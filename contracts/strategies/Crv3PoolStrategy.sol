// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../interfaces/vesper/IVesperPool.sol";
import "./Strategy.sol";
import "./Crv3PoolMgr.sol";

/// @title This strategy will deposit collateral token in Curve and earn interest.
abstract contract Crv3PoolStrategy is Crv3PoolMgr, Strategy {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    mapping(address => bool) private reservedToken;
    address[] private oracles;

    uint256 public constant ORACLE_PERIOD = 3600; // 1h
    uint256 public usdRate;
    uint256 public usdRateTimestamp;
    uint256 public immutable collIdx;

    uint256 public prevLpRate;
    uint256 public pendingFee;

    uint256 public depositSlippage = 500; // 10000 is 100%
    event UpdatedDepositSlippage(uint256 oldSlippage, uint256 newSlippage);

    constructor(
        address _controller,
        address _pool,
        uint256 _collateralIdx
    ) public Strategy(_controller, _pool, THREECRV) Crv3PoolMgr() {
        require(_collateralIdx < COINS.length, "Invalid collateral for 3Pool");
        require(
            COIN_ADDRS[_collateralIdx] == IVesperPool(_pool).token(),
            "Collateral does not match"
        );
        reservedToken[THREECRV] = true;
        reservedToken[COIN_ADDRS[_collateralIdx]] = true;
        reservedToken[CRV] = true;
        collIdx = _collateralIdx;
        _setupOracles();
    }

    function updateDepositSlippage(uint256 _newSlippage) external onlyController {
        require(_newSlippage != depositSlippage, "same-slippage");
        require(_newSlippage < 10000, "invalid-slippage-value");
        emit UpdatedDepositSlippage(depositSlippage, _newSlippage);
        depositSlippage = _newSlippage;
    }

    function _setupOracles() internal {
        oracles.push(swapManager.createOrUpdateOracle(CRV, WETH, ORACLE_PERIOD, 0));
        for (uint256 i = 0; i < COIN_ADDRS.length; i++) {
            oracles.push(swapManager.createOrUpdateOracle(COIN_ADDRS[i], WETH, ORACLE_PERIOD, 0));
        }
    }

    function _estimateSlippage(uint256 _amount, uint256 _slippage) internal pure returns (uint256) {
        return _amount.mul(10000 - _slippage).div(10000);
    }

    function _consultOracle(
        address _from,
        address _to,
        uint256 _amt
    ) internal returns (uint256, bool) {
        // from, to, amountIn, period, router
        uint256 rate;
        uint256 lastUpdate;
        (rate, lastUpdate, ) = swapManager.consult(_from, _to, _amt, ORACLE_PERIOD, 0);
        // We're looking at a TWAP ORACLE with a 1 hr Period that has been updated within the last hour
        if ((lastUpdate > (block.timestamp - ORACLE_PERIOD)) && (rate != 0)) return (rate, true);
        return (0, false);
    }

    function _consultOracleFree(
        address _from,
        address _to,
        uint256 _amt
    ) internal view returns (uint256, bool) {
        // from, to, amountIn, period, router
        uint256 rate;
        uint256 lastUpdate;
        (rate, lastUpdate) = swapManager.consultForFree(_from, _to, _amt, ORACLE_PERIOD, 0);
        // We're looking at a TWAP ORACLE with a 1 hr Period that has been updated within the last hour
        if ((lastUpdate > (block.timestamp - ORACLE_PERIOD)) && (rate != 0)) return (rate, true);
        return (0, false);
    }

    // given the rates of 3 stablecoins compared with a common denominator
    // return the lowest divided by the highest
    function _getSafeUsdRate() internal returns (uint256) {
        // use a stored rate if we've looked it up recently
        if (usdRateTimestamp > block.timestamp - ORACLE_PERIOD && usdRate != 0) return usdRate;
        // otherwise, calculate a rate and store it.
        uint256 lowest;
        uint256 highest;
        for (uint256 i = 0; i < COIN_ADDRS.length; i++) {
            // get the rate for $1
            (uint256 rate, bool isValid) = _consultOracle(COIN_ADDRS[i], WETH, 10**DECIMALS[i]);
            if (isValid) {
                if (lowest == 0 || rate < lowest) {
                    lowest = rate;
                }
                if (highest < rate) {
                    highest = rate;
                }
            }
        }
        // We only need to check one of them because if a single valid rate is returned,
        // highest == lowest and highest > 0 && lowest > 0
        require(lowest != 0, "no-oracle-rates");
        usdRateTimestamp = block.timestamp;
        usdRate = (lowest * 1e18) / highest;
        return usdRate;
    }

    function _getSafeUsdRateFree() internal view returns (uint256) {
        // use a stored rate if we've looked it up recently
        if (usdRateTimestamp > block.timestamp - ORACLE_PERIOD && usdRate != 0) return usdRate;
        // otherwise, calculate a rate and store it.
        uint256 lowest;
        uint256 highest;
        for (uint256 i = 0; i < COIN_ADDRS.length; i++) {
            // get the rate for $1
            (uint256 rate, bool isValid) = _consultOracleFree(COIN_ADDRS[i], WETH, 10**DECIMALS[i]);
            if (isValid) {
                if (lowest == 0 || rate < lowest) {
                    lowest = rate;
                }
                if (highest < rate) {
                    highest = rate;
                }
            }
        }
        // We only need to check one of them because if a single valid rate is returned,
        // highest == lowest and highest > 0 && lowest > 0
        require(lowest != 0, "no-oracle-rates");
        uint256 rate = (lowest * 1e18) / highest;
        return rate;
    }

    function interestEarned() external view override returns (uint256 collAmt) {
        uint256 crvAccrued = claimableRewards();
        if (crvAccrued != 0) {
            (, collAmt, ) = swapManager.bestOutputFixedInput(
                CRV,
                address(collateralToken),
                crvAccrued
            );
        }
        uint256 currentRate = _minimumLpPrice(_getSafeUsdRateFree());
        if (currentRate > prevLpRate) {
            collAmt = collAmt.add(
                convertFrom18(totalLp().mul(currentRate.sub(prevLpRate)).div(1e18))
            );
        }
    }

    function _updatePendingFee() internal override {
        uint256 currLpRate = _minimumLpPrice(_getSafeUsdRate());
        if (prevLpRate != 0) {
            if (currLpRate > prevLpRate) {
                pendingFee = pendingFee.add(
                    convertFrom18(
                        currLpRate
                            .sub(prevLpRate)
                            .mul(totalLp())
                            .mul(controller.interestFee(pool))
                            .div(1e36)
                    )
                );
            } else {
                // don't take fees if we're not making money
                return;
            }
        }
        prevLpRate = currLpRate;
    }

    function rebalance() external override whenNotPaused {
        // Check for LP appreciation and withdraw fees
        _updatePendingFee();
        uint256 fee = pendingFee;
        // Get CRV rewards and convert to Collateral
        // collect fees on profit from reward
        _claimCrv();
        uint256 earnedCollateral = _swapCrvToCollateral();
        if (earnedCollateral != 0) {
            fee = fee.add(earnedCollateral.mul(controller.interestFee(pool)).div(1e18));
        }
        if (fee != 0) {
            if (fee > earnedCollateral) {
                _unstakeAndWithdrawAsCollateral(fee.sub(earnedCollateral));
            }
            _handleFee(fee);
            pendingFee = 0;
        }
        // make any relevant deposits
        _deposit(collateralToken.balanceOf(pool));
    }

    /// Not needed for this strategy
    // solhint-disable-next-line no-empty-blocks
    function beforeWithdraw() external override {}

    /// @dev Check whether given token is reserved or not. Reserved tokens are not allowed to sweep.
    function isReservedToken(address _token) public view override returns (bool) {
        return reservedToken[_token];
    }

    /// @notice Returns true if strategy can be upgraded.
    /// @dev If there are no cTokens in strategy then it is upgradable
    function isUpgradable() external view override returns (bool) {
        return (totalLp() == 0) && (collateralToken.balanceOf(address(this)) == 0);
    }

    /// @dev Returns total collateral locked here
    function totalLocked() public view override returns (uint256) {
        return
            collateralToken
                .balanceOf(address(this))
                .add(getLpValueAs(totalLp().add(IERC20(crvLp).balanceOf(pool)), collIdx))
                .sub(pendingFee);
    }

    function _deposit(uint256 _amount) internal override {
        // get deposits from pool
        if (_amount != 0) {
            collateralToken.safeTransferFrom(pool, address(this), _amount);
        }
        // if we have any collateral left here from other operations, that should go too
        uint256[3] memory depositAmounts;
        depositAmounts[collIdx] = collateralToken.balanceOf(address(this));
        uint256 minLpAmount =
            _estimateSlippage(
                (depositAmounts[collIdx].mul(1e18)).div(_minimumLpPrice(_getSafeUsdRate())),
                depositSlippage
            );
        THREEPOOL.add_liquidity(depositAmounts, minLpAmount);
        _stakeAllLpToGauge();
    }

    function _withdraw(uint256 _amount) internal override {
        _unstakeAndWithdrawAsCollateral(_amount);
        collateralToken.safeTransfer(pool, IERC20(collateralToken).balanceOf(address(this)));
    }

    function _approveToken(uint256 _amount) internal override {
        collateralToken.safeApprove(pool, _amount);
        collateralToken.safeApprove(crvPool, _amount);
        for (uint256 i = 0; i < swapManager.N_DEX(); i++) {
            IERC20(CRV).safeApprove(address(swapManager.ROUTERS(i)), _amount);
        }
        IERC20(crvLp).safeApprove(crvGauge, _amount);
    }

    function _withdrawAll() internal override {
        pendingFee = 0;
        _unstakeAllLpFromGauge();
        _withdrawAllAs(collIdx);
        collateralToken.safeTransfer(pool, collateralToken.balanceOf(address(this)));
    }

    /// dev this function would only be a single line, so its omitted to save gas
    // solhint-disable-next-line no-empty-blocks
    function _claimReward() internal override {}

    function _unstakeAndWithdrawAsCollateral(uint256 _amount) internal {
        (uint256 lpToWithdraw, uint256 unstakeAmt) = calcWithdrawLpAs(_amount, collIdx);
        _unstakeLpFromGauge(unstakeAmt);
        uint256 minAmtOut =
            (convertFrom18(_minimumLpPrice(_getSafeUsdRate())) * lpToWithdraw) / 1e18;

        _withdrawAsFromCrvPool(lpToWithdraw, minAmtOut, collIdx);
    }

    function _swapCrvToCollateral() internal returns (uint256 collateralAmt) {
        uint256 amt = IERC20(CRV).balanceOf(address(this));
        if (amt != 0) {
            (address[] memory path, uint256 amountOut, uint256 rIdx) =
                swapManager.bestOutputFixedInput(CRV, address(collateralToken), amt);
            if (amountOut != 0) {
                collateralAmt = swapManager.ROUTERS(rIdx).swapExactTokensForTokens(
                    amt,
                    1,
                    path,
                    address(this),
                    block.timestamp
                )[path.length - 1];
            }
        }
    }

    function _migrateOut() internal override {
        require(controller.isPool(pool), "not-a-valid-pool");
        _pause();
        pendingFee = 0;
        _unstakeAllLpFromGauge();
        IERC20(crvLp).safeTransfer(pool, IERC20(crvLp).balanceOf(address(this)));
    }

    function _migrateIn() internal override {
        require(controller.isPool(pool), "not-a-valid-pool");
        require(controller.strategy(pool) == address(this), "not-a-valid-strategy");
        IERC20(crvLp).safeTransferFrom(pool, address(this), IERC20(crvLp).balanceOf(pool));
    }
}
