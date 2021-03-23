// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./VTokenBase.sol";

//solhint-disable no-empty-blocks
contract VUSDC is VTokenBase {
    constructor(address _controller)
        public
        VTokenBase("vUSDC Pool", "vUSDC", 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48, _controller)
    {}

    /// @dev Convert to 18 decimals from token defined decimals.
    function convertTo18(uint256 _value) public pure override returns (uint256) {
        return _value.mul(10**12);
    }

    /// @dev Convert from 18 decimals to token defined decimals.
    function convertFrom18(uint256 _value) public pure override returns (uint256) {
        return _value.div(10**12);
    }
}
