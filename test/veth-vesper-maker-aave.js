'use strict'
const {ethers} = require('hardhat')
const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
const {shouldBehaveLikeStrategy} = require('./behavior/maker-strategy')
const {deposit} = require('./utils/poolOps')
const {setupVPool} = require('./utils/setupHelper')
const {expect} = require('chai')

describe('VETH Pool', function () {
  let vDai, dai, vEth, strategy, weth, user1
  const vDaiPoolObj = {}

  beforeEach(async function () {
    this.accounts = await ethers.getSigners()
    vDaiPoolObj.accounts = this.accounts
    ;[, user1] = this.accounts
    await setupVPool(vDaiPoolObj, {
      pool: 'VDAI',
      strategy: 'AaveV2StrategyDAI',
      strategyType: 'aaveV2',
      feeCollector: this.accounts[9],
    })
    vDai = vDaiPoolObj.pool
    dai = await vDaiPoolObj.collateralToken
    await deposit(vDai, dai, 2, user1)
    await vDai.rebalance()
    await setupVPool(this, {
      pool: 'VETH',
      strategy: 'VesperMakerStrategyETH',
      collateralManager: 'CollateralManager',
      feeCollector: this.accounts[9],
      strategyType: 'vesperMaker',
      vPool: vDai,
      contracts: {controller: vDaiPoolObj.controller},
    })
    vDai = this.providerToken
    this.newStrategy = 'AaveV2StrategyETH'
    vEth = this.pool
    strategy = this.strategy
    weth = this.collateralToken
  })

  shouldBehaveLikePool('vETH', 'WETH', 'vDai')

  shouldBehaveLikeStrategy('vETH', 'WETH', 'vDai')

  it('Should not allow to sweep vToken from pool and strategy', async function () {
    await deposit(vEth, weth, 10, user1)
    await vEth.rebalance()
    let tx = strategy.sweepErc20(vDai.address)
    await expect(tx).to.be.revertedWith('not-allowed-to-sweep')
    tx = vEth.sweepErc20(vDai.address)
    await expect(tx).to.be.revertedWith('Not allowed to sweep')
  })
})
