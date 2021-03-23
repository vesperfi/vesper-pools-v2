// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface AaveLendingPoolAddressesProvider {
    function getLendingPool() external view returns (address);

    function getAddress(bytes32 id) external view returns (address);
}

interface AaveLendingPool {
    function deposit(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;

    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256);
}

interface AaveProtocolDataProvider {
    function getReserveTokensAddresses(address asset)
        external
        view
        returns (
            address aTokenAddress,
            address stableDebtTokenAddress,
            address variableDebtTokenAddress
        );
}
