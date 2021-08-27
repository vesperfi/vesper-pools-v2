'use strict'

/* eslint-disable no-console */

const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
const {shouldBehaveLikeStrategy} = require('./behavior/crv-strategy')
const {setupVPool, deployContract} = require('./utils/setupHelper')
const {expect} = require('chai')
const {ethers} = require('hardhat')
const {deposit, reset} = require('./utils/poolOps')
const swapper = require('./utils/tokenSwapper')
const time = require('./utils/time')
const {BigNumber: BN} = require('ethers')

const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f'
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const SUSHI_ROUTER = '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F'

const THREE_CRV = '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490'
const THREE_POOL = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7'
const DECIMAL18 = BN.from('1000000000000000000')
const DECSIX = BN.from('6')

describe('vDAI Pool with Crv3PoolStrategy', function () {
  let pool, collateralToken, controller, feeCollector, strategy,
    threePool, lpToken, daiToken, usdcToken, usdtToken, swapManager
  let user1, user2, user3, user4, user5, user6, user7, user8

  function convertTo18(amount, decimal) {
    const multiplier = DECIMAL18.div(BN.from('10').pow(decimal))
    return BN.from(amount).mul(multiplier)
  }

  before(async function() {
    threePool = await ethers.getContractAt('IStableSwap3Pool', THREE_POOL)
    lpToken = await ethers.getContractAt('ERC20',THREE_CRV)
    daiToken = await ethers.getContractAt('ERC20',DAI)
    usdcToken = await ethers.getContractAt('ERC20',USDC)
    usdtToken = await ethers.getContractAt('ERC20',USDT)
  })

  beforeEach(async function () {
    this.accounts = await ethers.getSigners()
    ;[user1, user2, user3, user4, user5, user6, user7, user8] = this.accounts    
    await setupVPool(this, {
      pool: 'VDAI',
      strategy: 'Crv3PoolStrategyDAI',
      feeCollector: this.accounts[9],
      strategyType: 'crv',
    })
    this.newStrategy = 'Crv3PoolStrategyDAI'
    pool = this.pool
    collateralToken = this.collateralToken
    controller = this.controller
    strategy = this.strategy
    feeCollector = this.feeCollector
    swapManager = this.swapManager

    await time.increase(3600)
    console.log('')
    await swapManager['updateOracles()']()
  })

  describe('Pool Tests', function() {
    shouldBehaveLikePool('vDai', 'DAI', '3CRV')
  })

  after(reset)
  describe('Strategy Tests', function() {
    shouldBehaveLikeStrategy('vDai', 'DAI', '3CRV')
  })

  describe('Crv3PoolStrategy: DAI Functionality', function() {
    it('Should calculate fees properly and reflect those in share price', async function () {
      await deposit(pool, collateralToken, 20, user1)
      await pool.rebalance()
      const price1 = await pool.getPricePerShare()
      // Time travel to generate earning
      await time.increase(30*24*60*60)
      await swapManager.connect(user2)['updateOracles()']()

      await deposit(pool, collateralToken, 20, user2)
      await pool.rebalance()

      const price2 = await pool.getPricePerShare()


      expect(price2).to.be.gt(price1, 'Share value should increase (1)')
      // Time travel to generate earning
      await time.increase(30*24*60*60)
      await swapManager['updateOracles()']()

      await deposit(pool, collateralToken, 20, user3)
      await pool.rebalance()
      await time.increase(30*24*60*60)
      await swapManager['updateOracles()']()

      await pool.rebalance()
      const price3 = await pool.getPricePerShare()
      expect(price3).to.be.gt(price2, 'Share value should increase (2)')
    })

    it('Large Deposits / Withdrawals have limited slippage', async function() {
        const depAmt = await deposit(pool, collateralToken, 9970, user1)
        const userBal = await pool.balanceOf(user1.address)
        await pool.rebalance()
        await pool.connect(user1).withdraw(userBal)
        const userBalFinal = await collateralToken.balanceOf(user1.address)
        const compAmt = depAmt.mul(BN.from(995)).div(BN.from(1000))
        expect(userBalFinal).to.be.gte(compAmt, 'Slippage and fees were greater than 0.5%')
    })
  })

  describe('Crv3PoolStrategy: DAI Functionality 2', function() {
    it('Should be able to migrate out / in', async function() {
      await controller.updateInterestFee(pool.address, '0')
      await deposit(pool, collateralToken, 20, user8)
      await pool.rebalance()

      let vPoolBalance = await pool.balanceOf(user8.address)
      await pool.connect(user8).withdraw(vPoolBalance.div(BN.from(2)))
      await time.increase(6*60*60)
      await swapManager['updateOracles()']()

      // Migrate out
      let target = strategy.address
      let methodSignature = 'migrateOut()'
      let data = '0x'
      await controller.executeTransaction(target, 0, methodSignature, data)

      let lpBalance = await lpToken.balanceOf(pool.address)
      expect(lpBalance).to.be.gt('0', 'lp did not transfer on migrateOut')

      strategy = await deployContract(this.newStrategy,[controller.address, pool.address])

      await controller.updateStrategy(pool.address, strategy.address)
      methodSignature = 'approveToken()'
      await controller.executeTransaction(strategy.address, 0, methodSignature, data)
      await time.increase(6*24*60*60)
      await swapManager['updateOracles()']()

      // // Deposit and rebalance with new strategy but before migrateIn
      await deposit(pool, collateralToken, 20, user7)
      await pool.rebalance()

      // Migrate in
      target = strategy.address
      methodSignature = 'migrateIn()'
      data = '0x'
      await controller.executeTransaction(target, 0, methodSignature, data)
      await time.increase(6*24*60*60)
      await swapManager['updateOracles()']()

      lpBalance = await lpToken.balanceOf(pool.address)
      expect(lpBalance).to.be.eq('0', 'lp did not transfer on migrateIn')
      lpBalance = await lpToken.balanceOf(strategy.address)
      expect(lpBalance).to.be.gt('0', 'lp is not in the strategy')
      let tlp = await strategy.totalLp()
      expect(tlp).to.be.gt('0', 'tlp is 0')

      // Deposit and rebalance after migrateIn
      const depositAmount = await deposit(pool, collateralToken, 20, user7)
      await pool.rebalance()

      vPoolBalance = await pool.balanceOf(user8.address)
      await pool.connect(user8).withdraw(vPoolBalance)
      vPoolBalance = await pool.balanceOf(user7.address)
      await pool.connect(user7).withdraw(vPoolBalance)

      lpBalance = await lpToken.balanceOf(strategy.address)
      tlp = await strategy.totalLp()
      vPoolBalance = await pool.balanceOf(user8.address)
      const daiBalance = await collateralToken.balanceOf(user8.address)

      expect(lpBalance).to.be.eq('0', 'lp balance should be 0')
      expect(tlp).to.be.eq('0', 'tlp should be 0')
      expect(vPoolBalance).to.be.eq('0', 'Pool balance of user should be zero')
      expect(daiBalance).to.be.gt(depositAmount,'DAI balance should be > deposit amount')
    })

    // This test will not work with slippage guards in place
    // eslint-disable-next-line
    xit('Test withdrawAll with Large Deposits', async function() {
      // We got DAI in the previous test
      // user 2 gets usdc
      console.log('1. making trades')
      let usdcBal = await swapper.swapEthForToken(99000, USDC, user2, user2)
      let usdtBal = await swapper.swapEthForToken(99000, USDT, user3, user3)
      const moreDai = await swapper.swapEthForToken(99000, DAI, user6, user6, SUSHI_ROUTER)
      const moreUsdc = await swapper.swapEthForToken(99000, USDC, user4, user4, SUSHI_ROUTER)
      const moreUsdt = await swapper.swapEthForToken(99000, USDT, user5, user5, SUSHI_ROUTER)

      console.log('2. transfers')

      await daiToken(user6).transfer(user1.address, moreDai)
      await usdcToken.connect(user2).transfer(user1.address, usdcBal)
      await usdcToken.connect(user4).transfer(user1.address, moreUsdc)
      await usdtToken.connect(user3).transfer(user1.address, usdtBal)
      await usdtToken.connect(user5).transfer(user1.address, moreUsdt)

      const daiBal = await daiToken.balanceOf(user1.address)
      usdcBal = await usdcToken.balanceOf(user1.address)
      usdtBal = await usdtToken.balanceOf(user1.address)

      console.log(daiBal.toString())
      console.log(usdcBal.toString())
      console.log(usdtBal.toString())

      const sumUSD = daiBal.add(convertTo18(usdcBal, DECSIX)).add(convertTo18(usdtBal, DECSIX))
      console.log(sumUSD.div(BN.from(2)).toString())

      console.log('3. approvals')

      await daiToken.connect(user1).approve(threePool.address, daiBal)
      await usdcToken.connect(user1).approve(threePool.address, usdcBal)
      await usdtToken.connect(user1).approve(threePool.address, usdtBal)

      console.log('4. add liq')

      threePool.connect(user1).add_liquidity([daiBal, usdcBal, usdtBal], 1)

      console.log('5. small vPool deposit')

      await deposit(pool, collateralToken, 1, user7)
      await pool.rebalance()
      const pricePerShare = await pool.getPricePerShare()
      console.log(pricePerShare.toString())

      console.log('6. Move LP Tokens to Strategy & Rebalance')

      let lpBal = await lpToken.balanceOf(user1.address)
      lpBal = lpBal.div(BN.from(2))
      console.log(lpBal.toString())

      await lpToken.connect(user1).transfer(strategy.address, lpBal)
      await pool.rebalance()

      const pricePerShareAfter = await pool.getPricePerShare()
      console.log(pricePerShareAfter.toString())

      console.log('7. Withdraw All')

      const target = strategy.address
      const methodSignature = 'withdrawAll()'
      const data = '0x'
      await controller.executeTransaction(target, 0, methodSignature, data)

      const poolDai = await daiToken.balanceOf(pool.address)
      const feeDai = await daiToken.balanceOf(feeCollector.address)
      console.log(poolDai.toString())
      console.log(feeDai.toString())
    })

    // This doesnt actually test anything, it just makes it easy to estimate APY
    // eslint-disable-next-line
    xit('Crv3PoolStrategy: DAI APY', async function() {
      await deposit(pool, collateralToken, 20, user3)
      const initPPS = await pool.getPricePerShare()
      let gasUsed = BN.from(0)
      // 1 rebalance(s) / day over 30 days
      console.log('Calculating ~%APY using 1 Rebalance / Day for 30 Days')
      for (let i = 0; i < 30; i++) {
          const tx = await pool.rebalance()
          gasUsed = gasUsed.add(BN.from(tx.receipt.gasUsed))
          await time.increase(24*60*60)
          swapManager.updateOracles()
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
      console.log(`VDAI CRV 3POOL is operating at roughly ${readablePI}% APY`)
      console.log(`avg gas used by rebalance: ${gasUsed.div(BN.from(30))}`)
    })
  })
})
