// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "./Strategy.sol";
import "../interfaces/compound/ICompound.sol";
import "../interfaces/vesper/IVesperPool.sol";

/// @title This strategy will deposit collateral token in Compound and earn interest.
abstract contract CompoundStrategy is Strategy {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    uint256 public pendingFee;

    CToken internal immutable cToken;
    address internal immutable rewardToken;
    Comptroller internal immutable comptroller;
    uint256 internal exchangeRateStored;

    constructor(
        address _controller,
        address _pool,
        address _receiptToken,
        address _rewardToken,
        address _comptroller
    ) public Strategy(_controller, _pool, _receiptToken) {
        require(_rewardToken != address(0), "RewardToken address is zero");
        cToken = CToken(_receiptToken);
        rewardToken = _rewardToken;
        comptroller = Comptroller(_comptroller);
    }

    /// @notice Vesper pools are using this function so it should exist in all strategies.
    //solhint-disable-next-line no-empty-blocks
    function beforeWithdraw() external override onlyPool {}

    /**
     * @dev Calculate interest fee on earning from Compound and transfer fee to fee collector.
     * Deposit available collateral from pool into Compound.
     * Anyone can call it except when paused.
     */
    function rebalance() external override onlyKeeper {
        _rebalanceEarned();
        uint256 balance = collateralToken.balanceOf(pool);
        if (balance != 0) {
            _deposit(balance);
        }
    }

    /// @notice Returns true if strategy can be upgraded.
    /// @dev If there are no cTokens in strategy then it is upgradable
    function isUpgradable() external view override returns (bool) {
        return cToken.balanceOf(address(this)) == 0;
    }

    /**
     * @notice Returns interest earned in COMP since last rebalance.
     * @dev Make sure to return value in collateral token
     */
    function interestEarned() public view override returns (uint256 collateralEarned) {
        uint256 compAccrued = comptroller.compAccrued(address(this));
        if (compAccrued != 0) {
            (, collateralEarned, ) = swapManager.bestOutputFixedInput(
                rewardToken,
                address(collateralToken),
                compAccrued
            );
        }
    }

    /// @notice This method is deprecated and will be removed from Strategies in next release
    function isReservedToken(address _token) public view override returns (bool) {
        return _token == address(cToken) || _token == rewardToken;
    }

    /**
     * @notice Total collateral locked in Compound.
     * @dev This value will be used in pool share calculation, so true totalLocked
     * will be balance in Compound minus any pending fee to collect.
     * @return Return value will be in collateralToken defined decimal.
     */
    function totalLocked() public view override returns (uint256) {
        uint256 _totalCTokens = cToken.balanceOf(pool).add(cToken.balanceOf(address(this)));
        return _convertToCollateral(_totalCTokens).sub(_calculatePendingFee());
    }

    function _approveToken(uint256 _amount) internal override {
        collateralToken.safeApprove(pool, _amount);
        collateralToken.safeApprove(address(cToken), _amount);
        for (uint256 i = 0; i < swapManager.N_DEX(); i++) {
            IERC20(rewardToken).safeApprove(address(swapManager.ROUTERS(i)), _amount);
        }
    }

    /**
     * @dev Claim rewardToken and convert rewardToken into collateral token.
     * Calculate interest fee on earning from rewardToken and transfer balance minus
     * fee to pool.
     * @dev Transferring collateral to pool will increase pool share price.
     */
    function _claimReward() internal override {
        address[] memory markets = new address[](1);
        markets[0] = address(cToken);
        comptroller.claimComp(address(this), markets);

        uint256 _rewardAmount = IERC20(rewardToken).balanceOf(address(this));
        if (_rewardAmount > 0) {
            _safeSwap(rewardToken, address(collateralToken), _rewardAmount);
            uint256 _collateralEarned = collateralToken.balanceOf(address(this));
            uint256 _fee = _collateralEarned.mul(controller.interestFee(pool)).div(1e18);
            collateralToken.safeTransfer(pool, _collateralEarned.sub(_fee));
        }
    }

    function _deposit(uint256 _amount) internal virtual override {
        collateralToken.safeTransferFrom(pool, address(this), _amount);
        require(cToken.mint(_amount) == 0, "deposit-failed");
    }

    /**
     * @notice Migrate tokens from pool to this address
     * @dev Any working Compound strategy has cTokens in strategy contract.
     * @dev There can be scenarios when pool already has cTokens and new
     * strategy will have to move those tokens from pool to self address.
     * @dev Only valid pool strategy is allowed to move tokens from pool.
     */
    function _migrateIn() internal override {
        require(controller.isPool(pool), "not-a-valid-pool");
        require(controller.strategy(pool) == address(this), "not-a-valid-strategy");
        IERC20(cToken).safeTransferFrom(pool, address(this), cToken.balanceOf(pool));
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
        IERC20(cToken).safeTransfer(pool, cToken.balanceOf(address(this)));
    }

    /**
     * @dev Calculate interest fee earning and transfer it to fee collector.
     * RebalanceEarned completes in following steps,
     *      Claim rewardToken and earn fee.
     *      Update pending fee.
     *      Withdraw collateral equal to pendingFee from compound.
     *      Now we have collateral equal to pendingFee + fee earning from rewardToken.
     *      Deposit collateral in Pool and get shares.
     *      Transfer shares to feeCollector.
     */
    function _rebalanceEarned() internal {
        _claimReward();
        _updatePendingFee();
        // Read state variable once to save gas
        uint256 _pendingFee = pendingFee;
        uint256 _cTokenAmount = _convertToCToken(_pendingFee);
        if (_cTokenAmount != 0) {
            require(cToken.redeemUnderlying(_pendingFee) == 0, "rebalanceEarned::withdraw-failed");
            // Update state variable
            pendingFee = 0;
            _afterRedeem();
        }
        _handleFee(collateralToken.balanceOf(address(this)));
    }

    function _withdraw(uint256 _amount) internal override {
        require(cToken.redeemUnderlying(_amount) == 0, "withdraw-failed");
        _afterRedeem();
        collateralToken.safeTransfer(pool, collateralToken.balanceOf(address(this)));
    }

    function _withdrawAll() internal override {
        pendingFee = 0;
        require(cToken.redeem(cToken.balanceOf(address(this))) == 0, "withdraw-all-failed");
        _afterRedeem();
        collateralToken.safeTransfer(pool, collateralToken.balanceOf(address(this)));
    }

    /// @dev Hook to call after collateral is redeemed from Compound
    /// @notice We did empty implementation as not all derived are going to implement it.
    //solhint-disable-next-line no-empty-blocks
    function _afterRedeem() internal virtual {}

    function _convertToCToken(uint256 _collateralAmount) internal view returns (uint256) {
        return _collateralAmount.mul(1e18).div(cToken.exchangeRateStored());
    }

    function _convertToCollateral(uint256 _cTokenAmount) internal view returns (uint256) {
        return _cTokenAmount.mul(cToken.exchangeRateStored()).div(1e18);
    }

    function _calculatePendingFee() internal view returns (uint256) {
        uint256 interest =
            cToken
                .exchangeRateStored()
                .sub(exchangeRateStored)
                .mul(cToken.balanceOf(address(this)))
                .div(1e18);
        uint256 fee = interest.mul(controller.interestFee(pool)).div(1e18);
        return pendingFee.add(fee);
    }

    function _updatePendingFee() internal override {
        pendingFee = _calculatePendingFee();
        exchangeRateStored = cToken.exchangeRateStored();
    }
}
