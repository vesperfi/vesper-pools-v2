// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./MakerStrategy.sol";
import "./AaveRewards.sol";
import "../interfaces/aave/IAaveV2.sol";

/// @dev This strategy will deposit collateral token in Maker and borrow DAI
/// and deposit borrowed DAI in Aave to earn interest on it.
abstract contract AaveV2MakerStrategy is MakerStrategy, AaveRewards {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    //solhint-disable-next-line const-name-snakecase
    AaveLendingPoolAddressesProvider public constant aaveAddressesProvider =
        AaveLendingPoolAddressesProvider(0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5);

    uint256 private constant WAT = 10**16;
    IERC20 private immutable aToken;
    mapping(address => bool) private reservedToken;

    constructor(
        address _controller,
        address _pool,
        address _cm,
        address _receiptToken,
        bytes32 _collateralType
    ) public MakerStrategy(_controller, _pool, _cm, _receiptToken, _collateralType) {
        aToken = IERC20(_receiptToken);
    }

    /// @notice Initiate cooldown to unstake aave.
    function startCooldown() external onlyKeeper returns (bool) {
        return _startCooldown();
    }

    /// @notice Unstake Aave from stakedAave contract
    function unstakeAave() external onlyKeeper {
        _unstakeAave();
    }

    /// @notice Returns interest earned since last rebalance.
    function interestEarned() public view virtual override returns (uint256 collateralEarned) {
        collateralEarned = super.interestEarned();
        uint256 _aaveAmount = stkAAVE.getTotalRewardsBalance(address(this));
        if (_aaveAmount != 0) {
            (, uint256 _amountOut, ) =
                swapManager.bestOutputFixedInput(AAVE, address(collateralToken), _aaveAmount);
            collateralEarned = collateralEarned.add(_amountOut);
        }
    }

    /// @dev Check whether given token is reserved or not. Reserved tokens are not allowed to sweep.
    function isReservedToken(address _token) public view override returns (bool) {
        return _token == receiptToken || _token == AAVE || _token == address(stkAAVE);
    }

    /// @dev Approve Dai and collateralToken to collateral manager
    function _approveToken(uint256 _amount) internal override {
        super._approveToken(_amount);
        IERC20(DAI).safeApprove(aaveAddressesProvider.getLendingPool(), _amount);
        for (uint256 i = 0; i < swapManager.N_DEX(); i++) {
            IERC20(AAVE).safeApprove(address(swapManager.ROUTERS(i)), _amount);
        }
    }

    function _claimReward() internal override {
        uint256 _aaveAmount = _claimAave();
        if (_aaveAmount != 0) {
            _safeSwap(AAVE, address(collateralToken), _aaveAmount);
        }
    }

    function _depositDaiToLender(uint256 _amount) internal override {
        address _aaveLendingPool = aaveAddressesProvider.getLendingPool();
        AaveLendingPool(_aaveLendingPool).deposit(DAI, _amount, address(this), 0);
    }

    function _getDaiBalance() internal view override returns (uint256) {
        return aToken.balanceOf(address(this));
    }

    function _withdrawDaiFromLender(uint256 _amount) internal override {
        address _aaveLendingPool = aaveAddressesProvider.getLendingPool();
        require(
            AaveLendingPool(_aaveLendingPool).withdraw(DAI, _amount, address(this)) == _amount,
            "withdrawn-amount-is-not-correct"
        );
    }

    /// dev these functions are not implemented for this strategy
    // solhint-disable-next-line no-empty-blocks
    function _migrateIn() internal override {}

    // solhint-disable-next-line no-empty-blocks
    function _migrateOut() internal override {}
}
