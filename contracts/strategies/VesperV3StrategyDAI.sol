// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./VesperV3Strategy.sol";

//solhint-disable no-empty-blocks
contract VesperV3StrategyDAI is VesperV3Strategy {
    string public constant NAME = "Strategy-VesperV3-DAI";
    string public constant VERSION = "2.0.9";

    constructor(
        address _controller,
        address _pool,
        address _receiptToken
    ) public VesperV3Strategy(_controller, _pool, _receiptToken) {}
}
