// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./AaveV2Strategy.sol";

//solhint-disable no-empty-blocks
contract AaveV2StrategyDAI is AaveV2Strategy {
    string public constant NAME = "Strategy-AaveV2-DAI";
    string public constant VERSION = "2.0.3";

    constructor(address _controller, address _pool)
        public
        AaveV2Strategy(_controller, _pool, 0x028171bCA77440897B824Ca71D1c56caC55b68A3) //aDAI
    {}
}
