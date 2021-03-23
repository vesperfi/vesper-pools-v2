// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./PoolShareGovernanceToken.sol";
import "../interfaces/uniswap/IUniswapV2Router02.sol";
import "../../sol-address-list/contracts/interfaces/IAddressList.sol";

interface IVSPStrategy {
    function rebalance() external;
}

//solhint-disable no-empty-blocks, reason-string
contract VVSP is PoolShareGovernanceToken {
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    IAddressList public immutable pools;

    // Lock period, in seconds, is minimum required time between deposit and withdraw
    uint256 public lockPeriod;

    // user address to last deposit timestamp mapping
    mapping(address => uint256) public depositTimestamp;

    constructor(address _controller, address _token)
        public
        PoolShareGovernanceToken("vVSP pool", "vVSP", _token, _controller)
    {
        pools = IAddressList(IController(_controller).pools());
        lockPeriod = 1 days;
    }

    modifier onlyController() {
        require(address(controller) == _msgSender(), "Caller is not the controller");
        _;
    }

    function pause() external onlyController {
        _pause();
    }

    function unpause() external onlyController {
        _unpause();
    }

    function shutdown() external onlyController {
        _shutdown();
    }

    function open() external onlyController {
        _open();
    }

    /// @dev Approve strategy for given pool
    function approveToken(address pool, address strategy) external onlyController {
        require(pools.contains(pool), "Not a pool");
        require(strategy == controller.strategy(address(this)), "Not a strategy");
        IERC20(pool).safeApprove(strategy, MAX_UINT_VALUE);
    }

    /**
     * @dev Controller will call this function when new strategy is added in pool.
     * Approve strategy for all tokens
     */
    function approveToken() external onlyController {
        _approve(MAX_UINT_VALUE);
    }

    /// @dev update deposit lock period, only controller can call this function.
    function updateLockPeriod(uint256 _newLockPeriod) external onlyController {
        lockPeriod = _newLockPeriod;
    }

    /**
     * @dev Controller will call this function when strategy is removed from pool.
     * Reset approval of all tokens
     */
    function resetApproval() external onlyController {
        _approve(uint256(0));
    }

    function rebalance() external {
        require(!stopEverything || (_msgSender() == address(controller)), "Contract has shutdown");
        IVSPStrategy strategy = IVSPStrategy(controller.strategy(address(this)));
        strategy.rebalance();
    }

    function sweepErc20(address _erc20) external {
        require(
            _erc20 != address(token) && _erc20 != address(this) && !controller.isPool(_erc20),
            "Not allowed to sweep"
        );
        IUniswapV2Router02 uniswapRouter = IUniswapV2Router02(controller.uniswapRouter());
        IERC20 erc20 = IERC20(_erc20);
        uint256 amt = erc20.balanceOf(address(this));
        erc20.safeApprove(address(uniswapRouter), 0);
        erc20.safeApprove(address(uniswapRouter), amt);
        address[] memory path;
        if (address(_erc20) == WETH) {
            path = new address[](2);
            path[0] = address(_erc20);
            path[1] = address(token);
        } else {
            path = new address[](3);
            path[0] = address(_erc20);
            path[1] = address(WETH);
            path[2] = address(token);
        }
        uniswapRouter.swapExactTokensForTokens(amt, 1, path, address(this), now + 30);
    }

    function _afterBurning(uint256 amount) internal override {
        token.safeTransfer(_msgSender(), amount);
    }

    function _beforeMinting(uint256 amount) internal override {
        token.safeTransferFrom(_msgSender(), address(this), amount);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        if (from == address(0)) {
            // Token being minted i.e. user is depositing VSP
            // NOTE: here 'to' is same as 'msg.sender'
            depositTimestamp[to] = block.timestamp;
        } else {
            // transfer, transferFrom or withdraw is called.
            require(
                block.timestamp >= depositTimestamp[from].add(lockPeriod),
                "Operation not allowed due to lock period"
            );
        }
        // Move vVSP delegation when mint, burn, transfer or transferFrom is called.
        _moveDelegates(delegates[from], delegates[to], amount);
    }

    function _approve(uint256 approvalAmount) private {
        address strategy = controller.strategy(address(this));
        uint256 length = pools.length();
        for (uint256 i = 0; i < length; i++) {
            (address pool, ) = pools.at(i);
            IERC20(pool).safeApprove(strategy, approvalAmount);
        }
    }
}
