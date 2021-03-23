// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./AaveStrategy.sol";

//solhint-disable no-empty-blocks
contract AaveStrategyWBTC is AaveStrategy {
    string public constant NAME = "Strategy-Aave-WBTC";
    string public constant VERSION = "2.0.2";

    constructor(address _controller, address _pool)
        public
        AaveStrategy(_controller, _pool, 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599)
    {}
}
