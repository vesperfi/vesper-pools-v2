// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface TokenLikeTest is IERC20 {
    function deposit() external payable;

    function withdraw(uint256) external;

    function decimals() external view returns (uint256);
}
