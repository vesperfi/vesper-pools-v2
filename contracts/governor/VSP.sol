// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../Owned.sol";
import "./VSPGovernanceToken.sol";

// solhint-disable no-empty-blocks
contract VSP is VSPGovernanceToken, Owned {
    /// @dev The EIP-712 typehash for the permit struct used by the contract
    bytes32 public constant PERMIT_TYPEHASH =
        keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );

    uint256 internal immutable mintLockPeriod;
    uint256 internal constant INITIAL_MINT_LIMIT = 10000000 * (10**18);

    constructor() public VSPGovernanceToken("VesperToken", "VSP") {
        mintLockPeriod = block.timestamp + (365 days);
    }

    /// @dev Mint VSP. Only owner can mint
    function mint(address _recipient, uint256 _amount) external onlyOwner {
        require(
            (totalSupply().add(_amount) <= INITIAL_MINT_LIMIT) ||
                (block.timestamp > mintLockPeriod),
            "Minting not allowed"
        );
        _mint(_recipient, _amount);
        _moveDelegates(address(0), delegates[_recipient], _amount);
    }

    /// @dev Burn VSP from caller
    function burn(uint256 _amount) external {
        _burn(_msgSender(), _amount);
        _moveDelegates(delegates[_msgSender()], address(0), _amount);
    }

    /// @dev Burn VSP from given account. Caller must have proper allowance.
    function burnFrom(address _account, uint256 _amount) external {
        uint256 decreasedAllowance =
            allowance(_account, _msgSender()).sub(_amount, "ERC20: burn amount exceeds allowance");

        _approve(_account, _msgSender(), decreasedAllowance);
        _burn(_account, _amount);
        _moveDelegates(delegates[_account], address(0), _amount);
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
     * @param _owner The address to approve from
     * @param _spender The address to be approved
     * @param _amount The number of tokens that are approved (2^256-1 means infinite)
     * @param _deadline The time at which to expire the signature
     * @param _v The recovery byte of the signature
     * @param _r Half of the ECDSA signature pair
     * @param _s Half of the ECDSA signature pair
     */
    function permit(
        address _owner,
        address _spender,
        uint256 _amount,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external {
        require(_deadline >= block.timestamp, "VSP:permit: signature expired");

        bytes32 domainSeparator =
            keccak256(
                abi.encode(
                    DOMAIN_TYPEHASH,
                    keccak256(bytes(name())),
                    keccak256(bytes("1")),
                    getChainId(),
                    address(this)
                )
            );
        bytes32 structHash =
            keccak256(
                abi.encode(PERMIT_TYPEHASH, _owner, _spender, _amount, nonces[_owner]++, _deadline)
            );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        address signatory = ecrecover(digest, _v, _r, _s);
        require(signatory != address(0) && signatory == _owner, "VSP::permit: invalid signature");
        _approve(_owner, _spender, _amount);
    }

    /// @dev Overridden ERC20 transfer
    function transfer(address recipient, uint256 amount) public override returns (bool) {
        _transfer(_msgSender(), recipient, amount);
        _moveDelegates(delegates[_msgSender()], delegates[recipient], amount);
        return true;
    }

    /// @dev Overridden ERC20 transferFrom
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public override returns (bool) {
        _transfer(sender, recipient, amount);
        _approve(
            sender,
            _msgSender(),
            allowance(sender, _msgSender()).sub(
                amount,
                "VSP::transferFrom: transfer amount exceeds allowance"
            )
        );
        _moveDelegates(delegates[sender], delegates[recipient], amount);
        return true;
    }
}
