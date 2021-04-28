'use strict'

const swapper = require('../utils/tokenSwapper')
const poolOps = require('../utils/poolOps')
const {getPermitData} = require('../utils/signHelper')
const {MNEMONIC} = require('../utils/testkey')

const {expect} = require('chai')
const {expectRevert, BN, time} = require('@openzeppelin/test-helpers')
const ERC20 = artifacts.require('ERC20')

const DECIMAL18 = new BN('1000000000000000000')

async function shouldBehaveLikePool(poolName, collateralName, pTokenName, accounts) {
  let pool, strategy, controller, collateralToken, providerToken, collateralDecimal, feeCollector, strategyType
  let underlayStrategy

  const [, user1, user2, user3] = accounts

  async function deposit(amount, depositor) {
    return poolOps.deposit(pool, collateralToken, amount, depositor)
  }

  function convertTo18(amount) {
    const multiplier = DECIMAL18.div(new BN('10').pow(collateralDecimal))
    return new BN(amount).mul(multiplier).toString()
  }

  function convertFrom18(amount) {
    const divisor = DECIMAL18.div(new BN('10').pow(collateralDecimal))
    return new BN(amount).div(divisor).toString()
  }

  async function executeIfExist(fn) {
    if (typeof fn === 'function') {
      await fn()
    }
  }

  async function timeTravel(seconds = 6 * 60 * 60, blocks = 25) {
    const timeTravelFn = () => time.increase(seconds)
    const blockMineFn = async () => time.advanceBlockTo((await time.latestBlock()).add(new BN(blocks)))
    return strategyType.includes('compound') || underlayStrategy.includes('compound') ? blockMineFn() : timeTravelFn()
  }

  describe(`${poolName} basic operation tests`, function () {
    beforeEach(async function () {
      // This setup helps in not typing 'this' all the time
      pool = this.pool
      strategy = this.strategy
      controller = this.controller
      collateralToken = this.collateralToken
      providerToken = this.providerToken
      feeCollector = this.feeCollector
      strategyType = this.strategyType
      underlayStrategy = this.underlayStrategy || ''
      // Decimal will be used for amount conversion
      collateralDecimal = await this.collateralToken.decimals.call()
    })

    describe(`Gasless approval for ${poolName} token`, function () {
      it('Should allow gasless approval using permit()', async function () {
        const amount = DECIMAL18.toString()
        const {owner, deadline, sign} = await getPermitData(pool, amount, MNEMONIC, user1)
        await pool.permit(owner, user1, amount, deadline, sign.v, sign.r, sign.s)
        const allowance = await pool.allowance(owner, user1)
        expect(allowance).to.be.bignumber.equal(amount, `${poolName} allowance is wrong`)
      })
    })

    describe(`Deposit ${collateralName} into the ${poolName} pool`, function () {
      it(`Should deposit ${collateralName}`, async function () {
        const depositAmount = (await deposit(10, user1)).toString()
        const depositAmount18 = convertTo18(depositAmount)
        return Promise.all([pool.totalSupply(), pool.totalValue(), pool.balanceOf(user1)]).then(function ([
          totalSupply,
          totalValue,
          vPoolBalance,
        ]) {
          expect(totalSupply).to.be.bignumber.equal(depositAmount18, `Total supply of ${poolName} is wrong`)
          expect(totalValue).to.be.bignumber.equal(depositAmount, `Total value of ${poolName} is wrong`)
          expect(vPoolBalance).to.be.bignumber.equal(depositAmount18, `${poolName} balance of user is wrong`)
        })
      })

      it(`Should deposit ${collateralName} and call rebalance() in Pool`, async function () {
        const depositAmount = (await deposit(10, user2)).toString()
        const depositAmount18 = convertTo18(depositAmount)
        await executeIfExist(providerToken.exchangeRateCurrent)
        await pool.rebalance()
        await executeIfExist(providerToken.exchangeRateCurrent)
        return Promise.all([
          pool.tokenLocked(),
          pool.totalSupply(),
          pool.totalValue(),
          pool.balanceOf(user2),
          providerToken.balanceOf(pool.address),
          providerToken.balanceOf(strategy.address),
        ]).then(function ([
          tokenLocked,
          totalSupply,
          totalValue,
          vPoolBalance,
          pTokenBalancePool,
          pTokenBalanceStrategy,
        ]) {
          expect(tokenLocked).to.be.bignumber.gte(depositAmount, `${collateralName} locked is wrong`)
          expect(totalSupply).to.be.bignumber.equal(depositAmount18, `Total supply of ${poolName} is wrong`)
          expect(totalValue).to.be.bignumber.gte(depositAmount, `Total value of ${poolName} is wrong`)
          expect(vPoolBalance).to.be.bignumber.equal(depositAmount18, `${poolName} balance of user is wrong`)
          const pTokenBalance = pTokenBalancePool.gt(new BN('0')) ? pTokenBalancePool : pTokenBalanceStrategy
          expect(pTokenBalance).to.be.bignumber.gt('0', `${pTokenName} balance of pool is wrong`)
        })
      })
    })

    describe(`Withdraw ${collateralName} from ${poolName} pool`, function () {
      let depositAmount
      beforeEach(async function () {
        depositAmount = await deposit(10, user1)
      })
      it(`Should withdraw all ${collateralName} before rebalance`, async function () {
        const withdrawAmount = await pool.balanceOf(user1)
        await pool.withdraw(withdrawAmount, {from: user1})
        return Promise.all([
          pool.tokenLocked(),
          pool.totalSupply(),
          pool.totalValue(),
          pool.balanceOf(user1),
          collateralToken.balanceOf(user1),
        ]).then(function ([tokenLocked, totalSupply, totalValue, vPoolBalance, collateralBalance]) {
          expect(tokenLocked).to.be.bignumber.equal('0', `${collateralName} locked is wrong`)
          expect(totalSupply).to.be.bignumber.equal('0', `Total supply of ${poolName} is wrong`)
          expect(totalValue).to.be.bignumber.equal('0', `Total value of ${poolName} is wrong`)
          expect(vPoolBalance).to.be.bignumber.equal('0', `${poolName} balance of user is wrong`)
          expect(collateralBalance).to.be.bignumber.equal(depositAmount, `${collateralName} balance of user is wrong`)
        })
      })

      it(`Should withdraw partial ${collateralName} before rebalance`, async function () {
        let vPoolBalance = await pool.balanceOf(user1)
        const withdrawAmount = new BN(vPoolBalance).sub(new BN(convertTo18(100)))
        await pool.withdraw(withdrawAmount, {from: user1})
        vPoolBalance = (await pool.balanceOf(user1)).toString()
        const collateralBalance = (await collateralToken.balanceOf(user1)).toString()
        expect(vPoolBalance).to.equal(convertTo18(100), `${poolName} balance of user is wrong`)
        expect(collateralBalance).to.equal(convertFrom18(withdrawAmount), `${collateralName} balance of user is wrong`)
      })

      it(`Should withdraw very small ${collateralName} after rebalance`, async function () {
        await pool.rebalance()
        const collateralBalanceBefore = await collateralToken.balanceOf(user1)
        const withdrawAmount = '10000000000000000'
        await pool.withdraw(withdrawAmount, {from: user1})
        const collateralBalance = await collateralToken.balanceOf(user1)
        expect(collateralBalance).to.be.bignumber.gt(collateralBalanceBefore, 'Withdraw failed')
      })

      it(`Should withdraw partial ${collateralName} after rebalance`, async function () {
        // Another deposit to protect from underwater
        await deposit(10, user2)
        await pool.rebalance()
        const collateralBalanceBefore = await collateralToken.balanceOf(user1)
        const withdrawAmount = (await pool.balanceOf(user1)).div(new BN(2))
        await pool.withdraw(withdrawAmount, {from: user1})
        const collateralBalance = await collateralToken.balanceOf(user1)
        expect(collateralBalance).to.be.bignumber.gt(collateralBalanceBefore, 'Withdraw failed')
      })

      it(`Should withdraw very small ${collateralName} after rebalance`, async function () {
        await pool.rebalance()
        const collateralBalanceBefore = await collateralToken.balanceOf(user1)
        const withdrawAmount = '10000000000000000'
        await pool.withdraw(withdrawAmount, {from: user1})
        const collateralBalance = await collateralToken.balanceOf(user1)
        expect(collateralBalance).to.be.bignumber.gt(collateralBalanceBefore, 'Withdraw failed')
      })

      it(`Should withdraw partial ${collateralName} after rebalance and deposit`, async function () {
        await pool.rebalance()
        await deposit(10, user1)
        const collateralBalanceBefore = await collateralToken.balanceOf(user1)
        const withdrawAmount = (await pool.balanceOf(user1)).div(new BN(2))
        await pool.withdraw(withdrawAmount, {from: user1})
        const collateralBalance = await collateralToken.balanceOf(user1)
        expect(collateralBalance).to.be.bignumber.gt(collateralBalanceBefore, 'Withdraw failed')
      })

      it(`Should withdraw all ${collateralName} after rebalance`, async function () {
        depositAmount = await deposit(10, user1)
        const dust = DECIMAL18.div(new BN('100')) // Dust is less than 1e16
        await controller.updateInterestFee(pool.address, '0')
        await pool.rebalance()
        const withdrawAmount = await pool.balanceOf(user1)
        await executeIfExist(providerToken.exchangeRateCurrent)
        await executeIfExist(providerToken.rebalance)
        await pool.withdraw(withdrawAmount, {from: user1})
        return Promise.all([
          pool.tokenLocked(),
          pool.totalSupply(),
          pool.totalValue(),
          pool.balanceOf(user1),
          collateralToken.balanceOf(user1),
        ]).then(function ([tokenLocked, totalSupply, totalValue, vPoolBalance, collateralBalance]) {
          // Due to rounding some dust, 10000 wei, might left in case of Compound strategy
          expect(tokenLocked).to.be.bignumber.lte(dust, `${collateralName} locked is wrong`)
          expect(totalSupply).to.be.bignumber.equal('0', `Total supply of ${poolName} is wrong`)
          expect(totalValue).to.be.bignumber.lte(dust, `Total value of ${poolName} is wrong`)
          expect(vPoolBalance).to.be.bignumber.equal('0', `${poolName} balance of user is wrong`)
          expect(collateralBalance).to.be.bignumber.gte(depositAmount, `${collateralName} balance of user is wrong`)
        })
      })
    })

    describe(`Rebalance ${poolName} pool`, function () {
      it('Should rebalance multiple times.', async function () {
        const depositAmount = (await deposit(10, user1)).toString()
        await pool.rebalance()
        await executeIfExist(providerToken.rebalance)
        const tokensHere = await pool.tokensHere()
        expect(tokensHere).to.be.bignumber.equal('0', 'Tokens here is not correct')
        // Time travel 6 hours
        await timeTravel()
        await executeIfExist(providerToken.exchangeRateCurrent)
        await pool.rebalance()
        await timeTravel()
        await executeIfExist(providerToken.exchangeRateCurrent)
        await pool.rebalance()
        await executeIfExist(providerToken.rebalance)
        return Promise.all([pool.tokenLocked(), pool.totalSupply(), pool.balanceOf(user1)]).then(function ([
          tokenLocked,
          totalSupply,
          vPoolBalance,
        ]) {
          expect(tokenLocked).to.be.bignumber.gt(depositAmount, `${collateralName} locked is wrong`)
          expect(totalSupply).to.be.bignumber.gt(depositAmount, `Total supply of ${poolName} is wrong`)
          expect(vPoolBalance).to.be.bignumber.eq(convertTo18(depositAmount), `${poolName} balance of user is wrong`)
        })
      })
    })

    describe(`Price per share of ${poolName} pool`, function () {
      it('Should increase pool share value', async function () {
        await deposit(20, user1)
        const price1 = await pool.getPricePerShare()
        await pool.rebalance()
        await executeIfExist(providerToken.rebalance)

        // Time travel to generate earning
        await timeTravel(5 * 60 * 60, 50)
        await executeIfExist(providerToken.exchangeRateCurrent)
        await deposit(20, user2)
        await pool.rebalance()
        await executeIfExist(providerToken.rebalance)

        const price2 = await pool.getPricePerShare()
        expect(price2).to.be.bignumber.gt(price1, `${poolName} share value should increase`)

        // Time travel to generate earning
        await timeTravel()
        await executeIfExist(providerToken.exchangeRateCurrent)
        await executeIfExist(providerToken.rebalance)
        await deposit(20, user3)
        await timeTravel()
        await executeIfExist(providerToken.exchangeRateCurrent)
        await executeIfExist(providerToken.rebalance)
        await pool.rebalance()
        await executeIfExist(providerToken.rebalance)
        const price3 = await pool.getPricePerShare()
        expect(price3).to.be.bignumber.gt(price2, `${poolName} share value should increase`)
      })
    })

    describe(`Withdraw fee in ${poolName} pool`, function () {
      let depositAmount
      const fee = new BN('200000000000000000')
      beforeEach(async function () {
        depositAmount = await deposit(10, user2)
        await this.controller.updateWithdrawFee(pool.address, fee)
      })
      it('Should collect fee on withdraw', async function () {
        await pool.withdraw(depositAmount, {from: user2})
        const feeToCollect = depositAmount.mul(fee).div(DECIMAL18)
        const vPoolBalanceFC = await pool.balanceOf(feeCollector)
        expect(vPoolBalanceFC).to.be.bignumber.eq(feeToCollect, 'Withdraw fee transfer failed')
      })

      it('Should collect fee on withdraw after rebalance', async function () {
        // Another deposit to protect from underwater
        await deposit(10, user1)
        await pool.rebalance()
        await pool.withdraw(depositAmount, {from: user2})
        const vPoolBalanceFC = await pool.balanceOf(feeCollector)
        expect(vPoolBalanceFC).to.be.bignumber.gt('0', 'Withdraw fee transfer failed')
      })

      it('Should not allow user to withdraw without fee', async function () {
        await pool.rebalance()
        const withdrawAmount = await pool.balanceOf(user2)
        const tx = pool.withdrawByStrategy(withdrawAmount, {from: user2})
        await expectRevert(tx, 'Not a white listed address')
      })

      it('Should allow fee collector to withdraw without fee', async function () {
        // Another deposit to protect from underwater
        await deposit(10, user1)
        await pool.rebalance()
        const withdrawAmount = await pool.balanceOf(user2)
        await pool.withdraw(withdrawAmount, {from: user2})

        // Add fee collector to fee white list
        const target = await pool.feeWhiteList()
        const methodSignature = 'add(address)'
        const data = web3.eth.abi.encodeParameter('address', feeCollector)
        await controller.executeTransaction(target, 0, methodSignature, data)

        const feeCollected = await pool.balanceOf(feeCollector)
        await pool.withdrawByStrategy(feeCollected, {from: feeCollector})
        const vPoolBalanceFC = await pool.balanceOf(feeCollector)
        expect(vPoolBalanceFC).to.be.bignumber.eq('0', `${poolName} balance of FC is not correct`)
        const collateralBalance = await collateralToken.balanceOf(feeCollector)
        expect(collateralBalance).to.be.bignumber.gt('0', `${collateralName} balance of FC is not correct`)
      })
    })

    describe(`Interest fee in ${poolName} pool`, function () {
      beforeEach(async function () {
        await deposit(20, user1)
      })
      it('Should handle interest fee on rebalance', async function () {
        await pool.rebalance()
        await executeIfExist(providerToken.rebalance)

        const vPoolBalanceFC = await pool.balanceOf(feeCollector)
        // Time travel to generate earning
        await timeTravel()
        await executeIfExist(providerToken.exchangeRateCurrent)

        // Another deposit
        await deposit(200, user2)
        await pool.rebalance()
        await executeIfExist(providerToken.rebalance)
        const vPoolBalanceFC2 = await pool.balanceOf(feeCollector)
        expect(vPoolBalanceFC2).to.be.bignumber.gt(vPoolBalanceFC, 'Fee collected is not correct')

        // Time travel to generate earning
        await timeTravel()
        await executeIfExist(providerToken.exchangeRateCurrent)
        await pool.rebalance()

        const vPoolBalanceFC3 = await pool.balanceOf(feeCollector)
        expect(vPoolBalanceFC3).to.be.bignumber.gt(vPoolBalanceFC2, 'Fee collected is not correct')
      })

      it('Should rebalance when interest fee is zero', async function () {
        await controller.updateInterestFee(pool.address, '0')
        await pool.rebalance()
        // Time travel to generate earning
        await timeTravel()
        await executeIfExist(providerToken.exchangeRateCurrent)
        await executeIfExist(providerToken.rebalance)
        // Another deposit
        await deposit(200, user2)
        await pool.rebalance()
        let vPoolBalanceFC = await pool.balanceOf(feeCollector)
        expect(vPoolBalanceFC.toString()).to.eq('0', 'Collected fee should be zero')

        // Another time travel and rebalance to run scenario again
        await timeTravel()
        await pool.rebalance()
        vPoolBalanceFC = await pool.balanceOf(feeCollector)
        expect(vPoolBalanceFC.toString()).to.eq('0', 'Collected fee should be zero')
      })
    })

    describe(`Sweep ERC20 token in ${poolName} pool`, function () {
      it(`Should sweep ERC20 for ${collateralName}`, async function () {
        const metAddress = '0xa3d58c4e56fedcae3a7c43a725aee9a71f0ece4e'
        const MET = await ERC20.at(metAddress)
        await swapper.swapEthForToken(2, metAddress, accounts[0], pool.address)

        await pool.sweepErc20(metAddress)

        return Promise.all([pool.totalSupply(), pool.totalValue(), MET.balanceOf(pool.address)]).then(function ([
          totalSupply,
          totalValue,
          metBalance,
        ]) {
          expect(totalSupply).to.be.bignumber.eq('0', `Total supply of ${poolName} is wrong`)
          expect(totalValue).to.be.bignumber.gt('0', `Total value of ${poolName} is wrong`)
          expect(metBalance.toString()).to.eq('0', 'ERC20 token balance of pool is wrong')
        })
      })

      it(`Should not be able sweep ${poolName}, ${collateralName} and ${pTokenName}`, async function () {
        let tx = pool.sweepErc20(pool.address)
        await expectRevert(tx, 'Not allowed to sweep')

        tx = pool.sweepErc20(collateralToken.address)
        await expectRevert(tx, 'Not allowed to sweep')

        tx = pool.sweepErc20(providerToken.address)
        await expectRevert(tx, 'Not allowed to sweep')
      })
    })
  })
}

module.exports = {shouldBehaveLikePool}
