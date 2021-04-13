// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "contracts/interfaces/bancor/IBancor.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../Pausable.sol";
import "../interfaces/vesper/IController.sol";
import "../interfaces/vesper/IStrategy.sol";
import "../interfaces/vesper/IVesperPool.sol";
import "../interfaces/uniswap/IUniswapV2Router02.sol";

/**
 * ContractRegistry - https://etherscan.io/address/0x52Ae12ABe5D8BD778BD5397F99cA900624CfADD4
 * Use addressOf to find various addresses if these need to be updated
 * https://github.com/bancorprotocol/contracts-solidity/blob/master/solidity/contracts/utility/ContractRegistryClient.sol
 */
/// @title This strategy will deposit collateral token in Bancor and earn interest.
abstract contract BancorStrategy is IStrategy, Pausable {
    using SafeERC20 for IERC20;
    using SafeMath for uint;

    address internal constant BNT = 0x1F573D6Fb3F13d689FF844B4cE37794d79a7FF1C;
    address internal constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    IController public immutable controller;
    address public immutable override pool;
    IERC20 public immutable poolToken; // tokens in Vesper pool
    IERC20 public immutable collateralToken; // collateral held in Bancor
    IERC20 public immutable anchorToken; // anchor token in Bancor (e.g. BNT_ETH)
    ILiquidityProtection internal immutable liquidityProtection;
    ILiquidityProtectionStore internal immutable liquidityProtectionStore;
    uint internal immutable liquidityTimelock;

    uint public pendingFee;

    struct Deposit {
        uint id;
        uint depositTime;
        uint principle;
        uint expected;
        uint compensation;
    }

    struct Withdrawal {
        uint principle;
        uint portion;
        uint expected;
        uint actual;
        uint compensation;
    }

    mapping(uint => Deposit) public deposits;
    uint[] public depositIndex;
    uint public depositCount = 0;

// TODO: DELETE ME
    uint public count = 0;

    constructor(
        address _controller,
        address _pool,
        address _collateralToken,
        address _anchorToken,
        address _liquidityProtection,
        address _liquidityProtectionStore,
        uint _liquidityTimelockDays
    ) public {
        require(_controller != address(0), "Controller is zero");
        require(IController(_controller).isPool(_pool), "Not a valid pool");
        require(_anchorToken != address(0), "AnchorToken is zero");
        require(_liquidityProtection != address(0), "LiquidityProtection is zero");
        require(_liquidityProtectionStore != address(0), "LiquidityProtectionStore is zero");
        controller = IController(_controller);
        pool = _pool;
        poolToken = IERC20(IVesperPool(_pool).token());
        collateralToken = IERC20(_collateralToken);
        anchorToken = IERC20(_anchorToken);
        liquidityProtection = ILiquidityProtection(_liquidityProtection);
        liquidityProtectionStore = ILiquidityProtectionStore(_liquidityProtectionStore);
        liquidityTimelock = _liquidityTimelockDays * 60 * 60 * 24;
    }

    function peek() external view returns (string memory) {
        // uint _principle;
        // uint _actual;
        bool hasWithdrawable;
        uint[] memory withdrawables;
        (hasWithdrawable, withdrawables) = _getWithdrawableDeposits();
        if (hasWithdrawable) {
            return uint2str(withdrawables.length);
        }
        return "0";
        // (_principle, _actual) = _updateDeposits();
        // return string(abi.encodePacked(uint2str(_principle), " ", uint2str(_actual)));
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
     * @notice Deposit all collateral token from pool into Bancor.
     * Anyone can call it except when paused.
     */
    function depositAll() external live {
        deposit(poolToken.balanceOf(pool));
        count = count + 1;
    }

    /// @notice Vesper pools are using this function so it should exist in all strategies.
    //solhint-disable-next-line no-empty-blocks
    function beforeWithdraw() external override onlyPool {}

    /**
     * @dev Withdraw collateral token from Bancor.
     * @param _amount Amount of collateral token
     */
    function withdraw(uint _amount) external override onlyAuthorized {
        require(false, addressToString(msg.sender));
        if (msg.sender == address(controller)) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, ) = pool.delegatecall(abi.encodeWithSignature("withdraw(uint256)", _amount));
            require(success, "delegated withdraw failed");
        }
        _withdraw(_amount, false);
    }

    /**
     * @dev Withdraw all collateral from Bancor and deposit into pool.
     * Controller only function, called when migrating strategy.
     */
    function withdrawAll() external override onlyController {
        _withdrawAll();
    }

    /**
     * @dev Calculate interest fee on earning from Bancor and transfer fee to fee collector.
     * Deposit available collateral from pool into Bancor.
     * Anyone can call it except when paused.
     */
    function rebalance() external override live {
        _rebalanceEarned();
        uint balance = poolToken.balanceOf(pool);
        if (balance != 0) {
            _deposit(balance);
        }
    }

    /**
     * @dev Calculate earning from Bancor and also calculate interest fee.
     * Deposit fee into Vesper pool to get Vesper pool shares.
     * Transfer fee, Vesper pool shares, to fee collector
     */
    function _rebalanceEarned() internal {
        _updatePendingFee();

        if (pendingFee != 0) {
            _withdraw(pendingFee, true);
            pendingFee = 0;
            uint256 feeInShare = IERC20(pool).balanceOf(address(this));
            IERC20(pool).safeTransfer(controller.feeCollector(pool), feeInShare);
        }
    }

    function _updatePendingFee() internal {
        bool tHasWithdrawals;
        uint[] memory tWithdrawableDeposits;

        (tHasWithdrawals, tWithdrawableDeposits) = _getWithdrawableDeposits();
        if (tHasWithdrawals) {
            uint tPrinciple;
            uint tActual;
            (tPrinciple, tActual) = _updateDeposits(tWithdrawableDeposits);
            pendingFee = _calculatePendingFee(tPrinciple, tActual);
        }
    }

    function _calculatePendingFee(uint _principle, uint _actual) internal view returns (uint) {
        uint fee = 0;
        // only charge if there is interest to charge on
        if (_actual > _principle) {
            uint interest = _actual.sub(_principle);
            fee = interest.mul(controller.interestFee(pool)).div(1e18);
        }
        return fee;
    }

    /**
     * @notice Sweep given token to vesper pool
     * @param _fromToken token address to sweep
     */
    function sweepErc20(address _fromToken) external {
        require((_fromToken != BNT && _fromToken != address(collateralToken) && _fromToken != address(poolToken)), "Not allowed to sweep that");
        // if (_fromToken == ETH) {
        //     payable(pool).transfer(address(this).balance);
        // } else {
        uint amount = IERC20(_fromToken).balanceOf(address(this));
        IERC20(_fromToken).safeTransfer(pool, amount);
        // }
    }

    /// @notice Returns true if strategy can be upgraded.
    /// @dev If there are no idsTokens in strategy then it is upgradable
    function isUpgradable() external view override returns (bool) {
        return depositIndex.length == 0;
    }

    function isReservedToken(address _token) external view override returns (bool) {
        return (_token != BNT && _token != address(collateralToken) && _token != address(poolToken));
    }

    /// @dev Address of BNT token
    function token() external view override returns (address) {
        return BNT;
    }

    /**
     * @notice Total collateral locked in Bancor.
     * @dev This value will be used in pool share calculation, so true totalLocked
     * will be balance in Bancor minus any pending fee to collect.
     * @return Return value will be in poolToken defined decimal.
     */
    function totalLocked() external view override returns (uint) {
        uint total = 0;
        for (uint i = 0; i < depositIndex.length; i++) {
            uint lockedBalance;
            (,,,,lockedBalance,,,) = liquidityProtectionStore.protectedLiquidity(deposits[depositIndex[i]].id);
            total = total.add(lockedBalance);
        }
        return total;
    }

    /**
     * @notice Deposit collateral token from pool into Bancor.
     * @param _amount Amount of collateral token to deposit
     */
    function deposit(uint _amount) public override live {
        _deposit(_amount);
    }

    //solhint-disable-next-line no-empty-blocks
    function _beforeDeposit(uint _amount) internal virtual {}

    function _deposit(uint _amount) internal virtual {
        _beforeDeposit(_amount);
        uint depositId;
        if (address(collateralToken) == ETH) {
            depositId = liquidityProtection.addLiquidity{value: _amount}(anchorToken, collateralToken, _amount);
        } else {
            depositId = liquidityProtection.addLiquidity(anchorToken, collateralToken, _amount);
        }
        Deposit memory aDeposit = Deposit(depositId, block.timestamp, _amount, _amount, 0);
        uint tNewIndex = depositCount;
        depositCount = depositCount + 1;
        deposits[tNewIndex] = aDeposit;
        depositIndex.push(tNewIndex);
        _updatePendingFee();
    }

