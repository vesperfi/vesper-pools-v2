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
    function interestEarned() external view override returns (uint256 collateralEarned) {
        uint256 _daiBalanceHere = _getDaiBalance();
        uint256 _debt = cm.getVaultDebt(vaultNum);

        if (_daiBalanceHere > _debt) {
            collateralEarned = _getAmountsOut(
                DAI,
                address(collateralToken),
                _daiBalanceHere.sub(_debt)
            );
        }

        uint256 _compAccrued = comptroller.compAccrued(address(this));
        if (_compAccrued != 0) {
            collateralEarned = collateralEarned.add(
                _getAmountsOut(rewardToken, address(collateralToken), _compAccrued)
            );
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
            _daiEarned = _getAmountsOut(rewardToken, DAI, _compAccrued);
        }
        return cm.getVaultDebt(vaultNum) > _getDaiBalance().add(_daiEarned);
    }

    function _approveToken(uint256 _amount) internal override {
        super._approveToken(_amount);
        IUniswapV2Router02 uniswapRouter = IUniswapV2Router02(controller.uniswapRouter());
        IERC20(rewardToken).safeApprove(address(uniswapRouter), _amount);
    }

    /// @notice Claim rewardToken from lender and convert it into DAI
    function _claimReward() internal {
        address[] memory _markets = new address[](1);
        _markets[0] = address(cToken);
        comptroller.claimComp(address(this), _markets);

        uint256 _rewardAmount = IERC20(rewardToken).balanceOf(address(this));
        if (_rewardAmount > 0) {
            _safeSwap(_rewardAmount, _getPath(rewardToken, DAI));
        }
    }

    function _depositDaiToLender(uint256 _amount) internal override {
        require(cToken.mint(_amount) == 0, "deposit-in-compound-failed");
    }

    function _getAmountsOut(
        address _from,
        address _to,
        uint256 _amountIn
    ) internal view returns (uint256) {
        IUniswapV2Router02 _uniswapRouter = IUniswapV2Router02(controller.uniswapRouter());
        address[] memory _path = _getPath(_from, _to);
        return _uniswapRouter.getAmountsOut(_amountIn, _path)[_path.length - 1];
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
    function _rebalanceDaiInLender() internal {
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

    /**
     * @notice Harvest earning from COMP and DAI and convert earning to collateral token.
     * Then calculate interest fee on earned collateral and transfer earned minus
     * fee to pool.
     * @dev Transferring collateral to pool will increase pool share price.
     */
    function _rebalanceEarned() internal override {
        require(
            (block.number - lastRebalanceBlock) >= controller.rebalanceFriction(pool),
            "can-not-rebalance"
        );
        lastRebalanceBlock = block.number;
        // Claim reward and convert it to DAI
        _claimReward();
        // Use earned DAI to rebalance DAI in lender
        _rebalanceDaiInLender();

        // Convert available DAI into collateral token
        uint256 _daiBalanceHere = IERC20(DAI).balanceOf(address(this));
        if (_daiBalanceHere != 0) {
            _safeSwap(_daiBalanceHere, _getPath(DAI, address(collateralToken)));
            // Calculate interest fee earned and send earning minus fee to pool
            uint256 _collateralEarned = collateralToken.balanceOf(address(this));
            if (_collateralEarned != 0) {
                uint256 _fee = _collateralEarned.mul(controller.interestFee(pool)).div(1e18);
                collateralToken.safeTransfer(pool, _collateralEarned.sub(_fee));
                _handleFee(_fee);
            }
        }
    }

    /**
     * @notice Safe swap via Uniswap
     * @dev There are many scenarios when token swap via Uniswap can fail, so this
     * method will wrap Uniswap call in a 'try catch' to make it fail safe.
     * @param _amount Amount to be swapped
     * @param _path Conversion path for swap
     */
    function _safeSwap(uint256 _amount, address[] memory _path) private {
        IUniswapV2Router02 _uniswapRouter = IUniswapV2Router02(controller.uniswapRouter());

        // Swap and get collateralToken here.
        // It is possible that amount out resolves to 0
        // Which will cause the swap to fail
        try _uniswapRouter.getAmountsOut(_amount, _path) returns (uint256[] memory amounts) {
            if (amounts[_path.length - 1] != 0) {
                _uniswapRouter.swapExactTokensForTokens(
                    _amount,
                    1,
                    _path,
                    address(this),
                    block.timestamp + 30
                );
            }
            // solhint-disable-next-line no-empty-blocks
        } catch {}
    }

    function _withdrawDaiFromLender(uint256 _amount) internal override {
        require(cToken.redeemUnderlying(_amount) == 0, "withdraw-from-compound-failed");
    }

    function _withdrawExcessDaiFromLender(uint256 _base) internal override {
        uint256 _daiBalance = _getDaiBalance();
        if (_daiBalance > _base) {
            _withdrawDaiFromLender(_daiBalance.sub(_base));
        }
    }
}
