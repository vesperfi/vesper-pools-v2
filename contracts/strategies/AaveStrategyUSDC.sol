// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./AaveStrategy.sol";

//solhint-disable no-empty-blocks
contract AaveStrategyUSDC is AaveStrategy {
    string public constant NAME = "Strategy-Aave-USDC";
    string public constant VERSION = "2.0.2";

    constructor(address _controller, address _pool)
        public
        AaveStrategy(_controller, _pool, 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48)
    {}
}
