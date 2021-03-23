// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../Pausable.sol";
import "../interfaces/aave/IAave.sol";
import "../interfaces/vesper/IController.sol";
import "../interfaces/vesper/IStrategy.sol";
import "../interfaces/vesper/IVesperPool.sol";
import "../interfaces/uniswap/IUniswapV2Router02.sol";

/// @dev This strategy will deposit collateral token in Aave and earn interest.
abstract contract AaveStrategy is IStrategy, Pausable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    IController public immutable controller;
    IERC20 public immutable collateralToken;
    address public immutable override pool;
    uint256 public pendingFee;

    AToken internal immutable aToken;
    address internal constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address public constant AAVE_ADDRESSES_PROVIDER = 0x24a42fD28C976A61Df5D00D0599C34c4f90748c8;

    mapping(address => bool) private reservedToken;

    constructor(
        address _controller,
        address _pool,
        address _collateralToken
    ) public {
        require(_controller != address(0), "Controller address is zero");
        require(IController(_controller).isPool(_pool), "Not a valid pool");
        controller = IController(_controller);
        pool = _pool;
        collateralToken = IERC20(_collateralToken);
        address aTokenAddress = _getToken(_collateralToken == WETH ? ETH : _collateralToken);
        aToken = AToken(aTokenAddress);

        reservedToken[aTokenAddress] = true;
        reservedToken[_collateralToken] = true;
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

    /**
     * @notice Deposit all collateral token from pool into Aave.
     * Anyone can call it except when paused.
     */
    function depositAll() external live {
        deposit(collateralToken.balanceOf(pool));
    }

    //solhint-disable no-empty-blocks
    function beforeWithdraw() external override onlyPool {}

    /**
     * @dev Withdraw collateral token from Aave.
     * @param _amount Amount of collateral token
     */
    function withdraw(uint256 _amount) external override onlyAuthorized {
        _updatePendingFee();
        _withdraw(_amount);
    }

    /**
     * @dev Withdraw all collateral from Aave and deposit into pool.
     * Controller only function, called when migrating strategy.
     */
    function withdrawAll() external override onlyController {
        uint256 _balance = aToken.balanceOf(pool);
        if (_balance != 0) {
            pendingFee = 0;
            _withdraw(_balance);
        }
    }

    /**
     * @dev Deposit available collateral from pool into Aave.
     * Also calculate interest fee on earning from Aave and transfer fee to fee collector.
     * Anyone can call it except when paused.
     */
    function rebalance() external override live {
        _rebalanceEarned();
        uint256 balance = collateralToken.balanceOf(pool);
        if (balance != 0) {
            _deposit(balance);
        }
    }

    /**
     * @dev sweep given token to vesper pool
     * @param _fromToken token address to sweep
     */
    function sweepErc20(address _fromToken) external {
        if (_fromToken == ETH) {
            payable(pool).transfer(address(this).balance);
        } else {
            uint256 amount = IERC20(_fromToken).balanceOf(address(this));
            IERC20(_fromToken).safeTransfer(pool, amount);
        }
    }

    /// @dev Returns true if strategy can be upgraded.
    /// @dev If there are no aTokens in strategy then it is upgradable
    function isUpgradable() external view override returns (bool) {
        return aToken.balanceOf(address(this)) == 0;
    }

    function isReservedToken(address _token) external view override returns (bool) {
        return reservedToken[_token];
    }

    /// @dev Returns address of Aave token correspond to collateral token
    function token() external view override returns (address) {
        return address(aToken);
    }

    /// @dev Returns total collateral locked in pool via this strategy
    function totalLocked() external view override returns (uint256) {
        uint256 balance = aToken.balanceOf(pool);
        return balance.sub(_calculatePendingFee(balance));
    }

    /**
     * @notice Deposit collateral token from pool into Aave.
     * @dev Before deposit we also update pendingFee. Anyone can call it except when paused.
     * @param _amount Amount of collateral token
     */
    function deposit(uint256 _amount) public override live {
        _updatePendingFee();
        _deposit(_amount);
    }

    function _deposit(uint256 _amount) internal virtual {
        collateralToken.safeTransferFrom(pool, address(this), _amount);
        AaveAddressesProvider aaveProvider = AaveAddressesProvider(AAVE_ADDRESSES_PROVIDER);
        address aavePool = aaveProvider.getLendingPool();
        address aavePoolCore = aaveProvider.getLendingPoolCore();
        collateralToken.safeApprove(aavePoolCore, 0);
        collateralToken.safeApprove(aavePoolCore, _amount);

        AavePool(aavePool).deposit(
            address(collateralToken),
            _amount,
            controller.aaveReferralCode()
        );

        IERC20(address(aToken)).safeTransfer(pool, aToken.balanceOf(address(this)));
    }

    /**
     * @dev Calcualte earning from Aave and also calculate interest fee.
     * Deposit fee into Vesper pool to get Vesper pool shares.
     * Transfer fee, Vesper pool shares, to fee collector
     */
    function _rebalanceEarned() internal {
        _updatePendingFee();
        if (pendingFee != 0) {
            IERC20(address(aToken)).safeTransferFrom(pool, address(this), pendingFee);
            aToken.redeem(pendingFee);
            pendingFee = 0;
            _beforeFeeTransfer();
            uint256 feeInShare = IERC20(pool).balanceOf(address(this));
            IERC20(pool).safeTransfer(controller.feeCollector(pool), feeInShare);
        }
    }

    function _withdraw(uint256 _amount) internal virtual {
        IERC20(address(aToken)).safeTransferFrom(pool, address(this), _amount);
        aToken.redeem(_amount);
        collateralToken.safeTransfer(pool, collateralToken.balanceOf(address(this)));
    }

    /// @dev Hook to call before fee is transferred to fee collector.
    function _beforeFeeTransfer() internal virtual {
        uint256 collateralBalance = collateralToken.balanceOf(address(this));
        collateralToken.safeApprove(pool, 0);
        collateralToken.safeApprove(pool, collateralBalance);
        IVesperPool(pool).deposit(collateralBalance);
    }

    /// @dev Get aToken address
    function _getToken(address _collateralToken) internal view returns (address) {
        AaveAddressesProvider aaveProvider = AaveAddressesProvider(AAVE_ADDRESSES_PROVIDER);
        address aavePoolCore = aaveProvider.getLendingPoolCore();
        return AavePoolCore(aavePoolCore).getReserveATokenAddress(_collateralToken);
    }

    function _calculatePendingFee(uint256 aTokenBalance) internal view returns (uint256) {
        uint256 interest = aTokenBalance.sub(aToken.principalBalanceOf(pool));
        uint256 fee = interest.mul(controller.interestFee(pool)).div(1e18);
        return pendingFee.add(fee);
    }

    function _updatePendingFee() internal {
        pendingFee = _calculatePendingFee(aToken.balanceOf(pool));
    }
}
