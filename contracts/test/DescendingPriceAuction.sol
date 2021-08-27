// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/EnumerableMap.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../interfaces/bloq/IDescendingPriceAuction.sol";

contract DescendingPriceAuction is IDescendingPriceAuction {
    using SafeERC20 for IERC20;
    using Counters for Counters.Counter;
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableMap for EnumerableMap.UintToAddressMap;

    mapping(uint256 => DPA) private auctions;
    EnumerableMap.UintToAddressMap private collections;
    EnumerableMap.UintToAddressMap private auctioneers;
    Counters.Counter private collectionCount;
    Counters.Counter private auctionCount;

    // Mapping from aucitoneer address to their (enumerable) set of auctions
    mapping(address => EnumerableSet.UintSet) private _byNeer;

    // Mapping from collectionId to its (enumerable) set of auctions
    mapping(uint256 => EnumerableSet.UintSet) private _byColl;

    constructor() public {
        // Start the counts at 1
        // the 0th collection is available to all
        auctionCount.increment();
        collectionCount.increment();
    }

    function _msgSender() internal view returns (address) {
        return msg.sender;
    }

    modifier onlyAuctioneer(uint256 _id) {
        (bool success, address neer) = auctioneers.tryGet(_id);
        require(success, "non-existent-auction");
        require(_msgSender() == neer, "caller-not-auctioneer");
        _;
    }

    modifier onlyCollectionOwner(uint256 _id) {
        // anyone can create an auction in the 0th collection
        if (_id != 0) {
            (bool success, address owner) = collections.tryGet(_id);
            require(success, "non-existent-collection");
            require(_msgSender() == owner, "caller-not-collection-owner");
        }
        _;
    }

    function getAuction(uint256 _id) external view override returns (DPA memory) {
        return auctions[_id];
    }

    function totalAuctions() external view override returns (uint256) {
        return auctioneers.length();
    }

    function totalCollections() external view override returns (uint256) {
        return collections.length();
    }

    function collectionLength(uint256 _id) external view override returns (uint256) {
        return _byColl[_id].length();
    }

    function neerGroupLength(address _neer) external view override returns (uint256) {
        return _byNeer[_neer].length();
    }

    // return AuctionId
    function auctionOfNeerByIndex(address _neer, uint256 i)
        external
        view
        override
        returns (uint256)
    {
        return _byNeer[_neer].at(i);
    }

    // return AuctionId
    function auctionOfCollByIndex(uint256 _id, uint256 i) external view override returns (uint256) {
        return _byColl[_id].at(i);
    }

    function _auctionExists(uint256 _auctionId) internal view virtual returns (bool) {
        return auctioneers.contains(_auctionId);
    }

    function createAuction(DPAConfig memory _auction)
        external
        override
        onlyCollectionOwner(_auction.collectionId)
        returns (uint256)
    {
        require(_auction.endBlock > block.number, "end-block-passed");
        require(_auction.ceiling != 0, "start-price-zero");
        require(_auction.ceiling >= _auction.floor, "invalid-pricing");
        require(_auction.paymentToken != address(0x0), "invalid-payment-token");
        require(_auction.payee != address(0x0), "invalid-payee");
        require(_auction.tokens.length != 0, "no-line-items");
        require(_auction.tokens.length == _auction.tokenAmounts.length, "improper-line-items");
        require(_auction.tokens.length < 8, "too-many-line-items");
        return _createAuction(_auction);
    }

    function _createAuction(DPAConfig memory _auction) internal returns (uint256) {
        _pullTokens(_auction.tokens, _auction.tokenAmounts);
        uint256 id = auctionCount.current();
        uint256 decay =
            _calulateAbsoluteDecay(
                _auction.ceiling,
                _auction.floor,
                block.number,
                _auction.endBlock
            );
        auctions[id] = DPA({
            id: id,
            ceiling: _auction.ceiling,
            floor: _auction.floor,
            absoluteDecay: decay,
            collectionId: _auction.collectionId,
            paymentToken: _auction.paymentToken,
            payee: _auction.payee,
            startBlock: block.number,
            endBlock: _auction.endBlock,
            stopped: false,
            winner: address(0x0),
            winningBlock: 0,
            winningPrice: 0,
            tokens: _auction.tokens,
            tokenAmounts: _auction.tokenAmounts
        });
        address neer = _msgSender();
        auctioneers.set(id, neer);
        _byNeer[neer].add(id);
        _byColl[_auction.collectionId].add(id);
        auctionCount.increment();
        emit AuctionCreated(id, _auction.collectionId, neer);
        return id;
    }

    function _pullTokens(address[] memory tokens, uint256[] memory amounts) internal {
        for (uint256 i = 0; i < tokens.length; i++) {
            _pullToken(tokens[i], amounts[i]);
        }
    }

    function _pullToken(address _token, uint256 _amount) internal {
        require(_amount != 0, "invalid-token-amount");
        _safeTransferFromExact(_token, _msgSender(), address(this), _amount);
    }

    function _sendTokens(
        address recipient,
        address[] memory tokens,
        uint256[] memory amounts
    ) internal {
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).safeTransfer(recipient, amounts[i]);
        }
    }

    function stopAuction(uint256 _id) external override onlyAuctioneer(_id) {
        DPA memory auction = auctions[_id];
        require(auction.winner == address(0x0) && !auction.stopped, "cant-be-stopped");
        _sendTokens(auctioneers.get(_id), auction.tokens, auction.tokenAmounts);
        auctions[_id].stopped = true;
        emit AuctionStopped(_id);
    }

    function bid(uint256 _id) external override {
        require(_auctionExists(_id), "no-such-auction-id");
        DPA memory auction = auctions[_id];
        require(auction.winner == address(0x0), "auction-has-ended");
        require(!auction.stopped, "auction-has-been-stopped");
        uint256 price =
            _getCurrentPrice(auction.absoluteDecay, auction.floor, auction.endBlock, block.number);
        address bidder = _msgSender();
        _safeTransferFromExact(auction.paymentToken, bidder, auction.payee, price);
        _sendTokens(bidder, auction.tokens, auction.tokenAmounts);
        auction.stopped = true;
        auction.winner = bidder;
        auction.winningBlock = block.number;
        auction.winningPrice = price;
        auctions[_id] = auction;
        emit AuctionWon(_id, price, auction.paymentToken, bidder);
    }

    function getCurrentPrice(uint256 _id) external view override returns (uint256) {
        require(_auctionExists(_id), "no-such-auction-id");
        DPA memory a = auctions[_id];
        return _getCurrentPrice(a.absoluteDecay, a.floor, a.endBlock, block.number);
    }

    function _getCurrentPrice(
        uint256 m,
        uint256 f,
        uint256 e,
        uint256 t
    ) internal pure returns (uint256 p) {
        if (t > e) return f;
        if (m == 0) return f;
        // we know m is actually negative, so we're solving y=-mx+b (p = -(m * t) + b)
        uint256 b = f + ((m * e) / 1e18);
        p = b - ((m * t) / 1e18);
    }

    function _calulateAbsoluteDecay(
        uint256 c,
        uint256 f,
        uint256 s,
        uint256 e
    ) internal pure returns (uint256) {
        require(e > s, "invalid-ramp");
        require(c >= f, "price-not-descending-or-const");
        return ((c - f) * 1e18) / (e - s);
    }

    function _safeTransferFromExact(
        address _token,
        address _from,
        address _to,
        uint256 _amount
    ) internal {
        IERC20 token = IERC20(_token);
        uint256 before = token.balanceOf(_to);
        token.safeTransferFrom(_from, _to, _amount);
        require(token.balanceOf(_to) - before == _amount, "not-enough-transferred");
    }

    function createCollection() external override returns (uint256) {
        uint256 id = collectionCount.current();
        address owner = _msgSender();
        collections.set(id, owner);
        collectionCount.increment();
        emit CollectionCreated(id, owner);
        return id;
    }

    function transferCollection(address _to, uint256 _id)
        external
        override
        onlyCollectionOwner(_id)
    {
        collections.set(_id, _to);
        emit CollectionTransfer(_id, _msgSender(), _to);
    }
}
