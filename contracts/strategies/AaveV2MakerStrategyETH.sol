// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./AaveV2MakerStrategy.sol";

//solhint-disable no-empty-blocks
contract AaveV2MakerStrategyETH is AaveV2MakerStrategy {
    string public constant NAME = "AaveV2Maker-Strategy-ETH";
    string public constant VERSION = "2.0.3";

    constructor(
        address _controller,
        address _pool,
        address _cm
    )
        public
        AaveV2MakerStrategy(
            _controller,
            _pool,
            _cm,
            0x028171bCA77440897B824Ca71D1c56caC55b68A3, //aDAI
            "ETH-A"
        )
    {}
}
