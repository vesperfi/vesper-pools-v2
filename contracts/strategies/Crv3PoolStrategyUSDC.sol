// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./Crv3PoolStrategy.sol";

//solhint-disable no-empty-blocks
contract Crv3PoolStrategyUSDC is Crv3PoolStrategy {
    using SafeMath for uint256;

    string public constant NAME = "Strategy-Curve-3pool-USDC";
    string public constant VERSION = "1.0.0";

    constructor(address _controller, address _pool)
        public
        Crv3PoolStrategy(_controller, _pool, 1)
    {}

    function convertFrom18(uint256 amount) public pure override returns (uint256) {
        return amount.div(10**12);
    }
}
