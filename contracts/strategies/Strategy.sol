// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../Pausable.sol";
import "../interfaces/vesper/IController.sol";
import "../interfaces/vesper/IStrategy.sol";
import "../interfaces/vesper/IVesperPool.sol";
import "../../sol-address-list/contracts/interfaces/IAddressListExt.sol";
import "../../sol-address-list/contracts/interfaces/IAddressListFactory.sol";

abstract contract Strategy is IStrategy, Pausable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    IController public immutable controller;
    IERC20 public immutable collateralToken;
    address public immutable receiptToken;
    address public immutable override pool;
    IAddressListExt public keepers;
    address internal constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    uint256 internal constant MAX_UINT_VALUE = uint256(-1);

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

    modifier live() {
        require(!paused || _msgSender() == address(controller), "contract-has-been-paused");
        _;
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
     * @dev Deposit collateral token into lending pool.
     * @param _amount Amount of collateral token
     */
    function deposit(uint256 _amount) public override live {
        _updatePendingFee();
        _deposit(_amount);
    }

    /**
     * @notice Deposit all collateral token from pool to other lending pool.
     * Anyone can call it except when paused.
     */
    function depositAll() external virtual live {
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
            payable(pool).transfer(address(this).balance);
        } else {
            uint256 _amount = IERC20(_fromToken).balanceOf(address(this));
            IERC20(_fromToken).safeTransfer(pool, _amount);
        }
    }

    /// @dev Returns true if strategy can be upgraded.
    function isUpgradable() external view override returns (bool) {
        return totalLocked() == 0;
    }

    /// @dev Returns address of token correspond to collateral token
    function token() external view override returns (address) {
        return receiptToken;
    }

    /// @dev Check whether given token is reserved or not. Reserved tokens are not allowed to sweep.
    function isReservedToken(address _token) public view virtual override returns (bool);

    /// @dev Returns total collateral locked here
    function totalLocked() public view virtual override returns (uint256);

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

    function _deposit(uint256 _amount) internal virtual;

    function _withdraw(uint256 _amount) internal virtual;

    function _approveToken(uint256 _amount) internal virtual;

    function _updatePendingFee() internal virtual;

    function _withdrawAll() internal virtual;
}
