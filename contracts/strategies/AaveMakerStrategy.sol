// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../Pausable.sol";
import "../interfaces/aave/IAave.sol";
import "../interfaces/maker/IMakerDAO.sol";
import "../interfaces/vesper/ICollateralManager.sol";
import "../interfaces/vesper/IController.sol";
import "../interfaces/vesper/IStrategy.sol";
import "../interfaces/vesper/IVesperPool.sol";
import "../interfaces/uniswap/IUniswapV2Router02.sol";

/// @dev This strategy will deposit collateral token in Maker and borrow DAI
/// and deposit borrowed DAI in Aave to earn interest on it.
abstract contract AaveMakerStrategy is IStrategy, Pausable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address public constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
    address public constant AAVE_ADDRESSES_PROVIDER = 0x24a42fD28C976A61Df5D00D0599C34c4f90748c8;
    ICollateralManager public immutable cm;
    IController public immutable controller;
    IERC20 public immutable collateralToken;
    bytes32 public immutable collateralType;
    uint256 public immutable vaultNum;
    address public immutable override pool;
    uint256 public lastRebalanceBlock;
    uint256 public highWater;
    uint256 public lowWater;

    uint256 internal constant MAX_UINT_VALUE = uint256(-1);
    uint256 private constant WAT = 10**16;
    AToken private immutable aToken;

    mapping(address => bool) private reservedToken;

    constructor(
        address _controller,
        address _pool,
        address _collateralToken,
        address _cm,
        bytes32 _collateralType
    ) public {
        require(_controller != address(0), "Controller address is zero");
        require(IController(_controller).isPool(_pool), "Not a valid pool");
        controller = IController(_controller);
        collateralType = _collateralType;
        vaultNum = _createVault(_collateralType, _cm);
        pool = _pool;
        collateralToken = IERC20(_collateralToken);
        cm = ICollateralManager(_cm);
        address aTokenAddress = _getToken();
        aToken = AToken(aTokenAddress);

        reservedToken[_collateralToken] = true;
        reservedToken[aTokenAddress] = true;
        reservedToken[DAI] = true;
    }

    modifier live() {
        require(!paused || _msgSender() == address(controller), "Contract has paused");
        _;
    }

    modifier onlyAuthorized() {
        require(
            _msgSender() == address(controller) || _msgSender() == pool,
            "Caller is not authorized"
        );
        _;
    }

    modifier onlyController() {
        require(_msgSender() == address(controller), "Caller is not the controller");
        _;
    }

    modifier onlyPool() {
        require(_msgSender() == pool, "Caller is not pool");
        _;
    }

    function pause() external override onlyController {
        _pause();
    }

    function unpause() external override onlyController {
        _unpause();
    }

    /// @dev Approve Dai and collateralToken to collateral manager
    function approveToken() external onlyController {
        IERC20(DAI).safeApprove(address(cm), MAX_UINT_VALUE);
        collateralToken.safeApprove(address(cm), MAX_UINT_VALUE);
    }

    /// @dev Reset Dai and collateralToken approval of collateral manager
    function resetApproval() external onlyController {
        IERC20(DAI).safeApprove(address(cm), 0);
        collateralToken.safeApprove(address(cm), 0);
    }

    /**
     * @dev Deposit collateral token into Maker vault.
     * @param _amount Amount of collateral token
     */
    function deposit(uint256 _amount) external override onlyPool {
        _deposit(_amount);
    }

    /**
     * @dev Called during withdrawal process.
     * Withdraw is not allowed if pool in underwater.
     * If pool is underwater, calling resurface() will bring pool above water.
     * It will impact share price in pool and that's why it has to be called before withdraw.
     */
    function beforeWithdraw() external override onlyPool {
        if (isUnderwater()) {
            _resurface();
        }
    }

    /**
     * @dev Withdraw collateral token from Maker and in order to do that strategy
     * has to withdraw Dai from Aave and payback Dai in Maker.
     * @param _amount Amount of collateral token to be withdrawn
     */
    function withdraw(uint256 _amount) external override onlyAuthorized {
        _withdraw(_amount);
    }

    /**
     * @dev Rebalance earning and withdraw all collateral.
     * Controller only function, called when migrating strategy.
     */
    function withdrawAllWithRebalance() external onlyController {
        _rebalanceEarned();
        _withdrawAll();
    }

    /**
     * @dev Withdraw all collateral. No rebalance earning.
     * Controller only function, called when migrating strategy.
     */
    function withdrawAll() external override onlyController {
        _withdrawAll();
    }

    /**
     * @dev Wrapper function for rebalanceEarned and rebalanceCollateral
     * Anyone can call it except when paused.
     */
    function rebalance() external override live {
        _rebalanceEarned();
        _rebalanceCollateral();
    }

    /**
     * @dev Rebalance collateral and debt in Maker.
     * Based on defined risk parameter either borrow more DAI from Maker or
     * payback some DAI in Maker. It will try to mitigate risk of liquidation.
     * Anyone can call it except when paused.
     */
    function rebalanceCollateral() external live {
        _rebalanceCollateral();
    }

    /**
     * @dev Convert earned DAI from Aave to collateral token
     * Also calculate interest fee on earning from Aave and transfer fee to fee collector.
     * Anyone can call it except when paused.
     */
    function rebalanceEarned() external live {
        _rebalanceEarned();
    }

    /**
     * @dev If pool is underwater this function will resolve underwater condition.
     * If Debt in Maker is greater than aDAI balance in Aave then pool in underwater.
     * Lowering DAI debt in Maker will resolve underwater condtion.
     * Resolve: Calculate required collateral token to lower DAI debt. Withdraw required
     * collateral token from pool and/or Maker and convert those to DAI via Uniswap.
     * Finally payback debt in Maker using DAI.
     */
    function resurface() external live {
        _resurface();
    }

    /// @dev sweep given ERC20 token to vesper pool
    function sweepErc20(address _fromToken) external {
        uint256 amount = IERC20(_fromToken).balanceOf(address(this));
        IERC20(_fromToken).safeTransfer(pool, amount);
    }

    function updateBalancingFactor(uint256 _highWater, uint256 _lowWater) external onlyController {
        require(_lowWater != 0, "Value is zero");
        require(_highWater > _lowWater, "highWater <= lowWater");
        highWater = _highWater.mul(WAT);
        lowWater = _lowWater.mul(WAT);
    }

    /**
     * @notice Returns interest earned since last rebalance.
     * @dev Make sure to return value in collateral token and in order to do that
     * we are using Uniswap to get collateral amount for earned DAI.
     */
    function interestEarned() external view returns (uint256) {
        uint256 aDaiBalance = aToken.balanceOf(pool);
        uint256 debt = cm.getVaultDebt(vaultNum);
        if (aDaiBalance > debt) {
            uint256 daiEarned = aDaiBalance.sub(debt);
            IUniswapV2Router02 uniswapRouter = IUniswapV2Router02(controller.uniswapRouter());
            address[] memory path = _getPath(DAI, address(collateralToken));
            return uniswapRouter.getAmountsOut(daiEarned, path)[path.length - 1];
        }
        return 0;
    }

    /// @dev Returns true if strategy can be upgraded.
    function isUpgradable() external view override returns (bool) {
        return totalLocked() == 0;
    }

    function isReservedToken(address _token) external view override returns (bool) {
        return reservedToken[_token];
    }

    /// @dev Address of Aave DAI token
    function token() external view override returns (address) {
        return address(aToken);
    }

    /// @dev Check if pool is underwater i.e. debt is greater than aDai in Aave
    function isUnderwater() public view returns (bool) {
        return cm.getVaultDebt(vaultNum) > aToken.balanceOf(pool);
    }

    /// @dev Returns total collateral locked in Maker vault
    function totalLocked() public view override returns (uint256) {
        return convertFrom18(cm.getVaultBalance(vaultNum));
    }

    /// @dev Convert from 18 decimals to token defined decimals. Default no conversion.
    function convertFrom18(uint256 _amount) public pure virtual returns (uint256) {
        return _amount;
    }

    /// @dev Create new Maker vault
    function _createVault(bytes32 _collateralType, address _cm) internal returns (uint256 vaultId) {
        address mcdManager = ICollateralManager(_cm).mcdManager();
        ManagerLike manager = ManagerLike(mcdManager);
        vaultId = manager.open(_collateralType, address(this));
        manager.cdpAllow(vaultId, address(this), 1);

        //hope and cpdAllow on vat for collateralManager's address
        VatLike(manager.vat()).hope(_cm);
        manager.cdpAllow(vaultId, _cm, 1);

        //Register vault with collateral Manager
        ICollateralManager(_cm).registerVault(vaultId, _collateralType);
    }

    function _deposit(uint256 _amount) internal {
        collateralToken.safeTransferFrom(pool, address(this), _amount);
        cm.depositCollateral(vaultNum, _amount);
    }

    function _depositDaiToAave(uint256 _amount) internal {
        AaveAddressesProvider aaveProvider = AaveAddressesProvider(AAVE_ADDRESSES_PROVIDER);
        address aavePool = aaveProvider.getLendingPool();
        address aavePoolCore = aaveProvider.getLendingPoolCore();

        IERC20(DAI).safeApprove(aavePoolCore, 0);
        IERC20(DAI).safeApprove(aavePoolCore, _amount);
        AavePool(aavePool).deposit(DAI, _amount, controller.aaveReferralCode());
        IERC20(address(aToken)).safeTransfer(pool, _amount);
    }

    /**
     * @dev Deposit fee into Vesper pool to get Vesper pool shares.
     * Transfer fee, Vesper pool shares, to fee collector.
     */
    function _handleFee(uint256 fee) internal {
        if (fee != 0) {
            collateralToken.safeApprove(pool, 0);
            collateralToken.safeApprove(pool, fee);
            IVesperPool(pool).deposit(fee);
            uint256 feeInShare = IERC20(pool).balanceOf(address(this));
            IERC20(pool).safeTransfer(controller.feeCollector(pool), feeInShare);
        }
    }

    function _moveDaiToMaker(uint256 _amount) internal {
        if (_amount != 0) {
            _withdrawDaiFromAave(_amount);
            cm.payback(vaultNum, _amount);
        }
    }

    function _moveDaiFromMaker(uint256 _amount) internal {
        cm.borrow(vaultNum, _amount);
        // In edge case, we might be able to borrow less, so better check how much DAI we borrowed
        _amount = IERC20(DAI).balanceOf(address(this));
        _depositDaiToAave(_amount);
    }

    function _rebalanceCollateral() internal {
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
                require(!isUnderwater(), "Pool is underwater");
                _moveDaiFromMaker(maxDebt.sub(debt));
            } else if (collateralRatio < lowWater) {
                // Redeem DAI from Aave and deposit in maker
                _moveDaiToMaker(debt.sub(maxDebt));
            }
        }
    }

    function _rebalanceEarned() internal {
        require(
            (block.number - lastRebalanceBlock) >= controller.rebalanceFriction(pool),
            "Can not rebalance"
        );
        lastRebalanceBlock = block.number;
        uint256 debt = cm.getVaultDebt(vaultNum);
        _withdrawExcessDaiFromAave(debt);
        uint256 balance = IERC20(DAI).balanceOf(address(this));
        if (balance != 0) {
            IUniswapV2Router02 uniswapRouter = IUniswapV2Router02(controller.uniswapRouter());
            IERC20(DAI).safeApprove(address(uniswapRouter), 0);
            IERC20(DAI).safeApprove(address(uniswapRouter), balance);
            address[] memory path = _getPath(DAI, address(collateralToken));
            // Swap and get collateralToken here.
            // It is possible that amount out resolves to 0
            // Which will cause the swap to fail
            try uniswapRouter.getAmountsOut(balance, path) returns (uint256[] memory amounts) {
                if (amounts[path.length - 1] != 0) {
                    uniswapRouter.swapExactTokensForTokens(
                        balance,
                        1,
                        path,
                        address(this),
                        now + 30
                    );
                    uint256 collateralBalance = collateralToken.balanceOf(address(this));
                    uint256 fee = collateralBalance.mul(controller.interestFee(pool)).div(1e18);
                    collateralToken.safeTransfer(pool, collateralBalance.sub(fee));
                    _handleFee(fee);
                }
            } catch {}
        }
    }

    function _resurface() internal {
        uint256 earnBalance = aToken.balanceOf(pool);
        uint256 debt = cm.getVaultDebt(vaultNum);
        require(debt > earnBalance, "Pool is above water");
        uint256 shortAmount = debt.sub(earnBalance);
        IUniswapV2Router02 uniswapRouter = IUniswapV2Router02(controller.uniswapRouter());
        address[] memory path = _getPath(address(collateralToken), DAI);
        uint256 tokenNeeded = uniswapRouter.getAmountsIn(shortAmount, path)[0];

        uint256 balance = collateralToken.balanceOf(pool);

        // If pool has more balance than tokenNeeded, get what needed from pool
        // else get pool balance from pool and remaining from Maker vault
        if (balance >= tokenNeeded) {
            collateralToken.safeTransferFrom(pool, address(this), tokenNeeded);
        } else {
            cm.withdrawCollateral(vaultNum, tokenNeeded.sub(balance));
            collateralToken.safeTransferFrom(pool, address(this), balance);
        }
        collateralToken.safeApprove(address(uniswapRouter), 0);
        collateralToken.safeApprove(address(uniswapRouter), tokenNeeded);
        uniswapRouter.swapExactTokensForTokens(tokenNeeded, 1, path, address(this), now + 30);
        uint256 daiBalance = IERC20(DAI).balanceOf(address(this));
        cm.payback(vaultNum, daiBalance);

        // If Uniswap operation leave any collateral dust then send it to pool
        uint256 _collateralbalance = collateralToken.balanceOf(address(this));
        if (_collateralbalance != 0) {
            collateralToken.safeTransfer(pool, _collateralbalance);
        }
    }

    function _withdrawDaiFromAave(uint256 _amount) internal {
        IERC20(address(aToken)).safeTransferFrom(pool, address(this), _amount);
        aToken.redeem(_amount);
    }

    function _withdrawExcessDaiFromAave(uint256 _base) internal {
        uint256 balance = aToken.balanceOf(pool);
        if (balance > _base) {
            uint256 amount = balance.sub(_base);
            IERC20(address(aToken)).safeTransferFrom(pool, address(this), amount);
            aToken.redeem(amount);
        }
    }

    function _withdraw(uint256 _amount) internal {
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

    function _withdrawAll() internal {
        _moveDaiToMaker(cm.getVaultDebt(vaultNum));
        require(cm.getVaultDebt(vaultNum) == 0, "Debt should be 0");
        cm.withdrawCollateral(vaultNum, totalLocked());
        collateralToken.safeTransfer(pool, collateralToken.balanceOf(address(this)));
    }

    /// @dev Get aToken address
    function _getToken() internal view returns (address) {
        AaveAddressesProvider aaveProvider = AaveAddressesProvider(AAVE_ADDRESSES_PROVIDER);
        address aavePoolCore = aaveProvider.getLendingPoolCore();
        return AavePoolCore(aavePoolCore).getReserveATokenAddress(DAI);
    }

    function _getPath(address _from, address _to) internal pure returns (address[] memory) {
        address[] memory path;
        if (_from == WETH || _to == WETH) {
            path = new address[](2);
            path[0] = _from;
            path[1] = _to;
        } else {
            path = new address[](3);
            path[0] = _from;
            path[1] = WETH;
            path[2] = _to;
        }
        return path;
    }
}
