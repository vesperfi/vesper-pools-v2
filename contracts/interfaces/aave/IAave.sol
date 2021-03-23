// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface AaveAddressesProvider {
    function getLendingPool() external view returns (address);

    function getLendingPoolCore() external view returns (address);
}

interface AavePool {
    function deposit(
        address _reserve,
        uint256 _amount,
        uint16 _referralCode
    ) external payable;
}

interface AavePoolCore {
    function getReserveATokenAddress(address _reserve) external view returns (address);
}

interface AToken {
    function redeem(uint256 _amount) external;

    function balanceOf(address _user) external view returns (uint256);

    function principalBalanceOf(address _user) external view returns (uint256);

    function transfer(address recipient, uint256 amount) external returns (bool);

    function approve(address spender, uint256 amount) external returns (bool);

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external returns (bool);
}
