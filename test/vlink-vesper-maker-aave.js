'use strict'

const {ethers} = require('hardhat')
const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
const {shouldBehaveLikeStrategy} = require('./behavior/maker-strategy')
const {deposit} = require('./utils/poolOps')
const {setupVPool} = require('./utils/setupHelper')
const {expect} = require('chai')

describe('VLINK Pool', function () {
  let vDai, dai, vLink, strategy, link
  const vDaiPoolObj = {}

  beforeEach(async function () {
    this.accounts = await ethers.getSigners()
    vDaiPoolObj.accounts = this.accounts
    await setupVPool(vDaiPoolObj, {
      pool: 'VDAI',
      strategy: 'AaveV2StrategyDAI',
      strategyType: 'aaveV2',
      feeCollector: this.accounts[9],
    })
    vDai = vDaiPoolObj.pool
    dai = await vDaiPoolObj.collateralToken
    await deposit(vDai, dai, 2, this.accounts[0])
    await vDai.rebalance()
    await setupVPool(this, {
      pool: 'VLINK',
      strategy: 'VesperMakerStrategyLINK',
      collateralManager: 'CollateralManager',
      feeCollector: this.accounts[9],
      strategyType: 'vesperMaker',
      vPool: vDai,
      contracts: {controller: vDaiPoolObj.controller},
    })
    vDai = this.providerToken
    this.newStrategy = 'AaveV2StrategyLINK'
    vLink = this.pool
    strategy = this.strategy
    link = this.collateralToken
  })

  shouldBehaveLikePool('vLINK', 'LINK', 'vLink')

  shouldBehaveLikeStrategy('vLINK', 'LINK', 'vLink')

  it('Should not allow to sweep vToken from pool and strategy', async function () {
    await deposit(vLink, link, 10, this.accounts[0])
    await vLink.rebalance()
    let tx = strategy.sweepErc20(vDai.address)
    await expect(tx).to.be.revertedWith('not-allowed-to-sweep')
    tx = vLink.sweepErc20(vDai.address)
    await expect(tx).to.be.revertedWith('Not allowed to sweep')
  })

})
