// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./VTokenBase.sol";

//solhint-disable no-empty-blocks
contract VDAI is VTokenBase {
    constructor(address _controller)
        public
        VTokenBase("vDAI Pool", "vDAI", 0x6B175474E89094C44Da98b954EedeAC495271d0F, _controller)
    {}
}
