// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./BancorStrategy.sol";
import "../interfaces/token/IToken.sol";

//solhint-disable no-empty-blocks
contract BancorStrategyETH is BancorStrategy {
    string public constant NAME = "Strategy-Bancor-ETH";
    string public constant VERSION = "0.1.0";

    constructor(address _controller, address _pool, uint _liquidityTimelockDays)
        public
        BancorStrategy(
            _controller,
            _pool,
            0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE, //ETH
            0xb1CD6e4153B2a390Cf00A6556b0fC1458C4A5533, //ETH_BNT_ANCHOR,
            0xeead394A017b8428E2D5a976a054F303F78f3c0C, //LIQUIDITY_PROTECTION
            0xf5FAB5DBD2f3bf675dE4cB76517d4767013cfB55, //LIQUIDITY_PROTECTION_STORE
            _liquidityTimelockDays
        )
    {}

    // function _beforeWithdrawal() internal override {
    //     TokenLike(WETH).deposit();
    // }

    // function _processWithdrawal(uint _actuals, uint _principles) internal override {
    //     _processFees(_actuals, _principles);
    //     collateralToken.safeTransfer(pool, collateralToken.balanceOf(address(this)));
    // }

    // function _processFees(uint _actuals, uint _principles) internal override {
    //     uint fees = _actuals.sub(_principles).mul(controller.interestFee(pool).div(1e18));
    //     controller.feeCollector(pool).send(fees);
    // }

    receive() external payable {}

    function _beforeDeposit(uint _amount) internal override {
        poolToken.safeTransferFrom(pool, address(this), _amount);
        TokenLike(WETH).withdraw(_amount);
    }

}
