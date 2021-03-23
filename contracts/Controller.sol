// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./Owned.sol";
import "./interfaces/vesper/IVesperPool.sol";
import "./interfaces/vesper/IStrategy.sol";
import "./interfaces/vesper/IPoolRewards.sol";
import "../sol-address-list/contracts/interfaces/IAddressList.sol";
import "../sol-address-list/contracts/interfaces/IAddressListFactory.sol";

contract Controller is Owned {
    using SafeMath for uint256;

    // Pool specific params
    mapping(address => uint256) public withdrawFee;
    mapping(address => uint256) public interestFee;
    mapping(address => address) public feeCollector;
    mapping(address => uint256) public rebalanceFriction;
    mapping(address => address) public strategy;
    mapping(address => address) public poolRewards;
    uint16 public aaveReferralCode;
    address public founderVault;
    uint256 public founderFee = 5e16;
    address public treasuryPool;
    address public uniswapRouter = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;
    IAddressList public immutable pools;

    constructor() public {
        IAddressListFactory addressFactory =
            IAddressListFactory(0xD57b41649f822C51a73C44Ba0B3da4A880aF0029);
        pools = IAddressList(addressFactory.createList());
    }

    modifier validPool(address pool) {
        require(pools.contains(pool), "Not a valid pool");
        _;
    }

    /**
     * @dev Add new pool in vesper system
     * @param _pool Address of new pool
     */
    function addPool(address _pool) external onlyOwner {
        require(_pool != address(0), "invalid-pool");
        IERC20 pool = IERC20(_pool);
        require(pool.totalSupply() == 0, "Zero supply required");
        pools.add(_pool);
    }

    /**
     * @dev Remove pool from vesper system
     * @param _pool Address of pool to be removed
     */
    function removePool(address _pool) external onlyOwner {
        IERC20 pool = IERC20(_pool);
        require(pool.totalSupply() == 0, "Zero supply required");
        pools.remove(_pool);
    }

    /**
     * @dev Execute transaction in given target contract
     * @param target Address of target contract
     * @param value Ether amount to transfer
     * @param signature Signature of function in target contract
     * @param data Encoded data for function call
     */
    function executeTransaction(
        address target,
        uint256 value,
        string memory signature,
        bytes memory data
    ) external payable onlyOwner returns (bytes memory) {
        return _executeTransaction(target, value, signature, data);
    }

    /// @dev Execute multiple transactions.
    function executeTransactions(
        address[] memory targets,
        uint256[] memory values,
        string[] memory signatures,
        bytes[] memory calldatas
    ) external payable onlyOwner {
        require(targets.length != 0, "Must provide actions");
        require(
            targets.length == values.length &&
                targets.length == signatures.length &&
                targets.length == calldatas.length,
            "Transaction data mismatch"
        );

        for (uint256 i = 0; i < targets.length; i++) {
            _executeTransaction(targets[i], values[i], signatures[i], calldatas[i]);
        }
    }

    function updateAaveReferralCode(uint16 referralCode) external onlyOwner {
        aaveReferralCode = referralCode;
    }

    function updateFeeCollector(address _pool, address _collector)
        external
        onlyOwner
        validPool(_pool)
    {
        require(_collector != address(0), "invalid-collector");
        require(feeCollector[_pool] != _collector, "same-collector");
        feeCollector[_pool] = _collector;
    }

    function updateFounderVault(address _founderVault) external onlyOwner {
        founderVault = _founderVault;
    }

    function updateFounderFee(uint256 _founderFee) external onlyOwner {
        require(founderFee != _founderFee, "same-founderFee");
        require(_founderFee <= 1e18, "founderFee-above-100%");
        founderFee = _founderFee;
    }

    function updateInterestFee(address _pool, uint256 _interestFee) external onlyOwner {
        require(_interestFee <= 1e18, "Fee limit reached");
        require(feeCollector[_pool] != address(0), "FeeCollector not set");
        interestFee[_pool] = _interestFee;
    }

    function updateStrategy(address _pool, address _newStrategy)
        external
        onlyOwner
        validPool(_pool)
    {
        require(_newStrategy != address(0), "invalid-strategy-address");
        address currentStrategy = strategy[_pool];
        require(currentStrategy != _newStrategy, "same-pool-strategy");
        require(IStrategy(_newStrategy).pool() == _pool, "wrong-pool");
        IVesperPool vpool = IVesperPool(_pool);
        if (currentStrategy != address(0)) {
            require(IStrategy(currentStrategy).isUpgradable(), "strategy-is-not-upgradable");
            vpool.resetApproval();
        }
        strategy[_pool] = _newStrategy;
        vpool.approveToken();
    }

    function updateRebalanceFriction(address _pool, uint256 _f)
        external
        onlyOwner
        validPool(_pool)
    {
        require(rebalanceFriction[_pool] != _f, "same-friction");
        rebalanceFriction[_pool] = _f;
    }

    function updatePoolRewards(address _pool, address _poolRewards)
        external
        onlyOwner
        validPool(_pool)
    {
        require(IPoolRewards(_poolRewards).pool() == _pool, "wrong-pool");
        poolRewards[_pool] = _poolRewards;
    }

    function updateTreasuryPool(address _pool) external onlyOwner validPool(_pool) {
        treasuryPool = _pool;
    }

    function updateUniswapRouter(address _uniswapRouter) external onlyOwner {
        uniswapRouter = _uniswapRouter;
    }

    function updateWithdrawFee(address _pool, uint256 _newWithdrawFee)
        external
        onlyOwner
        validPool(_pool)
    {
        require(_newWithdrawFee <= 1e18, "withdraw-fee-limit-reached");
        require(withdrawFee[_pool] != _newWithdrawFee, "same-withdraw-fee");
        require(feeCollector[_pool] != address(0), "FeeCollector-not-set");
        withdrawFee[_pool] = _newWithdrawFee;
    }

    function isPool(address _pool) external view returns (bool) {
        return pools.contains(_pool);
    }

    function _executeTransaction(
        address target,
        uint256 value,
        string memory signature,
        bytes memory data
    ) internal onlyOwner returns (bytes memory) {
        bytes memory callData;
        if (bytes(signature).length == 0) {
            callData = data;
        } else {
            callData = abi.encodePacked(bytes4(keccak256(bytes(signature))), data);
        }
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory returnData) = target.call{value: value}(callData);
        require(success, "Transaction execution reverted.");
        return returnData;
    }
}
