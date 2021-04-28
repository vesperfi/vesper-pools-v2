// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./Crv3PoolStrategy.sol";

//solhint-disable no-empty-blocks
contract Crv3PoolStrategyDAI is Crv3PoolStrategy {
    string public constant NAME = "Strategy-Curve-3pool-DAI";
    string public constant VERSION = "1.0.0";

    constructor(address _controller, address _pool)
        public
        Crv3PoolStrategy(_controller, _pool, 0)
    {}
}
