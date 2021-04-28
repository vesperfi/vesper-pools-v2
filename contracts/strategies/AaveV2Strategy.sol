// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "./Strategy.sol";
import "./AaveRewards.sol";
import "../interfaces/aave/IAaveV2.sol";
import "../interfaces/vesper/IVesperPool.sol";

/// @dev This strategy will deposit collateral token in Aave and earn interest.
abstract contract AaveV2Strategy is Strategy, AaveRewards {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    //solhint-disable-next-line const-name-snakecase
    AaveLendingPoolAddressesProvider public constant aaveAddressesProvider =
        AaveLendingPoolAddressesProvider(0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5);

    uint256 public pendingFee;
    IERC20 internal immutable aToken;
    uint256 internal collateralLocked;

    constructor(
        address _controller,
        address _pool,
        address _receiptToken
    ) public Strategy(_controller, _pool, _receiptToken) {
        aToken = IERC20(_receiptToken);
    }

    //solhint-disable no-empty-blocks
    function beforeWithdraw() external override onlyPool {}

    /**
     * @notice Returns interest earned since last rebalance.
     * @dev Make sure to return value in collateral token
     */
    function interestEarned() external view override returns (uint256 collateralEarned) {
        uint256 _aaveAmount = stkAAVE.getTotalRewardsBalance(address(this));
        if (_aaveAmount != 0) {
            (, collateralEarned, ) = swapManager.bestOutputFixedInput(
                AAVE,
                address(collateralToken),
                _aaveAmount
            );
        }
    }

    /// @notice Initiate cooldown to unstake aave.
    function startCooldown() external onlyKeeper returns (bool) {
        return _startCooldown();
    }

    /// @notice Unstake Aave from stakedAave contract
    function unstakeAave() external onlyKeeper {
        _unstakeAave();
    }

    /**
     * @dev Deposit available collateral from pool into Aave.
     * Also calculate interest fee on earning from Aave and transfer fee to fee collector.
     * Anyone can call it except when paused.
     */
    function rebalance() external override onlyKeeper {
        _rebalanceEarned();
        uint256 balance = collateralToken.balanceOf(pool);
        if (balance != 0) {
            _deposit(balance);
        }
    }

    /// @dev Returns true if strategy can be upgraded.
    /// @dev If there are no aTokens in strategy then it is upgradable
    function isUpgradable() external view override returns (bool) {
        return aToken.balanceOf(address(this)) == 0;
    }

    function isReservedToken(address _token) public view override returns (bool) {
        return _token == receiptToken || _token == AAVE || _token == address(stkAAVE);
    }

    /**
     * @notice Total collateral locked in Aave.
     * @dev This value will be used in pool share calculation, so true totalLocked
     * will be balance in Aave minus any pending fee to collect.
     * @return Return value will be in collateralToken defined decimal.
     */
    function totalLocked() public view override returns (uint256) {
        uint256 balance = aToken.balanceOf(pool).add(aToken.balanceOf(address(this)));
        return balance.sub(_calculatePendingFee(balance));
    }

    /// @notice Large approval of token
    function _approveToken(uint256 _amount) internal override {
        collateralToken.safeApprove(pool, _amount);
        collateralToken.safeApprove(aaveAddressesProvider.getLendingPool(), _amount);
        for (uint256 i = 0; i < swapManager.N_DEX(); i++) {
            IERC20(AAVE).safeApprove(address(swapManager.ROUTERS(i)), _amount);
        }
    }

    /**
     * @dev Claim Aave and convert it into collateral token.
     * Calculate interest fee on earning from Aave and transfer balance minus
     * fee to pool.
     * @dev Transferring collateral to pool will increase pool share price.
     */
    function _claimReward() internal override {
        uint256 _aaveAmount = _claimAave();
        if (_aaveAmount != 0) {
            _safeSwap(AAVE, address(collateralToken), _aaveAmount);
            uint256 _collateralEarned = collateralToken.balanceOf(address(this));
            uint256 _fee = _collateralEarned.mul(controller.interestFee(pool)).div(1e18);
            collateralToken.safeTransfer(pool, _collateralEarned.sub(_fee));
        }
    }

    function _deposit(uint256 _amount) internal virtual override {
        collateralToken.safeTransferFrom(pool, address(this), _amount);
        address _aaveLendingPool = aaveAddressesProvider.getLendingPool();

        AaveLendingPool(_aaveLendingPool).deposit(
            address(collateralToken),
            _amount,
            address(this),
            0
        );
        _updateCollateralLocked();
    }

    /**
     * @notice Migrate tokens from pool to this address
     * @dev Any working Aave strategy has aToken in strategy contract.
     * @dev There can be scenarios when pool already has aTokens and new
     * strategy will have to move those tokens from pool to self address.
     * @dev Only valid pool strategy is allowed to move tokens from pool.
     */
    function _migrateIn() internal override {
        require(controller.isPool(pool), "not-a-valid-pool");
        require(controller.strategy(pool) == address(this), "not-a-valid-strategy");
        aToken.safeTransferFrom(pool, address(this), aToken.balanceOf(pool));
    }

    /**
     * @notice Migrate tokens out to pool.
     * @dev There can be scenarios when we want to use new strategy without
     * calling withdrawAll(). We can achieve this by moving tokens in pool
     * and new strategy will take care from there.
     * @dev Pause this strategy, set pendingFee to zero and move tokens out.
     */
    function _migrateOut() internal override {
        require(controller.isPool(pool), "not-a-valid-pool");
        _pause();
        pendingFee = 0;
        aToken.safeTransfer(pool, aToken.balanceOf(address(this)));
        IERC20(stkAAVE).safeTransfer(pool, stkAAVE.balanceOf(address(this)));
    }

    /**
     * @dev Calcualte earning from Aave and also calculate interest fee.
     * Deposit fee into Vesper pool to get Vesper pool shares.
     * Transfer fee, Vesper pool shares, to fee collector
     */
    function _rebalanceEarned() internal {
        _updatePendingFee();
        _claimReward();
        if (pendingFee != 0) {
            // Withdraw pendingFee worth collateral from Aave
            _withdraw(pendingFee, address(this));
            pendingFee = 0;
        }
        _handleFee(collateralToken.balanceOf(address(this)));
    }

    /**
     * @dev Withdraw collateral token from Aave.
     * @param _amount Amount of collateral token
     */
    function _withdraw(uint256 _amount) internal override {
        _withdraw(_amount, pool);
    }

    /**
     * @dev Withdraw amount from Aave to given address
     * @param _amount Amount of aToken to withdraw
     * @param _to Address where you want receive collateral
     */
    function _withdraw(uint256 _amount, address _to) internal virtual {
        address aavePool = aaveAddressesProvider.getLendingPool();
        require(
            AaveLendingPool(aavePool).withdraw(address(collateralToken), _amount, _to) == _amount,
            "withdrawn-amount-is-not-correct"
        );
        _updateCollateralLocked();
    }

    /**
     * @dev Withdraw all collateral from Aave and deposit into pool.
     * Controller only function, called when migrating strategy.
     */
    function _withdrawAll() internal override {
        uint256 _balance = aToken.balanceOf(address(this));
        if (_balance != 0) {
            pendingFee = 0;
            _withdraw(_balance, pool);
        }
    }

    function _updateCollateralLocked() internal {
        collateralLocked = aToken.balanceOf(address(this));
    }

    function _updatePendingFee() internal override {
        pendingFee = _calculatePendingFee(aToken.balanceOf(address(this)));
    }

    function _calculatePendingFee(uint256 aTokenBalance) internal view returns (uint256) {
        uint256 interest = aTokenBalance.sub(collateralLocked);
        uint256 fee = interest.mul(controller.interestFee(pool)).div(1e18);
        return pendingFee.add(fee);
    }
}
