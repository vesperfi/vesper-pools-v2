// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./CompoundStrategy.sol";
import "../interfaces/token/IToken.sol";

//solhint-disable no-empty-blocks
contract CompoundStrategyETH is CompoundStrategy {
    string public constant NAME = "Strategy-Compound-ETH";
    string public constant VERSION = "2.0.3";

    constructor(address _controller, address _pool)
        public
        CompoundStrategy(
            _controller,
            _pool,
            0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5,
            0xc00e94Cb662C3520282E6f5717214004A7f26888,
            0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B
        )
    {}

    receive() external payable {
        require(msg.sender == address(cToken) || msg.sender == WETH, "Not allowed to send ether");
    }

    /// @dev Hool to call after collateral is redeemed from Compound
    function _afterRedeem() internal override {
        TokenLike(WETH).deposit{value: address(this).balance}();
    }

    function _deposit(uint256 _amount) internal override {
        collateralToken.safeTransferFrom(pool, address(this), _amount);
        TokenLike(WETH).withdraw(_amount);
        cToken.mint{value: _amount}();
    }
}
