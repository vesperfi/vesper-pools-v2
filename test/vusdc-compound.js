'use strict'

const {ethers} = require('hardhat')
const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
const {shouldBehaveLikeStrategy} = require('./behavior/compound-strategy')
const {setupVPool} = require('./utils/setupHelper')

describe('vUSDC Pool with Compound strategy', function () {
  beforeEach(async function () {
    this.accounts = await ethers.getSigners()
    await setupVPool(this, {
      pool: 'VUSDC',
      strategy: 'CompoundStrategyUSDC',
      feeCollector: this.accounts[9],
      strategyType: 'compound',
    })

    this.newStrategy = 'CompoundStrategyUSDC'
  })

  shouldBehaveLikePool('vUSDC', 'USDC', 'cUSDC')
  shouldBehaveLikeStrategy('vUSDC', 'USDC')
})
