'use strict'

const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
const {shouldBehaveLikeStrategy} = require('./behavior/aave-strategy')
const {setupVPool} = require('./utils/setupHelper')

const VDAI = artifacts.require('VDAI')
const AaveStrategy = artifacts.require('AaveStrategyDAI')
const Controller = artifacts.require('Controller')

contract('vDAI Pool with AaveStrategy', function (accounts) {
  beforeEach(async function () {
    await setupVPool(this, {
      controller: Controller,
      pool: VDAI,
      strategy: AaveStrategy,
      feeCollector: accounts[9],
      strategyType: 'aave',
    })

    this.newStrategy = AaveStrategy
  })

  shouldBehaveLikePool('vDai', 'DAI', 'aDai', accounts)
  shouldBehaveLikeStrategy('vDai', 'DAI', 'aDai', accounts)
})
