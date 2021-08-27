'use strict'

const hre = require('hardhat')
const provider = hre.waffle.provider
const swapper = require('../utils/tokenSwapper')
const {ethers} = require('hardhat')
const {defaultAbiCoder} = ethers.utils
const poolOps = require('../utils/poolOps')
const {getPermitData} = require('../utils/signHelper')
const {MNEMONIC} = require('../utils/testkey')
const {expect} = require('chai')
const {BigNumber: BN} = require('ethers')
const DECIMAL18 = BN.from('1000000000000000000')

/* eslint-disable mocha/no-setup-in-describe */
/* eslint-disable mocha/no-sibling-hooks */

async function shouldBehaveLikePool(poolName, collateralName, pTokenName) {
  let pool,
    strategy,
    controller,
    collateralToken,
    providerToken,
    collateralDecimal,
    feeCollector,
    strategyType,
    swapManager,
    underlayStrategy,
    accounts,
    user1,
    user2,
    user3

  async function adjustForFee(amt) {
    let x = amt
    if (strategyType.includes('crv')) {
      x = await strategy.estimateFeeImpact(amt)
    }
    return x
  }

  async function deposit(amount, depositor) {
    return poolOps.deposit(pool, collateralToken, amount, depositor)
  }

  function convertTo18(amount) {
    const multiplier = DECIMAL18.div(BN.from('10').pow(collateralDecimal))
    return BN.from(amount).mul(multiplier).toString()
  }

  function convertFrom18(amount) {
    const divisor = DECIMAL18.div(BN.from('10').pow(collateralDecimal))
    return BN.from(amount).div(divisor).toString()
  }

  async function executeIfExist(fn) {
    if (typeof fn === 'function') {
      await fn()
    }
  }

  async function timeTravel(seconds = 6 * 60 * 60, blocks = 25) {
    const timeTravelFn = async function() {
      await provider.send('evm_increaseTime', [seconds])
      await provider.send('evm_mine')
    }  
    await swapManager['updateOracles()']()
    const blockMineFn = async function() {
      for (let i = 0; i < blocks; i++) {
        await provider.send('evm_mine')
      }
    }
    return strategyType.includes('compound') || underlayStrategy.includes('compound') ? blockMineFn() : timeTravelFn()
  }

  describe(`${poolName} basic operation tests`, function () {
    beforeEach(async function () {
      // This setup helps in not typing 'this' all the time
      accounts = await ethers.getSigners()
      ;[user1, user2, user3] = accounts
      pool = this.pool
      strategy = this.strategy
      controller = this.controller
      collateralToken = this.collateralToken
      providerToken = this.providerToken
      feeCollector = this.feeCollector
      strategyType = this.strategyType
      underlayStrategy = this.underlayStrategy || ''
      swapManager = this.swapManager
      // Decimal will be used for amount conversion
      collateralDecimal = await collateralToken.decimals()
      timeTravel(12)
    })

    describe(`Gasless approval for ${poolName} token`, function () {
      it('Should allow gasless approval using permit()', async function () {
        const amount = DECIMAL18.toString()
        const {owner, deadline, sign} = await getPermitData(pool, amount, MNEMONIC, user1.address)
        await pool.permit(owner, user1.address, amount, deadline, sign.v, sign.r, sign.s)
        const allowance = await pool.allowance(owner, user1.address)
        expect(allowance).to.be.equal(amount, `${poolName} allowance is wrong`)
      })
    })

    describe(`Deposit ${collateralName} into the ${poolName} pool`, function () {
      it(`Should deposit ${collateralName}`, async function () {
        const depositAmount = await deposit(10, user1)
        const depositAmount18 = convertTo18(depositAmount)
        return Promise.all([pool.totalSupply(), pool.totalValue(), pool.balanceOf(user1.address)]).then(function ([
          totalSupply,
          totalValue,
          vPoolBalance,
        ]) {
          expect(totalSupply).to.be.equal(depositAmount18, `Total supply of ${poolName} is wrong`)
          expect(totalValue).to.be.equal(depositAmount, `Total value of ${poolName} is wrong`)
          expect(vPoolBalance).to.be.equal(depositAmount18, `${poolName} balance of user is wrong`)
        })
      })

      it(`Should deposit ${collateralName} and call rebalance() in Pool`, async function () {
        const depositAmount = (await deposit(100, user2)).toString()
        const depositAmountAdj = await adjustForFee(depositAmount)
        const depositAmount18 = convertTo18(depositAmount)
        await executeIfExist(providerToken.exchangeRateCurrent)
        await poolOps.rebalance(strategy, accounts)
        await executeIfExist(providerToken.exchangeRateCurrent)
        await Promise.all([pool.tokenLocked(), pool.totalSupply(), pool.totalValue(), 
          pool.balanceOf(user2.address)]).then(
          function ([tokenLocked, totalSupply, totalValue, vPoolBalance]) {
            expect(tokenLocked).to.be.gte(depositAmountAdj, `${collateralName} locked is wrong`)
            expect(totalSupply).to.be.equal(depositAmount18, `Total supply of ${poolName} is wrong`)
            expect(totalValue).to.be.gte(depositAmountAdj, `Total value of ${poolName} is wrong`)
            expect(vPoolBalance).to.be.equal(depositAmount18, `${poolName} balance of user is wrong`)
          }
        )
        if (!strategyType.includes('crv')) {
          await Promise.all([providerToken.balanceOf(pool.address), providerToken.balanceOf(strategy.address)]).then(
            function ([pTokenBalancePool, pTokenBalanceStrategy]) {
              const pTokenBalance = pTokenBalancePool.gt(BN.from('0')) ? pTokenBalancePool : pTokenBalanceStrategy
              expect(pTokenBalance).to.be.gt('0', `${pTokenName} balance of pool is wrong`)
            }
          )
        }
      })
    })

    describe(`Withdraw ${collateralName} from ${poolName} pool`, function () {
      let depositAmount
      beforeEach(async function () {
        depositAmount = await deposit(10, user1)
      })
      it(`Should withdraw all ${collateralName} before rebalance`, async function () {
        const withdrawAmount = await pool.balanceOf(user1.address)
        await pool.connect(user1).withdraw(withdrawAmount)
        return Promise.all([
          pool.tokenLocked(),
          pool.totalSupply(),
          pool.totalValue(),
          pool.balanceOf(user1.address),
          collateralToken.balanceOf(user1.address),
        ]).then(function ([tokenLocked, totalSupply, totalValue, vPoolBalance, collateralBalance]) {
          expect(tokenLocked).to.be.equal('0', `${collateralName} locked is wrong`)
          expect(totalSupply).to.be.equal('0', `Total supply of ${poolName} is wrong`)
          expect(totalValue).to.be.equal('0', `Total value of ${poolName} is wrong`)
          expect(vPoolBalance).to.be.equal('0', `${poolName} balance of user is wrong`)
          expect(collateralBalance).to.be.equal(depositAmount, `${collateralName} balance of user is wrong`)
        })
      })

      it(`Should withdraw partial ${collateralName} before rebalance`, async function () {
        let vPoolBalance = await pool.balanceOf(user1.address)
        const withdrawAmount = BN.from(vPoolBalance).sub(BN.from(convertTo18(100)))
        await pool.connect(user1).withdraw(withdrawAmount)
        vPoolBalance = (await pool.balanceOf(user1.address)).toString()
        const collateralBalance = (await collateralToken.balanceOf(user1.address)).toString()
        expect(vPoolBalance).to.equal(convertTo18(100), `${poolName} balance of user is wrong`)
        expect(collateralBalance).to.equal(convertFrom18(withdrawAmount), `${collateralName} balance of user is wrong`)
      })

      it(`Should withdraw very small ${collateralName} after rebalance`, async function () {
        await poolOps.rebalance(strategy, accounts)
        const collateralBalanceBefore = await collateralToken.balanceOf(user1.address)
        const withdrawAmount = '10000000000000000'
        await pool.connect(user1).withdraw(withdrawAmount)
        const collateralBalance = await collateralToken.balanceOf(user1.address)
        expect(collateralBalance).to.be.gt(collateralBalanceBefore, 'Withdraw failed')
      })

      it(`Should withdraw partial ${collateralName} after rebalance`, async function () {
        // Another deposit to protect from underwater
        await deposit(10, user2)
        await poolOps.rebalance(strategy, accounts)
        const collateralBalanceBefore = await collateralToken.balanceOf(user1.address)
        const withdrawAmount = (await pool.balanceOf(user1.address)).div(BN.from(2))
        await pool.connect(user1).withdraw(withdrawAmount)
        const collateralBalance = await collateralToken.balanceOf(user1.address)
        expect(collateralBalance).to.be.gt(collateralBalanceBefore, 'Withdraw failed')
      })

      it(`Should withdraw very small ${collateralName} after rebalance`, async function () {
        await poolOps.rebalance(strategy, accounts)
        const collateralBalanceBefore = await collateralToken.balanceOf(user1.address)
        const withdrawAmount = '10000000000000000'
        await pool.connect(user1).withdraw(withdrawAmount)
        const collateralBalance = await collateralToken.balanceOf(user1.address)
        expect(collateralBalance).to.be.gt(collateralBalanceBefore, 'Withdraw failed')
      })

      it(`Should withdraw partial ${collateralName} after rebalance and deposit`, async function () {
        await poolOps.rebalance(strategy, accounts)
        await deposit(10, user1)
        const collateralBalanceBefore = await collateralToken.balanceOf(user1.address)
        const withdrawAmount = (await pool.balanceOf(user1.address)).div(BN.from(2))
        await pool.connect(user1).withdraw(withdrawAmount)
        const collateralBalance = await collateralToken.balanceOf(user1.address)
        expect(collateralBalance).to.be.gt(collateralBalanceBefore, 'Withdraw failed')
      })

      it(`Should withdraw user's full balance of ${collateralName} after rebalance`, async function () {
        depositAmount = await deposit(10, user1)
        const adjDepAmt = await adjustForFee(depositAmount.mul(BN.from(2)))
        const dust = DECIMAL18.div(BN.from('100')) // Dust is less than 1e16
        await controller.updateInterestFee(pool.address, '0')
        await poolOps.rebalance(strategy, accounts)
        const withdrawAmount = await pool.balanceOf(user1.address)
        await executeIfExist(providerToken.exchangeRateCurrent)
        await executeIfExist(providerToken.rebalance)
        await pool.connect(user1).withdraw(withdrawAmount)
        return Promise.all([
          pool.tokenLocked(),
          pool.totalSupply(),
          pool.totalValue(),
          pool.balanceOf(user1.address),
          collateralToken.balanceOf(user1.address),
        ]).then(function ([tokenLocked, totalSupply, totalValue, vPoolBalance, collateralBalance]) {
          // Due to rounding some dust, 10000 wei, might left in case of Compound strategy
          expect(tokenLocked).to.be.lte(dust, `${collateralName} locked is wrong`)
          expect(totalSupply).to.be.equal('0', `Total supply of ${poolName} is wrong`)
          expect(totalValue).to.be.lte(dust, `Total value of ${poolName} is wrong`)
          expect(vPoolBalance).to.be.equal('0', `${poolName} balance of user is wrong`)
          expect(collateralBalance).to.be.gte(adjDepAmt, `${collateralName} balance of user is wrong`)
        })
      })
    })

    describe(`Rebalance ${poolName} pool`, function () {
      it('Should rebalance multiple times.', async function () {
        const depositAmount = (await deposit(100, user2)).toString()
        const adjDepAmt = await adjustForFee(depositAmount)
        await poolOps.rebalance(strategy, accounts)
        await executeIfExist(providerToken.rebalance)
        const tokensHere = await pool.tokensHere()
        expect(tokensHere).to.be.equal('0', 'Tokens here is not correct')
        // Time travel 6 hours
        await timeTravel()
        await executeIfExist(providerToken.exchangeRateCurrent)
        await poolOps.rebalance(strategy, accounts)
        await timeTravel()
        await executeIfExist(providerToken.exchangeRateCurrent)
        await poolOps.rebalance(strategy, accounts)
        await executeIfExist(providerToken.rebalance)
        if (strategyType === 'vesperv3') await poolOps.simulateV3Profit(strategy, accounts)
        return Promise.all([pool.tokenLocked(), pool.balanceOf(user2.address)]).then(
          function ([tokenLocked, vPoolBalance]) {
            expect(tokenLocked).to.be.gt(adjDepAmt, `${collateralName} locked is wrong`)
            expect(vPoolBalance).to.be.eq(convertTo18(depositAmount), `${poolName} balance of user is wrong`)
          }
        )
      })
    })

    describe(`Price per share of ${poolName} pool`, function () {
      it('Should increase pool share value', async function () {
        await deposit(100, user1)
        await poolOps.rebalance(strategy, accounts)
        const price1 = await pool.getPricePerShare()
        const totalValue1 = await pool.totalValue()
        await executeIfExist(providerToken.rebalance)

        // Time travel to generate earning
        await poolOps.timeTravel(20 * 24 * 60 * 60, 50)
        await executeIfExist(providerToken.exchangeRateCurrent)
        await deposit(200, user2)
        await poolOps.rebalance(strategy, accounts)
        await executeIfExist(providerToken.rebalance)
        if (strategyType === 'vesperv3') await poolOps.simulateV3Profit(strategy, accounts)

        const price2 = await pool.getPricePerShare()
        const totalValue2 = await pool.totalValue()
        expect(totalValue2).to.be.gt(totalValue1, `${poolName} total value should increase (1)`)
        expect(price2).to.be.gt(price1, `${poolName} share value should increase (1)`)

        // Time travel to generate earning
        await poolOps.timeTravel(20 * 24 * 60 * 60, 50)
        await executeIfExist(providerToken.exchangeRateCurrent)
        await executeIfExist(providerToken.rebalance)
        await deposit(200, user3)
        await poolOps.timeTravel(20 * 24 * 60 * 60, 50)
       
        await executeIfExist(providerToken.exchangeRateCurrent)
        await executeIfExist(providerToken.rebalance)
        if (strategyType === 'vesperv3') await poolOps.simulateV3Profit(strategy, accounts)
        const totalValue3 = await pool.totalValue()
        expect(totalValue3).to.be.gt(totalValue2, `${poolName} total value should increase (2)`)
      })
    })

    describe(`Withdraw fee in ${poolName} pool`, function () {
      let depositAmount
      const fee = BN.from('200000000000000000')
      beforeEach(async function () {
        depositAmount = await deposit(10, user2)
        await this.controller.updateWithdrawFee(pool.address, fee)
      })
      it('Should collect fee on withdraw', async function () {
        await pool.connect(user2).withdraw(depositAmount)
        const feeToCollect = depositAmount.mul(fee).div(DECIMAL18)
        const vPoolBalanceFC = await pool.balanceOf(feeCollector.address)
        expect(vPoolBalanceFC).to.be.eq(feeToCollect, 'Withdraw fee transfer failed')
      })

      it('Should collect fee on withdraw after rebalance', async function () {
        // Another deposit to protect from underwater
        await deposit(10, user1)
        await poolOps.rebalance(strategy, accounts)
        await pool.connect(user2).withdraw(depositAmount)
        const vPoolBalanceFC = await pool.balanceOf(feeCollector.address)
        expect(vPoolBalanceFC).to.be.gt('0', 'Withdraw fee transfer failed')
      })

      it('Should not allow user to withdraw without fee', async function () {
        await poolOps.rebalance(strategy, accounts)
        const withdrawAmount = await pool.balanceOf(user2.address)
        const tx = pool.connect(user2).withdrawByStrategy(withdrawAmount)
        await expect(tx).to.be.revertedWith('Not a white listed address')
      })

      it('Should allow fee collector to withdraw without fee', async function () {
        // Another deposit to protect from underwater
        await deposit(100, user1)
        await poolOps.rebalance(strategy, accounts)
        const withdrawAmount = await pool.balanceOf(user2.address)
        await pool.connect(user2).withdraw(withdrawAmount)

        // Add fee collector to fee white list
        const target = await pool.feeWhiteList()
        const methodSignature = 'add(address)'
        const data = defaultAbiCoder.encode(['address'], [feeCollector.address])
        await controller.executeTransaction(target, 0, methodSignature, data)

        const feeCollected = await pool.balanceOf(feeCollector.address)
        await pool.connect(feeCollector).withdrawByStrategy(feeCollected)
        const vPoolBalanceFC = await pool.balanceOf(feeCollector.address)
        expect(vPoolBalanceFC).to.be.eq('0', `${poolName} balance of FC is not correct`)
        const collateralBalance = await collateralToken.balanceOf(feeCollector.address)
        expect(collateralBalance).to.be.gt('0', `${collateralName} balance of FC is not correct`)
      })
    })

    describe(`Interest fee in ${poolName} pool`, function () {
      beforeEach(async function () {
        await deposit(200, user1)
      })
      it('Should handle interest fee on rebalance', async function () {
        // if interest fee is set to 0 this test shouldn't run
        const interestFee = await controller.interestFee(pool.address)
        if (interestFee.eq(BN.from(0))) return

        await poolOps.rebalance(strategy, accounts)
        await executeIfExist(providerToken.rebalance)

        const vPoolBalanceFC = await pool.balanceOf(feeCollector.address)
        // Time travel to generate earning
        await timeTravel()
        await executeIfExist(providerToken.exchangeRateCurrent)

        // Another deposit
        await deposit(200, user2)
        await poolOps.rebalance(strategy, accounts)
        await executeIfExist(providerToken.rebalance)
        const vPoolBalanceFC2 = await pool.balanceOf(feeCollector.address)
        expect(vPoolBalanceFC2).to.be.gt(vPoolBalanceFC, 'Fee collected is not correct')

        // Time travel to generate earning
        await timeTravel()
        await executeIfExist(providerToken.exchangeRateCurrent)
        await poolOps.rebalance(strategy, accounts)

        const vPoolBalanceFC3 = await pool.balanceOf(feeCollector.address)
        expect(vPoolBalanceFC3).to.be.gt(vPoolBalanceFC2, 'Fee collected is not correct')
      })
    })

    describe(`Interest fee in ${poolName} pool 2`, function () {
      beforeEach(async function () {
        await deposit(20, user1)
      })
      it('Should rebalance when interest fee is zero', async function () {
        await controller.updateInterestFee(pool.address, '0')
        await poolOps.rebalance(strategy, accounts)
        // Time travel to generate earning
        await timeTravel()
        await executeIfExist(providerToken.exchangeRateCurrent)
        await executeIfExist(providerToken.rebalance)
        // Another deposit
        await deposit(200, user2)
        await poolOps.rebalance(strategy, accounts)
        let vPoolBalanceFC = await pool.balanceOf(feeCollector.address)
        expect(vPoolBalanceFC.toString()).to.eq('0', 'Collected fee should be zero')

        // Another time travel and rebalance to run scenario again
        await timeTravel()
        await poolOps.rebalance(strategy, accounts)
        vPoolBalanceFC = await pool.balanceOf(feeCollector.address)
        expect(vPoolBalanceFC.toString()).to.eq('0', 'Collected fee should be zero')
      })
    })

    describe(`Sweep ERC20 token in ${poolName} pool`, function () {
      it(`Should sweep ERC20 for ${collateralName}`, async function () {
        const metAddress = '0xa3d58c4e56fedcae3a7c43a725aee9a71f0ece4e'
        const MET = await ethers.getContractAt('ERC20', metAddress)
        await swapper.swapEthForToken(2, metAddress, accounts[0], pool.address)

        await pool.sweepErc20(metAddress)

        return Promise.all([pool.totalSupply(), pool.totalValue(), MET.balanceOf(pool.address)]).then(function ([
          totalSupply,
          totalValue,
          metBalance,
        ]) {
          expect(totalSupply).to.be.eq('0', `Total supply of ${poolName} is wrong`)
          expect(totalValue).to.be.gt('0', `Total value of ${poolName} is wrong`)
          expect(metBalance.toString()).to.eq('0', 'ERC20 token balance of pool is wrong')
        })
      })

      it(`Should not be able sweep ${poolName}, ${collateralName} and ${pTokenName}`, async function () {
        let tx = pool.sweepErc20(pool.address)
        await expect(tx).to.be.revertedWith('Not allowed to sweep')

        tx = pool.sweepErc20(collateralToken.address)
        await expect(tx).to.be.revertedWith('Not allowed to sweep')

        tx = pool.sweepErc20(providerToken.address)
        await expect(tx).to.be.revertedWith('Not allowed to sweep')
      })
    })
  })
}

module.exports = {shouldBehaveLikePool}
