'use strict'

const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
const {shouldBehaveLikeStrategy} = require('./behavior/compound-strategy')
const {setupVPool} = require('./utils/setupHelper')

const VDAI = artifacts.require('VDAI')
const CompoundStrategy = artifacts.require('CompoundStrategyDAI')
const Controller = artifacts.require('Controller')

contract('vDAI Pool with Compound strategy', function (accounts) {
  beforeEach(async function () {
    await setupVPool(this, {
      controller: Controller,
      pool: VDAI,
      strategy: CompoundStrategy,
      feeCollector: accounts[9],
      strategyType: 'compound',
    })

    this.newStrategy = CompoundStrategy
  })

  shouldBehaveLikePool('vDAI', 'DAI', 'cDAI', accounts)
  shouldBehaveLikeStrategy('vDAI', 'DAI', accounts)
})
