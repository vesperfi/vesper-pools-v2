// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./PoolShareToken.sol";
import "../interfaces/uniswap/IUniswapV2Router02.sol";
import "../interfaces/vesper/IStrategy.sol";

abstract contract VTokenBase is PoolShareToken {
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    constructor(
        string memory name,
        string memory symbol,
        address _token,
        address _controller
    ) public PoolShareToken(name, symbol, _token, _controller) {
        require(_controller != address(0), "Controller address is zero");
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

    /// @dev Approve strategy to spend collateral token and strategy token of pool.
    function approveToken() external virtual onlyController {
        address strategy = controller.strategy(address(this));
        token.safeApprove(strategy, MAX_UINT_VALUE);
        IERC20(IStrategy(strategy).token()).safeApprove(strategy, MAX_UINT_VALUE);
    }

    /// @dev Reset token approval of strategy. Called when updating strategy.
    function resetApproval() external virtual onlyController {
        address strategy = controller.strategy(address(this));
        token.safeApprove(strategy, 0);
        IERC20(IStrategy(strategy).token()).safeApprove(strategy, 0);
    }

    /**
     * @dev Rebalance invested collateral to mitigate liquidation risk, if any.
     * Behavior of rebalance is driven by risk parameters defined in strategy.
     */
    function rebalance() external virtual {
        IStrategy strategy = IStrategy(controller.strategy(address(this)));
        strategy.rebalance();
    }

    /**
     * @dev Convert given ERC20 token into collateral token via Uniswap
     * @param _erc20 Token address
     */
    function sweepErc20(address _erc20) external virtual {
        _sweepErc20(_erc20);
    }

    /// @dev Returns collateral token locked in strategy
    function tokenLocked() public view virtual returns (uint256) {
        IStrategy strategy = IStrategy(controller.strategy(address(this)));
        return strategy.totalLocked();
    }

    /// @dev Returns total value of vesper pool, in terms of collateral token
    function totalValue() public view override returns (uint256) {
        return tokenLocked().add(tokensHere());
    }

    /**
     * @dev After burning hook, it will be called during withdrawal process.
     * It will withdraw collateral from strategy and transfer it to user.
     */
    function _afterBurning(uint256 _amount) internal override {
        uint256 balanceHere = tokensHere();
        if (balanceHere < _amount) {
            _withdrawCollateral(_amount.sub(balanceHere));
            balanceHere = tokensHere();
            _amount = balanceHere < _amount ? balanceHere : _amount;
        }
        token.safeTransfer(_msgSender(), _amount);
    }

    /**
     * @dev Before burning hook.
     * Some actions, like resurface(), can impact share price and has to be called before withdraw.
     */
    function _beforeBurning(
        uint256 /* shares */
    ) internal override {
        IStrategy strategy = IStrategy(controller.strategy(address(this)));
        strategy.beforeWithdraw();
    }

    function _beforeMinting(uint256 amount) internal override {
        token.safeTransferFrom(_msgSender(), address(this), amount);
    }

    function _withdrawCollateral(uint256 amount) internal virtual {
        IStrategy strategy = IStrategy(controller.strategy(address(this)));
        strategy.withdraw(amount);
    }

    function _sweepErc20(address _from) internal {
        IStrategy strategy = IStrategy(controller.strategy(address(this)));
        require(
            _from != address(token) && _from != address(this) && !strategy.isReservedToken(_from),
            "Not allowed to sweep"
        );
        IUniswapV2Router02 uniswapRouter = IUniswapV2Router02(controller.uniswapRouter());
        uint256 amt = IERC20(_from).balanceOf(address(this));
        IERC20(_from).safeApprove(address(uniswapRouter), 0);
        IERC20(_from).safeApprove(address(uniswapRouter), amt);
        address[] memory path;
        if (address(token) == WETH) {
            path = new address[](2);
            path[0] = _from;
            path[1] = address(token);
        } else {
            path = new address[](3);
            path[0] = _from;
            path[1] = WETH;
            path[2] = address(token);
        }
        uniswapRouter.swapExactTokensForTokens(amt, 1, path, address(this), now + 30);
    }
}
