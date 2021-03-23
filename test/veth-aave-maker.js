'use strict'

const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
const {shouldBehaveLikeStrategy} = require('./behavior/maker-strategy')
const {setupVPool} = require('./utils/setupHelper')
// const format = require('./utils/prettyWeb3Objects')
const {deposit} = require('./utils/poolOps')
const {expect} = require('chai')
const {BN, time} = require('@openzeppelin/test-helpers')

const VETH = artifacts.require('VETH')
const AaveMakerStrategy = artifacts.require('AaveMakerStrategyETH')
const AaveStrategy = artifacts.require('AaveStrategyETH')
const Controller = artifacts.require('Controller')
const CollateralManager = artifacts.require('CollateralManager')
const JugLike = artifacts.require('JugLike')

const DECIMAL = new BN('1000000000000000000')
/* eslint-disable mocha/max-top-level-suites */
contract('vETH Pool with AaveMakerStrategy', function (accounts) {
  let pool, controller, strategy, collateralToken, cm, vaultNum
  const [, user1, user2, user3, user4] = accounts
  beforeEach(async function () {
    await setupVPool(this, {
      controller: Controller,
      pool: VETH,
      strategy: AaveMakerStrategy,
      collateralManager: CollateralManager,
      feeCollector: accounts[9],
      strategyType: 'maker',
    })
    this.newStrategy = AaveStrategy
    pool = this.pool
    controller = this.controller
    strategy = this.strategy
    collateralToken = this.collateralToken
    cm = this.collateralManager
    vaultNum = this.vaultNum
  })

  shouldBehaveLikePool('vETH', 'WETH', 'aDAI', accounts)

  shouldBehaveLikeStrategy('vETH', 'WETH', 'aDAI', accounts)

  describe('Basic test with ETH as collateral', function () {
    it('Should deposit and rebalance', async function () {
      const depositAmount = new BN(10).mul(DECIMAL).toString()
      await pool.methods['deposit()']({value: depositAmount, from: user1})
      await pool.rebalance()
      return Promise.all([pool.tokenLocked(), pool.totalSupply(), pool.totalValue(), pool.balanceOf(user1)]).then(
        function ([tokenLocked, totalSupply, totalValue, vPoolBalance]) {
          expect(tokenLocked).to.be.bignumber.equal(depositAmount, 'ETH locked is wrong')
          expect(totalSupply).to.be.bignumber.equal(depositAmount, 'Total supply of vETH is wrong')
          expect(totalValue).to.be.bignumber.equal(depositAmount, 'Total value of $ vETH is wrong')
          expect(vPoolBalance).to.be.bignumber.equal(depositAmount, 'vETH balance of user is wrong')
        }
      )
    })

    it('Should deposit via fallback and rebalance', async function () {
      const depositAmount = new BN(10).mul(DECIMAL).toString()
      await web3.eth.sendTransaction({from: user2, to: pool.address, value: depositAmount})
      await pool.rebalance()
      return Promise.all([pool.tokenLocked(), pool.totalSupply(), pool.totalValue(), pool.balanceOf(user2)]).then(
        function ([tokenLocked, totalSupply, totalValue, vPoolBalance]) {
          expect(tokenLocked).to.be.bignumber.equal(depositAmount, 'ETH locked is wrong')
          expect(totalSupply).to.be.bignumber.equal(depositAmount, 'Total supply of vETH is wrong')
          expect(totalValue).to.be.bignumber.equal(depositAmount, 'Total value of $ vETH is wrong')
          expect(vPoolBalance).to.be.bignumber.equal(depositAmount, 'vETH balance of user is wrong')
        }
      )
    })

    it('Should withdraw all ETH after rebalance', async function () {
      const depositAmount = new BN(10).mul(DECIMAL).toString()
      await pool.methods['deposit()']({value: depositAmount, from: user3})
      await pool.rebalance()
      const ethBalanceBefore = await web3.eth.getBalance(user3)
      const withdrawAmount = await pool.balanceOf(user3)
      await pool.withdrawETH(withdrawAmount, {from: user3})
      return Promise.all([
        pool.tokenLocked(),
        pool.totalSupply(),
        pool.totalValue(),
        pool.balanceOf(user3),
        web3.eth.getBalance(user3),
      ]).then(function ([tokenLocked, totalSupply, totalValue, vPoolBalance, ethBalanceAfter]) {
        expect(tokenLocked).to.be.bignumber.equal('0', 'ETH locked is wrong')
        expect(totalSupply).to.be.bignumber.equal('0', 'Total supply of vETH is wrong')
        expect(totalValue).to.be.bignumber.equal('0', 'Total value of vETH is wrong')
        expect(vPoolBalance).to.be.bignumber.equal('0', 'vETH balance of user is wrong')
        expect(ethBalanceAfter).to.be.bignumber.gt(ethBalanceBefore, 'ETH balance of user is wrong')
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
      const jugLike = await JugLike.at('0x19c0976f590D67707E62397C87829d896Dc0f1F1')
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

      let withdrawAmount = await pool.balanceOf(user1)
      await pool.withdraw(withdrawAmount, {from: user1})

      withdrawAmount = await pool.balanceOf(user2)
      await pool.withdraw(withdrawAmount, {from: user2})

      withdrawAmount = await pool.balanceOf(user3)
      await pool.withdraw(withdrawAmount, {from: user3})

      withdrawAmount = await pool.balanceOf(user4)
      await pool.withdraw(withdrawAmount, {from: user4})

      const balance = await pool.balanceOf(this.feeCollector)
      expect(balance).to.be.bignumber.equal(expectedVPoolToken, 'vETH balance of FC is wrong')

      await pool.withdraw(balance, {from: this.feeCollector})

      return Promise.all([pool.tokenLocked(), pool.totalSupply(), pool.totalValue(), pool.balanceOf(user1)]).then(
        function ([tokenLocked, totalSupply, totalValue, vPoolBalance]) {
          expect(tokenLocked).to.be.bignumber.equal('0', 'WETH locked is wrong')
          expect(totalSupply).to.be.bignumber.equal('0', 'Total supply of vETH is wrong')
          expect(totalValue).to.be.bignumber.equal('0', 'Total value of vETH is wrong')
          expect(vPoolBalance).to.be.bignumber.equal('0', 'vETH balance of user is wrong')
        }
      )
    })
  })

  // eslint-disable-next-line mocha/no-setup-in-describe, mocha/no-skipped-tests
  describe.skip('DAI mint limit', function () {
    it('Should rebalance with available DAI amount', async function () {
      await deposit(pool, collateralToken, 50000, user1)
      // await deposit(pool, collateralToken, 50000, user2)
      // await deposit(pool, collateralToken, 50000, user3)
      // await deposit(pool, collateralToken, 50000, user4)
      const highWater = await strategy.highWater()
      let vaultInfo = await cm.getVaultInfo(vaultNum)
      expect(vaultInfo.collateralRatio).to.be.bignumber.equal('0', 'Collateral ratio should be zero')
      // console.log('Before rebalance', format(vaultInfo))
      await pool.rebalance()
      vaultInfo = await cm.getVaultInfo(vaultNum)
      expect(vaultInfo.collateralRatio).to.be.bignumber.gt(highWater, 'Collateral ratio should be > highWater')
      // console.log('After 1st rebalance', format(vaultInfo))

      await pool.rebalance()
      vaultInfo = await cm.getVaultInfo(vaultNum)
      expect(vaultInfo.collateralRatio).to.be.bignumber.gt(highWater, 'Collateral ratio should be > highWater')
      // console.log('After 2nd rebalance', format(vaultInfo))
    })
  })
})
