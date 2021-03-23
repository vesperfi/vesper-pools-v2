'use strict'

const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
const {shouldBehaveLikeStrategy} = require('./behavior/compound-strategy')
const {setupVPool} = require('./utils/setupHelper')

const VETH = artifacts.require('VETH')
const CompoundStrategy = artifacts.require('CompoundStrategyETH')
const Controller = artifacts.require('Controller')

contract('vETH Pool with Compound strategy', function (accounts) {
  beforeEach(async function () {
    await setupVPool(this, {
      controller: Controller,
      pool: VETH,
      strategy: CompoundStrategy,
      feeCollector: accounts[9],
      strategyType: 'compound',
    })

    this.newStrategy = CompoundStrategy
  })

  shouldBehaveLikePool('vETH', 'WETH', 'cETH', accounts)
  shouldBehaveLikeStrategy('vETH', 'WETH', accounts)
})
