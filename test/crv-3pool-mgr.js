'use strict'

const {expect} = require('chai')
const {ethers} = require('hardhat')
const time = require('./utils/time')
const {deployContract} = require('./utils/setupHelper')
const {BigNumber: BN} = require('ethers')
const {swapEthForToken} = require('./utils/tokenSwapper')

// We use these
const DECIMAL = BN.from('1000000000000000000')
const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f'
// const POOL = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7'
const THREECRV = '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490'
const GAUGE = '0xbFcF63294aD7105dEa65aA58F8AE5BE2D9d0952A'
const CRV = '0xD533a949740bb3306d119CC777fa900bA034cd52'

// globals
let poolManager, daiToken, lpToken, gaugeToken, crvToken, daiBalance,
  lpBalance, gaugeBalance, crvBalance, accounts

async function getBalances() {
  daiBalance = await daiToken.balanceOf(poolManager.address)
  lpBalance = await lpToken.balanceOf(poolManager.address)
  gaugeBalance = await gaugeToken.balanceOf(poolManager.address)
  crvBalance = await crvToken.balanceOf(poolManager.address)
}

/* eslint-disable mocha/max-top-level-suites, mocha/no-top-level-hooks */
describe('Crv3PoolMgr', function() {
  before(async function() {
    accounts = await ethers.getSigners()
    poolManager = await deployContract('Crv3PoolMock')    
   
    // 10 ETH for DAI
    await swapEthForToken(10, DAI, accounts[0], poolManager.address)
    daiToken = await ethers.getContractAt('ERC20',DAI)
    lpToken = await ethers.getContractAt('ERC20',THREECRV)
    gaugeToken = await ethers.getContractAt('ERC20',GAUGE)
    crvToken = await ethers.getContractAt('ERC20',CRV)
    await poolManager.approveLpForGauge()
    await poolManager.approveTokenForPool(DAI)
  })

  beforeEach(async function() {
    await getBalances()
  })

  describe('depositToCRVPool', function() {
    it('Should deposit DAI into the pool', async function() {
      const daiAmt = BN.from(2000).mul(DECIMAL)
      await poolManager.depositToCrvPool(daiAmt, 0, 0)
      expect(await daiToken.balanceOf(poolManager.address)).to.be.equal(daiBalance.sub(daiAmt))
      expect(await lpToken.balanceOf(poolManager.address)).to.be.gt('0')
    })
  })

  describe('depositDAIToCRVPool', function() {
    it('Should deposit DAI into the pool', async function() {
      const daiAmt = BN.from(2000).mul(DECIMAL)
      await poolManager.depositDaiToCrvPool(daiAmt, false)
      expect(await daiToken.balanceOf(poolManager.address)).to.be.equal(daiBalance.sub(daiAmt))
      expect(await lpToken.balanceOf(poolManager.address)).to.be.gt(lpBalance)
    })
  })

  describe('withdrawAsFromCRVPool', function() {
    it('Should withdraw DAI from the pool', async function() {
      const wdAmt = lpBalance.div(BN.from(4))
      await poolManager.withdrawAsFromCrvPool(wdAmt, 0, 0)
      expect(await daiToken.balanceOf(poolManager.address)).to.be.gt(daiBalance)
      expect(await lpToken.balanceOf(poolManager.address)).to.be.equal(lpBalance.sub(wdAmt))
    })
  })

  describe('calcWithdrawLpAs', function() {
    it('Should calculate LP amount when there is nothing in the gauge DAI', async function() {
      const daiNeeded = lpBalance.div(BN.from(4))
      const lpAmt = await poolManager.calcWithdrawLpAs(daiNeeded, 0)
      expect(lpAmt.lpToWithdraw).to.be.gt('0')
      expect(lpAmt.lpToWithdraw).to.be.lt(daiNeeded)
      expect(lpAmt.unstakeAmt).to.be.equal('0')
    })

    it('Should calculate LP amount when there is something in the gauge', async function() {
      await poolManager.stakeAllLpToGauge()
      const daiNeeded = lpBalance.div(BN.from(2))
      const lpAmt = await poolManager.calcWithdrawLpAs(daiNeeded, 0)
      expect(lpAmt.lpToWithdraw).to.be.gt('0')
      expect(lpAmt.lpToWithdraw).to.be.lt(daiNeeded)
      expect(lpAmt.unstakeAmt).to.be.gt('0')
      await poolManager.unstakeLpFromGauge(lpAmt.unstakeAmt)
      await poolManager.withdrawAsFromCrvPool(lpAmt.lpToWithdraw, 0, 0)
      const newDAIBalance = await daiToken.balanceOf(poolManager.address)
      const withdrawn = newDAIBalance.sub(daiBalance)
      expect(withdrawn).to.be.gte(daiNeeded, 'wrong amount withdrawn')
      await poolManager.unstakeAllLpFromGauge()
    })
  })

  describe('stakeAllLPToGauge', function() {
    it('Should stake all LP to the Gauge', async function() {
      await poolManager.stakeAllLpToGauge()
      expect(await gaugeToken.balanceOf(poolManager.address)).to.be.gt(gaugeBalance)
      expect(await lpToken.balanceOf(poolManager.address)).to.be.equal('0')
    })
  })

  describe('unstakeLPFromGauge', function() {
    it('Should remove LP from the Gauge', async function() {
      const wdAmt = gaugeBalance.div(BN.from(4))
      await poolManager.unstakeLpFromGauge(wdAmt)
      expect(await gaugeToken.balanceOf(poolManager.address)).to.be.equal(gaugeBalance.sub(wdAmt))
      expect(await lpToken.balanceOf(poolManager.address)).to.be.gt(lpBalance)
    })
  })

  describe('unstakeAllLPFromGauge', function() {
    it('Should remove LP from the Gauge', async function() {
      await poolManager.unstakeAllLpFromGauge()
      expect(await gaugeToken.balanceOf(poolManager.address)).to.be.equal('0')
      expect(await lpToken.balanceOf(poolManager.address)).to.be.gt(lpBalance)
    })
  })

  describe('Rewards', function() {
    before(async function() {
      daiBalance = await daiToken.balanceOf(poolManager.address)
      await poolManager.depositDaiToCrvPool(daiBalance, true)
      await getBalances()
      expect(daiBalance).to.be.equal('0')
      expect(lpBalance).to.be.equal('0')
      expect(gaugeBalance).to.be.gt('0')
      expect(crvBalance).to.be.equal('0')
      // 1 month
      await time.increase(24 * 60 * 60 * 30)
      await poolManager.setCheckpoint()
    })

    it('Should calculate rewards', async function() {
      const availableRewards = await poolManager.claimableRewards()
      expect(availableRewards).to.be.gt('0')
    })

    it('Should claim rewards', async function() {
      await poolManager.claimCrv()
      crvBalance = await crvToken.balanceOf(poolManager.address)
      expect(crvBalance).to.be.gt('0')
      const availableRewards = await poolManager.claimableRewards()
      expect(availableRewards).to.be.equal('0')
    })
  })
})
