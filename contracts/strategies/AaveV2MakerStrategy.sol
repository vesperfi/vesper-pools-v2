// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./MakerStrategy.sol";
import "../interfaces/aave/IAaveV2.sol";

/// @dev This strategy will deposit collateral token in Maker and borrow DAI
/// and deposit borrowed DAI in Aave to earn interest on it.
abstract contract AaveV2MakerStrategy is MakerStrategy {
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

    /// @dev Approve Dai and collateralToken to collateral manager
    function _approveToken(uint256 _amount) internal override {
        super._approveToken(_amount);
        IERC20(DAI).safeApprove(aaveAddressesProvider.getLendingPool(), _amount);
    }

    /// @dev Check whether given token is reserved or not. Reserved tokens are not allowed to sweep.
    //TODO check staked aave address too
    function isReservedToken(address _token) public view override returns (bool) {
        return _token == receiptToken;
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

    function _withdrawExcessDaiFromLender(uint256 _base) internal override {
        uint256 _balance = _getDaiBalance();
        if (_balance > _base) {
            _withdrawDaiFromLender(_balance.sub(_base));
        }
    }
}
