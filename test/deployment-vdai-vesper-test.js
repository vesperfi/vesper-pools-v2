'use strict'
const hre = require('hardhat')
const ethers = hre.ethers
const poolOps = require('./utils/poolOps')
const {advanceBlock, increase} = require('./utils/time')
const {expect} = require('chai')
const {adjustBalance} = require('./utils/balance')
const {unlock} = require('./utils/setupHelper')
const {defaultAbiCoder} = ethers.utils
const {BigNumber: BN} = require('ethers')
const DECIMAL18 = BN.from('1000000000000000000')
const ONE_MILLION = DECIMAL18.mul('1000000')
const vDAIv3PoolProxyAddress = '0xB4eDcEFd59750144882170FCc52ffeD40BfD5f7d'
const vDAIPoolAddress = '0xcA0c34A3F35520B9490C1d58b35A19AB64014D80'
const vDAIVesperStrategyAddress = '0x7E381e9ef102605f65A6c3614C023EBd5Fa1ab78'
const controllerAddress = '0xa4F1671d3Aee73C05b552d57f2d16d3cfcBd0217'
const botKeeperAddress = '0x76d266DFD3754f090488ae12F6Bd115cD7E77eBD'

describe('VDAI Pools (V2 <-> V3) integration tests', function () {
  // V2
  let pool, strategy, controller, collateralToken
  // V3
  let poolV3, strategiesV3, collateralTokenV3, botKeeperSigner
  // common
  let accounts, user1, user2

  async function deposit(amount, depositor) {
    return poolOps.deposit(pool, collateralToken, amount, depositor)
  }

  async function rebalanceAllV3Strategies() {
    for (const v3Strategy of strategiesV3) {
      const strategyMetadata = await poolV3.strategy(v3Strategy.instance.address)
      if (strategyMetadata._active) {
        await v3Strategy.instance.connect(botKeeperSigner).rebalance()
      }
    }
  }

  beforeEach(async function () {
    // Common setup
    accounts = await ethers.getSigners()
    ;[user1, user2] = accounts
    const amount = BN.from(10).mul(DECIMAL18)

    // Setup V2 DAI pool / Strategy
    pool = await ethers.getContractAt('VDAI', vDAIPoolAddress)
    strategy = await ethers.getContractAt('VesperV3StrategyDAI', vDAIVesperStrategyAddress)
    controller = await ethers.getContractAt('Controller', controllerAddress)
    const governorAddress = await controller.owner()
    const governorSigner = await unlock(governorAddress)
    await hre.network.provider.send('hardhat_setBalance', [governorAddress, amount.toHexString()])
    const keepers = await strategy.keepers()
    const methodSignature = 'add(address)'
    const data = defaultAbiCoder.encode(['address'], [user1.address])
    await controller.connect(governorSigner).executeTransaction(keepers, 0, methodSignature, data)
    const collateralTokenAddressV2 = await pool.token()
    collateralToken = await ethers.getContractAt('TokenLikeTest', collateralTokenAddressV2)

    // Setup V3 DAI pool / Strategies
    poolV3 = await ethers.getContractAt('IVesperPoolV3', vDAIv3PoolProxyAddress)
    
    const governorV3Address = '0x76d266DFD3754f090488ae12F6Bd115cD7E77eBD' // await poolV3.governor()
    botKeeperSigner = await unlock(botKeeperAddress)
    await hre.network.provider.send('hardhat_setBalance', [governorV3Address, amount.toHexString()])

    const interestFee = '1500' // 15%
    const _v3Strategies = await poolV3.getStrategies()
    strategiesV3 = []
    for (const _strategy of _v3Strategies) {
      const instance = await ethers.getContractAt('IStrategyV3', _strategy)
      const strat = {
        instance,
        name: _strategy,
        config: {interestFee, debtRatio: 9500, debtRate: ONE_MILLION},
      }
      const strategyTokenAddress = await instance.token()
      strat.token = await ethers.getContractAt('CToken', strategyTokenAddress)
      strategiesV3.push(strat)
    }
    const v3CollateralTokenAddress = await poolV3.token()
    collateralTokenV3 = await ethers.getContractAt('TokenLikeTest', v3CollateralTokenAddress)
  })

  afterEach(poolOps.reset)

  describe('vDAI2 deposit test', function () {
    it('Should transfer fund to V3 DAI pool on large deposit in V2 DAI pool', async function () {
      const v3PoolSupplyBefore = await poolV3.totalSupply()
      const v3PoolTotalValueBefore = await poolV3.totalValue()
      const depositAmount = await deposit(1000, user1)
      await strategy.rebalance()
      return Promise.all([poolV3.totalSupply(), poolV3.totalValue()]).then(function ([
        v3PoolSupplyAfter,
        v3PoolTotalValueAfter,
      ]) {
        expect(v3PoolSupplyAfter).to.be.gt(v3PoolSupplyBefore, 'Total supply is wrong')
        expect(v3PoolTotalValueAfter).to.be.gt(v3PoolTotalValueBefore, 'Total value is wrong')
        expect(v3PoolTotalValueAfter).to.be.equal(v3PoolTotalValueBefore.add(depositAmount), 'Total value is wrong')
      })
    })
  })

  describe('vDAI2 rebalance test', function () {
    it('Should earn interest in VDAI2 pool', async function () {
      const v2SharePriceBefore = await pool.getPricePerShare()
      const v3SharePriceBefore = await poolV3.pricePerShare()
      await deposit(100, user1)
      const user1PoolBalanceBefore = await pool.balanceOf(user1.address)
      await rebalanceAllV3Strategies()
      advanceBlock(100)
      return Promise.all([
        pool.getPricePerShare(),
        await pool.balanceOf(user1.address),
        await poolV3.pricePerShare(),
      ]).then(function ([v2SharePriceAfter, user1PoolBalanceAfter, v3SharePriceAfter]) {
        expect(user1PoolBalanceAfter).to.be.equal(user1PoolBalanceBefore, 'User1 pool balance is wrong')
        expect(v2SharePriceAfter).to.be.gt(v2SharePriceBefore, 'V2 pool price per share is wrong')
        expect(v3SharePriceAfter).to.be.gt(v3SharePriceBefore, 'V3 pool price per share is wrong')
      })
    })

    it('Should not affect small depositor on deposit by large depositors', async function () {
      // small deposit
      await deposit(1, user1)
      const v2SharePriceBefore = await pool.getPricePerShare()
      const v3SharePriceBefore = await poolV3.pricePerShare()
      const user1PoolBalanceBefore = await pool.balanceOf(user1.address)
      const totalUser1AmountBefore = v2SharePriceBefore.mul(user1PoolBalanceBefore)

      await increase(24 * 60 * 60 * 3) // 3 days
      await rebalanceAllV3Strategies()

      // large deposit
      await deposit(1000, user2)
      await strategy.rebalance()

      return Promise.all([
        pool.getPricePerShare(),
        await pool.balanceOf(user1.address),
        await poolV3.pricePerShare(),
      ]).then(function ([v2SharePriceAfter, user1PoolBalanceAfter, v3SharePriceAfter]) {
        const totalUser1AmountAfter = v2SharePriceAfter.mul(user1PoolBalanceAfter)
        expect(user1PoolBalanceAfter).to.be.equal(user1PoolBalanceBefore, 'User1 pool balance is wrong')
        expect(v2SharePriceAfter).to.be.gt(v2SharePriceBefore, 'V2 pool price per share is wrong')
        expect(v3SharePriceAfter).to.be.gt(v3SharePriceBefore, 'V3 pool price per share is wrong')
        expect(totalUser1AmountAfter).to.be.gt(totalUser1AmountBefore, 'User1 pool amount is wrong')
      })
    })
  })

  describe('vDAI2 withdraw test', function () {
    it('Should trigger vDAI3 withdraw on vDAI2 withdraw (both pool\'s buffers > 0)', async function () {
      // deposit DAI worth of 10 ETH in V2 pool
      await deposit(10, user2)
      const user2PoolBalance = await pool.balanceOf(user2.address)
      expect(user2PoolBalance).to.be.gt(0, 'Wrong user2 balance')
      await strategy.rebalance()

      // Set buffer collateral balance in V2 to 500 and v3 to 600 DAI which is < DAI deposited by user2.
      adjustBalance(collateralToken.address, pool.address, BN.from(500).mul(DECIMAL18))
      adjustBalance(collateralTokenV3.address, poolV3.address, BN.from(600).mul(DECIMAL18))
      const bufferInV2 = await collateralToken.balanceOf(pool.address)
      const bufferInV3 = await collateralTokenV3.balanceOf(poolV3.address)
      expect(bufferInV2).to.be.equal(BN.from(500).mul(DECIMAL18), 'Wrong V2 pool collateral token balance')
      expect(bufferInV3).to.be.equal(BN.from(600).mul(DECIMAL18), 'Wrong V3 pool collateral token balance')

      // withdraw full amount from V2 pool for user2
      await pool.connect(user2).withdraw(user2PoolBalance)
      return Promise.all([
        collateralToken.balanceOf(pool.address),
        collateralTokenV3.balanceOf(poolV3.address),
        await pool.balanceOf(user2.address),
      ]).then(function ([bufferInV2After, bufferInV3After, user2Balance]) {
        expect(bufferInV2After).to.be.equal(0, 'V2 pool buffer value is wrong')
        expect(bufferInV3After).to.be.equal(0, 'V3 pool buffer value is wrong')
        expect(user2Balance).to.be.equal(0, 'Failed to withdraw full amount')
      })
    })

    it('Should withdraw from vDAI2 when vDAI3 has 0 buffer.', async function () {
      // deposit DAI worth of 10 ETH in V2 pool
      await deposit(10, user2)
      const user2PoolBalance = await pool.balanceOf(user2.address)
      expect(user2PoolBalance).to.be.gt(0, 'Wrong user2 balance')
      await strategy.rebalance()

      // Set buffer collateral balance in V2 to 500 (< DAI deposited by user2) and v3 to 0 DAI.
      adjustBalance(collateralToken.address, pool.address, BN.from(500).mul(DECIMAL18))
      adjustBalance(collateralTokenV3.address, poolV3.address, BN.from(0))
      const bufferInV2 = await collateralToken.balanceOf(pool.address)
      const bufferInV3 = await collateralTokenV3.balanceOf(poolV3.address)
      expect(bufferInV2).to.be.equal(BN.from(500).mul(DECIMAL18), 'Wrong V2 pool collateral token balance')
      expect(bufferInV3).to.be.equal(0, 'Wrong V3 pool collateral token balance')

      // withdraw full amount from V2 pool for user2
      await pool.connect(user2).withdraw(user2PoolBalance)
      return Promise.all([
        collateralToken.balanceOf(pool.address),
        collateralTokenV3.balanceOf(poolV3.address),
        await pool.balanceOf(user2.address),
      ]).then(function ([bufferInV2After, bufferInV3After, user2Balance]) {
        expect(bufferInV2After).to.be.equal(0, 'V2 pool buffer value is wrong')
        expect(bufferInV3After).to.be.equal(0, 'V3 pool buffer value is wrong')
        expect(user2Balance).to.be.equal(0, 'Failed to withdraw full amount')
      })
    })

    it('Should withdraw from vDAI2 when vDAI2 and vDAI3 has 0 buffer.', async function () {
      // deposit DAI worth of 10 ETH in V2 pool
      await deposit(10, user2)
      const user2PoolBalance = await pool.balanceOf(user2.address)
      expect(user2PoolBalance).to.be.gt(0, 'Wrong user2 balance')
      await strategy.rebalance()

      // Set buffer collateral balance in V2 and v3 to 0 DAI.
      adjustBalance(collateralToken.address, pool.address, BN.from(0))
      adjustBalance(collateralTokenV3.address, poolV3.address, BN.from(0))
      const bufferInV2 = await collateralToken.balanceOf(pool.address)
      const bufferInV3 = await collateralTokenV3.balanceOf(poolV3.address)
      expect(bufferInV2).to.be.equal(0, 'Wrong V2 pool collateral token balance')
      expect(bufferInV3).to.be.equal(0, 'Wrong V3 pool collateral token balance')

      // withdraw full amount from V2 pool for user2
      await pool.connect(user2).withdraw(user2PoolBalance)
      return Promise.all([
        collateralToken.balanceOf(pool.address),
        collateralTokenV3.balanceOf(poolV3.address),
        await pool.balanceOf(user2.address),
      ]).then(function ([bufferInV2After, bufferInV3After, user2Balance]) {
        expect(bufferInV2After).to.be.equal(0, 'V2 pool buffer value is wrong')
        expect(bufferInV3After).to.be.equal(0, 'V3 pool buffer value is wrong')
        expect(user2Balance).to.be.equal(0, 'Failed to withdraw full amount')
      })
    })

    it('Should not affect small depositor on withdraw by large depositors', async function () {
      // small deposit
      await deposit(1, user1)
      const v2SharePriceBefore = await pool.getPricePerShare()
      const v3SharePriceBefore = await poolV3.pricePerShare()
      const user1PoolBalanceBefore = await pool.balanceOf(user1.address)
      const totalUser1AmountBefore = v2SharePriceBefore.mul(user1PoolBalanceBefore)

      await increase(24 * 60 * 60 * 3) // 3 days
      await rebalanceAllV3Strategies()

      // large deposit
      await deposit(1000, user2)
      await rebalanceAllV3Strategies()

      // full amount withdraw by large depositor
      const user2PoolBalanceAfter = await pool.balanceOf(user2.address)
      await pool.connect(user2).withdraw(user2PoolBalanceAfter)

      return Promise.all([
        pool.getPricePerShare(),
        await pool.balanceOf(user1.address),
        await poolV3.pricePerShare(),
      ]).then(function ([v2SharePriceAfter, user1PoolBalanceAfter, v3SharePriceAfter]) {
        const totalUser1AmountAfter = v2SharePriceAfter.mul(user1PoolBalanceAfter)
        expect(user1PoolBalanceAfter).to.be.equal(user1PoolBalanceBefore, 'User1 pool balance is wrong')
        expect(v2SharePriceAfter).to.be.gt(v2SharePriceBefore, 'V2 pool price per share is wrong')
        expect(v3SharePriceAfter).to.be.gt(v3SharePriceBefore, 'V3 pool price per share is wrong')
        expect(totalUser1AmountAfter).to.be.gt(totalUser1AmountBefore, 'User1 pool amount is wrong')
      })
    })
  })

  describe('vDAI3 strategy rebalance tests', function () {
    it('Should increase share price of vDAI2 on rebalance on vDAI3', async function () {
      const v2SharePriceBefore = await pool.getPricePerShare()
      const v3SharePriceBefore = await poolV3.pricePerShare()
      await deposit(1000, user1)
      await rebalanceAllV3Strategies()
      return Promise.all([pool.getPricePerShare(), poolV3.pricePerShare()]).then(function ([
        v2SharePriceAfter,
        v3SharePriceAfter,
      ]) {
        expect(v2SharePriceAfter).to.be.gt(v2SharePriceBefore, 'V2 pool price per share is wrong')
        expect(v3SharePriceAfter).to.be.gt(v3SharePriceBefore, 'V3 pool price per share is wrong')
      })
    })
  })
})
