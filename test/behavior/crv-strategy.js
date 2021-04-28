'use strict'

const swapper = require('../utils/tokenSwapper')
const { deployContract} = require('../utils/setupHelper')
const {ethers} = require('hardhat')
const {defaultAbiCoder} = ethers.utils
const {deposit} = require('../utils/poolOps')
const {expect} = require('chai')
const time = require('../utils/time')
const {BigNumber: BN} = require('ethers')
const DECIMAL = BN.from('1000000000000000000')


// Crv strategy behavior test suite
function shouldBehaveLikeStrategy(poolName, collateralName) {
  let pool, strategy, controller, collateralToken, collateralDecimal, feeCollector, swapManager, accounts
  let owner, user4, user2, user3

  function convertTo18(amount) {
    const multiplier = DECIMAL.div(BN.from('10').pow(collateralDecimal))
    return BN.from(amount).mul(multiplier).toString()
  }

  function convertFrom18(amount) {
    const divisor = DECIMAL.div(BN.from('10').pow(collateralDecimal))
    return BN.from(amount).div(divisor).toString()
  }

  describe(`${poolName}:: CrvStrategy basic tests`, function () {
    beforeEach(async function () {
      accounts = await ethers.getSigners()
      ;[owner, user4, user2, user3] = accounts
      pool = this.pool
      controller = this.controller
      strategy = this.strategy
      collateralToken = this.collateralToken
      feeCollector = this.feeCollector
      swapManager = this.swapManager
      // Decimal will be used for amount conversion
      collateralDecimal = await this.collateralToken.decimals()
    })

    it('Should sweep erc20 from strategy', async function () {
      const metAddress = '0xa3d58c4e56fedcae3a7c43a725aee9a71f0ece4e'
      const token = await ethers.getContractAt('ERC20',metAddress)
      const tokenBalance = await swapper.swapEthForToken(1, metAddress, user4, strategy.address)
      await strategy.sweepErc20(metAddress)

      const totalSupply = await pool.totalSupply()
      const metBalanceInPool = await token.balanceOf(pool.address)
      expect(totalSupply).to.be.equal('0', `Total supply of ${poolName} is wrong`)
      expect(metBalanceInPool).to.be.equal(tokenBalance, 'ERC20 token balance is wrong')
    })

    describe(`${poolName}:: DepositAll in CrvStrategy`, function () {
      it(`Should deposit ${collateralName} and call depositAll() in Strategy`, async function () {
        const depositAmount = await deposit(pool, collateralToken, 2, user3)
        const tokensHere = await pool.tokensHere()
        await strategy.depositAll()
        const vPoolBalance = await pool.balanceOf(user3.address)
        expect(convertFrom18(vPoolBalance)).to.be.equal(
          depositAmount,
          `${poolName} balance of user is wrong`
        )
        const totalLocked = await pool.tokenLocked()
        const adjTotalLocked = await strategy.estimateFeeImpact(totalLocked)
        expect(tokensHere).to.be.gte(adjTotalLocked, 'Token locked is not correct')
      })
    })

    describe(`${poolName}:: DepositValue in CrvStrategy`, function () {
      it(`Should deposit ${collateralName} and call depositAll() in Strategy`, async function () {
        const depositAmount = await deposit(pool, collateralToken, 2, user3)
        const tokensHere = await pool.tokensHere()
        await strategy.depositAll()
        const vPoolBalance = await pool.balanceOf(user3.address)
        expect(convertFrom18(vPoolBalance)).to.be.equal(
          depositAmount,
          `${poolName} balance of user is wrong`
        )
        const totalLocked = await pool.tokenLocked()
        const adjTotalLocked = await strategy.estimateFeeImpact(totalLocked)
        expect(tokensHere).to.be.gte(adjTotalLocked, 'Token locked is not correct')
      })
    })

    describe(`${poolName}:: Interest fee via CrvStrategy`, function () {
      it('Should handle interest fee correctly after withdraw', async function () {
        await deposit(pool, collateralToken, 40, user2)
        await pool.rebalance()
        const pricePerShare = await pool.getPricePerShare()
        const vPoolBalanceBefore = await pool.balanceOf(feeCollector.address)

        // Time travel 10 hours to earn some crv & dai
        await time.increase(100 * 60 * 60)
        await swapManager['updateOracles()']()
        await pool.rebalance()
        const pricePerShare2 = await pool.getPricePerShare()

        expect(pricePerShare2).to.be.gt(pricePerShare, 'PricePerShare should be higher after time travel')
        await pool.connect(user2).withdraw(await pool.balanceOf(user2.address))

        const tokenLocked = await pool.tokenLocked()
        expect(tokenLocked).to.be.gt('0', 'Token locked should be greater than zero')

        const totalSupply = await pool.totalSupply()
        expect(totalSupply).to.be.gt('0', 'Total supply should be greater than zero')

        const vPoolBalanceAfter = await pool.balanceOf(feeCollector.address)
        expect(vPoolBalanceAfter).to.be.gt(vPoolBalanceBefore, 'Fee collected is not correct')

        const dust = DECIMAL.div(BN.from('100')) // Dust is less than 1e16
        const tokensHere = await pool.tokensHere()
        expect(tokensHere).to.be.lt(dust, 'Tokens here is not correct')
        
      })
    })

    describe(`${poolName}:: Updates via Controller`, function () {
      it('Should call withdraw() in strategy', async function () {
        await deposit(pool, collateralToken, 20, user4)
        await pool.rebalance()

        const vPoolBalanceBefore = await pool.balanceOf(user4.address)
        const collateralBalanceBefore = await collateralToken.balanceOf(pool.address)


        const totalSupply = await pool.totalSupply()
        const price = await pool.getPricePerShare()
        const withdrawAmount = totalSupply.mul(price).div(DECIMAL).toString()
        
        const target = strategy.address
        const methodSignature = 'withdraw(uint256)'
        const data = defaultAbiCoder.encode(['uint256'], [withdrawAmount])
        await controller.executeTransaction(target, 0, methodSignature, data)

        const vPoolBalance = await pool.balanceOf(user4.address)
        const collateralBalance = await collateralToken.balanceOf(pool.address)

        expect(collateralBalance).to.be.gt(
          collateralBalanceBefore, `${collateralName} balance of pool is wrong`)
        expect(vPoolBalance).to.be.eq(vPoolBalanceBefore, `${poolName} balance of user is wrong`)
      })

      it('Should call withdrawAll() in strategy', async function () {
        await deposit(pool, collateralToken, 2, user3)
        await pool.rebalance()

        // const totalLockedBefore = await strategy.totalLocked()

        const target = strategy.address
        const methodSignature = 'withdrawAll()'
        const data = '0x'
        await controller.connect(owner).executeTransaction(target, 0, methodSignature, data)

        // const tokensInPool = await pool.tokensHere()
        const totalLocked = await strategy.totalLocked()

        expect(totalLocked).to.be.eq('0', 'Total Locked should be 0')
        // expect(tokensInPool).to.be.gte(totalLockedBefore, 
        // 'Tokens in pool should be at least what was estimated')
      })

      it('Should rebalance after withdrawAll() and adding new strategy', async function () {
        await deposit(pool, collateralToken, 10, user3)
        await pool.rebalance()
        // const totalLockedBefore = await strategy.totalLocked()

        const target = strategy.address
        let methodSignature = 'withdrawAll()'
        const data = '0x'
        await controller.connect(owner).executeTransaction(target, 0, methodSignature, data)

        strategy = await deployContract(this.newStrategy,[controller.address, pool.address])
        methodSignature = 'approveToken()'
        await controller.executeTransaction(strategy.address, 0, methodSignature, data)

        await controller.updateStrategy(pool.address, strategy.address)
        await pool.rebalance()

        const totalLockedAfter = await strategy.totalLocked()
        expect(totalLockedAfter).to.be.gte('0', 'Total locked with new strategy is wrong')

        const withdrawAmount = await pool.balanceOf(user3.address)
        await pool.connect(user3).withdraw(withdrawAmount)

        const collateralBalance = convertTo18(await collateralToken.balanceOf(user3.address))
        expect(collateralBalance).to.be.gt('0', `${collateralName} balance of user is wrong`)
      })
    })

    describe('Interest Earned', function () {
      it('Should get the interest earned', async function() {
        let interestEarned = await strategy.interestEarned()
        expect(interestEarned).to.be.eq('0', 'Phantom interest is occurring')

        await deposit(pool, collateralToken, 10, user3)
        await pool.rebalance()

        // Time travel 10 hours to earn some crv & dai
        await time.increase(100 * 60 * 60)

        await swapManager['updateOracles()']()

        // withdrawals trigger update to stored values
        await pool.connect(user3).withdraw(BN.from(1).mul(DECIMAL))

        let interestEarnedAfter = await strategy.interestEarned()
        expect(interestEarnedAfter).to.be.gte(interestEarned, 'Interest did not grow (1)')

        await pool.connect(user3).withdraw(BN.from(1).mul(DECIMAL))
        interestEarned = await strategy.interestEarned()

        await time.increase(100 * 60 * 60)
        await swapManager['updateOracles()']()

        await pool.connect(user3).withdraw(BN.from(1).mul(DECIMAL))

        interestEarnedAfter = await strategy.interestEarned()
        expect(interestEarnedAfter).to.be.gte(interestEarned, 'Interest did not grow (2)')

        const percentIncrease = (interestEarnedAfter.sub(interestEarned))
          .mul(BN.from(10000))
          .div(interestEarned).toNumber()
        const readablePI = percentIncrease / 100
        // actual interest diff here should be just over 100%, because we earn one extra block of interest
        expect(readablePI).to.be.lt(101, 'Interest calculation is wrong')
      })
    })
  })
}

module.exports = {shouldBehaveLikeStrategy}
