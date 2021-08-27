// SPDX-License-Identifier: MIT
/* solhint-disable */
pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Not a complete interface, but should have what we need
interface ILiquidityGaugeV2 is IERC20 {
    function deposit(uint256 _value) external;

    function withdraw(uint256 _value) external;

    function claimable_tokens(address addr) external returns (uint256);

    function integrate_fraction(address addr) external view returns (uint256);

    function user_checkpoint(address addr) external returns (bool);
}
/* solhint-enable */
