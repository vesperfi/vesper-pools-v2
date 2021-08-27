// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../Pausable.sol";
import "../interfaces/bloq/ISwapManager.sol";
import "../interfaces/vesper/IController.sol";
import "../interfaces/vesper/IStrategy.sol";
import "../interfaces/vesper/IVesperPool.sol";
import "../../sol-address-list/contracts/interfaces/IAddressListExt.sol";
import "../../sol-address-list/contracts/interfaces/IAddressListFactory.sol";

abstract contract Strategy is IStrategy, Pausable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    // solhint-disable-next-line
    ISwapManager public swapManager = ISwapManager(0xe382d9f2394A359B01006faa8A1864b8a60d2710);
    IController public immutable controller;
    IERC20 public immutable collateralToken;
    address public immutable receiptToken;
    address public immutable override pool;
    IAddressListExt public keepers;
    address internal constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    uint256 internal constant MAX_UINT_VALUE = type(uint256).max;

    event UpdatedSwapManager(address indexed previousSwapManager, address indexed newSwapManager);

    constructor(
        address _controller,
        address _pool,
        address _receiptToken
    ) public {
        require(_controller != address(0), "controller-address-is-zero");
        require(IController(_controller).isPool(_pool), "not-a-valid-pool");
        controller = IController(_controller);
        pool = _pool;
        collateralToken = IERC20(IVesperPool(_pool).token());
        receiptToken = _receiptToken;
    }

    modifier onlyAuthorized() {
        require(
            _msgSender() == address(controller) || _msgSender() == pool,
            "caller-is-not-authorized"
        );
        _;
    }

    modifier onlyController() {
        require(_msgSender() == address(controller), "caller-is-not-the-controller");
        _;
    }

    modifier onlyKeeper() {
        require(keepers.contains(_msgSender()), "caller-is-not-keeper");
        _;
    }

    modifier onlyPool() {
        require(_msgSender() == pool, "caller-is-not-the-pool");
        _;
    }

    function pause() external override onlyController {
        _pause();
    }

    function unpause() external override onlyController {
        _unpause();
    }

    /// @dev Approve all required tokens
    function approveToken() external onlyController {
        _approveToken(0);
        _approveToken(MAX_UINT_VALUE);
    }

    /// @dev Reset approval of all required tokens
    function resetApproval() external onlyController {
        _approveToken(0);
    }

    /**
     * @notice Create keeper list
     * @dev Create keeper list
     * NOTE: Any function with onlyKeeper modifier will not work until this function is called.
     * NOTE: Due to gas constraint this function cannot be called in constructor.
     */
    function createKeeperList() external onlyController {
        require(address(keepers) == address(0), "keeper-list-already-created");
        IAddressListFactory factory =
            IAddressListFactory(0xD57b41649f822C51a73C44Ba0B3da4A880aF0029);
        keepers = IAddressListExt(factory.createList());
        keepers.grantRole(keccak256("LIST_ADMIN"), _msgSender());
    }

    /**
     * @notice Update swap manager address
     * @param _swapManager swap manager address
     */
    function updateSwapManager(address _swapManager) external onlyController {
        require(_swapManager != address(0), "sm-address-is-zero");
        require(_swapManager != address(swapManager), "sm-is-same");
        emit UpdatedSwapManager(address(swapManager), _swapManager);
        swapManager = ISwapManager(_swapManager);
    }

    /**
     * @dev Deposit collateral token into lending pool.
     * @param _amount Amount of collateral token
     */
    function deposit(uint256 _amount) public override onlyKeeper {
        _updatePendingFee();
        _deposit(_amount);
    }

    /**
     * @notice Deposit all collateral token from pool to other lending pool.
     * Anyone can call it except when paused.
     */
    function depositAll() external virtual onlyKeeper {
        deposit(collateralToken.balanceOf(pool));
    }

    /**
     * @dev Withdraw collateral token from lending pool.
     * @param _amount Amount of collateral token
     */
    function withdraw(uint256 _amount) external override onlyAuthorized {
        _updatePendingFee();
        _withdraw(_amount);
    }

    /**
     * @dev Withdraw all collateral. No rebalance earning.
     * Controller only function, called when migrating strategy.
     */
    function withdrawAll() external override onlyController {
        _withdrawAll();
    }

    /**
     * @dev sweep given token to vesper pool
     * @param _fromToken token address to sweep
     */
    function sweepErc20(address _fromToken) external onlyKeeper {
        require(!isReservedToken(_fromToken), "not-allowed-to-sweep");
        if (_fromToken == ETH) {
            Address.sendValue(payable(pool), address(this).balance);
        } else {
            uint256 _amount = IERC20(_fromToken).balanceOf(address(this));
            IERC20(_fromToken).safeTransfer(pool, _amount);
        }
    }

    /// @dev Returns true if strategy can be upgraded.
    function isUpgradable() external view virtual override returns (bool) {
        return totalLocked() == 0;
    }

    /// @dev Returns address of token correspond to collateral token
    function token() external view override returns (address) {
        return receiptToken;
    }

    /// @dev Convert from 18 decimals to token defined decimals. Default no conversion.
    function convertFrom18(uint256 amount) public pure virtual returns (uint256) {
        return amount;
    }

    /// @dev report the interest earned since last rebalance
    function interestEarned() external view virtual returns (uint256);

    /// @dev Check whether given token is reserved or not. Reserved tokens are not allowed to sweep.
    function isReservedToken(address _token) public view virtual override returns (bool);

    /// @dev Returns total collateral locked here
    function totalLocked() public view virtual override returns (uint256);

    /// @dev For moving between versions of similar strategies
    function migrateIn() external onlyController {
        _migrateIn();
    }

    /// @dev For moving between versions of similar strategies
    function migrateOut() external onlyController {
        _migrateOut();
    }

    /**
     * @notice Handle earned interest fee
     * @dev Earned interest fee will go to the fee collector. We want fee to be in form of Vepseer
     * pool tokens not in collateral tokens so we will deposit fee in Vesper pool and send vTokens
     * to fee collactor.
     * @param _fee Earned interest fee in collateral token.
     */
    function _handleFee(uint256 _fee) internal virtual {
        if (_fee != 0) {
            IVesperPool(pool).deposit(_fee);
            uint256 _feeInVTokens = IERC20(pool).balanceOf(address(this));
            IERC20(pool).safeTransfer(controller.feeCollector(pool), _feeInVTokens);
        }
    }

    /**
     * @notice Safe swap via Uniswap
     * @dev There are many scenarios when token swap via Uniswap can fail, so this
     * method will wrap Uniswap call in a 'try catch' to make it fail safe.
     * @param _from address of from token
     * @param _to address of to token
     * @param _amount Amount to be swapped
     */
    function _safeSwap(
        address _from,
        address _to,
        uint256 _amount
    ) internal {
        (address[] memory _path, uint256 amountOut, uint256 rIdx) =
            swapManager.bestOutputFixedInput(_from, _to, _amount);
        if (amountOut != 0) {
            swapManager.ROUTERS(rIdx).swapExactTokensForTokens(
                _amount,
                1,
                _path,
                address(this),
                block.timestamp + 30
            );
        }
    }

    function _deposit(uint256 _amount) internal virtual;

    function _withdraw(uint256 _amount) internal virtual;

    function _approveToken(uint256 _amount) internal virtual;

    function _updatePendingFee() internal virtual;

    function _withdrawAll() internal virtual;

    function _migrateIn() internal virtual;

    function _migrateOut() internal virtual;

    function _claimReward() internal virtual;
}
