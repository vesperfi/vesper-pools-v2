// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./VTokenBase.sol";

//solhint-disable no-empty-blocks
contract VWBTC is VTokenBase {
    constructor(address _controller)
        public
        VTokenBase("vWBTC Pool", "vWBTC", 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599, _controller)
    {}

    /// @dev Convert to 18 decimals from token defined decimals.
    function convertTo18(uint256 _value) public pure override returns (uint256) {
        return _value.mul(10**10);
    }

    /// @dev Convert from 18 decimals to token defined decimals.
    function convertFrom18(uint256 _value) public pure override returns (uint256) {
        return _value.div(10**10);
    }
}
