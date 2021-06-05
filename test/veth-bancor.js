'use strict'

const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
const {shouldBehaveLikeStrategy} = require('./behavior/bancor-strategy')
const {setupVPool} = require('./utils/setupHelper')

const VETH = artifacts.require('VETH')
const BancorStrategy = artifacts.require('BancorStrategyETH')
const Controller = artifacts.require('Controller')

contract('vETH Pool with Bancor strategy', function (accounts) {
  beforeEach(async function () {
    await setupVPool(this, {
      controller: Controller,
      pool: VETH,
      strategy: BancorStrategy,
      feeCollector: accounts[9],
      strategyType: 'bancor',
      liquidityLockPeriod: 1,
    })

    this.newStrategy = BancorStrategy
  })

  shouldBehaveLikePool('vETH', 'WETH', 'vETH', accounts)
  shouldBehaveLikeStrategy('vETH', 'WETH', accounts)
})
