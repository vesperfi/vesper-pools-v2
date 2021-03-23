'use strict'

const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
const {shouldBehaveLikeStrategy} = require('./behavior/aave-strategy')
const {setupVPool} = require('./utils/setupHelper')

const VUSDC = artifacts.require('VUSDC')
const AaveStrategy = artifacts.require('AaveStrategyUSDC')
const Controller = artifacts.require('Controller')

contract('vUSDC Pool with AaveStrategy', function (accounts) {
  beforeEach(async function () {
    await setupVPool(this, {
      controller: Controller,
      pool: VUSDC,
      strategy: AaveStrategy,
      feeCollector: accounts[9],
      strategyType: 'aave',
    })
    this.newStrategy = AaveStrategy
  })

  shouldBehaveLikePool('vUSDC', 'USDC', 'aUSDC', accounts)
  shouldBehaveLikeStrategy('vUSDC', 'USDC', 'aUSDC', accounts)
})
