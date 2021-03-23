// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./AaveStrategy.sol";
import "../interfaces/token/IToken.sol";

//solhint-disable no-empty-blocks
contract AaveStrategyETH is AaveStrategy {
    string public constant NAME = "Strategy-Aave-ETH";
    string public constant VERSION = "2.0.2";

    constructor(address _controller, address _pool)
        public
        AaveStrategy(_controller, _pool, 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2)
    {}

    receive() external payable {}

    function _beforeFeeTransfer() internal override {
        IVesperPool(pool).deposit{value: address(this).balance}();
    }

    function _withdraw(uint256 _amount) internal override {
        IERC20(address(aToken)).safeTransferFrom(pool, address(this), _amount);
        aToken.redeem(_amount);
        TokenLike(WETH).deposit{value: address(this).balance}();
        collateralToken.safeTransfer(pool, collateralToken.balanceOf(address(this)));
    }

    function _deposit(uint256 _amount) internal override {
        collateralToken.safeTransferFrom(pool, address(this), _amount);
        TokenLike(WETH).withdraw(_amount);
        AaveAddressesProvider aaveProvider = AaveAddressesProvider(AAVE_ADDRESSES_PROVIDER);
        AavePool aavePool = AavePool(aaveProvider.getLendingPool());
        aavePool.deposit{value: _amount}(ETH, _amount, controller.aaveReferralCode());
        IERC20(address(aToken)).safeTransfer(pool, aToken.balanceOf(address(this)));
    }
}
