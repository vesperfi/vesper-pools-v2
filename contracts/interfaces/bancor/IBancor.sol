// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/*
    Liquidity Protection Store interface
*/
interface ILiquidityProtectionStore {

    /**
     * @dev returns an existing locked network token (BNT) balance details
     *
     * @param _provider    locked balances provider
     * @param _index       start index
     * @return amount of network tokens
     * @return lock expiration time
     */
    function lockedBalance(address _provider, uint256 _index) external view returns (uint256, uint256);

    /**
     * @dev returns an existing protected liquidity details
     *
     * @param _id  protected liquidity id
     *
     * @return liquidity provider
     * @return pool token address
     * @return reserve token address
     * @return pool token amount (total)
     * @return reserve token amount (staked)
     * @return rate of 1 protected reserve token in units of the other reserve token (numerator)
     * @return rate of 1 protected reserve token in units of the other reserve token (denominator)
     * @return timestamp
     */
    function protectedLiquidity(uint256 _id)
        external
        view
        returns (
            address,
            address,
            address,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256
        );
}

/*
    Liquidity Protection interface
*/
interface ILiquidityProtection {

    function addLiquidity(
        IERC20 poolAnchor,
        IERC20 reserveToken,
        uint256 amount
    ) external payable returns (uint256);

    function removeLiquidity(uint256 id, uint32 portion) external;

    function removeLiquidityReturn(
        uint256 id,
        uint32 portion,
        uint256 removeTimestamp
    ) external view returns (
        uint256,
        uint256,
        uint256
    );
}

/*
    Liquidity Protection Stats interface
*/
interface ILiquidityProtectionStats {

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
