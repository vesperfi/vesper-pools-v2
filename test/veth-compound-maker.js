'use strict'

const {shouldBehaveLikePool} = require('./behavior/vesper-pool')
const {shouldBehaveLikeStrategy} = require('./behavior/maker-strategy')
const {setupVPool} = require('./utils/setupHelper')
const {deposit} = require('./utils/poolOps')
const {expect} = require('chai')
const {BN, time} = require('@openzeppelin/test-helpers')

const Comptroller = artifacts.require('Comptroller')

const ERC20 = artifacts.require('ERC20')
const VETH = artifacts.require('VETH')
const CompoundStrategy = artifacts.require('CompoundMakerStrategyETH')
const AaveStrategy = artifacts.require('AaveStrategyETH')
const Controller = artifacts.require('Controller')
const CollateralManager = artifacts.require('CollateralManager')
const JugLike = artifacts.require('JugLike')

const DECIMAL = new BN('1000000000000000000')
/* eslint-disable mocha/max-top-level-suites */
contract('VETH Pool with CompoundMakerStrategy', function (accounts) {
  let pool, controller, strategy, collateralToken, providerToken
  const [, user1, user2, user3, user4, user5] = accounts
  beforeEach(async function () {
    this.accounts = accounts
    await setupVPool(this, {
      controller: Controller,
      pool: VETH,
      strategy: CompoundStrategy,
      collateralManager: CollateralManager,
      feeCollector: accounts[9],
      strategyType: 'compoundMaker',
    })
    this.newStrategy = AaveStrategy
    pool = this.pool
    controller = this.controller
    strategy = this.strategy
    collateralToken = this.collateralToken
    providerToken = this.providerToken
  })

  shouldBehaveLikePool('vETH', 'WETH', 'cDAI', accounts)

  shouldBehaveLikeStrategy('vETH', 'WETH', 'cDAI', accounts)

  it('Should verify token is reserved or not', async function () {
    const cDAI = '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643'
    const COMP = '0xc00e94Cb662C3520282E6f5717214004A7f26888'
    const WETH = await pool.token()
    let outcome = await strategy.isReservedToken(cDAI)
    expect(outcome, 'should return true').to.be.true
    outcome = await strategy.isReservedToken(COMP)
    expect(outcome, 'should return true').to.be.true
    outcome = await strategy.isReservedToken(WETH)
    expect(outcome, 'should return false').to.be.false
  })

  it('Liquidate COMP on rebalance/rebalanceEarned', async function () {
    const comptroller = await Comptroller.at('0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B')
    const COMP = await ERC20.at('0xc00e94Cb662C3520282E6f5717214004A7f26888')
    const depositAmount = await deposit(pool, collateralToken, 100, user5)
    await pool.rebalance()

    // Time travel to earn COMP
    await time.advanceBlockTo((await time.latestBlock()).add(new BN(50)))
    await providerToken.exchangeRateCurrent()

    let compBalance = await COMP.balanceOf(strategy.address)
    let compAccrued = await comptroller.compAccrued(strategy.address)
    expect(compBalance).to.be.bignumber.equal('0', 'COMP balance should be zero')
    expect(compAccrued).to.be.bignumber.equal('0', 'COMP Accrued should be zero')

    // This withdraw will trigger calculation of COMP accrued in Compound
    await pool.withdraw(depositAmount.div(new BN(5)), {from: user5})
    compAccrued = await comptroller.compAccrued(strategy.address)
    expect(compAccrued).to.be.bignumber.gt('0', 'COMP Accrued should be > 0')

    await strategy.rebalanceEarned()
    compAccrued = await comptroller.compAccrued(strategy.address)
    expect(compAccrued).to.be.bignumber.equal('0', 'COMP Accrued should be zero')

    const tokensHere = await pool.tokensHere()
    compBalance = await COMP.balanceOf(strategy.address)

    expect(compBalance).to.be.bignumber.equal('0', 'COMP balance should be zero')
    expect(tokensHere).to.be.bignumber.gt('0', 'Tokens here should be > 0')
  })

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

      await time.advanceBlockTo((await time.latestBlock()).add(new BN(100)))
      await providerToken.exchangeRateCurrent()
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
})
