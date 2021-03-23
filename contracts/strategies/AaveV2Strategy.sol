// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../Pausable.sol";
import "../interfaces/aave/IAaveV2.sol";
import "../interfaces/vesper/IController.sol";
import "../interfaces/vesper/IStrategy.sol";
import "../interfaces/vesper/IVesperPool.sol";
import "../interfaces/uniswap/IUniswapV2Router02.sol";

/// @dev This strategy will deposit collateral token in Aave and earn interest.
abstract contract AaveV2Strategy is IStrategy, Pausable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    IController public immutable controller;
    IERC20 public immutable collateralToken;

    //solhint-disable-next-line const-name-snakecase
    AaveLendingPoolAddressesProvider public constant aaveAddressesProvider =
        AaveLendingPoolAddressesProvider(0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5);
    address public immutable override pool;
    uint256 public pendingFee;

    IERC20 internal immutable aToken;

    uint256 internal collateralLocked;

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
        address aTokenAddress = _getToken(_collateralToken);
        aToken = IERC20(aTokenAddress);

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
        _withdraw(_amount, pool);
    }

    /**
     * @dev Withdraw all collateral from Aave and deposit into pool.
     * Controller only function, called when migrating strategy.
     */
    function withdrawAll() external override onlyController {
        uint256 _balance = aToken.balanceOf(pool);
        if (_balance != 0) {
            pendingFee = 0;
            _withdraw(_balance, pool);
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
        uint256 amount = IERC20(_fromToken).balanceOf(address(this));
        IERC20(_fromToken).safeTransfer(pool, amount);
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
        address _aaveLendingPool = aaveAddressesProvider.getLendingPool();
        collateralToken.safeApprove(_aaveLendingPool, 0);
        collateralToken.safeApprove(_aaveLendingPool, _amount);

        AaveLendingPool(_aaveLendingPool).deposit(
            address(collateralToken),
            _amount,
            pool,
            controller.aaveReferralCode()
        );
        _updateCollateralLocked();
    }

    /**
     * @dev Calcualte earning from Aave and also calculate interest fee.
     * Deposit fee into Vesper pool to get Vesper pool shares.
     * Transfer fee, Vesper pool shares, to fee collector
     */
    function _rebalanceEarned() internal {
        _updatePendingFee();
        if (pendingFee != 0) {
            // Withdraw pendingFee worth collateral from Aave
            _withdraw(pendingFee, address(this));
            pendingFee = 0;

            // Deposit collateral in pool and get shares
            uint256 collateralBalance = collateralToken.balanceOf(address(this));
            collateralToken.safeApprove(pool, 0);
            collateralToken.safeApprove(pool, collateralBalance);
            IVesperPool(pool).deposit(collateralBalance);
            uint256 feeInShare = IERC20(pool).balanceOf(address(this));
            IERC20(pool).safeTransfer(controller.feeCollector(pool), feeInShare);
        }
    }

    /**
     * @dev Withdraw amount from Aave to given address
     * @param _amount Amount of aToken to withdraw
     * @param _to Address where you want receive collateral
     */
    function _withdraw(uint256 _amount, address _to) internal virtual {
        IERC20(address(aToken)).safeTransferFrom(pool, address(this), _amount);
        address aavePool = aaveAddressesProvider.getLendingPool();
        AaveLendingPool(aavePool).withdraw(address(collateralToken), _amount, _to);
        _updateCollateralLocked();
    }

    /// @dev Get aToken address
    function _getToken(address _collateralToken) internal view returns (address) {
        bytes32 providerId = 0x0100000000000000000000000000000000000000000000000000000000000000;
        address aaveProtocolDataProvider = aaveAddressesProvider.getAddress(providerId);
        (address aTokenAddress, , ) =
            AaveProtocolDataProvider(aaveProtocolDataProvider).getReserveTokensAddresses(
                _collateralToken
            );
        return aTokenAddress;
    }

    function _calculatePendingFee(uint256 aTokenBalance) internal view returns (uint256) {
        uint256 interest = aTokenBalance.sub(collateralLocked);
        uint256 fee = interest.mul(controller.interestFee(pool)).div(1e18);
        return pendingFee.add(fee);
    }

    function _updatePendingFee() internal {
        pendingFee = _calculatePendingFee(aToken.balanceOf(pool));
    }

    function _updateCollateralLocked() internal {
        collateralLocked = aToken.balanceOf(pool);
    }
}
