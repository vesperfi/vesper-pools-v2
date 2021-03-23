// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../Pausable.sol";
import "../interfaces/compound/ICompound.sol";
import "../interfaces/vesper/IController.sol";
import "../interfaces/vesper/IStrategy.sol";
import "../interfaces/vesper/IVesperPool.sol";
import "../interfaces/uniswap/IUniswapV2Router02.sol";

/// @title This strategy will deposit collateral token in Compound and earn interest.
abstract contract CompoundStrategy is IStrategy, Pausable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    IController public immutable controller;
    IERC20 public immutable collateralToken;
    address public immutable override pool;
    uint256 public pendingFee;

    CToken internal immutable cToken;
    address internal immutable rewardToken;
    Comptroller internal immutable comptroller;
    address internal constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    uint256 internal exchangeRateStored;

    constructor(
        address _controller,
        address _pool,
        address _cToken,
        address _rewardToken,
        address _comptroller
    ) public {
        require(_controller != address(0), "Controller address is zero");
        require(_rewardToken != address(0), "RewardToken address is zero");
        require(IController(_controller).isPool(_pool), "Not a valid pool");
        controller = IController(_controller);
        pool = _pool;
        collateralToken = IERC20(IVesperPool(_pool).token());
        cToken = CToken(_cToken);
        rewardToken = _rewardToken;
        comptroller = Comptroller(_comptroller);
    }

    modifier live() {
        require(!paused || _msgSender() == address(controller), "Contract has paused");
        _;
    }

    modifier onlyAuthorized() {
        require(
            _msgSender() == address(controller) || _msgSender() == pool,
            "Caller is not authorized"
        );
        _;
    }

    modifier onlyController() {
        require(_msgSender() == address(controller), "Caller is not the controller");
        _;
    }

    modifier onlyPool() {
        require(_msgSender() == pool, "Caller is not pool");
        _;
    }

    function pause() external override onlyController {
        _pause();
    }

    function unpause() external override onlyController {
        _unpause();
    }

    /**
     * @notice Migrate tokens from pool to this address
     * @dev Any working Compound strategy has cTokens in strategy contract.
     * @dev There can be scenarios when pool already has cTokens and new
     * strategy will have to move those tokens from pool to self address.
     * @dev Only valid pool strategy is allowed to move tokens from pool.
     */
    function migrateIn() external onlyController {
        require(controller.isPool(pool), "not-a-valid-pool");
        require(controller.strategy(pool) == address(this), "not-a-valid-strategy");
        cToken.transferFrom(pool, address(this), cToken.balanceOf(pool));
    }

    /**
     * @notice Migrate tokens out to pool.
     * @dev There can be scenarios when we want to use new strategy without
     * calling withdrawAll(). We can achieve this by moving tokens in pool
     * and new strategy will take care from there.
     * @dev Pause this strategy, set pendingFee to zero and move tokens out.
     */
    function migrateOut() external onlyController {
        require(controller.isPool(pool), "not-a-valid-pool");
        _pause();
        pendingFee = 0;
        cToken.transfer(pool, cToken.balanceOf(address(this)));
    }

    /**
     * @notice Deposit all collateral token from pool into Compound.
     * Anyone can call it except when paused.
     */
    function depositAll() external live {
        deposit(collateralToken.balanceOf(pool));
    }

    /// @notice Vesper pools are using this function so it should exist in all strategies.
    //solhint-disable-next-line no-empty-blocks
    function beforeWithdraw() external override onlyPool {}

    /**
     * @dev Withdraw collateral token from Compound.
     * @param _amount Amount of collateral token
     */
    function withdraw(uint256 _amount) external override onlyAuthorized {
        _withdraw(_amount);
    }

    /**
     * @dev Withdraw all collateral from Compound and deposit into pool.
     * Controller only function, called when migrating strategy.
     */
    function withdrawAll() external override onlyController {
        _withdrawAll();
    }

    /**
     * @dev Calculate interest fee on earning from Compound and transfer fee to fee collector.
     * Deposit available collateral from pool into Compound.
     * Anyone can call it except when paused.
     */
    function rebalance() external override live {
        _rebalanceEarned();
        uint256 balance = collateralToken.balanceOf(pool);
        if (balance != 0) {
            _deposit(balance);
        }
    }

    /**
     * @notice Sweep given token to vesper pool
     * @dev Reserved tokens are not allowed to sweep.
     * @param _fromToken token address to sweep
     */
    function sweepErc20(address _fromToken) external {
        require(_fromToken != address(cToken) && _fromToken != rewardToken, "Not allowed to sweep");

        if (_fromToken == ETH) {
            payable(pool).transfer(address(this).balance);
        } else {
            uint256 amount = IERC20(_fromToken).balanceOf(address(this));
            IERC20(_fromToken).safeTransfer(pool, amount);
        }
    }

    /**
     * @notice Returns interest earned in COMP since last rebalance.
     * @dev Make sure to return value in collateral token and in order to do that
     * we are using Uniswap to get collateral amount for earned DAI.
     */
    function interestEarned() external view returns (uint256) {
        uint256 compAccrued = comptroller.compAccrued(address(this));
        if (compAccrued != 0) {
            IUniswapV2Router02 uniswapRouter = IUniswapV2Router02(controller.uniswapRouter());
            address[] memory path = _getPath(rewardToken, address(collateralToken));
            return uniswapRouter.getAmountsOut(compAccrued, path)[path.length - 1];
        }
        return 0;
    }

    /// @notice Returns true if strategy can be upgraded.
    /// @dev If there are no cTokens in strategy then it is upgradable
    function isUpgradable() external view override returns (bool) {
        return cToken.balanceOf(address(this)) == 0;
    }

    /// @notice This method is deprecated and will be removed from Strategies in next release
    function isReservedToken(address _token) external view override returns (bool) {
        return _token == address(cToken) || _token == rewardToken;
    }

    /// @dev Returns address of Compound token correspond to collateral token
    function token() external view override returns (address) {
        return address(cToken);
    }

    /**
     * @notice Total collateral locked in Compound.
     * @dev This value will be used in pool share calculation, so true totalLocked
     * will be balance in Compound minus any pending fee to collect.
     * @return Return value will be in collateralToken defined decimal.
     */
    function totalLocked() external view override returns (uint256) {
        uint256 _totalCTokens = cToken.balanceOf(pool).add(cToken.balanceOf(address(this)));
        return _convertToCollateral(_totalCTokens).sub(_calculatePendingFee());
    }

    /**
     * @notice Deposit collateral token from pool into Compound.
     * @dev Update pendingFee before deposit. Anyone can call it except when paused.
     * @param _amount Amount of collateral token to deposit
     */
    function deposit(uint256 _amount) public override live {
        _updatePendingFee();
        _deposit(_amount);
    }

    /**
     * @dev Claim rewardToken and convert rewardToken into collateral token.
     * Calculate interest fee on earning from rewardToken and transfer balance minus
     * fee to pool.
     * @dev Transferring collateral to pool will increase pool share price.
     */
    function _claimComp() internal {
        address[] memory markets = new address[](1);
        markets[0] = address(cToken);
        comptroller.claimComp(address(this), markets);
        uint256 amt = IERC20(rewardToken).balanceOf(address(this));
        if (amt != 0) {
            IUniswapV2Router02 uniswapRouter = IUniswapV2Router02(controller.uniswapRouter());
            address[] memory path = _getPath(rewardToken, address(collateralToken));
            uint256 amountOut = uniswapRouter.getAmountsOut(amt, path)[path.length - 1];
            if (amountOut != 0) {
                IERC20(rewardToken).safeApprove(address(uniswapRouter), 0);
                IERC20(rewardToken).safeApprove(address(uniswapRouter), amt);
                uniswapRouter.swapExactTokensForTokens(amt, 1, path, address(this), now + 30);
                uint256 _collateralEarned = collateralToken.balanceOf(address(this));
                uint256 _fee = _collateralEarned.mul(controller.interestFee(pool)).div(1e18);
                collateralToken.safeTransfer(pool, _collateralEarned.sub(_fee));
            }
        }
    }

    function _deposit(uint256 _amount) internal virtual {
        collateralToken.safeTransferFrom(pool, address(this), _amount);
        collateralToken.safeApprove(address(cToken), 0);
        collateralToken.safeApprove(address(cToken), _amount);
        require(cToken.mint(_amount) == 0, "deposit-failed");
    }

    /**
     * @dev Calculate interest fee earning and transfer it to fee collector.
     * RebalanceEarned completes in following steps,
     *      Claim rewardToken and earn fee.
     *      Update pending fee.
     *      Withdraw collateral equal to pendingFee from compound.
     *      Now we have collateral equal to pendingFee + fee earning from rewardToken.
     *      Deposit collateral in Pool and get shares.
     *      Transfer shares to feeCollector.
     */
    function _rebalanceEarned() internal {
        _claimComp();
        _updatePendingFee();
        // Read state variable once to save gas
        uint256 _pendingFee = pendingFee;
        uint256 _cTokenAmount = _convertToCToken(_pendingFee);
        if (_cTokenAmount != 0) {
            require(cToken.redeemUnderlying(_pendingFee) == 0, "rebalanceEarned::withdraw-failed");
            // Update state variable
            pendingFee = 0;
            _afterRedeem();
        }

        uint256 _collateralBalance = collateralToken.balanceOf(address(this));
        if (_collateralBalance != 0) {
            collateralToken.safeApprove(pool, 0);
            collateralToken.safeApprove(pool, _collateralBalance);
            IVesperPool(pool).deposit(_collateralBalance);
            uint256 _feeInShare = IERC20(pool).balanceOf(address(this));
            IERC20(pool).safeTransfer(controller.feeCollector(pool), _feeInShare);
        }
    }

    function _withdraw(uint256 _amount) internal {
        _updatePendingFee();
        require(cToken.redeemUnderlying(_amount) == 0, "withdraw-failed");
        _afterRedeem();
        collateralToken.safeTransfer(pool, collateralToken.balanceOf(address(this)));
    }

    function _withdrawAll() internal {
        pendingFee = 0;
        require(cToken.redeem(cToken.balanceOf(address(this))) == 0, "withdraw-all-failed");
        _afterRedeem();
        collateralToken.safeTransfer(pool, collateralToken.balanceOf(address(this)));
    }

    /// @dev Hook to call after collateral is redeemed from Compound
    /// @notice We did empty implementation as not all derived are going to implement it.
    //solhint-disable-next-line no-empty-blocks
    function _afterRedeem() internal virtual {}

    function _convertToCToken(uint256 _collateralAmount) internal view returns (uint256) {
        return _collateralAmount.mul(1e18).div(cToken.exchangeRateStored());
    }

    function _convertToCollateral(uint256 _cTokenAmount) internal view returns (uint256) {
        return _cTokenAmount.mul(cToken.exchangeRateStored()).div(1e18);
    }

    function _calculatePendingFee() internal view returns (uint256) {
        uint256 interest =
            cToken
                .exchangeRateStored()
                .sub(exchangeRateStored)
                .mul(cToken.balanceOf(address(this)))
                .div(1e18);
        uint256 fee = interest.mul(controller.interestFee(pool)).div(1e18);
        return pendingFee.add(fee);
    }

    function _updatePendingFee() internal {
        pendingFee = _calculatePendingFee();
        exchangeRateStored = cToken.exchangeRateStored();
    }

    function _getPath(address _from, address _to) internal pure returns (address[] memory) {
        address[] memory path;
        if (_from == WETH || _to == WETH) {
            path = new address[](2);
            path[0] = _from;
            path[1] = _to;
        } else {
            path = new address[](3);
            path[0] = _from;
            path[1] = WETH;
            path[2] = _to;
        }
        return path;
    }
}
