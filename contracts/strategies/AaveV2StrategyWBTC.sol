// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./AaveV2Strategy.sol";

//solhint-disable no-empty-blocks
contract AaveV2StrategyWBTC is AaveV2Strategy {
    string public constant NAME = "Strategy-AaveV2-WBTC";
    string public constant VERSION = "2.0.3";

    constructor(address _controller, address _pool)
        public
        AaveV2Strategy(_controller, _pool, 0x9ff58f4fFB29fA2266Ab25e75e2A8b3503311656) // aWBTC
    {}
}
