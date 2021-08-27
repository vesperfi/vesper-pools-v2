// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./Strategy.sol";
import "../interfaces/vesper/ICollateralManager.sol";
import "../interfaces/uniswap/IUniswapV2Router02.sol";

interface ManagerInterface {
    function vat() external view returns (address);

    function open(bytes32, address) external returns (uint256);

    function cdpAllow(
        uint256,
        address,
        uint256
    ) external;
}

interface VatInterface {
    function hope(address) external;

    function nope(address) external;
}

/// @dev This strategy will deposit collateral token in Maker, borrow Dai and
/// deposit borrowed DAI in other lending pool to earn interest.
abstract contract MakerStrategy is Strategy {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    address internal constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
    ICollateralManager public immutable cm;
    bytes32 public immutable collateralType;
    uint256 public immutable vaultNum;
    uint256 public lastRebalanceBlock;
    uint256 public highWater;
    uint256 public lowWater;
    uint256 private constant WAT = 10**16;

    constructor(
        address _controller,
        address _pool,
        address _cm,
        address _receiptToken,
        bytes32 _collateralType
    ) public Strategy(_controller, _pool, _receiptToken) {
        collateralType = _collateralType;
        vaultNum = _createVault(_collateralType, _cm);
        cm = ICollateralManager(_cm);
    }

    /**
     * @dev Called during withdrawal process.
     * Initial plan was to not allowed withdraw if pool in underwater. BUT as 1 of
     * audit suggested we should not use resurface during withdraw, hence removed logic.
     */
    //solhint-disable-next-line no-empty-blocks
    function beforeWithdraw() external override onlyPool {}

    /**
     * @dev Rebalance earning and withdraw all collateral.
     * Controller only function, called when migrating strategy.
     */
    function withdrawAllWithRebalance() external onlyController {
        _rebalanceEarned();
        _withdrawAll();
    }

    /**
     * @dev Wrapper function for rebalanceEarned and rebalanceCollateral
     * Anyone can call it except when paused.
     */
    function rebalance() external override onlyKeeper {
        _rebalanceEarned();
        _rebalanceCollateral();
    }

    /**
     * @dev Rebalance collateral and debt in Maker.
     * Based on defined risk parameter either borrow more DAI from Maker or
     * payback some DAI in Maker. It will try to mitigate risk of liquidation.
     * Anyone can call it except when paused.
     */
    function rebalanceCollateral() external onlyKeeper {
        _rebalanceCollateral();
    }

    /**
     * @dev Convert earned DAI to collateral token
     * Also calculate interest fee on earning and transfer fee to fee collector.
     * Anyone can call it except when paused.
     */
    function rebalanceEarned() external onlyKeeper {
        _rebalanceEarned();
    }

    /**
     * @dev If pool is underwater this function will resolve underwater condition.
     * If Debt in Maker is greater than Dai balance in lender pool then pool in underwater.
     * Lowering DAI debt in Maker will resolve underwater condtion.
     * Resolve: Calculate required collateral token to lower DAI debt. Withdraw required
     * collateral token from pool and/or Maker and convert those to DAI via Uniswap.
     * Finally payback debt in Maker using DAI.
     */
    function resurface() external onlyKeeper {
        _resurface();
    }

    /**
     * @notice Update balancing factors aka high water and low water values.
     * Water mark values represent Collateral Ratio in Maker. For example 300 as high water
     * means 300% collateral ratio.
     * @param _highWater Value for high water mark.
     * @param _lowWater Value for low water mark.
     */
    function updateBalancingFactor(uint256 _highWater, uint256 _lowWater) external onlyController {
        require(_lowWater != 0, "lowWater-is-zero");
        require(_highWater > _lowWater, "highWater-less-than-lowWater");
        highWater = _highWater.mul(WAT);
        lowWater = _lowWater.mul(WAT);
    }

    /**
     * @notice Returns interest earned since last rebalance.
     * @dev Make sure to return value in collateral token and in order to do that
     * we are using Uniswap to get collateral amount for earned DAI.
     */
    function interestEarned() public view virtual override returns (uint256 amountOut) {
        uint256 _daiBalance = _getDaiBalance();
        uint256 _debt = cm.getVaultDebt(vaultNum);
        if (_daiBalance > _debt) {
            (, amountOut, ) = swapManager.bestOutputFixedInput(
                DAI,
                address(collateralToken),
                _daiBalance.sub(_debt)
            );
        }
    }

    /// @dev Check whether given token is reserved or not. Reserved tokens are not allowed to sweep.
    function isReservedToken(address _token) public view virtual override returns (bool) {
        return _token == receiptToken;
    }

    /**
     * @notice Returns true if pool is underwater.
     * @notice Underwater - If debt is greater than earning of pool.
     * @notice Earning - Sum of DAI balance and DAI from accured reward, if any, in lending pool.
     */
    function isUnderwater() public view virtual returns (bool) {
        return cm.getVaultDebt(vaultNum) > _getDaiBalance();
    }

    /// @dev Returns total collateral locked via this strategy
    function totalLocked() public view virtual override returns (uint256) {
        return convertFrom18(cm.getVaultBalance(vaultNum));
    }

    /// @dev Create new Maker vault
    function _createVault(bytes32 _collateralType, address _cm) internal returns (uint256 vaultId) {
        address mcdManager = ICollateralManager(_cm).mcdManager();
        ManagerInterface manager = ManagerInterface(mcdManager);
        vaultId = manager.open(_collateralType, address(this));
        manager.cdpAllow(vaultId, address(this), 1);

        //hope and cpdAllow on vat for collateralManager's address
        VatInterface(manager.vat()).hope(_cm);
        manager.cdpAllow(vaultId, _cm, 1);

        //Register vault with collateral Manager
        ICollateralManager(_cm).registerVault(vaultId, _collateralType);
    }

    function _approveToken(uint256 _amount) internal virtual override {
        IERC20(DAI).safeApprove(address(cm), _amount);
        IERC20(DAI).safeApprove(address(receiptToken), _amount);
        collateralToken.safeApprove(address(cm), _amount);
        collateralToken.safeApprove(pool, _amount);
        for (uint256 i = 0; i < swapManager.N_DEX(); i++) {
            IERC20(DAI).safeApprove(address(swapManager.ROUTERS(i)), _amount);
            collateralToken.safeApprove(address(swapManager.ROUTERS(i)), _amount);
        }
    }

    function _deposit(uint256 _amount) internal override {
        collateralToken.safeTransferFrom(pool, address(this), _amount);
        cm.depositCollateral(vaultNum, _amount);
    }

    function _depositDaiToLender(uint256 _amount) internal virtual;

    function _moveDaiToMaker(uint256 _amount) internal {
        if (_amount != 0) {
            _withdrawDaiFromLender(_amount);
            cm.payback(vaultNum, _amount);
        }
    }

    function _moveDaiFromMaker(uint256 _amount) internal virtual {
        cm.borrow(vaultNum, _amount);
        _amount = IERC20(DAI).balanceOf(address(this));
        _depositDaiToLender(_amount);
    }

    function _swapBalanceToCollateral(address _from) internal {
        uint256 amt = IERC20(_from).balanceOf(address(this));
        if (amt != 0) {
            _safeSwap(_from, address(collateralToken), amt);
        }
    }

    function _rebalanceCollateral() internal virtual {
        _deposit(collateralToken.balanceOf(pool));
        (
            uint256 collateralLocked,
            uint256 debt,
            uint256 collateralUsdRate,
            uint256 collateralRatio,
            uint256 minimumDebt
        ) = cm.getVaultInfo(vaultNum);
        uint256 maxDebt = collateralLocked.mul(collateralUsdRate).div(highWater);
        if (maxDebt < minimumDebt) {
            // Dusting scenario. Payback all DAI
            _moveDaiToMaker(debt);
        } else {
            if (collateralRatio > highWater) {
                require(!isUnderwater(), "pool-is-underwater");
                _moveDaiFromMaker(maxDebt.sub(debt));
            } else if (collateralRatio < lowWater) {
                // Redeem DAI from Lender and deposit in maker
                _moveDaiToMaker(debt.sub(maxDebt));
            }
        }
    }

    function _rebalanceEarned() internal virtual {
        require(
            (block.number - lastRebalanceBlock) >= controller.rebalanceFriction(pool),
            "can-not-rebalance"
        );
        lastRebalanceBlock = block.number;
        _claimReward();
        _rebalanceDaiInLender();
        _swapBalanceToCollateral(DAI);
        uint256 collateralBalance = collateralToken.balanceOf(address(this));
        if (collateralBalance != 0) {
            uint256 fee = collateralBalance.mul(controller.interestFee(pool)).div(1e18);
            collateralToken.safeTransfer(pool, collateralBalance.sub(fee));
            _handleFee(fee);
        }
    }

    function _resurface() internal {
        uint256 earnBalance = _getDaiBalance();
        uint256 debt = cm.getVaultDebt(vaultNum);
        require(debt > earnBalance, "pool-is-above-water");
        uint256 shortAmount = debt.sub(earnBalance);
        _paybackShortAmount(shortAmount);
    }

    function _paybackShortAmount(uint256 shortAmount) internal virtual {
        (address[] memory path, uint256 collateralNeeded, uint256 rIdx) =
            swapManager.bestInputFixedOutput(address(collateralToken), DAI, shortAmount);
        if (collateralNeeded != 0) {
            uint256 balance = collateralToken.balanceOf(pool);

            // If pool has more balance than tokenNeeded, get what needed from pool
            // else get pool balance from pool and remaining from Maker vault
            if (balance >= collateralNeeded) {
                collateralToken.safeTransferFrom(pool, address(this), collateralNeeded);
            } else {
                cm.withdrawCollateral(vaultNum, collateralNeeded.sub(balance));
                collateralToken.safeTransferFrom(pool, address(this), balance);
            }
            swapManager.ROUTERS(rIdx).swapExactTokensForTokens(
                collateralNeeded,
                1,
                path,
                address(this),
                block.timestamp
            );
            uint256 daiBalance = IERC20(DAI).balanceOf(address(this));
            cm.payback(vaultNum, daiBalance);
        }

        // If any collateral dust then send it to pool
        uint256 _collateralbalance = collateralToken.balanceOf(address(this));
        if (_collateralbalance != 0) {
            collateralToken.safeTransfer(pool, _collateralbalance);
        }
    }

    function _withdraw(uint256 _amount) internal override {
        (
            uint256 collateralLocked,
            uint256 debt,
            uint256 collateralUsdRate,
            uint256 collateralRatio,
            uint256 minimumDebt
        ) = cm.whatWouldWithdrawDo(vaultNum, _amount);
        if (debt != 0 && collateralRatio < lowWater) {
            // If this withdraw results in Low Water scenario.
            uint256 maxDebt = collateralLocked.mul(collateralUsdRate).div(highWater);
            if (maxDebt < minimumDebt) {
                // This is Dusting scenario
                _moveDaiToMaker(debt);
            } else if (maxDebt < debt) {
                _moveDaiToMaker(debt.sub(maxDebt));
            }
        }
        cm.withdrawCollateral(vaultNum, _amount);
        collateralToken.safeTransfer(pool, collateralToken.balanceOf(address(this)));
    }

    function _withdrawAll() internal override {
        _moveDaiToMaker(cm.getVaultDebt(vaultNum));
        require(cm.getVaultDebt(vaultNum) == 0, "debt-should-be-0");
        cm.withdrawCollateral(vaultNum, totalLocked());
        collateralToken.safeTransfer(pool, collateralToken.balanceOf(address(this)));
    }

    function _withdrawDaiFromLender(uint256 _amount) internal virtual;

    function _rebalanceDaiInLender() internal virtual {
        uint256 debt = cm.getVaultDebt(vaultNum);
        uint256 balance = _getDaiBalance();
        if (balance > debt) {
            _withdrawDaiFromLender(balance.sub(debt));
        }
    }

    function _getDaiBalance() internal view virtual returns (uint256);

    /// Calculating pending fee is not required for Maker strategy
    // solhint-disable-next-line no-empty-blocks
    function _updatePendingFee() internal virtual override {}

    //solhint-disable-next-line no-empty-blocks
    function _claimReward() internal virtual override {}
}
