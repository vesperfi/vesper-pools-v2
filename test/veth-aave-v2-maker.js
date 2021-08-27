'use strict'

const hre = require('hardhat')
const ethers = hre.ethers
const provider = hre.waffle.provider
const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
const {shouldBehaveLikeStrategy} = require('./behavior/maker-strategy')
const {setupVPool, send} = require('./utils/setupHelper')
const {deposit} = require('./utils/poolOps')
const {expect} = require('chai')
const time = require('./utils/time')
const {BigNumber: BN} = require('ethers')

const DECIMAL = BN.from('1000000000000000000')
/* eslint-disable mocha/max-top-level-suites */
describe('VETH Pool with AaveMakerStrategy V2', function () {
  let pool, controller, strategy, collateralToken
  let user1, user2, user3, user4
  beforeEach(async function () {
    this.accounts = await ethers.getSigners()
    ;[, user1, user2, user3, user4] = this.accounts
    await setupVPool(this, {
      pool: 'VETH',
      strategy: 'AaveV2MakerStrategyETH',
      collateralManager: 'CollateralManager',
      feeCollector: this.accounts[9],
      strategyType: 'aaveMaker'
    })
    this.newStrategy = 'AaveV2StrategyETH'
    pool = this.pool
    controller = this.controller
    strategy = this.strategy
    collateralToken = this.collateralToken
  })

  shouldBehaveLikePool('vETH', 'WETH', 'aDAI')

  shouldBehaveLikeStrategy('vETH', 'WETH', 'aDAI')

  describe('Basic test with ETH as collateral', function() {
    it('Should deposit and rebalance', async function () {
      const depositAmount = BN.from(10).mul(DECIMAL).toString()
      await pool.connect(user1)['deposit()']({value: depositAmount})
        await pool.rebalance()
        return Promise.all([
          pool.tokenLocked(),
          pool.totalSupply(),
          pool.totalValue(),
          pool.balanceOf(user1.address),
        ]).then(function ([tokenLocked, totalSupply, totalValue, vPoolBalance]) {
          expect(tokenLocked).to.be.equal(depositAmount, 'ETH locked is wrong')
          expect(totalSupply).to.be.equal(depositAmount, 'Total supply of vETH is wrong')
          expect(totalValue).to.be.equal(depositAmount, 'Total value of $ vETH is wrong')
          expect(vPoolBalance).to.be.equal(depositAmount, 'vETH balance of user is wrong')
          
        })
    })

    it('Should deposit via fallback and rebalance', async function () {
      const depositAmount = BN.from(10).mul(DECIMAL)
      await send(user2.address, pool.address, depositAmount)
        await pool.rebalance()
        return Promise.all([
          pool.tokenLocked(),
          pool.totalSupply(),
          pool.totalValue(),
          pool.balanceOf(user2.address),
        ]).then(function ([tokenLocked, totalSupply, totalValue, vPoolBalance]) {
          expect(tokenLocked).to.be.equal(depositAmount.toString(), 'ETH locked is wrong')
          expect(totalSupply).to.be.equal(depositAmount.toString(), 'Total supply of vETH is wrong')
          expect(totalValue).to.be.equal(depositAmount.toString(), 'Total value of $ vETH is wrong')
          expect(vPoolBalance).to.be.equal(depositAmount.toString(), 'vETH balance of user is wrong')
          
        })
    })

    it('Should withdraw all ETH after rebalance', async function () {
      const depositAmount = BN.from(10).mul(DECIMAL).toString()
      await pool.connect(user3)['deposit()']({value: depositAmount})
      await pool.rebalance()
      const ethBalanceBefore = await time.latestBlock()
      const withdrawAmount = await pool.balanceOf(user3.address)
      await pool.connect(user3).withdrawETH(withdrawAmount)
      return Promise.all([
        pool.tokenLocked(),
        pool.totalSupply(),
        pool.totalValue(),
        pool.balanceOf(user3.address),
        provider.getBalance(user3.address),
      ]).then(function ([tokenLocked, totalSupply, totalValue, vPoolBalance, ethBalanceAfter]) {
        expect(tokenLocked).to.be.equal('0', 'ETH locked is wrong')
        expect(totalSupply).to.be.equal('0', 'Total supply of vETH is wrong')
        expect(totalValue).to.be.equal('0', 'Total value of vETH is wrong')
        expect(vPoolBalance).to.be.equal('0', 'vETH balance of user is wrong')
        expect(ethBalanceAfter).to.be.gt(ethBalanceBefore, 'ETH balance of user is wrong')
      })
    })
  })

  describe('Interest fee calculation via Jug Drip', function () {
    it('Should earn interest fee on earned amount', async function () {
      await deposit(pool, collateralToken, 10, user1)
      await deposit(pool, collateralToken, 10, user2)
      await deposit(pool, collateralToken, 10, user3)
      await deposit(pool, collateralToken, 10, user4)

      await pool.rebalance()
      const tokenLocked1 = await pool.tokenLocked()
      await time.increase(24 * 60 * 60)
      // Update rate using Jug drip
      const jugLike = await ethers.getContractAt('JugLike', '0x19c0976f590D67707E62397C87829d896Dc0f1F1')
      const vaultType = await strategy.collateralType()
      await jugLike.drip(vaultType)

      await pool.rebalance()
      // Calculate expected fee
      const tokenLocked2 = await pool.tokenLocked()
      const pricePerShare = await pool.getPricePerShare()
      const interestFee = await controller.interestFee(pool.address)
      const interestEarned = tokenLocked2.sub(tokenLocked1)
      const expectedInterestFee = interestEarned.mul(interestFee).div(DECIMAL)
      const expectedVPoolToken = expectedInterestFee.mul(DECIMAL).div(pricePerShare)

      let withdrawAmount = await pool.balanceOf(user1.address)
      await pool.connect(user1).withdraw(withdrawAmount)

      withdrawAmount = await pool.balanceOf(user2.address)
      await pool.connect(user2).withdraw(withdrawAmount)

      withdrawAmount = await pool.balanceOf(user3.address)
      await pool.connect(user3).withdraw(withdrawAmount)

      withdrawAmount = await pool.balanceOf(user4.address)
      await pool.connect(user4).withdraw(withdrawAmount)

      const balance = await pool.balanceOf(this.feeCollector.address)
      expect(balance).to.be.equal(expectedVPoolToken, 'vETH balance of FC is wrong')

      await pool.connect(this.feeCollector).withdraw(balance)

      return Promise.all([pool.tokenLocked(), pool.totalSupply(), pool.totalValue(), 
        pool.balanceOf(user1.address)]).then(
        function ([tokenLocked, totalSupply, totalValue, vPoolBalance]) {
          expect(tokenLocked).to.be.equal('0', 'WETH locked is wrong')
          expect(totalSupply).to.be.equal('0', 'Total supply of vETH is wrong')
          expect(totalValue).to.be.equal('0', 'Total value of vETH is wrong')
          expect(vPoolBalance).to.be.equal('0', 'vETH balance of user is wrong')
        }
      )
    })
  })
})
