'use strict'

const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
const {shouldBehaveLikeStrategy} = require('./behavior/compound-strategy')
const {setupVPool} = require('./utils/setupHelper')

const VWBTC = artifacts.require('VWBTC')
const CompoundStrategy = artifacts.require('CompoundStrategyWBTC')
const Controller = artifacts.require('Controller')

contract('vWBTC Pool with Compound strategy', function (accounts) {
  beforeEach(async function () {
    await setupVPool(this, {
      controller: Controller,
      pool: VWBTC,
      strategy: CompoundStrategy,
      feeCollector: accounts[9],
      strategyType: 'compound',
    })

    this.newStrategy = CompoundStrategy
  })

  shouldBehaveLikePool('VWBTC', 'WBTC', 'cWTBC', accounts)
  shouldBehaveLikeStrategy('VWBTC', 'WBTC', accounts)
})
