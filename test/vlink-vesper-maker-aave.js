'use strict'

const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
const {shouldBehaveLikeStrategy} = require('./behavior/maker-strategy')
const {deposit} = require('./utils/poolOps')
const {setupVPool} = require('./utils/setupHelper')
const VDAI = artifacts.require('VDAI')
const {expectRevert} = require('@openzeppelin/test-helpers')
const CollateralManager = artifacts.require('CollateralManager')
const AaveStrategy = artifacts.require('AaveV2StrategyDAI')
const VLINK = artifacts.require('VLINK')
const VesperStrategy = artifacts.require('VesperMakerStrategyLINK')
const AaveV2StrategyLINK = artifacts.require('AaveV2StrategyLINK')
const Controller = artifacts.require('Controller')

contract('VLINK Pool', function (accounts) {
  let vDai, dai, vLink, strategy, link
  const vDaiPoolObj = {}

  const [, user1] = accounts

  beforeEach(async function () {
    this.accounts = accounts
    await setupVPool(vDaiPoolObj, {
      controller: Controller,
      pool: VDAI,
      strategy: AaveStrategy,
      strategyType: 'aave',
      feeCollector: accounts[9],
    })
    vDai = vDaiPoolObj.pool
    dai = await vDaiPoolObj.collateralToken
    await deposit(vDai, dai, 2, user1)
    await vDai.rebalance()
    await setupVPool(this, {
      controller: Controller,
      pool: VLINK,
      strategy: VesperStrategy,
      collateralManager: CollateralManager,
      feeCollector: accounts[9],
      strategyType: 'vesperMaker',
      vPool: vDai,
      contracts: {controller: vDaiPoolObj.controller},
    })
    vDai = this.providerToken
    this.newStrategy = AaveV2StrategyLINK
    vLink = this.pool
    strategy = this.strategy
    link = this.collateralToken
  })

  shouldBehaveLikePool('vLINK', 'LINK', 'vLink', accounts)

  shouldBehaveLikeStrategy('vLINK', 'LINK', 'vLink', accounts)

  it('Should not allow to sweep vToken from pool and strategy', async function () {
    await deposit(vLink, link, 10, user1)
    await vLink.rebalance()
    let tx = strategy.sweepErc20(vDai.address)
    await expectRevert(tx, 'not-allowed-to-sweep')
    tx = vLink.sweepErc20(vDai.address)
    await expectRevert(tx, 'Not allowed to sweep')
  })
})
