// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./AaveV2Strategy.sol";

//solhint-disable no-empty-blocks
contract AaveV2StrategyUSDC is AaveV2Strategy {
    string public constant NAME = "Strategy-AaveV2-USDC";
    string public constant VERSION = "2.0.2";

    constructor(address _controller, address _pool)
        public
        AaveV2Strategy(_controller, _pool, 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48)
    {}
}
