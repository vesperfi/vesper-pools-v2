// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../strategies/Crv3PoolMgr.sol";

contract Crv3PoolMock is Crv3PoolMgr {
    /* solhint-disable */
    constructor() public Crv3PoolMgr() {}

    /* solhint-enable */

    function depositToCrvPool(
        uint256 _daiAmount,
        uint256 _usdcAmount,
        uint256 _usdtAmount
    ) external {
        _depositToCrvPool(_daiAmount, _usdcAmount, _usdtAmount);
    }

    function depositDaiToCrvPool(uint256 _daiAmount, bool _stake) external {
        _depositDaiToCrvPool(_daiAmount, _stake);
    }

    function withdrawAsFromCrvPool(
        uint256 _lpAmount,
        uint256 _minDai,
        uint256 i
    ) external {
        _withdrawAsFromCrvPool(_lpAmount, _minDai, i);
    }

    function withdrawAllAs(uint256 i) external {
        _withdrawAllAs(i);
    }

    function stakeAllLpToGauge() external {
        _stakeAllLpToGauge();
    }

    function unstakeAllLpFromGauge() external {
        _unstakeAllLpFromGauge();
    }

    function unstakeLpFromGauge(uint256 _amount) external {
        _unstakeLpFromGauge(_amount);
    }

    function claimCrv() external {
        _claimCrv();
    }

    function setCheckpoint() external {
        _setCheckpoint();
    }

    // if using this contract on its own.
    function approveLpForGauge() external {
        IERC20(crvLp).safeApprove(crvGauge, 0);
        IERC20(crvLp).safeApprove(crvGauge, type(uint256).max);
    }

    // if using this contract on its own.
    function approveTokenForPool(address _token) external {
        IERC20(_token).safeApprove(crvPool, 0);
        IERC20(_token).safeApprove(crvPool, type(uint256).max);
    }
}
