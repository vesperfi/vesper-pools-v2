// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./CrvPoolMgrBase.sol";
import "../interfaces/curve/IStableSwap3Pool.sol";

contract Crv3PoolMgr is CrvPoolMgrBase {
    using SafeMath for uint256;

    IStableSwap3Pool public constant THREEPOOL =
        IStableSwap3Pool(0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7);
    address public constant THREECRV = 0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490;
    address public constant GAUGE = 0xbFcF63294aD7105dEa65aA58F8AE5BE2D9d0952A;

    /* solhint-disable var-name-mixedcase */
    string[3] public COINS = ["DAI", "USDC", "USDT"];

    address[3] public COIN_ADDRS = [
        0x6B175474E89094C44Da98b954EedeAC495271d0F, // DAI
        0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48, // USDC
        0xdAC17F958D2ee523a2206206994597C13D831ec7 // USDT
    ];

    uint256[3] public DECIMALS = [18, 6, 6];

    /* solhint-enable */

    // solhint-disable-next-line no-empty-blocks
    constructor() public CrvPoolMgrBase(address(THREEPOOL), THREECRV, GAUGE) {}

    function _minimumLpPrice(uint256 _safeRate) internal view returns (uint256) {
        return ((THREEPOOL.get_virtual_price() * _safeRate) / 1e18);
    }

    function _depositToCrvPool(
        uint256 _daiAmount,
        uint256 _usdcAmount,
        uint256 _usdtAmount
    ) internal {
        uint256[3] memory depositAmounts = [_daiAmount, _usdcAmount, _usdtAmount];
        // using 1 for min_mint_amount, but we may want to improve this logic
        THREEPOOL.add_liquidity(depositAmounts, 1);
    }

    function _depositDaiToCrvPool(uint256 _daiAmount, bool _stake) internal {
        if (_daiAmount != 0) {
            THREEPOOL.add_liquidity([_daiAmount, 0, 0], 1);
            if (_stake) {
                _stakeAllLpToGauge();
            }
        }
    }

    function _withdrawAsFromCrvPool(
        uint256 _lpAmount,
        uint256 _minAmt,
        uint256 i
    ) internal {
        THREEPOOL.remove_liquidity_one_coin(_lpAmount, int128(i), _minAmt);
    }

    function _withdrawAllAs(uint256 i) internal {
        uint256 lpAmt = IERC20(crvLp).balanceOf(address(this));
        if (lpAmt != 0) {
            THREEPOOL.remove_liquidity_one_coin(lpAmt, int128(i), 0);
        }
    }

    function calcWithdrawLpAs(uint256 _amtNeeded, uint256 i)
        public
        view
        returns (uint256 lpToWithdraw, uint256 unstakeAmt)
    {
        uint256 lp = IERC20(crvLp).balanceOf(address(this));
        uint256 tlp = lp.add(IERC20(crvGauge).balanceOf(address(this)));
        lpToWithdraw = _amtNeeded.mul(tlp).div(getLpValueAs(tlp, i));
        lpToWithdraw = (lpToWithdraw > tlp) ? tlp : lpToWithdraw;
        if (lpToWithdraw > lp) {
            unstakeAmt = lpToWithdraw.sub(lp);
        }
    }

    function getLpValueAs(uint256 _lpAmount, uint256 i) public view returns (uint256) {
        return (_lpAmount != 0) ? THREEPOOL.calc_withdraw_one_coin(_lpAmount, int128(i)) : 0;
    }

    function estimateFeeImpact(uint256 _amount) public view returns (uint256) {
        return _amount.mul(uint256(1e10).sub(estimatedFees())).div(1e10);
    }

    function estimatedFees() public view returns (uint256) {
        return THREEPOOL.fee().mul(3);
    }
}
