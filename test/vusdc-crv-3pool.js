'use strict'

/* eslint-disable no-console */

const {ethers} = require('hardhat')
const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
const {shouldBehaveLikeStrategy} = require('./behavior/crv-strategy')
const {expect} = require('chai')
const {deposit} = require('./utils/poolOps')
const {setupVPool} = require('./utils/setupHelper')
const {BigNumber: BN} = require('ethers')
const time = require('./utils/time')

describe('vUSDC Pool with Crv3PoolStrategy', function () {
  let pool, collateralToken, feeCollector, strategy
  let user1, user2, user3

  beforeEach(async function () {
    this.accounts = await ethers.getSigners()
    ;[, user1, user2, user3] = this.accounts
    await setupVPool(this, {
      pool: 'VUSDC',
      strategy: 'Crv3PoolStrategyUSDC',
      feeCollector: this.accounts[9],
      strategyType: 'crv',
    })
    this.newStrategy = 'Crv3PoolStrategyUSDC'
    pool = this.pool
    collateralToken = this.collateralToken
    strategy = this.strategy
    feeCollector = this.feeCollector
  })

  shouldBehaveLikePool('vUsdc', 'USDC', '3CRV')
  shouldBehaveLikeStrategy('vUsdc', 'USDC', '3CRV')

  describe('Crv3PoolStrategy: USDC Functionality', function() {
    it('Should calculate fees properly and reflect those in share price', async function () {
      await deposit(pool, collateralToken, 20, user1)
      await pool.rebalance()
      const price1 = await pool.getPricePerShare()
      // Time travel to generate earning
      await time.increase(30*24*60*60)
      await deposit(pool, collateralToken, 20, user2)
      let prevLpRate = await strategy.prevLpRate()
      await pool.rebalance()
      const price2 = await pool.getPricePerShare()
      expect(price2).to.be.gt(price1, 'Share value should increase (1)')
      // Time travel to generate earning
      await time.increase(30*24*60*60)
      await deposit(pool, collateralToken, 20, user3)
      await time.increase(30*24*60*60)
      let prevLpRate2 = await strategy.prevLpRate()
      expect(prevLpRate2).to.be.gt(prevLpRate, 'LP Rate should increase (1)')
      prevLpRate = prevLpRate2
      await pool.rebalance()
      prevLpRate2 = await strategy.prevLpRate()
      expect(prevLpRate2).to.be.gt(prevLpRate, 'LP Rate should increase (2)')
      const price3 = await pool.getPricePerShare()
      expect(price3).to.be.gt(price2, 'Share value should increase (2)')
    })
    // This doesnt actually test anything, it just makes it easy to estimate APY
    // eslint-disable-next-line
    xit('Crv3PoolStrategy: USDC APY', async function() {
      await deposit(pool, collateralToken, 20, user3)
      const initPPS = await pool.getPricePerShare()
      let gasUsed = BN.from(0)
      // 1 rebalance(s) / day over 30 days
      console.log('Calculating ~%APY using 1 Rebalance / Day for 30 Days')
      for (let i = 0; i < 30; i++) {
          const tx = await pool.rebalance()
          gasUsed = gasUsed.add(BN.from(tx.receipt.gasUsed))
          await time.increase(24*60*60)
          console.log(`Day ${i+1}: ${tx.receipt.gasUsed}`)
      }
      const finPPS = await pool.getPricePerShare()
      const percentIncrease = (finPPS.sub(initPPS)).mul(BN.from(120000)).div(initPPS).toNumber()
      const readablePI = percentIncrease / 100
      const feeBal = await pool.balanceOf(feeCollector.address)
      console.log(feeBal.toString())
      const userBal = await pool.balanceOf(user3.address)
      console.log(userBal.toString())
      const vSupply = await pool.totalSupply()
      console.log(vSupply.toString())
      console.log(`VUSDC CRV 3POOL is operating at roughly ${readablePI}% APY`)
      console.log(`avg gas used by rebalance: ${gasUsed.div(BN.from(30))}`)
    })
  })
})
