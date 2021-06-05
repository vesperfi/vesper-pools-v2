// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/*
    Liquidity Protection interface
*/
interface ILiquidityProtectionTest {

    function addLiquidity(
        IERC20 poolAnchor,
        IERC20 reserveToken,
        uint256 amount
    ) external payable returns (uint256);

    function removeLiquidity(uint256 id, uint32 portion) external;

    function poolAvailableSpace(IERC20 poolAnchor) external returns (uint256, uint256);

}
