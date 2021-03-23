// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./VesperMakerStrategy.sol";

//solhint-disable no-empty-blocks
contract VesperMakerStrategyETH is VesperMakerStrategy {
    string public constant NAME = "Strategy-Vesper-Maker-ETH";
    string public constant VERSION = "2.0.3";

    constructor(
        address _controller,
        address _pool,
        address _cm,
        address _vPool
    ) public VesperMakerStrategy(_controller, _pool, _cm, _vPool, "ETH-A") {}
}
