// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../interfaces/vesper/IController.sol";
import "./Strategy.sol";
import "../interfaces/bloq/ISwapManager.sol";
import "../interfaces/vesper/IVesperPoolV3.sol";
import "../interfaces/vesper/IStrategyV3.sol";
import "../interfaces/vesper/IPoolRewardsV3.sol";

/// @title This strategy will deposit collateral token in VesperV3 and earn interest.
abstract contract VesperV3Strategy is Strategy {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    IVesperPoolV3 internal immutable vToken;

    constructor(
        address _controller,
        address _pool,
        address _receiptToken
    ) public Strategy(_controller, _pool, _receiptToken) {
        vToken = IVesperPoolV3(_receiptToken);
    }

    /**
     * @notice Migrate tokens from pool to this address
     * @dev Any working VesperV3 strategy has vTokens in strategy contract.
     * @dev There can be scenarios when pool already has vTokens and new
     * strategy will have to move those tokens from pool to self address.
     * @dev Only valid pool strategy is allowed to move tokens from pool.
     */
    function _migrateIn() internal override {
        require(controller.isPool(pool), "not-a-valid-pool");
        require(controller.strategy(pool) == address(this), "not-a-valid-strategy");
        IERC20(vToken).safeTransferFrom(pool, address(this), vToken.balanceOf(pool));
    }

    /**
     * @notice Migrate tokens out to pool.
     * @dev There can be scenarios when we want to use new strategy without
     * calling withdrawAll(). We can achieve this by moving tokens in pool
     * and new strategy will take care from there.
     * @dev Pause this strategy and move tokens out.
     */
    function _migrateOut() internal override {
        require(controller.isPool(pool), "not-a-valid-pool");
        _pause();
        IERC20(vToken).safeTransfer(pool, vToken.balanceOf(address(this)));
    }

    /// @notice Vesper pools are using this function so it should exist in all strategies.
    //solhint-disable-next-line no-empty-blocks
    function beforeWithdraw() external override onlyPool {}

    /**
     * @dev Calculate interest fee on earning from VesperV3 and transfer fee to fee collector.
     * Deposit available collateral from pool into VesperV3.
     * Anyone can call it except when paused.
     */
    function rebalance() external override whenNotPaused onlyKeeper {
        _claimReward();
        uint256 balance = collateralToken.balanceOf(pool);
        if (balance != 0) {
            _deposit(balance);
        }
    }

    /**
     * @notice Returns interest earned since last rebalance.
     */
    function interestEarned() public view override returns (uint256 collateralEarned) {
        // V3 Pool rewardToken can change over time so we don't store it in contract
        address _poolRewards = vToken.poolRewards();
        if (_poolRewards != address(0)) {
            address _rewardToken = IPoolRewardsV3(_poolRewards).rewardToken();
            uint256 _claimableRewards = IPoolRewardsV3(_poolRewards).claimable(address(this));
            // if there's any reward earned we add that to collateralEarned
            if (_claimableRewards != 0) {
                (, collateralEarned, ) = swapManager.bestOutputFixedInput(
                    _rewardToken,
                    address(collateralToken),
                    _claimableRewards
                );
            }
        }

        address[] memory _strategies = vToken.getStrategies();
        uint256 _len = _strategies.length;
        uint256 _unrealizedGain;

        for (uint256 i = 0; i < _len; i++) {
            uint256 _totalValue = IStrategyV3(_strategies[i]).totalValue();
            uint256 _debt = vToken.totalDebtOf(_strategies[i]);
            if (_totalValue > _debt) {
                _unrealizedGain = _unrealizedGain.add(_totalValue.sub(_debt));
            }
        }

        if (_unrealizedGain != 0) {
            // collateralEarned = rewards + unrealizedGain proportional to v2 share in v3
            collateralEarned = collateralEarned.add(
                _unrealizedGain.mul(vToken.balanceOf(address(this))).div(vToken.totalSupply())
            );
        }
    }

    /// @notice Returns true if strategy can be upgraded.
    /// @dev If there are no vTokens in strategy then it is upgradable
    function isUpgradable() external view override returns (bool) {
        return vToken.balanceOf(address(this)) == 0;
    }

    /// @notice This method is deprecated and will be removed from Strategies in next release
    function isReservedToken(address _token) public view override returns (bool) {
        address _poolRewards = vToken.poolRewards();
        return
            _token == address(vToken) ||
            (_poolRewards != address(0) && _token == IPoolRewardsV3(_poolRewards).rewardToken());
    }

    function _approveToken(uint256 _amount) internal override {
        collateralToken.safeApprove(pool, _amount);
        collateralToken.safeApprove(address(vToken), _amount);
        address _poolRewards = vToken.poolRewards();
        if (_poolRewards != address(0)) {
            address _rewardToken = IPoolRewardsV3(_poolRewards).rewardToken();
            for (uint256 i = 0; i < swapManager.N_DEX(); i++) {
                IERC20(_rewardToken).safeApprove(address(swapManager.ROUTERS(i)), _amount);
            }
        }
    }

    /**
     * @dev Converts rewardToken from V3 Pool to collateralToken
     * @notice V3 Pools will claim rewardToken onbehalf of caller on every withdraw/deposit
     */
    function _claimReward() internal override {
        // V3 Pool rewardToken can change over time so we don't store it in contract
        address _poolRewards = vToken.poolRewards();
        if (_poolRewards != address(0)) {
            IERC20 _rewardToken = IERC20(IPoolRewardsV3(_poolRewards).rewardToken());
            uint256 _rewardAmount = _rewardToken.balanceOf(address(this));
            if (_rewardAmount != 0)
                _safeSwap(address(_rewardToken), address(collateralToken), _rewardAmount);
        }
    }

    /**
     * @notice Total collateral locked in VesperV3.
     * @return Return value will be in collateralToken defined decimal.
     */
    function totalLocked() public view override returns (uint256) {
        uint256 _totalVTokens = vToken.balanceOf(pool).add(vToken.balanceOf(address(this)));
        return _convertToCollateral(_totalVTokens);
    }

    function _deposit(uint256 _amount) internal virtual override {
        collateralToken.safeTransferFrom(pool, address(this), _amount);
        vToken.deposit(_amount);
    }

    function _withdraw(uint256 _amount) internal override {
        _safeWithdraw(_convertToShares(_amount));
        collateralToken.safeTransfer(pool, collateralToken.balanceOf(address(this)));
    }

    /**
     * @dev V3 Pools may withdraw a partial amount of requested shares
     * Resulting in more burnt shares than actual collateral in V2
     * We make sure burnt shares equals to our expected value
     */
    function _safeWithdraw(uint256 _shares) internal {
        uint256 _maxShares = vToken.balanceOf(address(this));

        if (_shares != 0) {
            vToken.withdraw(_shares);

            require(
                vToken.balanceOf(address(this)) == _maxShares.sub(_shares),
                "Not enough shares withdrawn"
            );
        }
    }

    function _withdrawAll() internal override {
        _safeWithdraw(vToken.balanceOf(address(this)));
        _claimReward();
        collateralToken.safeTransfer(pool, collateralToken.balanceOf(address(this)));
    }

    function _convertToCollateral(uint256 _vTokenAmount) internal view returns (uint256) {
        uint256 _totalSupply = vToken.totalSupply();
        // avoids division by zero error when pool is empty
        return (_totalSupply != 0) ? vToken.totalValue().mul(_vTokenAmount).div(_totalSupply) : 0;
    }

    function _convertToShares(uint256 _collateralAmount) internal view returns (uint256) {
        return _collateralAmount.mul(vToken.totalSupply()).div(vToken.totalValue());
    }

    /**
     * @notice Returns interest earned since last rebalance.
     * @dev Empty implementation because V3 Strategies should collect pending interest fee
     */
    //solhint-disable-next-line no-empty-blocks
    function _updatePendingFee() internal override {}
}
