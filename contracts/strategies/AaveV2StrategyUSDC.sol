// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./AaveV2Strategy.sol";

//solhint-disable no-empty-blocks
contract AaveV2StrategyUSDC is AaveV2Strategy {
    string public constant NAME = "Strategy-AaveV2-USDC";
    string public constant VERSION = "2.0.2";

    constructor(address _controller, address _pool)
        public
        AaveV2Strategy(_controller, _pool, 0xBcca60bB61934080951369a648Fb03DF4F96263C) //aUSDC
    {}
}
