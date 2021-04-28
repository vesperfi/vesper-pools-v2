'use strict'
const {ethers} = require('hardhat')
const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
// const {shouldBehaveLikeStrategy} = require('./behavior/aave-strategy')
const {setupVPool} = require('./utils/setupHelper')

describe('vDAI Pool with AaveStrategy', function () {
  beforeEach(async function () {
    this.accounts = await ethers.getSigners()
    await setupVPool(this, {
      pool: 'VDAI',
      strategy: 'AaveV2StrategyDAI',
      feeCollector: this.accounts[9],
      strategyType: 'aaveV2',
    })

    this.newStrategy = 'AaveV2StrategyDAI'
  })

  shouldBehaveLikePool('vDai', 'DAI', 'aDai')
  // shouldBehaveLikeStrategy('vDai', 'DAI', 'aDai')
})
