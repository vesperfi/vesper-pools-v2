// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./AaveV2Strategy.sol";
import "../interfaces/token/IToken.sol";

//solhint-disable no-empty-blocks
contract AaveV2StrategyETH is AaveV2Strategy {
    string public constant NAME = "Strategy-AaveV2-ETH";
    string public constant VERSION = "2.0.3";

    constructor(address _controller, address _pool)
        public
        AaveV2Strategy(_controller, _pool, 0x030bA81f1c18d280636F32af80b9AAd02Cf0854e) // aWETH
    {}
}
