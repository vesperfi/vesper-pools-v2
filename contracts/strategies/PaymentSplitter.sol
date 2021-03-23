// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/GSN/Context.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

/**
 * @title PaymentSplitter
 * @dev This contract allows to split ERC20 and Ether tokens among a group of accounts. The sender does not need to be aware
 * that the token(s) (payment) will be split in this way, since it is handled transparently by the contract.
 *
 * The split can be in equal parts or in any other arbitrary proportion. The way this is specified is by assigning each
 * account to a number of shares. Of all the payment(s) that this contract receives, each account will then be able to claim
 * an amount proportional to the percentage of total shares they were assigned.
 *
 * `PaymentSplitter` follows a _pull payment_ model. This means that payments are not automatically forwarded to the
 * accounts but kept in this contract, and the actual transfer is triggered as a separate step by calling the {release} or {releaseEther}
 * function.
 */
contract PaymentSplitter is Context {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    event PayeeAdded(address indexed payee, uint256 share);
    event PaymentReleased(address indexed payee, address indexed asset, uint256 tokens);

    // Total share.
    uint256 public totalShare;
    // Total released for an asset.
    mapping(address => uint256) public totalReleased;
    // Payee's share
    mapping(address => uint256) public share;
    // Payee's share released for an asset
    mapping(address => mapping(address => uint256)) public released;
    // list of payees
    address[] public payees;
    address private constant ETHER_ASSET = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /**
     * @dev Creates an instance of `PaymentSplitter` where each account in `_payees` is assigned token(s) at
     * the matching position in the `_share` array.
     *
     * All addresses in `payees` must be non-zero. Both arrays must have the same non-zero length, and there must be no
     * duplicates in `payees`.
     * @param _payees -  address(es) of payees eligible to receive token(s)
     * @param _share - list of shares, transferred to payee in provided ratio.
     */
    constructor(address[] memory _payees, uint256[] memory _share) public {
        // solhint-disable-next-line max-line-length
        require(_payees.length == _share.length, "payees-and-share-length-mismatch");
        require(_payees.length > 0, "no-payees");

        for (uint256 i = 0; i < _payees.length; i++) {
            _addPayee(_payees[i], _share[i]);
        }
    }

    receive() external payable {}

    /**
     * @dev Transfer of ERC20 token(s) to `payee` based on share and their previous withdrawals.
     * @param _payee - payee's address to receive token(s)
     * @param _asset - ERC20 token's address
     */
    function release(address _payee, address _asset) external {
        require(share[_payee] > 0, "payee-dont-have-share");
        // find total received token(s)
        uint256 totalReceived = IERC20(_asset).balanceOf(address(this)).add(totalReleased[_asset]);

        uint256 tokens = _calculateAndUpdateReleasedTokens(_payee, _asset, totalReceived);
        // Transfer ERC20 token(s) to Payee.
        IERC20(_asset).safeTransfer(_payee, tokens);
        emit PaymentReleased(_payee, _asset, tokens);
    }

    /**
     * @dev Transfer of ether to `payee` based on share and their previous withdrawals.
     * @param _payee - payee's address to receive ether
     */
    function releaseEther(address payable _payee) external {
        require(share[_payee] > 0, "payee-dont-have-share");
        uint256 totalReceived = address(this).balance.add(totalReleased[ETHER_ASSET]);
        // find total received amount
        uint256 amount = _calculateAndUpdateReleasedTokens(_payee, ETHER_ASSET, totalReceived);
        // Transfer Ether to Payee.
        Address.sendValue(_payee, amount);
        emit PaymentReleased(_payee, ETHER_ASSET, amount);
    }

    /**
     * @dev Calculate token(s) for `payee` based on share and their previous withdrawals.
     * @param _payee - payee's address
     * @param _asset - token's address
     * return token(s)/ ether to be released
     */
    function _calculateAndUpdateReleasedTokens(
        address _payee,
        address _asset,
        uint256 _totalReceived
    ) private returns (uint256 tokens) {
        // find eligible token(s)/ether for a payee
        uint256 releasedTokens = released[_payee][_asset];
        tokens = _totalReceived.mul(share[_payee]).div(totalShare).sub(releasedTokens);
        require(tokens != 0, "payee-is-not-due-for-tokens");
        // update released token(s)
        released[_payee][_asset] = releasedTokens.add(tokens);
        totalReleased[_asset] = totalReleased[_asset].add(tokens);
    }

    /**
     * @dev Add a new payee to the contract.
     * @param _payee - payee address
     * @param _share -  payee's share
     */
    function _addPayee(address _payee, uint256 _share) private {
        require(_payee != address(0), "payee-is-zero-address");
        require(_share > 0, "payee-with-zero-share");
        require(share[_payee] == 0, "payee-exists-with-share");
        payees.push(_payee);
        share[_payee] = _share;
        totalShare = totalShare.add(_share);
        emit PayeeAdded(_payee, _share);
    }
}
