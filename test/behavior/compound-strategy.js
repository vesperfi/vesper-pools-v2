'use strict'

const swapper = require('../utils/tokenSwapper')
const {ethers} = require('hardhat')
const {defaultAbiCoder} = ethers.utils
const {deposit} = require('../utils/poolOps')
const {deployContract} = require('../utils/setupHelper')
const {addInList, approveToken, createKeeperList} = require('../utils/setupHelper')
const {advanceBlock} = require('../utils/time')
const {expect} = require('chai')
const {BigNumber: BN} = require('ethers')
const DECIMAL = BN.from('1000000000000000000')

const COMPTROLLER_ADDRESS = '0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B'
const COMP_ADDRESS = '0xc00e94Cb662C3520282E6f5717214004A7f26888'

// Compound strategy behavior test suite
async function shouldBehaveLikeStrategy(poolName, collateralName) {
  let pool, strategy, controller, comptroller, comp, feeCollector
  let collateralToken, providerToken, collateralDecimal
  let accounts, owner, user1, user2, user3, user4

  function convertTo18(amount) {
    const multiplier = DECIMAL.div(BN.from('10').pow(collateralDecimal))
    return BN.from(amount).mul(multiplier).toString()
  }

  function convertFrom18(amount) {
    const divisor = DECIMAL.div(BN.from('10').pow(collateralDecimal))
    return BN.from(amount).div(divisor).toString()
  }

  describe(`${poolName}:: CompoundStrategy basic tests`, function() {
    beforeEach(async function() {
      accounts = await ethers.getSigners()
      ;[owner, user1, user2, user3, user4] = accounts
      pool = this.pool
      controller = this.controller
      strategy = this.strategy
      collateralToken = this.collateralToken
      providerToken = this.providerToken
      feeCollector = this.feeCollector
      // Decimal will be used for amount conversion
      collateralDecimal = await this.collateralToken.decimals()

      comptroller = await ethers.getContractAt('Comptroller',COMPTROLLER_ADDRESS)
      comp = await ethers.getContractAt('ERC20',COMP_ADDRESS)
    })

    it('Should sweep erc20 from strategy', async function() {
      const metAddress = '0xa3d58c4e56fedcae3a7c43a725aee9a71f0ece4e'
      const token = await ethers.getContractAt('ERC20',metAddress)
      const tokenBalance = await swapper.swapEthForToken(1, metAddress, user4, strategy.address)
      await strategy.sweepErc20(metAddress)

      const totalSupply = await pool.totalSupply()
      const metBalanceInPool = await token.balanceOf(pool.address)
      expect(totalSupply).to.be.equal('0', `Total supply of ${poolName} is wrong`)
      expect(metBalanceInPool).to.be.equal(tokenBalance, 'ERC20 token balance is wrong')
    })

    describe(`${poolName}:: Claim COMP in CompoundStrategy`, function() {
      it('Should liquidate COMP when claimed by external source', async function() {
        await deposit(pool, collateralToken, 2, user2)
        await pool.rebalance()
        await advanceBlock(100)
        await providerToken.exchangeRateCurrent()
        await deposit(pool, collateralToken, 2, user3)
        await pool.rebalance()
        await comptroller.connect(user4).claimComp(strategy.address, [providerToken.address])
        let compBalance = await comp.balanceOf(strategy.address)
        expect(compBalance).to.be.gt('0', 'Should earn COMP')
        await swapper.swapEthForToken(10, COMP_ADDRESS, user4, strategy.address)
        await pool.rebalance()
        const tokensHere = await pool.tokensHere()
        compBalance = await comp.balanceOf(strategy.address)
        expect(compBalance).to.be.equal('0', 'COMP balance should be zero')
        expect(tokensHere).to.be.equal('0', `Tokens here of ${poolName} should be zero`)
      })
      it('Should claim COMP when rebalance() is called', async function() {
        await deposit(pool, collateralToken, 2, user3)
        await pool.rebalance()
        await advanceBlock(50)
        await providerToken.exchangeRateCurrent()
        await deposit(pool, collateralToken, 2, user4)
        await pool.rebalance()
        const tokensHere = await pool.tokensHere()
        const compBalance = await comp.balanceOf(strategy.address)
        expect(compBalance).to.be.equal('0', 'COMP balance should be zero')
        expect(tokensHere).to.be.equal('0', `Tokens here of ${poolName} should be zero`)
      })
    })

    describe(`${poolName}:: DepositAll in CompoundStrategy`, function() {
      it(`Should deposit ${collateralName} and call depositAll() in Strategy`, async function() {
        const depositAmount = await deposit(pool, collateralToken, 200, user3)
        const tokensHere = await pool.tokensHere()
        await providerToken.exchangeRateCurrent()
        await strategy.depositAll()
        const vPoolBalance = await pool.balanceOf(user3.address)
        expect(convertFrom18(vPoolBalance)).to.be.equal(
          depositAmount,
          `${poolName} balance of user is wrong`
        )
        await providerToken.exchangeRateCurrent()
        expect(await pool.tokenLocked()).to.be.gte(tokensHere, 'Token locked is not correct')
      })

      it('Should increase pending fee and share price after withdraw', async function() {
        await deposit(pool, collateralToken, 400, user1)
        let fee = await strategy.pendingFee()
        expect(fee).to.be.equal('0', 'fee should be zero')
        await strategy.depositAll()
        fee = await strategy.pendingFee()
        expect(fee).to.be.equal('0', 'fee should be zero')

        const sharePrice1 = await pool.getPricePerShare()
        // Time travel to trigger some earning
        await advanceBlock(200)
        await deposit(pool, collateralToken, 2, user1)
        await strategy.depositAll()
        fee = await strategy.pendingFee()
        expect(fee).to.be.gt('0', 'fee should be > 0')

        let sharePrice2 = await pool.getPricePerShare()
        expect(sharePrice2).to.be.gt(sharePrice1, 'share price should increase')
        // Time travel to trigger some earning
        await advanceBlock(200)
        const vPoolBalance = await pool.balanceOf(user1.address)
        await pool.connect(user1).withdraw(vPoolBalance)

        const updatedFee = await strategy.pendingFee()
        expect(updatedFee).to.be.gt(fee, 'updated fee should be greater than previous fee')
        // When all tokens are burnt, price will be back to 1.0
        sharePrice2 = await pool.getPricePerShare()
        expect(sharePrice2).to.be.equal(convertFrom18(DECIMAL), 'share price should 1.0')

        // We still have some pending fee to be converted into collateral, which will increase totalValue
        await pool.rebalance()
        expect(await pool.totalValue()).to.be.gt('0', `Total value of ${poolName} should be > 0`)
      })
    })

    describe(`${poolName}:: Interest fee via CompoundStrategy`, function() {
      it('Should handle interest fee correctly after withdraw', async function() {
        await deposit(pool, collateralToken, 200, user2)
        await pool.rebalance()

        const pricePerShare = await pool.getPricePerShare()
        const vPoolBalanceBefore = await pool.balanceOf(feeCollector.address)

        // Mine some blocks
        await advanceBlock(30)
        await providerToken.exchangeRateCurrent()
        const pricePerShare2 = await pool.getPricePerShare()
        expect(pricePerShare2).to.be.gt(pricePerShare, 'PricePerShare should be higher after time travel')

        await pool.connect(user2).withdraw(await pool.balanceOf(user2.address))
        await providerToken.exchangeRateCurrent()

        let tokenLocked = await pool.tokenLocked()
        // Ideally this should be zero but we have 1 block earning of cToken
        const dust = DECIMAL.div(BN.from('100')) // Dust is less than 1e16
        expect(tokenLocked).to.be.lte(dust, 'Token locked should be zero')
        let totalSupply = await pool.totalSupply()
        expect(totalSupply).to.be.equal('0', 'Total supply should be zero')

        await pool.rebalance()
        await providerToken.exchangeRateCurrent()

        tokenLocked = await pool.tokenLocked()
        expect(tokenLocked).to.be.gt('0', 'Token locked should be greater than zero')
        totalSupply = await pool.totalSupply()
        expect(totalSupply).to.be.gt('0', 'Total supply should be greater than zero')

        const vPoolBalanceAfter = await pool.balanceOf(feeCollector.address)
        expect(vPoolBalanceAfter).to.be.gt(vPoolBalanceBefore, 'Fee collected is not correct')
        const tokensHere = await pool.tokensHere()
        expect(tokensHere).to.be.equal('0', 'Tokens here is not correct')
      })
    })

    describe(`${poolName}:: Updates via Controller`, function() {
      it('Should call withdraw() in strategy', async function() {
        await deposit(pool, collateralToken, 2, user4)
        await pool.rebalance()

        const vPoolBalanceBefore = await pool.balanceOf(user4.address)

        const totalSupply = await pool.totalSupply()
        const price = await pool.getPricePerShare()
        const withdrawAmount = totalSupply
          .mul(price)
          .div(DECIMAL)
          .toString()

        const target = strategy.address
        const methodSignature = 'withdraw(uint256)'
        const data = defaultAbiCoder.encode(['uint256'], [withdrawAmount])
        await controller.executeTransaction(target, 0, methodSignature, data)

        const vPoolBalance = await pool.balanceOf(user4.address)
        const collateralBalance = await collateralToken.balanceOf(pool.address)

        expect(collateralBalance).to.be.eq(withdrawAmount, `${collateralName} balance of pool is wrong`)
        expect(vPoolBalance).to.be.eq(vPoolBalanceBefore, `${poolName} balance of user is wrong`)
      })

      it('Should call withdrawAll() in strategy', async function() {
        await deposit(pool, collateralToken, 2, user3)
        await pool.rebalance()

        const totalLocked = await strategy.totalLocked()

        const target = strategy.address
        const methodSignature = 'withdrawAll()'
        const data = '0x'
        await controller.connect(owner).executeTransaction(target, 0, methodSignature, data)

        const tokensInPool = await pool.tokensHere()
        expect(tokensInPool).to.be.gte(totalLocked, 'TokensHere in pool is not correct')
      })

      it('Should rebalance after withdrawAll() and adding new strategy', async function() {
        await deposit(pool, collateralToken, 200, user3)
        await pool.rebalance()
        await advanceBlock(25)
        await providerToken.exchangeRateCurrent()
        const totalLockedBefore = await strategy.totalLocked()

        const target = strategy.address
        const methodSignature = 'withdrawAll()'
        const data = '0x'
        await controller.connect(owner).executeTransaction(target, 0, methodSignature, data)
        strategy = await deployContract(this.newStrategy, [controller.address, pool.address])
        
        // TODO create new setup method to deploy new strategy
        await approveToken(controller, strategy.address)
        await createKeeperList(controller, strategy.address)
        const keepers = await strategy.keepers()
        await addInList(controller, keepers, user1.address)

        await controller.updateStrategy(pool.address, strategy.address)
        await strategy.connect(user1).rebalance()

        const totalLockedAfter = await strategy.totalLocked()
        expect(totalLockedAfter).to.be.gte(totalLockedBefore, 'Total locked with new strategy is wrong')

        const withdrawAmount = await pool.balanceOf(user3.address)
        await pool.connect(user3).withdraw(withdrawAmount)

        const collateralBalance = convertTo18(await collateralToken.balanceOf(user3.address))
        expect(collateralBalance).to.be.gt(withdrawAmount, `${collateralName} balance of user is wrong`)
      })
    })

    describe(`${poolName}:: Strategy migration without withdrawAll()`, function() {
      it('Should migrate strategy', async function() {
        await controller.updateInterestFee(pool.address, '0')
        await deposit(pool, collateralToken, 20, user1)
        await pool.rebalance()
        const totalValueBefore = await pool.totalValue()
        // Migrate out
        let target = strategy.address
        let methodSignature = 'migrateOut()'
        let data = '0x'
        await controller.executeTransaction(target, 0, methodSignature, data)
        strategy = await deployContract(this.newStrategy, [controller.address, pool.address])

        await approveToken(controller, strategy.address)
        await createKeeperList(controller, strategy.address)
        const keepers = await strategy.keepers()
        await addInList(controller, keepers, user1.address)

        await controller.updateStrategy(pool.address, strategy.address)
        await strategy.connect(user1).rebalance()

        // Migrate in
        target = strategy.address
        methodSignature = 'migrateIn()'
        data = '0x'
        await controller.executeTransaction(target, 0, methodSignature, data)
        await strategy.connect(user1).rebalance()
        const totalValueAfter = await pool.totalValue()
        expect(totalValueAfter).to.be.gte(totalValueBefore, 'Total value of pool is wrong after migration')
        await deposit(pool, collateralToken, 20, user1)
        await strategy.connect(user1).rebalance()
      })
    })
  })
}

module.exports = {shouldBehaveLikeStrategy}
