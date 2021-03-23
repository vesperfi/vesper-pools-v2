// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IMetAutonomousConverter {
    function convertEthToMet(uint256 _mintReturn) external payable returns (uint256 returnedMet);
}
