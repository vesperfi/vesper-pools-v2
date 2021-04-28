'use strict'

const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
const {shouldBehaveLikeStrategy} = require('./behavior/maker-strategy')
const {deposit} = require('./utils/poolOps')
const {setupVPool} = require('./utils/setupHelper')
const VDAI = artifacts.require('VDAI')
const {expectRevert} = require('@openzeppelin/test-helpers')
const CollateralManager = artifacts.require('CollateralManager')
const AaveStrategy = artifacts.require('AaveV2StrategyDAI')
const AaveStrategyETH = artifacts.require('AaveStrategyETH')
const VETH = artifacts.require('VETH')
const VesperStrategy = artifacts.require('VesperMakerStrategyETH')
const Controller = artifacts.require('Controller')

contract('VETH Pool', function (accounts) {
  let vDai, dai, vEth, strategy, weth
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
      pool: VETH,
      strategy: VesperStrategy,
      collateralManager: CollateralManager,
      feeCollector: accounts[9],
      strategyType: 'vesperMaker',
      vPool: vDai,
      contracts: {controller: vDaiPoolObj.controller},
    })
    vDai = this.providerToken
    this.newStrategy = AaveStrategyETH
    vEth = this.pool
    strategy = this.strategy
    weth = this.collateralToken
  })

  shouldBehaveLikePool('vETH', 'WETH', 'vDai', accounts)

  shouldBehaveLikeStrategy('vETH', 'WETH', 'vDai', accounts)

  it('Should not allow to sweep vToken from pool and strategy', async function () {
    await deposit(vEth, weth, 10, user1)
    await vEth.rebalance()
    let tx = strategy.sweepErc20(vDai.address)
    await expectRevert(tx, 'not-allowed-to-sweep')
    tx = vEth.sweepErc20(vDai.address)
    await expectRevert(tx, 'Not allowed to sweep')
  })
})
