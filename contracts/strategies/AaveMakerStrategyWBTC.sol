// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./AaveMakerStrategy.sol";

//solhint-disable no-empty-blocks
contract AaveMakerStrategyWBTC is AaveMakerStrategy {
    string public constant NAME = "Strategy-AaveMaker-WBTC";
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
            0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599,
            _cm,
            "WBTC-A"
        )
    {}

    /// @dev Convert from 18 decimals to token defined decimals.
    function convertFrom18(uint256 amount) public pure override returns (uint256) {
        return amount.div(10**10);
    }
}
