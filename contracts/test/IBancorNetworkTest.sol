// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IBancorNetworkTest {
    function convertByPath(
        address[] memory _path, 
        uint256 _amount, 
        uint256 _minReturn, 
        address _beneficiary, 
        address _affiliateAccount, 
        uint256 _affiliateFee
    ) external payable returns (uint256);

    function rateByPath(
        address[] memory _path, 
        uint256 _amount
    ) external view returns (uint256);

    function conversionPath(
        IERC20 _sourceToken, 
        IERC20 _targetToken
    ) external view returns (address[] memory);
}