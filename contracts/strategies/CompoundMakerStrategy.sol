// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./MakerStrategy.sol";
import "../interfaces/compound/ICompound.sol";

/// @dev This strategy will deposit collateral token in Maker, borrow Dai and
/// deposit borrowed DAI in Compound to earn interest.
abstract contract CompoundMakerStrategy is MakerStrategy {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    address internal immutable rewardToken;
    CToken internal immutable cToken;
    Comptroller internal immutable comptroller;

    constructor(
        address _controller,
        address _pool,
        address _cm,
        address _receiptToken,
        bytes32 _collateralType,
        address _rewardToken,
        address _comptroller
    ) public MakerStrategy(_controller, _pool, _cm, _receiptToken, _collateralType) {
        require(_rewardToken != address(0), "reward-token-address-is-zero");
        require(_receiptToken != address(0), "cToken-address-is-zero");
        require(_comptroller != address(0), "comptroller-address-is-zero");

        rewardToken = _rewardToken;
        cToken = CToken(_receiptToken);
        comptroller = Comptroller(_comptroller);
    }

    /**
     * @notice Returns earning from COMP and DAI since last rebalance.
     * @dev Make sure to return value in collateral token and in order to do that
     * we are using Uniswap to get collateral amount for earned CMOP and DAI.
     */
    function interestEarned() public view override returns (uint256 collateralEarned) {
        uint256 _daiBalanceHere = _getDaiBalance();
        uint256 _debt = cm.getVaultDebt(vaultNum);

        if (_daiBalanceHere > _debt) {
            (, collateralEarned, ) = swapManager.bestOutputFixedInput(
                DAI,
                address(collateralToken),
                _daiBalanceHere.sub(_debt)
            );
        }

        uint256 _compAccrued = comptroller.compAccrued(address(this));
        if (_compAccrued != 0) {
            (, uint256 accruedCollateral, ) =
                swapManager.bestOutputFixedInput(
                    rewardToken,
                    address(collateralToken),
                    _compAccrued
                );
            collateralEarned = collateralEarned.add(accruedCollateral);
        }
    }

    /// @dev Check whether given token is reserved or not. Reserved tokens are not allowed to sweep.
    function isReservedToken(address _token) public view override returns (bool) {
        return _token == receiptToken || _token == rewardToken;
    }

    /**
     * @notice Returns true if pool is underwater.
     * @notice Underwater - If debt is greater than earning of pool.
     * @notice Earning - Sum of DAI balance and DAI from accured reward, if any, in lending pool.
     * @dev There can be a scenario when someone calls claimComp() periodically which will
     * leave compAccrued = 0 and pool might be underwater. Call rebalance() to liquidate COMP.
     */
    function isUnderwater() public view override returns (bool) {
        uint256 _compAccrued = comptroller.compAccrued(address(this));
        uint256 _daiEarned;
        if (_compAccrued != 0) {
            (, _daiEarned, ) = swapManager.bestOutputFixedInput(rewardToken, DAI, _compAccrued);
        }
        return cm.getVaultDebt(vaultNum) > _getDaiBalance().add(_daiEarned);
    }

    function _approveToken(uint256 _amount) internal override {
        super._approveToken(_amount);
        for (uint256 i = 0; i < swapManager.N_DEX(); i++) {
            IERC20(rewardToken).safeApprove(address(swapManager.ROUTERS(i)), _amount);
        }
    }

    /// @notice Claim rewardToken from lender and convert it into DAI
    function _claimReward() internal override {
        address[] memory _markets = new address[](1);
        _markets[0] = address(cToken);
        comptroller.claimComp(address(this), _markets);

        uint256 _rewardAmount = IERC20(rewardToken).balanceOf(address(this));
        if (_rewardAmount != 0) {
            _safeSwap(rewardToken, DAI, _rewardAmount);
        }
    }

    function _depositDaiToLender(uint256 _amount) internal override {
        require(cToken.mint(_amount) == 0, "deposit-in-compound-failed");
    }

    function _getDaiBalance() internal view override returns (uint256) {
        return cToken.balanceOf(address(this)).mul(cToken.exchangeRateStored()).div(1e18);
    }

    /**
     * @dev Rebalance DAI in lender. If lender has more DAI than DAI debt in Maker
     * then withdraw excess DAI from lender. If lender is short on DAI, underwater,
     * then deposit DAI to lender.
     * @dev There may be a scenario where we do not have enough DAI to deposit to
     * lender, in that case pool will be underwater even after rebalanceDai.
     */
    function _rebalanceDaiInLender() internal override {
        uint256 _daiDebtInMaker = cm.getVaultDebt(vaultNum);
        uint256 _daiInLender = _getDaiBalance();
        if (_daiInLender > _daiDebtInMaker) {
            _withdrawDaiFromLender(_daiInLender.sub(_daiDebtInMaker));
        } else if (_daiInLender < _daiDebtInMaker) {
            uint256 _daiBalanceHere = IERC20(DAI).balanceOf(address(this));
            uint256 _daiNeeded = _daiDebtInMaker.sub(_daiInLender);
            if (_daiBalanceHere > _daiNeeded) {
                _depositDaiToLender(_daiNeeded);
            } else {
                _depositDaiToLender(_daiBalanceHere);
            }
        }
    }

    function _withdrawDaiFromLender(uint256 _amount) internal override {
        require(cToken.redeemUnderlying(_amount) == 0, "withdraw-from-compound-failed");
    }

    /// dev these functions are not implemented for this strategy
    // solhint-disable-next-line no-empty-blocks
    function _migrateIn() internal override {}

    // solhint-disable-next-line no-empty-blocks
    function _migrateOut() internal override {}
}
