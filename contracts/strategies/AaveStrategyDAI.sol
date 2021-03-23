// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./AaveStrategy.sol";

//solhint-disable no-empty-blocks
contract AaveStrategyDAI is AaveStrategy {
    string public constant NAME = "Strategy-Aave-DAI";
    string public constant VERSION = "2.0.2";

    constructor(address _controller, address _pool)
        public
        AaveStrategy(_controller, _pool, 0x6B175474E89094C44Da98b954EedeAC495271d0F)
    {}
}
