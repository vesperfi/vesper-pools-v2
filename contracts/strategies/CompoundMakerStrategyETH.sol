// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./CompoundMakerStrategy.sol";
import "../interfaces/token/IToken.sol";

//solhint-disable no-empty-blocks
contract CompoundMakerStrategyETH is CompoundMakerStrategy {
    string public constant NAME = "Compound-Maker-Strategy-ETH";
    string public constant VERSION = "2.0.3";

    constructor(
        address _controller,
        address _pool,
        address _cm
    )
        public
        CompoundMakerStrategy(
            _controller,
            _pool,
            _cm,
            0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643, // cDAI
            "ETH-A",
            0xc00e94Cb662C3520282E6f5717214004A7f26888, // COMP
            0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B // Comptroller
        )
    {}
}
