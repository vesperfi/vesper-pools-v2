'use strict'

const swapper = require('../utils/tokenSwapper')
const bancorHelper = require('../utils/bancorHelper')
const {deposit} = require('../utils/poolOps')
const {expect, assert} = require('chai')
const {BN, time} = require('@openzeppelin/test-helpers')
const DECIMAL = new BN('1000000000000000000')
const ERC20 = artifacts.require('ERC20')
const DAY = 86400;

const BNT_ADDRESS = '0x1F573D6Fb3F13d689FF844B4cE37794d79a7FF1C'
const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

// Bancor strategy behavior test suite
function shouldBehaveLikeStrategy(poolName, collateralName, accounts) {
  let pool, strategy, controller, bnt, feeCollector
  let collateralToken, providerToken, collateralDecimal
  const [owner, user1, user2, user3, user4] = accounts

  function convertTo18Str(amount) {
    const multiplier = DECIMAL.div(new BN('10').pow(collateralDecimal))
    return new BN(amount).mul(multiplier).toString()
  }

  function convertTo18(amount) {
    const multiplier = DECIMAL.div(new BN('10').pow(collateralDecimal))
    return new BN(amount).mul(multiplier)
  }

  function convertFrom18Str(amount) {
    const divisor = DECIMAL.div(new BN('10').pow(collateralDecimal))
    return new BN(amount).div(divisor).toString()
  }

  function convertFrom18(amount) {
    const divisor = DECIMAL.div(new BN('10').pow(collateralDecimal))
    return new BN(amount).div(divisor)
  }

  async function mineBlocks(numberOfBlocks) {
    await time.advanceBlockTo((await time.latestBlock()).add(new BN(numberOfBlocks)))
  }

  async function timeIncrease(duration) {
    await time.increase(duration)
  }

  async function getPoolRatio() {
    const poolTokenSpace = await bancorHelper.totalPoolAmount()
    const poolReserveSpace = await bancorHelper.totalReserveAmount()
    const poolRatio = poolTokenSpace.div(poolReserveSpace)
    return poolRatio
  }

  describe(`${poolName}:: BancorStrategy basic tests`, function () {
    beforeEach(async function () {
      pool = this.pool
      controller = this.controller
      strategy = this.strategy
      collateralToken = this.collateralToken
      providerToken = this.providerToken
      feeCollector = this.feeCollector
      // Decimal will be used for amount conversion
      collateralDecimal = await this.collateralToken.decimals.call()

      bnt = await ERC20.at(BNT_ADDRESS)
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

    // describe(`${poolName}:: Claim COMP in BancorStrategy`, function () {
    //   it('Should liquidate COMP when claimed by external source', async function () {
    //     await deposit(pool, collateralToken, 2, user2)
    //     await pool.rebalance()
    //     await mineBlocks(100)
    //     await providerToken.exchangeRateCurrent()
    //     await deposit(pool, collateralToken, 2, user3)
    //     await pool.rebalance()
    //     await comptroller.claimComp(strategy.address, [providerToken.address], {from: user4})
    //     let compBalance = await comp.balanceOf(strategy.address)
    //     expect(compBalance).to.be.bignumber.gt('0', 'Should earn COMP')
    //     await swapper.swapEthForToken(10, COMP_ADDRESS, user4, strategy.address)
    //     await pool.rebalance()
    //     const tokensHere = await pool.tokensHere()
    //     compBalance = await comp.balanceOf(strategy.address)
    //     expect(compBalance).to.be.bignumber.equal('0', 'COMP balance should be zero')
    //     expect(tokensHere).to.be.bignumber.equal('0', `Tokens here of ${poolName} should be zero`)
    //   })
    //   it('Should claim COMP when rebalance() is called', async function () {
    //     await deposit(pool, collateralToken, 2, user3)
    //     await pool.rebalance()
    //     await mineBlocks(50)
    //     await providerToken.exchangeRateCurrent()
    //     await deposit(pool, collateralToken, 2, user4)
    //     await pool.rebalance()
    //     const tokensHere = await pool.tokensHere()
    //     const compBalance = await comp.balanceOf(strategy.address)
    //     expect(compBalance).to.be.bignumber.equal('0', 'COMP balance should be zero')
    //     expect(tokensHere).to.be.bignumber.equal('0', `Tokens here of ${poolName} should be zero`)
    //   })
    // })

    describe(`${poolName}:: DepositAll in BancorStrategy`, function () {
      it(`Should deposit ${collateralName} and call depositAll() in Strategy`, async function () {
        const depositAmount = await deposit(pool, collateralToken, 2, user3)
        const tokensHere = await pool.tokensHere()
        // await providerToken.exchangeRateCurrent()
        await strategy.depositAll()
        const vPoolBalance = await pool.balanceOf(user3)
        expect(convertFrom18(vPoolBalance)).to.be.bignumber.equal(
          depositAmount,
          `${poolName} balance of user is wrong`
        )
        // await providerToken.exchangeRateCurrent()
        expect(await pool.tokenLocked()).to.be.bignumber.gte(tokensHere, 'Token locked is not correct')
      })

      it('Should increase pending fee and share price after withdraw', async function () {
        // inflate the ETH/BNT market to deflate later, add 0.1% of the pool so that we can still play with ratio
        const poolAmount = (await bancorHelper.totalPoolAmount())
        .div(new BN('10000'))
        .div(new BN('10').pow(collateralDecimal));
        // const user2DepositId = await bancorHelper.addLiquidity(user2, poolAmount);
        // await mineBlocks(10)

        // deposit collateralToken into pool
        await deposit(pool, collateralToken, 100, user1)
        let fee = await strategy.pendingFee()
        expect(fee).to.be.bignumber.equal('0', 'fee should be zero')
        
        // deposit to bancor
        await strategy.depositAll()
        fee = await strategy.pendingFee()
         let peek = await strategy.peek.call();
         expect(peek).to.equal('0')
        const sharePrice1 = await pool.getPricePerShare()
        expect(fee).to.be.bignumber.equal('0', 'fee should be zero')
        await timeIncrease(2 * DAY)
         peek = await strategy.peek.call();
        expect(peek).to.equal('1')
        
        // trade ETH with Bancor and Time travel to trigger some earning
        // await bancorHelper.removeLiquidity(user2, user2DepositId)

        // TODO: UNABLE TO GENERATE FEES / INTEREST ON BANCOR?!
        const uniBntBalance = await swapper.swapEthForToken(poolAmount, BNT_ADDRESS, user2, user2)
        await bancorHelper.swapBNTForETH(uniBntBalance, user2)
        await mineBlocks(1)
        await bancorHelper.swapETHForBNT(poolAmount, user2)
        await mineBlocks(1)
        await bancorHelper.swapBNTForETH(uniBntBalance, user2)
        await mineBlocks(1)
        await bancorHelper.swapETHForBNT(poolAmount, user2)
        await mineBlocks(1)
        await bancorHelper.swapBNTForETH(uniBntBalance, user2)
        await mineBlocks(1)
        await bancorHelper.swapETHForBNT(poolAmount, user2)
        await mineBlocks(1)
        await bancorHelper.swapBNTForETH(uniBntBalance, user2)
        await mineBlocks(1)
        await bancorHelper.swapETHForBNT(poolAmount, user2)
        await mineBlocks(1)
        await bancorHelper.swapBNTForETH(uniBntBalance, user2)
        // await bancorHelper.addLiquidityBnt(user2, uniBntBalance);
        await mineBlocks(10)
        await timeIncrease(2 * DAY)
        
        // deposit again
        await deposit(pool, collateralToken, 100, user1)
         peek = await strategy.peek.call();
        expect(peek).to.equal('1')
        await strategy.depositAll()
        
        await timeIncrease(2 * DAY)
         peek = await strategy.peek.call();
        expect(peek).to.equal('2')

        fee = await strategy.pendingFee()
        expect(fee).to.be.bignumber.gt('0', `fee should be > 0, was ${fee}`)

        let sharePrice2 = await pool.getPricePerShare()
        expect(sharePrice2).to.be.bignumber.gt(sharePrice1, 'share price should increase')

        // Time travel to trigger some earning
        await mineBlocks(200)
        const vPoolBalance = await pool.balanceOf(user1)
        await pool.withdraw(vPoolBalance, {from: user1})

        const updatedFee = await strategy.pendingFee()
        expect(updatedFee).to.be.bignumber.gt(fee, 'updated fee should be greater than previous fee')
        // When all tokens are burnt, price will be back to 1.0
        sharePrice2 = await pool.getPricePerShare()
        expect(sharePrice2).to.be.bignumber.equal(convertFrom18Str(DECIMAL), 'share price should 1.0')

        // We still have some pending fee to be converted into collateral, which will increase totalValue
        await pool.rebalance()
        expect(await pool.totalValue()).to.be.bignumber.gt('0', `Total value of ${poolName} should be > 0`)
      })
    })

    describe(`${poolName}:: Interest fee via BancorStrategy`, function () {
      it('Should handle interest fee correctly after withdraw', async function () {
        await deposit(pool, collateralToken, 200, user2)
        await pool.rebalance()

        const pricePerShare = await pool.getPricePerShare()
        const vPoolBalanceBefore = await pool.balanceOf(feeCollector)

        // Mine some blocks
        await mineBlocks(30)
//        await providerToken.exchangeRateCurrent()
        const pricePerShare2 = await pool.getPricePerShare()
        expect(pricePerShare2).to.be.bignumber.gt(pricePerShare, 'PricePerShare should be higher after time travel')

        await pool.withdraw(await pool.balanceOf(user2), {from: user2})
//        await providerToken.exchangeRateCurrent()

        let tokenLocked = await pool.tokenLocked()
        // Ideally this should be zero but we have 1 block earning of cToken
        const dust = DECIMAL.div(new BN('100')) // Dust is less than 1e16
        expect(tokenLocked).to.be.bignumber.lte(dust, 'Token locked should be zero')
        let totalSupply = await pool.totalSupply()
        expect(totalSupply).to.be.bignumber.equal('0', 'Total supply should be zero')

        await pool.rebalance()
//        await providerToken.exchangeRateCurrent()

        tokenLocked = await pool.tokenLocked()
        expect(tokenLocked).to.be.bignumber.gt('0', 'Token locked should be greater than zero')
        totalSupply = await pool.totalSupply()
        expect(totalSupply).to.be.bignumber.gt('0', 'Total supply should be greater than zero')

        const vPoolBalanceAfter = await pool.balanceOf(feeCollector)
        expect(vPoolBalanceAfter).to.be.bignumber.gt(vPoolBalanceBefore, 'Fee collected is not correct')
        const tokensHere = await pool.tokensHere()
        expect(tokensHere).to.be.bignumber.equal('0', 'Tokens here is not correct')
      })
    })

    describe(`${poolName}:: Updates via Controller`, function () {
      it('Should call withdraw() in strategy', async function () {
        await deposit(pool, collateralToken, 2, user4)
        await pool.rebalance()
        timeIncrease(2 * DAY)

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
        await deposit(pool, collateralToken, 2, user3)
        await pool.rebalance()

        const totalLocked = await strategy.totalLocked()

        const target = strategy.address
        const methodSignature = 'withdrawAll()'
        const data = '0x'
        await controller.executeTransaction(target, 0, methodSignature, data, {from: owner})

        const tokensInPool = await pool.tokensHere()
        expect(tokensInPool).to.be.bignumber.gte(totalLocked, 'TokensHere in pool is not correct')
      })

      it('Should rebalance after withdrawAll() and adding new strtegy', async function () {
        await deposit(pool, collateralToken, 200, user3)
        await pool.rebalance()
        await mineBlocks(25)
//        await providerToken.exchangeRateCurrent()
        const totalLockedBefore = await strategy.totalLocked()

        const target = strategy.address
        const methodSignature = 'withdrawAll()'
        const data = '0x'
        await controller.executeTransaction(target, 0, methodSignature, data, {from: owner})

        strategy = await this.newStrategy.new(controller.address, pool.address, 100)
        await controller.updateStrategy(pool.address, strategy.address)
        await pool.rebalance()

        const totalLockedAfter = await strategy.totalLocked()
        expect(totalLockedAfter).to.be.bignumber.gte(totalLockedBefore, 'Total locked with new strategy is wrong')

        const withdrawAmount = await pool.balanceOf(user3)
        await pool.withdraw(withdrawAmount, {from: user3})

        const collateralBalance = convertTo18(await collateralToken.balanceOf(user3))
        expect(collateralBalance).to.be.bignumber.gt(withdrawAmount, `${collateralName} balance of user is wrong`)
      })
    })

    describe(`${poolName}:: Strategy migration without withdrawAll()`, function () {
      it('Should migrate strategy', async function () {
        await controller.updateInterestFee(pool.address, '0')
        await deposit(pool, collateralToken, 20, user1)
        await pool.rebalance()

        let pricePerShare = await pool.getPricePerShare()
        let vPoolBalance = await pool.balanceOf(user1)
//        await providerToken.exchangeRateCurrent()
        await pool.withdraw(vPoolBalance.div(new BN(2)), {from: user1})

        // Migrate out
        let target = strategy.address
        let methodSignature = 'migrateOut()'
        let data = '0x'
        await controller.executeTransaction(target, 0, methodSignature, data)

//        await providerToken.exchangeRateCurrent()
        let pricePerShare2 = await pool.getPricePerShare()
        expect(pricePerShare2).to.be.bignumber.gt(pricePerShare, 'Share price should increase')

        strategy = await this.newStrategy.new(controller.address, pool.address)
        await controller.updateStrategy(pool.address, strategy.address)
        await mineBlocks(25)
//        await providerToken.exchangeRateCurrent()

        // Deposit and rebalance with new strategy but before migrateIn
        await deposit(pool, collateralToken, 20, user2)
        await pool.rebalance()

        pricePerShare = pricePerShare2
//        await providerToken.exchangeRateCurrent()
        pricePerShare2 = await pool.getPricePerShare()
        expect(pricePerShare2).to.be.bignumber.gt(pricePerShare, 'Share price should increase')

        // Migrate in
        target = strategy.address
        methodSignature = 'migrateIn()'
        data = '0x'
        await controller.executeTransaction(target, 0, methodSignature, data)
        await mineBlocks(25)
//        await providerToken.exchangeRateCurrent()

        // Deposit and rebalance after migrateIn
        const depositAmount = await deposit(pool, collateralToken, 20, user2)
        await pool.rebalance()

        pricePerShare = pricePerShare2
        pricePerShare2 = await pool.getPricePerShare()
        expect(pricePerShare2).to.be.bignumber.gt(pricePerShare, 'Share price should increase')

        vPoolBalance = await pool.balanceOf(user1)
        await pool.withdraw(vPoolBalance, {from: user1})
        vPoolBalance = await pool.balanceOf(user2)
        await pool.withdraw(vPoolBalance, {from: user2})

        const cTokenBalance = await providerToken.balanceOf(strategy.address)
        vPoolBalance = await pool.balanceOf(user1)
        const collateralBalance = await collateralToken.balanceOf(user1)

        expect(cTokenBalance).to.be.bignumber.gt('0', 'cToken balance should be > 0')
        expect(vPoolBalance).to.be.bignumber.eq('0', `${poolName} balance of user should be zero`)
        expect(collateralBalance).to.be.bignumber.gt(
          depositAmount,
          `${collateralName} balance should be > deposit amount`
        )
      })
    })
  })
}

module.exports = {shouldBehaveLikeStrategy}
