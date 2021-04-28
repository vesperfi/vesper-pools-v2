'use strict'

const {ethers} = require('hardhat')
const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
// const {shouldBehaveLikeStrategy} = require('./behavior/aave-strategy')
const {setupVPool} = require('./utils/setupHelper')

describe('vETH Pool with AaveStrategy', function () {
  beforeEach(async function () {
    this.accounts = await ethers.getSigners()
    await setupVPool(this, {
      pool: 'VETH',
      strategy: 'AaveV2StrategyETH',
      feeCollector: this.accounts[9],
      strategyType: 'aaveV2',
    })
    this.newStrategy = 'AaveV2StrategyETH'
  })

  shouldBehaveLikePool('vETH', 'WETH', 'aETH')
  // shouldBehaveLikeStrategy('vETH', 'WETH', 'aETH')
})
