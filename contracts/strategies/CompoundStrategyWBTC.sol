// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./CompoundStrategy.sol";
import "../interfaces/token/IToken.sol";

//solhint-disable no-empty-blocks
contract CompoundStrategyWBTC is CompoundStrategy {
    string public constant NAME = "Strategy-Compound-WBTC";
    string public constant VERSION = "2.0.2";

    constructor(address _controller, address _pool)
        public
        CompoundStrategy(
            _controller,
            _pool,
            0xC11b1268C1A384e55C48c2391d8d480264A3A7F4,
            0xc00e94Cb662C3520282E6f5717214004A7f26888,
            0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B
        )
    {}
}
