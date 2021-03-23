'use strict'

const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
const {shouldBehaveLikeStrategy} = require('./behavior/compound-strategy')
const {setupVPool} = require('./utils/setupHelper')

const VUSDC = artifacts.require('VUSDC')
const CompoundStrategy = artifacts.require('CompoundStrategyUSDC')
const Controller = artifacts.require('Controller')

contract('vUSDC Pool with Compound strategy', function (accounts) {
  beforeEach(async function () {
    await setupVPool(this, {
      controller: Controller,
      pool: VUSDC,
      strategy: CompoundStrategy,
      feeCollector: accounts[9],
      strategyType: 'compound',
    })

    this.newStrategy = CompoundStrategy
  })

  shouldBehaveLikePool('vUSDC', 'USDC', 'cUSDC', accounts)
  shouldBehaveLikeStrategy('vUSDC', 'USDC', accounts)
})
