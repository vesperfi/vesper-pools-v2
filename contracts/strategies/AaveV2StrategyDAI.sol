// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./AaveV2Strategy.sol";

//solhint-disable no-empty-blocks
contract AaveV2StrategyDAI is AaveV2Strategy {
    string public constant NAME = "Strategy-AaveV2-DAI";
    string public constant VERSION = "2.0.3";

    constructor(address _controller, address _pool)
        public
        AaveV2Strategy(_controller, _pool, 0x6B175474E89094C44Da98b954EedeAC495271d0F)
    {}
}
