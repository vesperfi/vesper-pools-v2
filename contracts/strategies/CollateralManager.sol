// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../interfaces//maker/IMakerDAO.sol";
import "../interfaces/vesper/ICollateralManager.sol";
import "../interfaces/vesper/IController.sol";

contract DSMath {
    uint256 internal constant RAY = 10**27;
    uint256 internal constant WAD = 10**18;

    function add(uint256 x, uint256 y) internal pure returns (uint256 z) {
        require((z = x + y) >= x, "math-not-safe");
    }

    function sub(uint256 x, uint256 y) internal pure returns (uint256 z) {
        require((z = x - y) <= x, "sub-overflow");
    }

    function mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
        require(y == 0 || (z = x * y) / y == x, "math-not-safe");
    }

    function wmul(uint256 x, uint256 y) internal pure returns (uint256 z) {
        z = add(mul(x, y), WAD / 2) / WAD;
    }

    function wdiv(uint256 x, uint256 y) internal pure returns (uint256 z) {
        z = add(mul(x, WAD), y / 2) / y;
    }

    function rmul(uint256 x, uint256 y) internal pure returns (uint256 z) {
        z = add(mul(x, y), RAY / 2) / RAY;
    }

    function toInt(uint256 x) internal pure returns (int256 y) {
        y = int256(x);
        require(y >= 0, "int-overflow");
    }

    function toRad(uint256 wad) internal pure returns (uint256 rad) {
        rad = mul(wad, RAY);
    }

    /**
     * @notice It will work only if _dec < 18
     */
    function convertTo18(uint256 _dec, uint256 _amt) internal pure returns (uint256 amt) {
        amt = mul(_amt, 10**(18 - _dec));
    }
}

