// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./CompoundStrategy.sol";
import "../interfaces/token/IToken.sol";

//solhint-disable no-empty-blocks
contract CompoundStrategyDAI is CompoundStrategy {
    string public constant NAME = "Strategy-Compound-DAI";
    string public constant VERSION = "2.0.2";

    constructor(address _controller, address _pool)
        public
        CompoundStrategy(
            _controller,
            _pool,
            0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643,
            0xc00e94Cb662C3520282E6f5717214004A7f26888,
            0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B
        )
    {}
}
