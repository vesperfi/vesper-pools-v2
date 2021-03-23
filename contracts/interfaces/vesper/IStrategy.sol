// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IStrategy {
    function rebalance() external;

    function deposit(uint256 amount) external;

    function beforeWithdraw() external;

    function withdraw(uint256 amount) external;

    function withdrawAll() external;

    function isUpgradable() external view returns (bool);

    function isReservedToken(address _token) external view returns (bool);

    function token() external view returns (address);

    function pool() external view returns (address);

    function totalLocked() external view returns (uint256);

    //Lifecycle functions
    function pause() external;

    function unpause() external;
}
