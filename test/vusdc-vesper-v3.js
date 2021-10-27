'use strict'
const { ethers } = require('hardhat')
const { shouldBehaveLikePool } = require('./behavior/vesper-pool')
const { shouldBehaveLikeStrategy } = require('./behavior/vesper-v3-strategy')
const { setupVPool, unlock } = require('./utils/setupHelper')

describe('vUSDC Pool with VesperV3Strategy', function () {

  const v3PoolAddress = '0x3553e7420B1D68A010ad447b782fae6388f5F37F'
  const v3Keeper = '0xdf826ff6518e609E4cEE86299d40611C148099d5'

  const abiV3Pool = [
    'function getStrategies() external view returns (address[] memory)',
    'function withdraw(uint256 _amount) external',
    'function addInList(address _listToUpdate, address _addressToAdd) external',
    'function balanceOf(address account) external view returns(uint256)',
    'function feeWhitelist() external view returns (address)',
    'function updateWithdrawFee(uint256 _newWithdrawFee) external',
    'event Withdraw(address indexed owner, uint256 shares, uint256 amount)'
  ]

  beforeEach(async function () {

    this.accounts = await ethers.getSigners()
    // vUSDC-V3 Pool
    this.receiptToken = v3PoolAddress

    await setupVPool(this, {
      controller: 'Controller',
      pool: 'VUSDC',
      strategy: 'VesperV3StrategyUSDC',
      feeCollector: this.accounts[9],
      strategyType: 'vesperv3',
    })
    this.newStrategy = 'VesperV3StrategyUSDC'

    this.v3Keeper = await unlock(v3Keeper)
    this.v3Pool = await ethers.getContractAt(abiV3Pool, v3PoolAddress)
    await this.v3Pool.connect(this.v3Keeper).addInList(await this.v3Pool.feeWhitelist(), this.strategy.address)
  })

  shouldBehaveLikePool('vUSDC', 'USDC', 'vUSDC-V3')
  shouldBehaveLikeStrategy('vUSDC', 'USDC')
})
