'use strict'
const {ethers} = require('hardhat')
const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
const {setupVPool} = require('./utils/setupHelper')

describe('vDAI Pool with VesperV3Strategy', function () {

  beforeEach(async function () {

    this.accounts = await ethers.getSigners()
    // vDAI-v3 Pool
    this.receiptToken = '0xB4eDcEFd59750144882170FCc52ffeD40BfD5f7d'

    await setupVPool(this, {
      controller: 'Controller',
      pool: 'VDAI',
      strategy: 'VesperV3StrategyDAI',
      feeCollector: this.accounts[9],
      strategyType: 'vesperv3',
    })
    this.newStrategy = 'VesperV3StrategyDAI'
  })

  shouldBehaveLikePool('vDAI', 'DAI', 'aDAI')
})
