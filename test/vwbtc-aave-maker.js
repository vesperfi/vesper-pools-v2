'use strict'

const VWBTC = artifacts.require('VWBTC')
const AaveStrategy = artifacts.require('AaveMakerStrategyWBTC')
const DirectAaveStrategy = artifacts.require('AaveStrategyWBTC')
const Controller = artifacts.require('Controller')
const CollateralManager = artifacts.require('CollateralManager')

const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
const {shouldBehaveLikeStrategy} = require('./behavior/maker-strategy')
const {setupVPool} = require('./utils/setupHelper')

contract('VWBTC Pool', function (accounts) {
  beforeEach(async function () {
    await setupVPool(this, {
      controller: Controller,
      pool: VWBTC,
      strategy: AaveStrategy,
      collateralManager: CollateralManager,
      feeCollector: accounts[9],
      strategyType: 'maker'
    })
    this.newStrategy = DirectAaveStrategy
  })

  shouldBehaveLikePool('vWBTC', 'WBTC', 'aDAI', accounts)
  shouldBehaveLikeStrategy('vWBTC', 'WBTC', 'aDAI', accounts)
})
