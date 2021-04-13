// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/*
    Liquidity Protection interface
*/
interface ILiquidityProtectionStatsTest {

    /**
     * @dev returns the total amount of protected pool tokens
     *
     * @param poolToken pool token address
     * @return total amount of protected pool tokens
     */
    function totalPoolAmount(IERC20 poolToken) external view returns (uint256);

    /**
     * @dev returns the total amount of protected reserve tokens
     *
     * @param poolToken     pool token address
     * @param reserveToken  reserve token address
     * @return total amount of protected reserve tokens
     */
    function totalReserveAmount(IERC20 poolToken, IERC20 reserveToken) external view returns (uint256);

}
