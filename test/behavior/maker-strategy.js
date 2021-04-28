'use strict'

const swapper = require('../utils/tokenSwapper')
const {deposit} = require('../utils/poolOps')
const {expect} = require('chai')
const {BN, time, constants} = require('@openzeppelin/test-helpers')
const {updateBalancingFactor} = require('../utils/setupHelper')
const DECIMAL = new BN('1000000000000000000')
const WAT = new BN('10000000000000000')
const ERC20 = artifacts.require('ERC20')
const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f'
function shouldBehaveLikeStrategy(poolName, collateralName, pTokenName, accounts) {
  let pool, cm, strategy, controller, vaultNum, strategyType
  let collateralToken, collateralDecimal, providerToken, feeCollector
  const [owner, user1, user2, user3, user4] = accounts

  function convertTo18(amount) {
    const multiplier = DECIMAL.div(new BN('10').pow(collateralDecimal))
    return new BN(amount).mul(multiplier).toString()
  }

  function convertFrom18(amount) {
    const divisor = DECIMAL.div(new BN('10').pow(collateralDecimal))
    return new BN(amount).div(divisor).toString()
  }

  async function executeIfExist(fn) {
    if (typeof fn === 'function') {
      await fn()
    }
  }

  async function timeTravel() {
    const timeTravelFn = () => time.increase(6 * 60 * 60)
    const blockMineFn = async () => time.advanceBlockTo((await time.latestBlock()).add(new BN(100)))

    return strategyType.includes('compound') ? blockMineFn() : timeTravelFn()
  }

  describe(`${poolName}:: MakerStrategy basic tests`, function () {
    beforeEach(async function () {
      pool = this.pool
      controller = this.controller
      strategy = this.strategy
      collateralToken = this.collateralToken
      providerToken = this.providerToken
      cm = this.collateralManager
      vaultNum = this.vaultNum
      feeCollector = this.feeCollector
      strategyType = this.strategyType
      // Decimal will be used for amount conversion
      collateralDecimal = await this.collateralToken.decimals.call()
    })

    it('Should sweep erc20 from strategy', async function () {
      const metAddress = '0xa3d58c4e56fedcae3a7c43a725aee9a71f0ece4e'
      const token = await ERC20.at(metAddress)
      const tokenBalance = await swapper.swapEthForToken(1, metAddress, user4, strategy.address)
      await strategy.sweepErc20(metAddress)

      const totalSupply = await pool.totalSupply()
      const metBalanceInPool = await token.balanceOf(pool.address)
      expect(totalSupply).to.be.bignumber.equal('0', `Total supply of ${poolName} is wrong`)
      expect(metBalanceInPool).to.be.bignumber.equal(tokenBalance, 'ERC20 token balance is wrong')
    })

    describe(`${poolName}:: Withdraw scenario`, function () {
      let depositAmount
      const user = user1
      beforeEach(async function () {
        depositAmount = await deposit(pool, collateralToken, 20, user)
      })
      it('Should payout debt if withdraw leaves dust in vault', async function () {
        const withdrawAmount = (await pool.balanceOf(user)).sub(new BN(100)).toString()
        await pool.rebalance()
        await executeIfExist(providerToken.exchangeRateCurrent)
        await executeIfExist(providerToken.rebalance)
        await pool.withdraw(withdrawAmount, {from: user})
        const vaultInfo = await cm.getVaultInfo(vaultNum)
        const balance = await collateralToken.balanceOf(user)
        expect(balance).to.be.bignumber.equal(convertFrom18(withdrawAmount), `${collateralName} balance is wrong`)
        expect(vaultInfo.daiDebt).to.be.bignumber.equal('0', 'Dai debt should be zero')
      })

      it('Should verify that rebalance in low water decreases debt', async function () {
        const depositAmount18 = convertTo18(depositAmount)
        await strategy.rebalanceCollateral()
        const vaultInfoBefore = await cm.getVaultInfo(vaultNum)
        const collateralRatio = vaultInfoBefore.collateralRatio
        // Increase collateral ratio
        const newLowWater = new BN(collateralRatio).div(WAT).add(new BN('500')).toString()
        const newHighWater = new BN(collateralRatio).div(WAT).add(new BN('600')).toString()
        await updateBalancingFactor(controller, strategy.address, [newHighWater, newLowWater])

        await strategy.rebalanceCollateral()
        return Promise.all([
          pool.totalSupply(),
          pool.totalValue(),
          pool.balanceOf(user),
          cm.getVaultInfo(vaultNum),
          strategy.highWater(),
        ]).then(function ([totalSupply, totalValue, vPoolBalance, vaultInfo, highWater]) {
          expect(totalSupply).to.be.bignumber.equal(depositAmount18, `Total supply of ${poolName} is wrong`)
          expect(totalValue).to.be.bignumber.equal(depositAmount, `Total value of ${poolName} is wrong`)
          expect(vPoolBalance).to.be.bignumber.equal(depositAmount18, `${poolName} balance of user is wrong`)
          expect(vaultInfo.collateralLocked).to.be.bignumber.eq(depositAmount18, 'Collateral locked in vault is wrong')
          expect(vaultInfo.collateralRatio).to.be.bignumber.eq(highWater, 'Collateral ratio is wrong')
          expect(vaultInfo.daiDebt).to.be.bignumber.lt(vaultInfoBefore.daiDebt, 'Dai debt should decrease')
        })
      })

      it('Should withdraw when below low water', async function () {
        await strategy.rebalanceCollateral()
        const vaultInfoBefore = await cm.getVaultInfo(vaultNum)
        const collateralRatio = vaultInfoBefore.collateralRatio

        // Increase collateral ratio to achieve low water
        const newLowWater = new BN(collateralRatio).div(WAT).add(new BN('500')).toString()
        const newHighWater = new BN(collateralRatio).div(WAT).add(new BN('600')).toString()
        await updateBalancingFactor(controller, strategy.address, [newHighWater, newLowWater])
        const collateralBalanceBefore = await collateralToken.balanceOf(user)

        const withdrawAmount = (await pool.balanceOf(user)).div(new BN(10))
        await pool.withdraw(withdrawAmount, {from: user})
        return Promise.all([strategy.highWater(), cm.getVaultInfo(vaultNum), collateralToken.balanceOf(user)]).then(
          function ([highWater, vaultInfo, collateralBalance]) {
            expect(vaultInfo.daiDebt).to.be.bignumber.lt(vaultInfoBefore.daiDebt, 'Dai debt should decrease')
            expect(collateralBalance).to.be.bignumber.gt(collateralBalanceBefore, `${collateralName} balance is wrong`)
            if (vaultInfo.daiDebt.toString() === '0') {
              expect(vaultInfo.collateralRatio).to.be.bignumber.eq(constants.MAX_UINT256, 'Collateral ratio is wrong')
            } else {
              expect(vaultInfo.collateralRatio).to.be.bignumber.eq(highWater, 'Collateral ratio is wrong')
            }
          }
        )
      })

      it('Should withdraw when above low water', async function () {
        await strategy.rebalanceCollateral()
        const collateralBalanceBefore = await collateralToken.balanceOf(user)
        const withdrawAmount = (await pool.balanceOf(user)).div(new BN(10))
        await pool.withdraw(withdrawAmount, {from: user})
        return Promise.all([
          strategy.lowWater(),
          strategy.highWater(),
          cm.getVaultInfo(vaultNum),
          collateralToken.balanceOf(user),
        ]).then(function ([lowWater, highWater, vaultInfo, collateralBalance]) {
          expect(vaultInfo.collateralRatio).to.be.bignumber.gt(lowWater, 'Collateral ratio should be > low water')
          expect(vaultInfo.collateralRatio).to.be.bignumber.lt(highWater, 'Collateral ratio should be < high water')
          expect(collateralBalance).to.be.bignumber.gt(collateralBalanceBefore, `${collateralName} balance is wrong`)
        })
      })
    })

    describe(`${poolName}:: RebalanceCollateral in MakerStrategy`, function () {
      it('Should bring collateralRatio equal to highWater', async function () {
        await deposit(pool, collateralToken, 10, user2)
        const highWater = await strategy.highWater()
        await strategy.rebalanceCollateral()
        const vaultInfo = await cm.getVaultInfo(vaultNum)
        expect(vaultInfo.collateralRatio).to.be.bignumber.eq(highWater, 'Collateral ratio is not balanced')
      })
    })

    describe(`${poolName}:: RebalanceEarn in MakerStrategy`, function () {
      beforeEach(async function () {
        await deposit(pool, collateralToken, 10, user2)
      })
      it(`Should increase ${collateralName} token in pool and earn fee`, async function () {
        await pool.rebalance()
        const tokensHere = await pool.tokensHere()
        const vPoolBalanceFcBefore = await pool.balanceOf(feeCollector)

        // Time travel trigger some earning
        await timeTravel()
        await executeIfExist(providerToken.exchangeRateCurrent)
        await executeIfExist(providerToken.rebalance)
        await strategy.rebalanceEarned()

        const vPoolBalanceFcAfter = await pool.balanceOf(feeCollector)
        expect(vPoolBalanceFcAfter).to.be.bignumber.gt(vPoolBalanceFcBefore, 'Fee collected is not correct')

        const tokensHereAfter = await pool.tokensHere()
        expect(tokensHereAfter).to.be.bignumber.gt(tokensHere, `${collateralName} token in pool should increase`)
      })

      it('Should rebalanceEarned when interest fee is zero', async function () {
        await controller.updateInterestFee(pool.address, '0')
        await pool.rebalance()
        const tokensHere = await pool.tokensHere()

        // Time travel trigger some earning
        await timeTravel()
        await executeIfExist(providerToken.exchangeRateCurrent)
        await executeIfExist(providerToken.rebalance)
        await strategy.rebalanceEarned()

        const vPoolBalanceFC = await pool.balanceOf(feeCollector)
        expect(vPoolBalanceFC.toString()).to.eq('0', 'Collected fee should be zero')

        const tokensHereAfter = await pool.tokensHere()
        expect(tokensHereAfter).to.be.bignumber.gt(tokensHere, `${collateralName} token in pool should increase`)
      })

      it('Should fail silently when calling rebalanceEarned with a small amount of DAI present', async function () {
        // swap ETH for DAI
        // Note, this function does the BN conversion for you, so 1 = 1 ETH
        await swapper.swapEthForToken(1, DAI, user1)
        // Deposit 1 Wei DAI
        const dai = await ERC20.at(DAI)
        dai.transfer(strategy.address, '1', {from: user1})
        // call rebalanceEarned and expect the dust to still be there
        await strategy.rebalanceEarned()
        expect(await dai.balanceOf(strategy.address)).to.be.bignumber.equal('1', 'Dai balance is wrong')
      })
    })

    describe(`${poolName}:: Rebalance in MakerStrategy`, function () {
      it('Should not fail even if borrow/debt is below maker dust limit', async function () {
        await deposit(pool, collateralToken, 1, user1)
        const dust = new BN(100)
        // Leave small amount and withdraw rest, so that we can generate debt less than dust
        const withdrawAmount = (await pool.balanceOf(user1)).sub(dust)
        await pool.withdraw(withdrawAmount, {from: user1})

        await pool.rebalance()
        let vaultInfo = await cm.getVaultInfo(vaultNum)
        expect(vaultInfo.daiDebt).to.be.bignumber.equal('0', 'Dai debt is wrong')
        await pool.withdraw(dust, {from: user1})
        vaultInfo = await cm.getVaultInfo(vaultNum)
        expect(vaultInfo.daiDebt).to.be.bignumber.equal('0', 'Dai debt is wrong')
        expect(vaultInfo.collateralLocked).to.be.bignumber.equal('0', 'Collateral lock is wrong')
      })

      it('Should calculate interestEarned correctly', async function () {
        await controller.updateInterestFee(pool.address, '0')
        await deposit(pool, collateralToken, 10, user2)
        await pool.rebalance()
        let interestEarned = await strategy.interestEarned()
        expect(interestEarned).to.be.bignumber.equal('0', 'Interest earned should be zero')

        const totalValue1 = await pool.totalValue()
        // Time travel
        await time.increase(6 * 60 * 60)
        interestEarned = await strategy.interestEarned()
        await pool.rebalance()
        const totalValue2 = await pool.totalValue()

        const actualInterestEarned = totalValue2.sub(totalValue1)
        expect(actualInterestEarned).to.be.bignumber.gte(interestEarned, 'Actual interest earned is not correct')
      })
    })

    describe(`${poolName}:: Resurface in MakerStrategy`, function () {
      beforeEach(async function () {
        await deposit(pool, collateralToken, 20, user3)
        // 2 rebalance and 12 hours of time should take pool underwater.
        await pool.rebalance()
        await time.increase(12 * 60 * 60)
        // If already underwater skip rebalance
        const isUnderwater = await strategy.isUnderwater()
        if (!isUnderwater) {
          await pool.rebalance()
        }
      })

      it('Should resolve underwater scenario', async function () {
        const vInfo = await cm.getVaultInfo(vaultNum)
        expect(await strategy.isUnderwater(), `${poolName} pool should be underwater`).to.be.true
        const poolSharePriceBefore = await pool.getPricePerShare()
        await strategy.resurface()
        expect(await strategy.isUnderwater(), `${poolName} pool should be above water`).to.be.false
        const poolSharePriceAfter = await pool.getPricePerShare()
        expect(poolSharePriceAfter).to.be.bignumber.lt(
          poolSharePriceBefore,
          'Pool share value should decrease after resurface'
        )
        const vInfo2 = await cm.getVaultInfo(vaultNum)
        const lowWater = await strategy.lowWater()
        expect(vInfo2.collateralLocked).to.be.bignumber.lte(vInfo.collateralLocked, 'Collateral locked is wrong')
        expect(vInfo2.daiDebt).to.be.bignumber.lte(vInfo.daiDebt, 'Dai debt is wrong')
        expect(vInfo2.collateralRatio).to.be.bignumber.gt(lowWater, `${poolName} pool is still under water`)
      })
    })

    describe(`${poolName}:: Updates via Controller`, function () {
      it('Should call withdraw() in strategy', async function () {
        await deposit(pool, collateralToken, 10, user4)
        await pool.rebalance()
        await executeIfExist(providerToken.exchangeRateCurrent)
        await executeIfExist(providerToken.rebalance)
        const vPoolBalanceBefore = await pool.balanceOf(user4)

        const totalSupply = await pool.totalSupply()
        const price = await pool.getPricePerShare()
        const withdrawAmount = totalSupply.mul(price).div(DECIMAL).toString()

        const target = strategy.address
        const methodSignature = 'withdraw(uint256)'
        const data = web3.eth.abi.encodeParameter('uint256', withdrawAmount)
        await controller.executeTransaction(target, 0, methodSignature, data, {from: accounts[0]})

        const vPoolBalance = await pool.balanceOf(user4)
        const collateralBalance = await collateralToken.balanceOf(pool.address)

        expect(collateralBalance).to.be.bignumber.eq(withdrawAmount, `${collateralName} balance of pool is wrong`)
        expect(vPoolBalance).to.be.bignumber.eq(vPoolBalanceBefore, `${poolName} balance of user is wrong`)
      })

      it('Should call withdrawAll() in strategy', async function () {
        await deposit(pool, collateralToken, 10, user3)
        await pool.rebalance()

        const totalLocked = await strategy.totalLocked()
        const vInfo = await cm.getVaultInfo(vaultNum)
        expect(vInfo.daiDebt).to.be.bignumber.gte('0', 'Dai debt is wrong')
        await executeIfExist(providerToken.exchangeRateCurrent)
        await executeIfExist(providerToken.rebalance)
        const target = strategy.address
        const methodSignature = 'withdrawAll()'
        const data = '0x'
        await controller.executeTransaction(target, 0, methodSignature, data, {from: owner})

        const vInfo2 = await cm.getVaultInfo(vaultNum)
        expect(vInfo2.collateralLocked).to.be.bignumber.equal('0', 'Collateral locked is wrong')
        expect(vInfo2.daiDebt).to.be.bignumber.equal('0', 'Dai debt is wrong')
        expect(vInfo2.collateralRatio).to.be.bignumber.equal('0', 'Collateral ratio is wrong')

        const tokensInPool = await pool.tokensHere()
        expect(tokensInPool).to.be.bignumber.equal(totalLocked, 'TokensHere in pool is not correct')
      })

      it('Should call withdrawAllWithRebalance() in strategy', async function () {
        await deposit(pool, collateralToken, 20, user3)
        await pool.rebalance()
        // Time travel 6 hours for some earning
        await timeTravel()
        await executeIfExist(providerToken.exchangeRateCurrent)
        await executeIfExist(providerToken.rebalance)
        const totalLocked = await strategy.totalLocked()

        const target = strategy.address
        const methodSignature = 'withdrawAllWithRebalance()'
        const data = '0x'
        await controller.executeTransaction(target, 0, methodSignature, data, {from: owner})

        const tokensInPool = await pool.tokensHere()
        // Withdraw all will do rebalanceEarned too, which can increase locked
        expect(tokensInPool).to.be.bignumber.gte(totalLocked, 'TokensHere in pool is not correct')
      })

      it('Should rebalance after withdrawAll() and adding AaveStrategy', async function () {
        await deposit(pool, collateralToken, 10, user3)
        await pool.rebalance()
        // Time travel 12 hours
        await timeTravel()
        await executeIfExist(providerToken.exchangeRateCurrent)
        await executeIfExist(providerToken.rebalance)
        const lockedWithMaker = await strategy.totalLocked()

        const target = strategy.address
        const methodSignature = 'withdrawAll()'
        const data = '0x'
        await controller.executeTransaction(target, 0, methodSignature, data, {from: owner})

        strategy = await this.newStrategy.new(controller.address, pool.address)
        await controller.updateStrategy(pool.address, strategy.address)
        await pool.rebalance()

        const lockedWithAave = await strategy.totalLocked()
        expect(lockedWithAave).to.be.bignumber.equal(lockedWithMaker, 'Total locked with direct Aave is wrong')
      })
    })
  })
}

module.exports = {shouldBehaveLikeStrategy}
