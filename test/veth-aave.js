'use strict'

const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
const {shouldBehaveLikeStrategy} = require('./behavior/aave-strategy')
const {setupVPool} = require('./utils/setupHelper')

const VETH = artifacts.require('VETH')
const AaveStrategy = artifacts.require('AaveStrategyETH')
const Controller = artifacts.require('Controller')

contract('vETH Pool with AaveStrategy', function (accounts) {
  beforeEach(async function () {
    await setupVPool(this, {
      controller: Controller,
      pool: VETH,
      strategy: AaveStrategy,
      feeCollector: accounts[9],
      strategyType: 'aave',
    })
    this.newStrategy = AaveStrategy
  })

  shouldBehaveLikePool('vETH', 'WETH', 'aETH', accounts)
  shouldBehaveLikeStrategy('vETH', 'WETH', 'aETH', accounts)
})
