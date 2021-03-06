'use strict'
const { ethers } = require('hardhat')
const { shouldBehaveLikePool } = require('./behavior/vesper-pool')
const { shouldBehaveLikeStrategy } = require('./behavior/vesper-v3-strategy')
const { setupVPool, unlock } = require('./utils/setupHelper')

describe('vDAI Pool with VesperV3Strategy', function () {


  const v3PoolAddress = '0xB4eDcEFd59750144882170FCc52ffeD40BfD5f7d'
  const vesperDeployer = '0xB5AbDABE50b5193d4dB92a16011792B22bA3Ef51'

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
    // vDAI-V3 Pool
    this.receiptToken = v3PoolAddress

    await setupVPool(this, {
      controller: 'Controller',
      pool: 'VDAI',
      strategy: 'VesperV3StrategyDAI',
      feeCollector: this.accounts[9],
      strategyType: 'vesperv3',
    })
    this.newStrategy = 'VesperV3StrategyDAI'

    this.v3Keeper = await unlock(vesperDeployer)
    this.v3Pool = await ethers.getContractAt(abiV3Pool, v3PoolAddress)
    await this.v3Pool.connect(this.v3Keeper).addInList(await this.v3Pool.feeWhitelist(), this.strategy.address)
  })

  shouldBehaveLikePool('vDAI', 'DAI', 'vDAI-V3')
  shouldBehaveLikeStrategy('vDAI', 'DAI')
})
