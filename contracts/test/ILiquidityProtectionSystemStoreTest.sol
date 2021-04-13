// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/*
    Liquidity Protection interface
*/
interface ILiquidityProtectionSystemStoreTest {

    /**
     * @dev increases the amount of network tokens minted into a specific pool
     * can be executed only by an owner
     *
     * @param poolAnchor    pool anchor
     * @param amount        amount to increase the minted tokens by
     */
    function incNetworkTokensMinted(IERC20 poolAnchor, uint256 amount) external;

    /**
     * @dev decreases the amount of network tokens minted into a specific pool
     * can be executed only by an owner
     *
     * @param poolAnchor    pool anchor
     * @param amount        amount to decrease the minted tokens by
     */
    function decNetworkTokensMinted(IERC20 poolAnchor, uint256 amount) external;

}