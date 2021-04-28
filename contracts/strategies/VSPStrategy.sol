// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../Pausable.sol";
import "../interfaces/vesper/IController.sol";
import "../interfaces/vesper/IVesperPool.sol";
import "../interfaces/bloq/ISwapManager.sol";
import "../../sol-address-list/contracts/interfaces/IAddressListExt.sol";
import "../../sol-address-list/contracts/interfaces/IAddressListFactory.sol";

contract VSPStrategy is Pausable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    uint256 public lastRebalanceBlock;
    IController public immutable controller;
    IVesperPool public immutable vvsp;
    IAddressListExt public immutable keepers;
    ISwapManager public swapManager = ISwapManager(0xe382d9f2394A359B01006faa8A1864b8a60d2710);
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    uint256 public nextPoolIdx;
    address[] public pools;
    uint256[] public liquidationLimit;
    string public constant NAME = "Strategy-VSP";
    string public constant VERSION = "2.0.3";

    event UpdatedSwapManager(address indexed previousSwapManager, address indexed newSwapManager);

    constructor(address _controller, address _vvsp) public {
        vvsp = IVesperPool(_vvsp);
        controller = IController(_controller);
        IAddressListFactory factory =
            IAddressListFactory(0xD57b41649f822C51a73C44Ba0B3da4A880aF0029);
        IAddressListExt _keepers = IAddressListExt(factory.createList());
        _keepers.grantRole(keccak256("LIST_ADMIN"), _controller);
        keepers = _keepers;
    }

    modifier onlyKeeper() {
        require(keepers.contains(_msgSender()), "caller-is-not-keeper");
        _;
    }

    modifier onlyController() {
        require(_msgSender() == address(controller), "Caller is not the controller");
        _;
    }

    function pause() external onlyController {
        _pause();
    }

    function unpause() external onlyController {
        _unpause();
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

    function updateLiquidationQueue(address[] calldata _pools, uint256[] calldata _limit)
        external
        onlyController
    {
        for (uint256 i = 0; i < _pools.length; i++) {
            require(controller.isPool(_pools[i]), "Not a valid pool");
            require(_limit[i] != 0, "Limit cannot be zero");
        }
        pools = _pools;
        liquidationLimit = _limit;
        nextPoolIdx = 0;
    }

    function isUpgradable() external view returns (bool) {
        return IERC20(vvsp.token()).balanceOf(address(this)) == 0;
    }

    function pool() external view returns (address) {
        return address(vvsp);
    }

    /**
        withdraw Vtoken from vvsp => Deposit vpool => withdraw collateral => swap in uni for VSP => transfer vsp to vvsp pool
        VETH => ETH => VSP
     */
    function rebalance() external whenNotPaused onlyKeeper {
        require(
            block.number - lastRebalanceBlock >= controller.rebalanceFriction(address(vvsp)),
            "Can not rebalance"
        );
        lastRebalanceBlock = block.number;

        if (nextPoolIdx == pools.length) {
            nextPoolIdx = 0;
        }

        IVesperPool _poolToken = IVesperPool(pools[nextPoolIdx]);
        uint256 _balance = _poolToken.balanceOf(address(vvsp));
        if (_balance != 0 && address(_poolToken) != address(vvsp)) {
            if (_balance > liquidationLimit[nextPoolIdx]) {
                _balance = liquidationLimit[nextPoolIdx];
            }
            _rebalanceEarned(_poolToken, _balance);
        }
        nextPoolIdx++;
    }

    /// @dev sweep given token to vsp pool
    function sweepErc20(address _fromToken) external {
        uint256 amount = IERC20(_fromToken).balanceOf(address(this));
        IERC20(_fromToken).safeTransfer(address(vvsp), amount);
    }

    function _rebalanceEarned(IVesperPool _poolToken, uint256 _amt) internal {
        IERC20(address(_poolToken)).safeTransferFrom(address(vvsp), address(this), _amt);
        _poolToken.withdrawByStrategy(_amt);
        IERC20 from = IERC20(_poolToken.token());
        IERC20 vsp = IERC20(vvsp.token());
        (address[] memory path, uint256 amountOut, uint256 rIdx) =
            swapManager.bestOutputFixedInput(
                address(from),
                address(vsp),
                from.balanceOf(address(this))
            );
        if (amountOut != 0) {
            from.safeApprove(address(swapManager.ROUTERS(rIdx)), 0);
            from.safeApprove(address(swapManager.ROUTERS(rIdx)), from.balanceOf(address(this)));
            swapManager.ROUTERS(rIdx).swapExactTokensForTokens(
                from.balanceOf(address(this)),
                1,
                path,
                address(this),
                now + 30
            );
            vsp.safeTransfer(address(vvsp), vsp.balanceOf(address(this)));
        }
    }
}
