// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../Pausable.sol";
import "../interfaces/vesper/IController.sol";
import "../interfaces/vesper/IVesperPool.sol";
import "../interfaces/vesper/IPoolRewards.sol";
import "../../sol-address-list/contracts/interfaces/IAddressListExt.sol";
import "../../sol-address-list/contracts/interfaces/IAddressListFactory.sol";

/// @title Holding pool share token
// solhint-disable no-empty-blocks
abstract contract PoolShareToken is ERC20, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    IAddressListExt public immutable feeWhiteList;
    IController public immutable controller;

    /// @dev The EIP-712 typehash for the contract's domain
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );

    /// @dev The EIP-712 typehash for the permit struct used by the contract
    bytes32 public constant PERMIT_TYPEHASH =
        keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );

    bytes32 public immutable domainSeparator;

    uint256 internal constant MAX_UINT_VALUE = uint256(-1);
    mapping(address => uint256) public nonces;
    event Deposit(address indexed owner, uint256 shares, uint256 amount);
    event Withdraw(address indexed owner, uint256 shares, uint256 amount);

    constructor(
        string memory _name,
        string memory _symbol,
        address _token,
        address _controller
    ) public ERC20(_name, _symbol) {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        token = IERC20(_token);
        controller = IController(_controller);
        IAddressListFactory factory =
            IAddressListFactory(0xD57b41649f822C51a73C44Ba0B3da4A880aF0029);
        IAddressListExt _feeWhiteList = IAddressListExt(factory.createList());
        _feeWhiteList.grantRole(keccak256("LIST_ADMIN"), _controller);
        feeWhiteList = _feeWhiteList;
        domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes(_name)),
                keccak256(bytes("1")),
                chainId,
                address(this)
            )
        );
    }

    /**
     * @notice Deposit ERC20 tokens and receive pool shares depending on the current share price.
     * @param amount ERC20 token amount.
     */
    function deposit(uint256 amount) external virtual nonReentrant whenNotPaused {
        _deposit(amount);
    }

    /**
     * @notice Deposit ERC20 tokens with permit aka gasless approval.
     * @param amount ERC20 token amount.
     * @param deadline The time at which signature will expire
     * @param v The recovery byte of the signature
     * @param r Half of the ECDSA signature pair
     * @param s Half of the ECDSA signature pair
     */
    function depositWithPermit(
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external virtual nonReentrant whenNotPaused {
        IVesperPool(address(token)).permit(_msgSender(), address(this), amount, deadline, v, r, s);
        _deposit(amount);
    }

    /**
     * @notice Withdraw collateral based on given shares and the current share price.
     * Transfer earned rewards to caller. Withdraw fee, if any, will be deduced from
     * given shares and transferred to feeCollector. Burn remaining shares and return collateral.
     * @param shares Pool shares. It will be in 18 decimals.
     */
    function withdraw(uint256 shares) external virtual nonReentrant whenNotShutdown {
        _withdraw(shares);
    }

    /**
     * @notice Withdraw collateral based on given shares and the current share price.
     * Transfer earned rewards to caller. Burn shares and return collateral.
     * @dev No withdraw fee will be assessed when this function is called.
     * Only some white listed address can call this function.
     * @param shares Pool shares. It will be in 18 decimals.
     */
    function withdrawByStrategy(uint256 shares) external virtual nonReentrant whenNotShutdown {
        require(feeWhiteList.get(_msgSender()) != 0, "Not a white listed address");
        _withdrawByStrategy(shares);
    }

    /**
     * @notice Transfer tokens to multiple recipient
     * @dev Left 160 bits are the recipient address and the right 96 bits are the token amount.
     * @param bits array of uint
     * @return true/false
     */
    function multiTransfer(uint256[] memory bits) external returns (bool) {
        for (uint256 i = 0; i < bits.length; i++) {
            address a = address(bits[i] >> 96);
            uint256 amount = bits[i] & ((1 << 96) - 1);
            require(transfer(a, amount), "Transfer failed");
        }
        return true;
    }

    /**
     * @notice Triggers an approval from owner to spends
     * @param owner The address to approve from
     * @param spender The address to be approved
     * @param amount The number of tokens that are approved (2^256-1 means infinite)
     * @param deadline The time at which to expire the signature
     * @param v The recovery byte of the signature
     * @param r Half of the ECDSA signature pair
     * @param s Half of the ECDSA signature pair
     */
    function permit(
        address owner,
        address spender,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(deadline >= block.timestamp, "Expired");
        bytes32 digest =
            keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    domainSeparator,
                    keccak256(
                        abi.encode(
                            PERMIT_TYPEHASH,
                            owner,
                            spender,
                            amount,
                            nonces[owner]++,
                            deadline
                        )
                    )
                )
            );
        address signatory = ecrecover(digest, v, r, s);
        require(signatory != address(0) && signatory == owner, "Invalid signature");
        _approve(owner, spender, amount);
    }

    /**
     * @notice Get price per share
     * @dev Return value will be in token defined decimals.
     */
    function getPricePerShare() external view returns (uint256) {
        if (totalSupply() == 0) {
            return convertFrom18(1e18);
        }
        return totalValue().mul(1e18).div(totalSupply());
    }

    /// @dev Convert to 18 decimals from token defined decimals. Default no conversion.
    function convertTo18(uint256 amount) public pure virtual returns (uint256) {
        return amount;
    }

    /// @dev Convert from 18 decimals to token defined decimals. Default no conversion.
    function convertFrom18(uint256 amount) public pure virtual returns (uint256) {
        return amount;
    }

    /// @dev Get fee collector address
    function feeCollector() public view virtual returns (address) {
        return controller.feeCollector(address(this));
    }

    /// @dev Returns the token stored in the pool. It will be in token defined decimals.
    function tokensHere() public view virtual returns (uint256) {
        return token.balanceOf(address(this));
    }

    /**
     * @dev Returns sum of token locked in other contracts and token stored in the pool.
     * Default tokensHere. It will be in token defined decimals.
     */
    function totalValue() public view virtual returns (uint256) {
        return tokensHere();
    }

    /**
     * @notice Get withdraw fee for this pool
     * @dev Format: 1e16 = 1% fee
     */
    function withdrawFee() public view virtual returns (uint256) {
        return controller.withdrawFee(address(this));
    }

    /**
     * @dev Hook that is called just before burning tokens. To be used i.e. if
     * collateral is stored in a different contract and needs to be withdrawn.
     * @param share Pool share in 18 decimals
     */
    function _beforeBurning(uint256 share) internal virtual {}

    /**
     * @dev Hook that is called just after burning tokens. To be used i.e. if
     * collateral stored in a different/this contract needs to be transferred.
     * @param amount Collateral amount in collateral token defined decimals.
     */
    function _afterBurning(uint256 amount) internal virtual {}

    /**
     * @dev Hook that is called just before minting new tokens. To be used i.e.
     * if the deposited amount is to be transferred from user to this contract.
     * @param amount Collateral amount in collateral token defined decimals.
     */
    function _beforeMinting(uint256 amount) internal virtual {}

    /**
     * @dev Hook that is called just after minting new tokens. To be used i.e.
     * if the deposited amount is to be transferred to a different contract.
     * @param amount Collateral amount in collateral token defined decimals.
     */
    function _afterMinting(uint256 amount) internal virtual {}

    /**
     * @dev Calculate shares to mint based on the current share price and given amount.
     * @param amount Collateral amount in collateral token defined decimals.
     */
    function _calculateShares(uint256 amount) internal view returns (uint256) {
        require(amount != 0, "amount is 0");

        uint256 _totalSupply = totalSupply();
        uint256 _totalValue = convertTo18(totalValue());
        uint256 shares =
            (_totalSupply == 0 || _totalValue == 0)
                ? amount
                : amount.mul(_totalSupply).div(_totalValue);
        return shares;
    }

    /// @dev Deposit incoming token and mint pool token i.e. shares.
    function _deposit(uint256 amount) internal whenNotPaused {
        uint256 shares = _calculateShares(convertTo18(amount));
        _beforeMinting(amount);
        _mint(_msgSender(), shares);
        _afterMinting(amount);
        emit Deposit(_msgSender(), shares, amount);
    }

    /// @dev Handle withdraw fee calculation and fee transfer to fee collector.
    function _handleFee(uint256 shares) internal returns (uint256 _sharesAfterFee) {
        if (withdrawFee() != 0) {
            uint256 _fee = shares.mul(withdrawFee()).div(1e18);
            _sharesAfterFee = shares.sub(_fee);
            _transfer(_msgSender(), feeCollector(), _fee);
        } else {
            _sharesAfterFee = shares;
        }
    }

    /// @dev Update pool reward of sender and receiver before transfer.
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 /* amount */
    ) internal virtual override {
        address poolRewards = controller.poolRewards(address(this));
        if (poolRewards != address(0)) {
            if (from != address(0)) {
                IPoolRewards(poolRewards).updateReward(from);
            }
            if (to != address(0)) {
                IPoolRewards(poolRewards).updateReward(to);
            }
        }
    }

    /// @dev Burns shares and returns the collateral value, after fee, of those.
    function _withdraw(uint256 shares) internal whenNotShutdown {
        require(shares != 0, "share is 0");
        _beforeBurning(shares);
        uint256 sharesAfterFee = _handleFee(shares);
        uint256 amount =
            convertFrom18(sharesAfterFee.mul(convertTo18(totalValue())).div(totalSupply()));

        _burn(_msgSender(), sharesAfterFee);
        _afterBurning(amount);
        emit Withdraw(_msgSender(), shares, amount);
    }

    /// @dev Burns shares and returns the collateral value of those.
    function _withdrawByStrategy(uint256 shares) internal {
        require(shares != 0, "Withdraw must be greater than 0");
        _beforeBurning(shares);
        uint256 amount = convertFrom18(shares.mul(convertTo18(totalValue())).div(totalSupply()));
        _burn(_msgSender(), shares);
        _afterBurning(amount);
        emit Withdraw(_msgSender(), shares, amount);
    }
}
