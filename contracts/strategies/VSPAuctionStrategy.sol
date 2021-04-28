// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../Pausable.sol";
import "../interfaces/vesper/IController.sol";
import "../interfaces/vesper/IVesperPool.sol";
import "../interfaces/bloq/ISwapManager.sol";
import "../interfaces/bloq/IDescendingPriceAuction.sol";
import "../../sol-address-list/contracts/interfaces/IAddressListExt.sol";
import "../../sol-address-list/contracts/interfaces/IAddressListFactory.sol";

contract VSPAuctionStrategy is Pausable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    uint256 public lastRebalanceBlock;
    IController public immutable controller;
    IVesperPool public immutable vvsp;
    IAddressListExt public immutable keepers;
    ISwapManager public swapManager = ISwapManager(0xe382d9f2394A359B01006faa8A1864b8a60d2710);
    IDescendingPriceAuction public auctionManager;
    uint256 public auctionCollectionId;
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    uint256 internal constant ORACLE_PERIOD = 3600;

    // Auction Config
    uint256 internal auctionDuration = 600; // 600 Blocks at 12s / block -> ~2hr
    uint256 internal auctionCeilingBuffer = 2500; // as BP * 10**2
    uint256 internal auctionFloorBuffer = 2500; // as BP * 10**2
    uint256 internal acceptableSlippage = 500; // as BP * 10**2
    address internal auctionPayee;

    uint256 public nextPoolIdx;
    address[] public pools;
    uint256[] public liquidationLimit;
    string public constant NAME = "Strategy-VSP-Auctions";
    string public constant VERSION = "2.0.0";

    event UpdatedSwapManager(address indexed previousSwapManager, address indexed newSwapManager);
    event UpdatedAuctionManager(
        address indexed previousAuctionManager,
        address indexed newAuctionManager
    );
    event UpdatedAuctionPayee(
        address indexed previousAuctionPayee,
        address indexed newAuctionPayee
    );
    event UpdatedAuctionConfig(
        uint256 ceilingBuffer,
        uint256 floorBuffer,
        uint256 duration,
        uint256 previousCeilingBuffer,
        uint256 previousFloorBuffer,
        uint256 previousDuration
    );
    event UpdatedCollectionId(uint256 previousCollectionId, uint256 newCollectionId);
    event UpdatedAcceptableSlippage(uint256 previousSlippage, uint256 newSlippage);

    constructor(
        address _controller,
        address _vvsp,
        address _pfDpa
    ) public {
        vvsp = IVesperPool(_vvsp);
        controller = IController(_controller);
        IAddressListFactory factory =
            IAddressListFactory(0xD57b41649f822C51a73C44Ba0B3da4A880aF0029);
        IAddressListExt _keepers = IAddressListExt(factory.createList());
        _keepers.grantRole(keccak256("LIST_ADMIN"), _controller);
        keepers = _keepers;
        auctionManager = IDescendingPriceAuction(_pfDpa);
        auctionCollectionId = auctionManager.createCollection();
        auctionPayee = address(this);
    }

    modifier onlyKeeper() {
        require(keepers.contains(_msgSender()), "caller-is-not-keeper");
        _;
    }

    modifier onlyController() {
        require(_msgSender() == address(controller), "Caller is not the controller");
        _;
    }

    function pause() external onlyController {
        _pause();
    }

    function unpause() external onlyController {
        _unpause();
    }

    /**
     * @notice Update swap manager address
     * @param _swapManager swap manager address
     */
    function updateSwapManager(address _swapManager) external onlyController {
        require(_swapManager != address(0x0), "sm-address-is-zero");
        require(_swapManager != address(swapManager), "sm-is-same");
        emit UpdatedSwapManager(address(swapManager), _swapManager);
        swapManager = ISwapManager(_swapManager);
    }

    function updateAuctionManager(address _auctionManager) external onlyController {
        require(_auctionManager != address(0x0), "am-address-is-zero");
        require(_auctionManager != address(_auctionManager), "am-is-same");
        emit UpdatedAuctionManager(address(_auctionManager), _auctionManager);
        auctionManager = IDescendingPriceAuction(_auctionManager);
        auctionCollectionId = auctionManager.createCollection();
    }

    // use this to send auction proceeds directly to drip address
    function updateAuctionPayee(address _payee) external onlyController {
        require(_payee != address(0x0), "payee-address-is-zero");
        require(_payee != auctionPayee, "payee-is-same");
        emit UpdatedAuctionPayee(auctionPayee, _payee);
        auctionPayee = _payee;
    }

    function updateAuctionCollectionId() external onlyController {
        uint256 newCollectionId = auctionManager.createCollection();
        emit UpdatedCollectionId(auctionCollectionId, newCollectionId);
        auctionCollectionId = newCollectionId;
    }

    function updateAuctionCollectionId(uint256 _collectionId) external onlyController {
        // DPA does not support checking collection ownership
        emit UpdatedCollectionId(auctionCollectionId, _collectionId);
        auctionCollectionId = _collectionId;
    }

    function updateAcceptableSlippage(uint256 _slippage) external onlyController {
        require(_slippage < 10000, "invalid-slippage");
        emit UpdatedAcceptableSlippage(acceptableSlippage, _slippage);
        acceptableSlippage = _slippage;
    }

    function updateAuctionConfig(
        uint256 ceilingBuffer,
        uint256 floorBuffer,
        uint256 duration
    ) external onlyController {
        require(duration != 0, "duration-is-zero");
        require(floorBuffer < 6667, "invalid-floor-buffer"); // No greater than 67% drawdown
        require(ceilingBuffer < 30000, "invalid-ceil-buffer"); // No greater than 300% upside
        emit UpdatedAuctionConfig(
            ceilingBuffer,
            floorBuffer,
            duration,
            auctionCeilingBuffer,
            auctionFloorBuffer,
            auctionDuration
        );
        auctionCeilingBuffer = ceilingBuffer;
        auctionFloorBuffer = floorBuffer;
        auctionDuration = duration;
    }

    function _stopAndSwap(DPA memory auction) internal {
        address[] memory tokens = auction.tokens;
        auctionManager.stopAuction(auction.id);
        for (uint256 i = 0; i < tokens.length; i++) {
            _safeSwapToVsp(tokens[i]);
        }
    }

    function _getAuctionsOfCollection() internal view returns (uint256[] memory auctions) {
        uint256 totalAuctions = auctionManager.collectionLength(auctionCollectionId);
        auctions = new uint256[](totalAuctions);
        for (uint256 i = 0; i < totalAuctions; i++) {
            auctions[i] = auctionManager.auctionOfCollByIndex(auctionCollectionId, i);
        }
    }

    function _createAuction(IVesperPool _poolToken, uint256 _poolTokenAmount) internal {
        // unwrap poolTokens to Tokens ie vWBTC -> WBTC
        _poolToken.withdrawByStrategy(_poolTokenAmount);
        address[] memory _tokens = new address[](1);
        _tokens[0] = _poolToken.token();
        uint256[] memory _tokenAmounts = new uint256[](1);
        _tokenAmounts[0] = IERC20(_tokens[0]).balanceOf(address(this));

        address vsp = vvsp.token();
        // calculate ceiling and floor values
        (uint256 c, uint256 f) = _getAuctionValues(_tokens, _tokenAmounts, vsp);
        DPAConfig memory _auction =
            DPAConfig({
                ceiling: c,
                floor: f,
                collectionId: auctionCollectionId,
                paymentToken: vsp,
                payee: auctionPayee,
                endBlock: block.number + auctionDuration,
                tokens: _tokens,
                tokenAmounts: _tokenAmounts
            });
        auctionManager.createAuction(_auction);
    }

    // This should get smarter (use oracles)
    function _getAuctionValues(
        address[] memory _tokens,
        uint256[] memory _tokenAmounts,
        address _outputToken
    ) internal returns (uint256 ceiling, uint256 floor) {
        require(_tokens.length == _tokenAmounts.length, "invalid-token-list");
        uint256 sum;
        for (uint256 i = 0; i < _tokens.length; i++) {
            (uint256 amountOut, bool validRate) =
                _getCompoundOracleRate(_tokens[i], _outputToken, _tokenAmounts[i]);
            require(validRate, "stale-oracle-rate");
            IERC20(_tokens[i]).approve(address(auctionManager), 0);
            IERC20(_tokens[i]).approve(address(auctionManager), _tokenAmounts[i]);
            sum += amountOut;
        }
        require(sum != 0, "cannot-calc-auction-value");
        ceiling = sum + ((sum * auctionCeilingBuffer) / 10000);
        floor = sum - ((sum * auctionFloorBuffer) / 10000);
    }

    function _safeSwapToVsp(address _fromToken) internal {
        IERC20 from = IERC20(_fromToken);
        IERC20 vsp = IERC20(vvsp.token());
        (address[] memory path, uint256 amountOut, uint256 rIdx) =
            swapManager.bestOutputFixedInput(
                _fromToken,
                address(vsp),
                from.balanceOf(address(this))
            );
        (uint256 expectedAmountOut, bool validRate) =
            _getCompoundOracleRate(_fromToken, vvsp.token(), from.balanceOf(address(this)));
        require(validRate, "stale-oracle-rate");
        expectedAmountOut = _calculateSlippage(expectedAmountOut, acceptableSlippage);
        if (amountOut != 0) {
            from.safeApprove(address(swapManager.ROUTERS(rIdx)), 0);
            from.safeApprove(address(swapManager.ROUTERS(rIdx)), from.balanceOf(address(this)));
            swapManager.ROUTERS(rIdx).swapExactTokensForTokens(
                from.balanceOf(address(this)),
                1,
                path,
                address(this),
                now + 30
            );
        }
    }

    function _getCompoundOracleRate(
        address _from,
        address _to,
        uint256 _amt
    ) internal returns (uint256, bool) {
        if (_from == WETH || _to == WETH) return _consultOracle(_from, _to, _amt);
        (uint256 fAmtOut, bool fValid) = _consultOracle(_from, WETH, _amt);
        (uint256 bRate, bool bValid) = _consultOracle(WETH, _to, fAmtOut);
        return (bRate, (fValid && bValid));
    }

    function _consultOracle(
        address _from,
        address _to,
        uint256 _amt
    ) internal returns (uint256, bool) {
        // from, to, amountIn, period, router
        (uint256 rate, uint256 lastUpdate, ) =
            swapManager.consult(_from, _to, _amt, ORACLE_PERIOD, 0);
        // We're looking at a TWAP ORACLE with a 1 hr Period that has been updated within the last hour
        if ((lastUpdate > (block.timestamp - ORACLE_PERIOD)) && (rate != 0)) return (rate, true);
        return (0, false);
    }

    function _calculateSlippage(uint256 _amount, uint256 _slippage)
        internal
        pure
        returns (uint256)
    {
        return (_amount.mul(uint256(10000).sub(_slippage)).div(10000)).add(1);
    }

    function killAllAuctions() external onlyController {
        uint256[] memory auctions = _getAuctionsOfCollection();
        for (uint256 i = 0; i < auctions.length; i++) {
            DPA memory a = auctionManager.getAuction(auctions[i]);
            if (a.winningBlock == 0 && !a.stopped) {
                _stopAndSwap(a);
            }
        }
    }

    function killAuction(uint256 _auctionId) external onlyController {
        _stopAndSwap(auctionManager.getAuction(_auctionId));
    }

    function updateLiquidationQueue(address[] calldata _pools, uint256[] calldata _limit)
        external
        onlyController
    {
        swapManager.createOrUpdateOracle(vvsp.token(), WETH, ORACLE_PERIOD, 0);
        for (uint256 i = 0; i < _pools.length; i++) {
            require(controller.isPool(_pools[i]), "Not a valid pool");
            require(_limit[i] != 0, "Limit cannot be zero");
            if (IVesperPool(_pools[i]).token() != WETH) {
                swapManager.createOrUpdateOracle(
                    IVesperPool(_pools[i]).token(),
                    WETH,
                    ORACLE_PERIOD,
                    0
                );
            }
        }
        pools = _pools;
        liquidationLimit = _limit;
        nextPoolIdx = 0;
    }

    function isUpgradable() external view returns (bool) {
        return IERC20(vvsp.token()).balanceOf(address(this)) == 0;
    }

    function pool() external view returns (address) {
        return address(vvsp);
    }

    function rebalance() external whenNotPaused onlyKeeper {
        require(
            block.number - lastRebalanceBlock >= controller.rebalanceFriction(address(vvsp)),
            "Can not rebalance"
        );
        lastRebalanceBlock = block.number;

        // // if any of our auction have hit their floor without being bought, market swap them
        uint256[] memory auctions = _getAuctionsOfCollection();
        for (uint256 i = 0; i < auctions.length; i++) {
            DPA memory a = auctionManager.getAuction(auctions[i]);
            if (block.number >= a.endBlock && a.winningBlock == 0 && !a.stopped) _stopAndSwap(a);
        }

        // First, send back any VSP we have received from auctions being completed
        uint256 vspBalance = IERC20(vvsp.token()).balanceOf(address(this));
        IERC20(vvsp.token()).safeTransfer(address(vvsp), vspBalance);

        if (nextPoolIdx == pools.length) {
            nextPoolIdx = 0;
        }

        IVesperPool _poolToken = IVesperPool(pools[nextPoolIdx]);
        uint256 _balance = _poolToken.balanceOf(address(vvsp));
        if (_balance != 0 && address(_poolToken) != address(vvsp)) {
            if (_balance > liquidationLimit[nextPoolIdx]) {
                _balance = liquidationLimit[nextPoolIdx];
            }
            IERC20(address(_poolToken)).safeTransferFrom(address(vvsp), address(this), _balance);
            _createAuction(_poolToken, _balance);
        }
        nextPoolIdx++;
    }

    /// @dev sweep given token to vsp pool
    function sweepErc20(address _fromToken) external {
        uint256 amount = IERC20(_fromToken).balanceOf(address(this));
        IERC20(_fromToken).safeTransfer(address(vvsp), amount);
    }
}
