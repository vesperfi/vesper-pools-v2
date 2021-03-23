// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./VTokenBase.sol";

//solhint-disable no-empty-blocks
contract VLINK is VTokenBase {
    constructor(address _controller)
        public
        VTokenBase("vLINK Pool", "vLINK", 0x514910771AF9Ca656af840dff83E8264EcF986CA, _controller)
    {}
}
