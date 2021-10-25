'use strict'

const hre = require('hardhat')
const ethers = hre.ethers
const { deposit } = require('../utils/poolOps')
const { expect } = require('chai')
const { BigNumber: BN } = require('ethers')
const time = require('../utils/time')
const DECIMAL = BN.from('1000000000000000000')
const { deployContract, addInList, approveToken, createKeeperList, unlock } = require('../utils/setupHelper')

// Vesper V3 strategy behavior test suite
function shouldBehaveLikeStrategy(poolName, collateralName) {
  let pool, strategy, controller, collateralToken, collateralDecimal
  let owner, user1, user2, user3, user4
  let v3Pool, v3Keeper, v3Strategies

  const poolV3Address = '0xB4eDcEFd59750144882170FCc52ffeD40BfD5f7d'
  const v3PoolTokenWhale = '0x7E381e9ef102605f65A6c3614C023EBd5Fa1ab78'

  function convertTo18(amount) {
    const multiplier = DECIMAL.div(BN.from('10').pow(collateralDecimal))
    return BN.from(amount).mul(multiplier).toString()
  }

  const abiV3Strategy = [
    {
      inputs: [],
      name: 'rebalance',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function'
    }
  ]

  async function setupV3Strategies(vesperPool) {
    const strategyAddresses = await vesperPool.getStrategies()
    const strategies = []
    for (const address of strategyAddresses) {
      strategies.push(await ethers.getContractAt(abiV3Strategy, address))
    }
    return strategies
  }

  async function rebalanceV3Strategies() {
    const rebalanceTxs = []
    for (const v3Strategy of v3Strategies) {
      rebalanceTxs.push(await v3Strategy.connect(v3Keeper).rebalance())
    }
    return rebalanceTxs
  }

  describe(`${poolName}:: VesperV3Strategy basic tests`, function () {
    beforeEach(async function () {
      ;[owner, user1, user2, user3, user4] = await ethers.getSigners()
      pool = this.pool
      controller = this.controller
      strategy = this.strategy
      collateralToken = this.collateralToken
      // Decimal will be used for amount conversion
      collateralDecimal = await this.collateralToken.decimals()
      v3Keeper = this.v3Keeper
      v3Pool = this.v3Pool
      v3Strategies = await setupV3Strategies(v3Pool)
    })

    describe(`${poolName}:: V3 rebalance`, function () {
      it('Should increase pricePerShare on each V3 rebalance', async function () {
        await deposit(pool, collateralToken, 2, user4)
        await pool.rebalance()
        expect(await pool.getPricePerShare()).to.eq(ethers.utils.parseEther('1'), 'Incorrect pricePerShare')

        let pricePerShareBefore = await pool.getPricePerShare()
        await rebalanceV3Strategies()
        let pricePerShareAfter = await pool.getPricePerShare()
        expect(pricePerShareAfter).to.gt(pricePerShareBefore, 'PricePerShare should increase')
        pricePerShareBefore = pricePerShareAfter

        await rebalanceV3Strategies()
        pricePerShareAfter = await pool.getPricePerShare()
        expect(pricePerShareAfter).to.gt(pricePerShareBefore, 'PricePerShare should increase')
      })

      it('Should withdraw after V3 rebalance', async function () {
        await controller.updateInterestFee(pool.address, '0')
        await deposit(pool, collateralToken, 2, user4)
        await pool.rebalance()

        await rebalanceV3Strategies()

        const withdrawAmount = await pool.balanceOf(user4.address)
        await pool.connect(user4).withdraw(withdrawAmount)

        const vPoolBalance = await pool.balanceOf(user4.address)
        const collateralBalance = await collateralToken.balanceOf(user4.address)
        expect(collateralBalance).to.gte(withdrawAmount, `${collateralName} balance of pool is wrong`)
        expect(vPoolBalance).to.eq(0, `${poolName} balance of user is wrong`)
      })
    })

    describe(`${poolName}:: Migrate strategy`, function () {
      it('Should migrate to new strategy', async function () {
        await deposit(pool, collateralToken, 2, user2)
        await pool.rebalance()
        await rebalanceV3Strategies()

        let receiptTokenInStrategy = await v3Pool.balanceOf(strategy.address)
        expect(receiptTokenInStrategy).to.gt(0, 'receipt token balance should be > 0 in strategy')
        let receiptTokenInPool = await v3Pool.balanceOf(pool.address)
        expect(receiptTokenInPool).to.eq(0, 'receipt token balance should be = 0 in pool')

        let target = strategy.address
        let methodSignature = 'migrateOut()'
        let data = '0x'
        await controller.connect(owner).executeTransaction(target, 0, methodSignature, data)

        receiptTokenInStrategy = await v3Pool.balanceOf(strategy.address)
        expect(receiptTokenInStrategy).to.eq(0, 'receipt token balance should be = 0 in strategy')
        receiptTokenInPool = await v3Pool.balanceOf(pool.address)
        expect(receiptTokenInPool).to.gt(0, 'receipt token balance should be > 0 in pool')

        strategy = await deployContract(this.newStrategy, [controller.address, pool.address, poolV3Address])
        await approveToken(controller, strategy.address)
        await createKeeperList(controller, strategy.address)
        const keepers = await strategy.keepers()
        await addInList(controller, keepers, user1.address)
        await controller.updateStrategy(pool.address, strategy.address)

        target = strategy.address
        methodSignature = 'migrateIn()'
        data = '0x'
        await controller.connect(owner).executeTransaction(target, 0, methodSignature, data)

        receiptTokenInStrategy = await v3Pool.balanceOf(strategy.address)
        expect(receiptTokenInStrategy).to.gt(0, 'receipt token balance should be > 0 in strategy')
        receiptTokenInPool = await v3Pool.balanceOf(pool.address)
        expect(receiptTokenInPool).to.eq(0, 'receipt token balance should be = 0 in pool')
      })
    })

    describe(`${poolName}:: Large withdraw`, function () {
      it('Should withdraw large amount, pool withdraw from strategy', async function () {
        let collateralBalance = await collateralToken.balanceOf(v3PoolTokenWhale)
        expect(collateralBalance).to.eq(0, 'collateral balance should be = 0')
        let v3Balance = await v3Pool.balanceOf(v3PoolTokenWhale)
        expect(v3Balance).to.gt(0, 'V3 pool balance should be > 0')

        const v3WhaleSigner = await unlock(v3PoolTokenWhale)
        await hre.network.provider.send('hardhat_setBalance',
          [v3PoolTokenWhale, ethers.utils.parseEther('10').toHexString()])
        await v3Pool.connect(v3WhaleSigner).withdraw(v3Balance)

        collateralBalance = await collateralToken.balanceOf(v3PoolTokenWhale)
        expect(collateralBalance).to.gt(0, 'collateral balance should be > 0')
        v3Balance = await v3Pool.balanceOf(v3PoolTokenWhale)
        expect(v3Balance).to.eq(0, 'V3 pool balance of whale should be = 0')
      })
    })

    describe(`${poolName}:: Updates via Controller`, function () {
      it('Should call withdraw() in strategy', async function () {
        await controller.updateInterestFee(pool.address, '0')
        await deposit(pool, collateralToken, 2, user2)
        await pool.rebalance()

        const vPoolBalanceBefore = await pool.balanceOf(user2.address)
        const totalSupply = await pool.totalSupply()
        const price = await pool.getPricePerShare()
        const withdrawAmount = totalSupply.mul(price).div(DECIMAL).toString()

        const target = strategy.address
        const methodSignature = 'withdraw(uint256)'
        const data = ethers.utils.defaultAbiCoder.encode(['uint256'], [withdrawAmount])
        await controller.connect(this.accounts[0]).executeTransaction(target, 0, methodSignature, data)

        const vPoolBalance = await pool.balanceOf(user2.address)
        const collateralBalance = await collateralToken.balanceOf(pool.address)

        expect(collateralBalance).to.eq(withdrawAmount, `${collateralName} balance of pool is wrong`)
        expect(vPoolBalance).to.eq(vPoolBalanceBefore, `${poolName} balance of user is wrong`)
      })

      it('Should call withdrawAll() in strategy', async function () {
        await deposit(pool, collateralToken, 2, user3)
        await pool.rebalance()

        const totalLocked = await strategy.totalLocked()

        const target = strategy.address
        const methodSignature = 'withdrawAll()'
        const data = '0x'
        await controller.connect(owner).executeTransaction(target, 0, methodSignature, data)

        const tokensInPool = await pool.tokensHere()
        expect(tokensInPool).to.gte(totalLocked, 'TokensHere in pool is not correct')
      })

      it('Should rebalance after withdrawAll() and adding new strategy', async function () {
        await deposit(pool, collateralToken, 2, user3)
        await pool.rebalance()
        await rebalanceV3Strategies()

        time.increase(60 * 60)
        const totalLockedBefore = await strategy.totalLocked()

        const target = strategy.address
        const methodSignature = 'withdrawAll()'
        const data = '0x'
        await controller.connect(owner).executeTransaction(target, 0, methodSignature, data)

        strategy = await deployContract(this.newStrategy, [controller.address, pool.address, poolV3Address])
        await approveToken(controller, strategy.address)
        await createKeeperList(controller, strategy.address)
        const keepers = await strategy.keepers()
        await addInList(controller, keepers, user1.address)
        await controller.updateStrategy(pool.address, strategy.address)
        // Add new strategy in V3 fee white list
        await v3Pool.connect(v3Keeper).addInList(await v3Pool.feeWhitelist(), strategy.address)

        await strategy.connect(user1).rebalance()

        const totalLockedAfter = await strategy.totalLocked()
        expect(totalLockedAfter).to.gte(totalLockedBefore, 'Total locked with new strategy is wrong')

        const withdrawAmount = await pool.balanceOf(user3.address)
        await pool.connect(user3).withdraw(withdrawAmount)

        const collateralBalance = convertTo18(await collateralToken.balanceOf(user3.address))
        expect(collateralBalance).to.gt(withdrawAmount, `${collateralName} balance of user is wrong`)
      })
    })
  })
}

module.exports = { shouldBehaveLikeStrategy }