// TODO: DELETE ME
    function addressToString(address _addr) public pure returns(string memory) 
    {
        bytes32 value = bytes32(uint256(_addr));
        bytes memory alphabet = "0123456789abcdef";

        bytes memory str = new bytes(51);
        str[0] = "0";
        str[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            str[2+i*2] = alphabet[uint8(value[i + 12] >> 4)];
            str[3+i*2] = alphabet[uint8(value[i + 12] & 0x0f)];
        }
        return string(str);
    }

// TODO: DELETE ME
    function uint2str(uint _i) internal pure returns (string memory _uintAsString) {
        if (_i == 0) {
            return "0";
        }
        uint j = _i;
        uint len;
        while (j != 0) {
            len++;
            j /= 10;
        }
        bytes memory bstr = new bytes(len);
        uint k = len - 1;
        while (_i != 0) {
            bstr[k--] = byte(uint8(48 + _i % 10));
            _i /= 10;
        }
        return string(bstr);
    }

    /**
     * @dev withdraw from withdrawable deposits
     */
    function _withdraw(uint _amount, bool _feeWithdrawal) internal {
        bool tHasWithdrawals;
        uint[] memory tWithdrawals;
        (tHasWithdrawals, tWithdrawals) = _getWithdrawableDeposits();
        // stop processing if nothing is withdrawable
        require(tHasWithdrawals, "no deposits are withdrawable yet");

        uint tPrinciples;
        uint tActuals;
        (tPrinciples, tActuals) = _updateDeposits(tWithdrawals);
        require(_amount <= tPrinciples, "not enough principle to withdraw");
        _withdrawDeposits(tWithdrawals, _amount, tPrinciples, tActuals, _feeWithdrawal);
    }

    /**
     * @dev withdraw everything regardless of IL protection
     */
    function _withdrawAll() internal {
        uint tPrinciples;
        uint tActuals;

        (tPrinciples, tActuals) = _updateDeposits(depositIndex);
        _withdrawDeposits(depositIndex, tPrinciples, tPrinciples, tActuals, false);
    }

    function _processFees(uint _actuals, uint _principles) internal virtual {
        uint fees = _actuals.sub(_principles).mul(controller.interestFee(pool).div(1e18));
        IERC20(pool).safeTransfer(controller.feeCollector(pool), fees);
    }

    function _withdrawDeposits(
            uint[] memory _depositIndexes,
            uint _amount, 
            uint _principles, 
            uint _actuals,
            bool _feeWithdrawal
        ) internal returns (uint, uint) {
        uint remainingAmount = _amount;
        uint totalInterest = 0;
        uint totalCompensation = 0;
        for (uint i = _depositIndexes.length - 1; i > 0; i--) {
            Withdrawal memory withdrawal = Withdrawal(0,0,0,0,0);

            Deposit memory iD = deposits[_depositIndexes[i]];
            withdrawal.principle = iD.principle;
            withdrawal.portion = remainingAmount.div(withdrawal.principle).mul(1e6);

            // nothing else to withdraw, use less than or eq in case there are small inaccuracies
            if (remainingAmount <= 0) {
                return (totalInterest, totalCompensation);
            } else {
                // remove liquidity from Bancor
                liquidityProtection.removeLiquidity(iD.id, uint32(withdrawal.portion));

                if (remainingAmount >= withdrawal.principle) {
                    // remove our deposit after removing liquidity
                    _removeDeposit(iD.id);
                } else if (remainingAmount < withdrawal.principle) {
                    // change existing deposit to reflect partial withdrawal
                    iD.principle = iD.principle.sub(remainingAmount);

                    // refetch the amounts to update our deposit
                    uint pExpected;
                    uint pCompensation;
                    (pExpected , , pCompensation) = liquidityProtection.removeLiquidityReturn(iD.id, 1e6, block.timestamp);
                    iD.expected = pExpected;
                    iD.compensation = pCompensation;
                }
            }

            if (withdrawal.compensation == 0) {
                // sum the interest if we're in profit
                // this takes into account partial withdrawals by dividing by the calculated portion remaining from the withdraw request
                totalInterest = totalInterest.add(withdrawal.actual.sub(withdrawal.principle).mul(withdrawal.portion.div(1e6)));
            } else {
                // or scrape together the compensation
                totalCompensation = totalCompensation.add(withdrawal.compensation);
            }
            remainingAmount = remainingAmount.sub(withdrawal.expected);
        }
        _convertBNT();

        // if it's a fee withdrawal don't process fees or send to pool
        if (_feeWithdrawal == false) {
            _processWithdrawal(_actuals, _principles);
        }
        return (totalInterest, totalCompensation);
    }

    function _processWithdrawal(uint _actuals, uint _principles) internal virtual {
        _processFees(_actuals, _principles);
        poolToken.safeTransfer(pool, poolToken.balanceOf(address(this)));
    }

    /**
    * @dev remove the deposit from deposits and depositIndex
    **/
    function _removeDeposit(uint _id) internal {
        int tIndex = -1;

        // find the deposit by id
        for (uint i = 0; i < depositIndex.length; i++) {
            Deposit memory iD = deposits[depositIndex[i]];
            if (iD.id == _id) {
                tIndex = int(depositIndex[i]);
            }
        }

        if (tIndex == -1 || uint(tIndex) >= depositIndex.length) return;
        delete deposits[uint(tIndex)];

        for (uint i = uint(tIndex); i < depositIndex.length - 1; i++){
            depositIndex[i] = depositIndex[i+1];
        }
        depositIndex.pop();
    }

    function _convertBNT() internal {
        uint _balance = IERC20(BNT).balanceOf(address(this));
        if (_balance > 0) {
            IUniswapV2Router02 uniswapRouter = IUniswapV2Router02(controller.uniswapRouter());
            address[] memory path = _getPath(BNT, address(poolToken));
            uint amountsOut = uniswapRouter.getAmountsOut(_balance, path)[path.length - 1];
            if (amountsOut != 0) {
                IERC20(BNT).safeApprove(address(uniswapRouter), 0);
                IERC20(BNT).safeApprove(address(uniswapRouter), _balance);
                uniswapRouter.swapExactTokensForTokens(_balance, 1, path, address(this), now + 30);
            }
        }
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

    function _getWithdrawableDeposits() internal view returns (bool, uint[] memory) {
        uint[] memory tWithdrawable = new uint[](depositIndex.length);
        uint j = 0;
        // get deposit indexes of deposits made >= liquidityTimelockDays ago
        for (uint i = 0; i < depositIndex.length; i++) {
            Deposit memory iD = deposits[i];
            if (block.timestamp.sub(iD.depositTime) >= liquidityTimelock) {
                tWithdrawable[j] = i;
                j++;
            }
        }
        // remove empties
        if (tWithdrawable.length > 0) {
            for (uint i = tWithdrawable.length - 1; i > j; i--) {
                delete tWithdrawable[i];
            }
        }
        return (j > 0, tWithdrawable);
    }

    function _updateDeposits(uint[] memory _depositIndexes) internal returns (uint, uint) {
        uint tPrinciples = 0;
        uint tActuals = 0;
        for (uint i; i < _depositIndexes.length; i++) {
            Deposit memory iD = deposits[_depositIndexes[i]];
            Withdrawal memory iW;
            (iW.expected, iW.actual, iW.compensation) = liquidityProtection.removeLiquidityReturn(iD.id, 1e6, block.timestamp);

            uint tOriginalPrinciple = iD.principle; // TODO: DELETE ME

            iW.principle = iD.principle;
            tPrinciples = tPrinciples.add(iW.principle);
            tActuals = tActuals.add(iW.actual);

            iD.expected = iW.expected;
            iD.compensation = iW.compensation;
            deposits[_depositIndexes[i]] = iD;
            iD.principle = iW.actual; // set the principle to actual value so that fees aren't charged on the same interest
            if (count == 1) { // TODO: DELETE ME
                require(iW.actual > tOriginalPrinciple, string(abi.encodePacked(uint2str(iW.actual), " ", uint2str(tOriginalPrinciple))));
            }
        }
        pendingFee = _calculatePendingFee(tPrinciples, tActuals);

        return (tPrinciples, tActuals);
    }
}
