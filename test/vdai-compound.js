'use strict'
const {ethers} = require('hardhat')
const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
const {shouldBehaveLikeStrategy} = require('./behavior/compound-strategy')
const {setupVPool} = require('./utils/setupHelper')

describe('vDAI Pool with Compound strategy', function () {
  beforeEach(async function () {
    this.accounts = await ethers.getSigners()
    await setupVPool(this, {
      pool: 'VDAI',
      strategy: 'CompoundStrategyDAI',
      feeCollector: this.accounts[9],
      strategyType: 'compound',
    })

    this.newStrategy = 'CompoundStrategyDAI'
  })

  shouldBehaveLikePool('vDAI', 'DAI', 'cDAI')
  shouldBehaveLikeStrategy('vDAI', 'DAI')
})
