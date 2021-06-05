// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/*
    Liquidity Protection interface
*/
interface ILiquidityProtectionStoreTest {

    function protectedLiquidityIds(address _provider) external view returns (uint256[] memory);

}
