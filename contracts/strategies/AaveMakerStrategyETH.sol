// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./AaveMakerStrategy.sol";

//solhint-disable no-empty-blocks
contract AaveMakerStrategyETH is AaveMakerStrategy {
    string public constant NAME = "Strategy-AaveMaker-ETH";
    string public constant VERSION = "2.0.2";

    constructor(
        address _controller,
        address _pool,
        address _cm
    )
        public
        AaveMakerStrategy(
            _controller,
            _pool,
            0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2,
            _cm,
            "ETH-A"
        )
    {}
}