contract CollateralManager is ICollateralManager, DSMath, ReentrancyGuard {
    using SafeERC20 for IERC20;
    mapping(uint256 => address) public override vaultOwner;
    mapping(bytes32 => address) public mcdGemJoin;
    mapping(uint256 => bytes32) public vaultType;
    address public constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
    address public override mcdManager = 0x5ef30b9986345249bc32d8928B7ee64DE9435E39;
    address public mcdDaiJoin = 0x9759A6Ac90977b93B58547b4A71c78317f391A28;
    address public mcdSpot = 0x65C79fcB50Ca1594B025960e539eD7A9a6D434A3;
    address public mcdJug = 0x19c0976f590D67707E62397C87829d896Dc0f1F1;
    uint256 internal constant MAX_UINT_VALUE = type(uint256).max;
    IController public immutable controller;

    modifier onlyVaultOwner(uint256 vaultNum) {
        require(msg.sender == vaultOwner[vaultNum], "Not a vault owner");
        _;
    }

    modifier onlyController() {
        require(msg.sender == address(controller), "Not a controller");
        _;
    }

    constructor(address _controller) public {
        require(_controller != address(0), "_controller is zero");
        controller = IController(_controller);
    }

    /**
     * @dev Add gemJoin adapter address from Maker in mapping
     * @param gemJoins Array of gem join addresses
     */
    function addGemJoin(address[] calldata gemJoins) external override onlyController {
        require(gemJoins.length != 0, "No gemJoin address");
        for (uint256 i; i < gemJoins.length; i++) {
            address gemJoin = gemJoins[i];
            bytes32 ilk = GemJoinLike(gemJoin).ilk();
            mcdGemJoin[ilk] = gemJoin;
        }
    }

    /**
     * @dev Store vault info.
     * @param vaultNum Vault number.
     * @param collateralType Collateral type of vault.
     */
    function registerVault(uint256 vaultNum, bytes32 collateralType) external override {
        require(msg.sender == ManagerLike(mcdManager).owns(vaultNum), "Not a vault owner");
        vaultOwner[vaultNum] = msg.sender;
        vaultType[vaultNum] = collateralType;
    }

    /**
     * @dev Update MCD addresses.
     */
    function updateMCDAddresses(
        address _mcdManager,
        address _mcdDaiJoin,
        address _mcdSpot,
        address _mcdJug
    ) external onlyController {
        mcdManager = _mcdManager;
        mcdDaiJoin = _mcdDaiJoin;
        mcdSpot = _mcdSpot;
        mcdJug = _mcdJug;
    }

    /**
     * @dev Deposit ERC20 collateral.
     * @param vaultNum Vault number.
     * @param amount ERC20 amount to deposit.
     */
    function depositCollateral(uint256 vaultNum, uint256 amount)
        external
        override
        nonReentrant
        onlyVaultOwner(vaultNum)
    {
        // Receives Gem amount, approve and joins it into the vat.
        // Also convert amount to 18 decimal
        amount = joinGem(mcdGemJoin[vaultType[vaultNum]], amount);

        ManagerLike manager = ManagerLike(mcdManager);
        // Locks Gem amount into the CDP
        VatLike(manager.vat()).frob(
            vaultType[vaultNum],
            manager.urns(vaultNum),
            address(this),
            address(this),
            toInt(amount),
            0
        );
    }

    /**
     * @dev Withdraw collateral.
     * @param vaultNum Vault number.
     * @param amount Collateral amount to withdraw.
     */
    function withdrawCollateral(uint256 vaultNum, uint256 amount)
        external
        override
        nonReentrant
        onlyVaultOwner(vaultNum)
    {
        ManagerLike manager = ManagerLike(mcdManager);
        GemJoinLike gemJoin = GemJoinLike(mcdGemJoin[vaultType[vaultNum]]);

        uint256 amount18 = convertTo18(gemJoin.dec(), amount);

        // Unlocks Gem amount18 from the CDP
        manager.frob(vaultNum, -toInt(amount18), 0);

        // Moves Gem amount18 from the CDP urn to this address
        manager.flux(vaultNum, address(this), amount18);

        // Exits Gem amount to this address as a token
        gemJoin.exit(address(this), amount);

        // Send Gem to pool's address
        IERC20(gemJoin.gem()).safeTransfer(vaultOwner[vaultNum], amount);
    }

    /**
     * @dev Payback borrowed DAI.
     * @param vaultNum Vault number.
     * @param amount Dai amount to payback.
     */
    function payback(uint256 vaultNum, uint256 amount) external override onlyVaultOwner(vaultNum) {
        ManagerLike manager = ManagerLike(mcdManager);
        address urn = manager.urns(vaultNum);
        address vat = manager.vat();
        bytes32 ilk = vaultType[vaultNum];

        // Calculate dai debt
        uint256 _daiDebt = _getVaultDebt(ilk, urn, vat);
        require(_daiDebt >= amount, "paying-excess-debt");

        // Approve and join dai in vat
        joinDai(urn, amount);
        manager.frob(vaultNum, 0, _getWipeAmount(ilk, urn, vat));
    }

    /**
     * @notice Borrow DAI.
     * @dev In edge case, when we hit DAI mint limit, we might end up borrowing
     * less than what is being asked.
     * @param vaultNum Vault number.
     * @param amount Dai amount to borrow. Actual borrow amount may be less than "amount"
     */
    function borrow(uint256 vaultNum, uint256 amount) external override onlyVaultOwner(vaultNum) {
        ManagerLike manager = ManagerLike(mcdManager);
        address vat = manager.vat();
        // Safety check in scenario where current debt and request borrow will exceed max dai limit
        uint256 _maxAmount = maxAvailableDai(vat, vaultNum);
        if (amount > _maxAmount) {
            amount = _maxAmount;
        }

        // Generates debt in the CDP
        manager.frob(vaultNum, 0, _getBorrowAmount(vat, manager.urns(vaultNum), vaultNum, amount));
        // Moves the DAI amount (balance in the vat in rad) to pool's address
        manager.move(vaultNum, address(this), toRad(amount));
        // Allows adapter to access to pool's DAI balance in the vat
        if (VatLike(vat).can(address(this), mcdDaiJoin) == 0) {
            VatLike(vat).hope(mcdDaiJoin);
        }
        // Exits DAI as a token to user's address
        DaiJoinLike(mcdDaiJoin).exit(msg.sender, amount);
    }

    /// @dev sweep given ERC20 token to treasury pool
    function sweepErc20(address fromToken) external {
        uint256 amount = IERC20(fromToken).balanceOf(address(this));
        address treasuryPool = controller.treasuryPool();
        IERC20(fromToken).safeTransfer(treasuryPool, amount);
    }

    /**
     * @dev Get current dai debt of vault.
     * @param vaultNum Vault number.
     */
    function getVaultDebt(uint256 vaultNum) external view override returns (uint256 daiDebt) {
        address urn = ManagerLike(mcdManager).urns(vaultNum);
        address vat = ManagerLike(mcdManager).vat();
        bytes32 ilk = vaultType[vaultNum];

        daiDebt = _getVaultDebt(ilk, urn, vat);
    }

    /**
     * @dev Get current collateral balance of vault.
     * @param vaultNum Vault number.
     */
    function getVaultBalance(uint256 vaultNum)
        external
        view
        override
        returns (uint256 collateralLocked)
    {
        address vat = ManagerLike(mcdManager).vat();
        address urn = ManagerLike(mcdManager).urns(vaultNum);
        (collateralLocked, ) = VatLike(vat).urns(vaultType[vaultNum], urn);
    }

    /**
     * @dev Calculate state based on withdraw amount.
     * @param vaultNum Vault number.
     * @param amount Collateral amount to withraw.
     */
    function whatWouldWithdrawDo(uint256 vaultNum, uint256 amount)
        external
        view
        override
        returns (
            uint256 collateralLocked,
            uint256 daiDebt,
            uint256 collateralUsdRate,
            uint256 collateralRatio,
            uint256 minimumDebt
        )
    {
        (collateralLocked, daiDebt, collateralUsdRate, collateralRatio, minimumDebt) = getVaultInfo(
            vaultNum
        );

        GemJoinLike gemJoin = GemJoinLike(mcdGemJoin[vaultType[vaultNum]]);
        uint256 amount18 = convertTo18(gemJoin.dec(), amount);
        require(amount18 <= collateralLocked, "insufficient collateral locked");
        collateralLocked = sub(collateralLocked, amount18);
        collateralRatio = getCollateralRatio(collateralLocked, collateralUsdRate, daiDebt);
    }

    /**
     * @dev Get vault info
     * @param vaultNum Vault number.
     */
    function getVaultInfo(uint256 vaultNum)
        public
        view
        override
        returns (
            uint256 collateralLocked,
            uint256 daiDebt,
            uint256 collateralUsdRate,
            uint256 collateralRatio,
            uint256 minimumDebt
        )
    {
        (collateralLocked, collateralUsdRate, daiDebt, minimumDebt) = _getVaultInfo(vaultNum);
        collateralRatio = getCollateralRatio(collateralLocked, collateralUsdRate, daiDebt);
    }

    /**
     * @dev Get available DAI amount based on current DAI debt and limit for given vault type.
     * @param vat Vat address
     * @param vaultNum Vault number.
     */
    function maxAvailableDai(address vat, uint256 vaultNum) public view returns (uint256) {
        // Get stable coin Art(debt) [wad], rate [ray], line [rad]
        //solhint-disable-next-line var-name-mixedcase
        (uint256 Art, uint256 rate, , uint256 line, ) = VatLike(vat).ilks(vaultType[vaultNum]);
        // Calculate total issued debt is Art * rate [rad]
        // Calcualte total available dai [wad]
        uint256 _totalAvailableDai = sub(line, mul(Art, rate)) / RAY;
        // For safety reason, return 99% of available
        return mul(_totalAvailableDai, 99) / 100;
    }

    function joinDai(address urn, uint256 amount) internal {
        DaiJoinLike daiJoin = DaiJoinLike(mcdDaiJoin);
        // Transfer Dai from strategy or pool to here
        IERC20(DAI).safeTransferFrom(msg.sender, address(this), amount);
        // Approves adapter to move dai.
        IERC20(DAI).safeApprove(mcdDaiJoin, 0);
        IERC20(DAI).safeApprove(mcdDaiJoin, amount);
        // Joins DAI into the vat
        daiJoin.join(urn, amount);
    }

    function joinGem(address adapter, uint256 amount) internal returns (uint256) {
        GemJoinLike gemJoin = GemJoinLike(adapter);

        IERC20 token = IERC20(gemJoin.gem());
        // Transfer token from strategy or pool to here
        token.safeTransferFrom(msg.sender, address(this), amount);
        // Approves adapter to take the Gem amount
        token.safeApprove(adapter, 0);
        token.safeApprove(adapter, amount);
        // Joins Gem collateral into the vat
        gemJoin.join(address(this), amount);
        // Convert amount to 18 decimal
        return convertTo18(gemJoin.dec(), amount);
    }

    /**
     * @dev Get borrow dai amount.
     */
    function _getBorrowAmount(
        address vat,
        address urn,
        uint256 vaultNum,
        uint256 wad
    ) internal returns (int256 amount) {
        // Updates stability fee rate
        uint256 rate = JugLike(mcdJug).drip(vaultType[vaultNum]);

        // Gets DAI balance of the urn in the vat
        uint256 dai = VatLike(vat).dai(urn);

        // If there was already enough DAI in the vat balance, just exits it without adding more debt
        if (dai < mul(wad, RAY)) {
            // Calculates the needed amt so together with the existing dai in the vat is enough to exit wad amount of DAI tokens
            amount = toInt(sub(mul(wad, RAY), dai) / rate);
            // This is neeeded due lack of precision. It might need to sum an extra amt wei (for the given DAI wad amount)
            amount = mul(uint256(amount), rate) < mul(wad, RAY) ? amount + 1 : amount;
        }
    }

    /**
     * @dev Get collateral ratio
     */
    function getCollateralRatio(
        uint256 collateralLocked,
        uint256 collateralRate,
        uint256 daiDebt
    ) internal pure returns (uint256) {
        if (collateralLocked == 0) {
            return 0;
        }

        if (daiDebt == 0) {
            return MAX_UINT_VALUE;
        }

        require(collateralRate != 0, "Collateral rate is zero");
        return wdiv(wmul(collateralLocked, collateralRate), daiDebt);
    }

    /**
     * @dev Get Vault Debt Amount.
     */
    function _getVaultDebt(
        bytes32 ilk,
        address urn,
        address vat
    ) internal view returns (uint256 wad) {
        // Get normalised debt [wad]
        (, uint256 art) = VatLike(vat).urns(ilk, urn);
        // Get stable coin rate [ray]
        (, uint256 rate, , , ) = VatLike(vat).ilks(ilk);
        // Get balance from vat [rad]
        uint256 dai = VatLike(vat).dai(urn);

        wad = _getVaultDebt(art, rate, dai);
    }

    function _getVaultDebt(
        uint256 art,
        uint256 rate,
        uint256 dai
    ) internal pure returns (uint256 wad) {
        if (dai < mul(art, rate)) {
            uint256 rad = sub(mul(art, rate), dai);
            wad = rad / RAY;
            wad = mul(wad, RAY) < rad ? wad + 1 : wad;
        } else {
            wad = 0;
        }
    }

    function _getVaultInfo(uint256 vaultNum)
        internal
        view
        returns (
            uint256 collateralLocked,
            uint256 collateralUsdRate,
            uint256 daiDebt,
            uint256 minimumDebt
        )
    {
        address urn = ManagerLike(mcdManager).urns(vaultNum);
        address vat = ManagerLike(mcdManager).vat();
        bytes32 ilk = vaultType[vaultNum];

        // Get minimum liquidation ratio [ray]
        (, uint256 mat) = SpotterLike(mcdSpot).ilks(ilk);

        // Get collateral locked and normalised debt [wad] [wad]
        (uint256 ink, uint256 art) = VatLike(vat).urns(ilk, urn);
        // Get stable coin and collateral rate  and min debt [ray] [ray] [rad]
        (, uint256 rate, uint256 spot, , uint256 dust) = VatLike(vat).ilks(ilk);
        // Get balance from vat [rad]

        collateralLocked = ink;
        daiDebt = _getVaultDebt(art, rate, VatLike(vat).dai(urn));
        minimumDebt = dust / RAY;
        // Calculate collateral rate in 18 decimals
        collateralUsdRate = rmul(mat, spot) / 10**9;
    }

    /**
     * @dev Get Payback amount.
     * @notice We need to fetch latest art, rate and dai to calcualte payback amount.
     */
    function _getWipeAmount(
        bytes32 ilk,
        address urn,
        address vat
    ) internal view returns (int256 amount) {
        // Get normalize debt, rate and dai balance from Vat
        (, uint256 art) = VatLike(vat).urns(ilk, urn);
        (, uint256 rate, , , ) = VatLike(vat).ilks(ilk);
        uint256 dai = VatLike(vat).dai(urn);

        // Uses the whole dai balance in the vat to reduce the debt
        amount = toInt(dai / rate);
        // Checks the calculated amt is not higher than urn.art (total debt), otherwise uses its value
        amount = uint256(amount) <= art ? -amount : -toInt(art);
    }
}
