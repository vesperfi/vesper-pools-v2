'use strict'

const swapper = require('../utils/tokenSwapper')
const {ethers} = require('hardhat')
const {defaultAbiCoder} = ethers.utils
const {deposit} = require('../utils/poolOps')
const {addInList, approveToken, createKeeperList, deployContract} = require('../utils/setupHelper')
const {expect} = require('chai')
const time = require('../utils/time')
const {BigNumber: BN} = require('ethers')
const {updateBalancingFactor} = require('../utils/setupHelper')
const DECIMAL = BN.from('1000000000000000000')
const WAT = BN.from('10000000000000000')
const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f'
const MAX_UINT256 = BN.from('2').pow(BN.from('256')).sub(BN.from('1'))

function shouldBehaveLikeStrategy(poolName, collateralName) {
  let pool, cm, strategy, controller, vaultNum, strategyType
  let collateralToken, collateralDecimal, providerToken, feeCollector
  let owner, user1, user2, user3, user4

  function convertTo18(amount) {
    const multiplier = DECIMAL.div(BN.from('10').pow(collateralDecimal))
    return BN.from(amount).mul(multiplier).toString()
  }

  function convertFrom18(amount) {
    const divisor = DECIMAL.div(BN.from('10').pow(collateralDecimal))
    return BN.from(amount).div(divisor).toString()
  }

  async function executeIfExist(fn) {
    if (typeof fn === 'function') {
      await fn()
    }
  }

  async function timeTravel() {
    const timeTravelFn = () => time.increase(6 * 60 * 60)
    const blockMineFn = async () => time.advanceBlockTo((await time.latestBlock()).add(BN.from(100)))

    return strategyType.includes('compound') ? blockMineFn() : timeTravelFn()
  }

  describe(`${poolName}:: MakerStrategy basic tests`, function () {
    beforeEach(async function () {

      [owner, user1, user2, user3, user4] = await ethers.getSigners()
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
      collateralDecimal = await this.collateralToken.decimals()
    })

    it('Should sweep erc20 from strategy', async function () {
      const metAddress = '0xa3d58c4e56fedcae3a7c43a725aee9a71f0ece4e'
      const token = await ethers.getContractAt('ERC20', metAddress)
      const tokenBalance = await swapper.swapEthForToken(1, metAddress, user4, strategy.address)
      await strategy.sweepErc20(metAddress)

      const totalSupply = await pool.totalSupply()
      const metBalanceInPool = await token.balanceOf(pool.address)
      expect(totalSupply).to.be.equal('0', `Total supply of ${poolName} is wrong`)
      expect(metBalanceInPool).to.be.equal(tokenBalance, 'ERC20 token balance is wrong')
    })

    describe(`${poolName}:: Withdraw scenario`, function () {
      let depositAmount     
      beforeEach(async function () {
        depositAmount = await deposit(pool, collateralToken, 80, user1)
      })
      it('Should payout debt if withdraw leaves dust in vault', async function () {
        const withdrawAmount = (await pool.balanceOf(user1.address)).sub(BN.from(100)).toString()
        await pool.rebalance()
        await executeIfExist(providerToken.exchangeRateCurrent)
        await executeIfExist(providerToken.rebalance)
        await pool.connect(user1).withdraw(withdrawAmount)
        const vaultInfo = await cm.getVaultInfo(vaultNum)
        const balance = await collateralToken.balanceOf(user1.address)
        expect(balance).to.be.equal(convertFrom18(withdrawAmount), `${collateralName} balance is wrong`)
        expect(vaultInfo.daiDebt).to.be.equal('0', 'Dai debt should be zero')
      })

      it('Should verify that rebalance in low water decreases debt', async function () {
        const depositAmount18 = convertTo18(depositAmount)
        await strategy.rebalanceCollateral()
        const vaultInfoBefore = await cm.getVaultInfo(vaultNum)
        const collateralRatio = vaultInfoBefore.collateralRatio
        // Increase collateral ratio
        const newLowWater = BN.from(collateralRatio).div(WAT).add(BN.from('500')).toString()
        const newHighWater = BN.from(collateralRatio).div(WAT).add(BN.from('600')).toString()
        await updateBalancingFactor(controller, strategy.address, [newHighWater, newLowWater])

        await strategy.rebalanceCollateral()
        return Promise.all([
          pool.totalSupply(),
          pool.totalValue(),
          pool.balanceOf(user1.address),
          cm.getVaultInfo(vaultNum),
          strategy.highWater(),
        ]).then(function ([totalSupply, totalValue, vPoolBalance, vaultInfo, highWater]) {
          expect(totalSupply).to.be.equal(depositAmount18, `Total supply of ${poolName} is wrong`)
          expect(totalValue).to.be.equal(depositAmount, `Total value of ${poolName} is wrong`)
          expect(vPoolBalance).to.be.equal(depositAmount18, `${poolName} balance of user is wrong`)
          expect(vaultInfo.collateralLocked).to.be.eq(depositAmount18, 'Collateral locked in vault is wrong')
          expect(vaultInfo.collateralRatio).to.be.eq(highWater, 'Collateral ratio is wrong')
          expect(vaultInfo.daiDebt).to.be.lt(vaultInfoBefore.daiDebt, 'Dai debt should decrease')
        })
      })

      it('Should withdraw when below low water', async function () {
        await strategy.rebalanceCollateral()
        const vaultInfoBefore = await cm.getVaultInfo(vaultNum)
        const collateralRatio = vaultInfoBefore.collateralRatio

        // Increase collateral ratio to achieve low water
        const newLowWater = BN.from(collateralRatio).div(WAT).add(BN.from('500')).toString()
        const newHighWater = BN.from(collateralRatio).div(WAT).add(BN.from('600')).toString()
        await updateBalancingFactor(controller, strategy.address, [newHighWater, newLowWater])
        const collateralBalanceBefore = await collateralToken.balanceOf(user1.address)

        const withdrawAmount = (await pool.balanceOf(user1.address)).div(BN.from(10))
        await pool.connect(user1).withdraw(withdrawAmount)
        return Promise.all([strategy.highWater(), cm.getVaultInfo(vaultNum),
           collateralToken.balanceOf(user1.address)]).then(
          function ([highWater, vaultInfo, collateralBalance]) {
            expect(vaultInfo.daiDebt).to.be.lt(vaultInfoBefore.daiDebt, 'Dai debt should decrease')
            expect(collateralBalance).to.be.gt(collateralBalanceBefore, `${collateralName} balance is wrong`)
            if (vaultInfo.daiDebt.eq(BN.from('0'))) {
              expect(vaultInfo.collateralRatio).to.be.eq(MAX_UINT256, 'Collateral ratio is wrong')
            } else {
              expect(vaultInfo.collateralRatio).to.be.eq(highWater, 'Collateral ratio is wrong')
            }
          }
        )
      })

      it('Should withdraw when above low water', async function () {
        await strategy.rebalanceCollateral()
        const collateralBalanceBefore = await collateralToken.balanceOf(user1.address)
        const withdrawAmount = (await pool.balanceOf(user1.address)).div(BN.from(10))
        await pool.connect(user1).withdraw(withdrawAmount)
        return Promise.all([
          strategy.lowWater(),
          strategy.highWater(),
          cm.getVaultInfo(vaultNum),
          collateralToken.balanceOf(user1.address),
        ]).then(function ([lowWater, highWater, vaultInfo, collateralBalance]) {
          expect(vaultInfo.collateralRatio).to.be.gt(lowWater, 'Collateral ratio should be > low water')
          expect(vaultInfo.collateralRatio).to.be.lt(highWater, 'Collateral ratio should be < high water')
          expect(collateralBalance).to.be.gt(collateralBalanceBefore, `${collateralName} balance is wrong`)
        })
      })
    })

    describe(`${poolName}:: RebalanceCollateral in MakerStrategy`, function () {
      it('Should bring collateralRatio equal to highWater', async function () {
        await deposit(pool, collateralToken, 100, user2)
        const highWater = await strategy.highWater()
        await strategy.rebalanceCollateral()
        const vaultInfo = await cm.getVaultInfo(vaultNum)
        expect(vaultInfo.collateralRatio).to.be.eq(highWater, 'Collateral ratio is not balanced')
      })
    })

    describe(`${poolName}:: RebalanceEarn in MakerStrategy`, function () {
      beforeEach(async function () {
        await deposit(pool, collateralToken, 100, user2)
      })
      it(`Should increase ${collateralName} token in pool and earn fee`, async function () {
        await pool.rebalance()
        const tokensHere = await pool.tokensHere()
        const vPoolBalanceFcBefore = await pool.balanceOf(feeCollector.address)

        // Time travel trigger some earning
        await timeTravel()
        await executeIfExist(providerToken.exchangeRateCurrent)
        await executeIfExist(providerToken.rebalance)
        await strategy.rebalanceEarned()

        const vPoolBalanceFcAfter = await pool.balanceOf(feeCollector.address)
        expect(vPoolBalanceFcAfter).to.be.gt(vPoolBalanceFcBefore, 'Fee collected is not correct')

        const tokensHereAfter = await pool.tokensHere()
        expect(tokensHereAfter).to.be.gt(tokensHere, `${collateralName} token in pool should increase`)
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

        const vPoolBalanceFC = await pool.balanceOf(feeCollector.address)
        expect(vPoolBalanceFC.toString()).to.eq('0', 'Collected fee should be zero')

        const tokensHereAfter = await pool.tokensHere()
        expect(tokensHereAfter).to.be.gt(tokensHere, `${collateralName} token in pool should increase`)
      })

      it('Should fail silently when calling rebalanceEarned with a small amount of DAI present', async function () {
        // swap ETH for DAI
        // Note, this function does the BN conversion for you, so 1 = 1 ETH
        await swapper.swapEthForToken(1, DAI, user1)
        // Deposit 1 Wei DAI
        const dai = await ethers.getContractAt('ERC20',DAI)
        dai.connect(user1).transfer(strategy.address, '1')
        // call rebalanceEarned and expect the dust to still be there
        await strategy.rebalanceEarned()
        expect(await dai.balanceOf(strategy.address)).to.be.equal('1', 'Dai balance is wrong')
      })
    })

    describe(`${poolName}:: Rebalance in MakerStrategy`, function () {
      it('Should not fail even if borrow/debt is below maker dust limit', async function () {
        await deposit(pool, collateralToken, 1, user1)
        const dust = BN.from(100)
        // Leave small amount and withdraw rest, so that we can generate debt less than dust
        const withdrawAmount = (await pool.balanceOf(user1.address)).sub(dust)
        await pool.connect(user1).withdraw(withdrawAmount)

        await pool.rebalance()
        let vaultInfo = await cm.getVaultInfo(vaultNum)
        expect(vaultInfo.daiDebt).to.be.equal('0', 'Dai debt is wrong')
        await pool.connect(user1).withdraw(dust)
        vaultInfo = await cm.getVaultInfo(vaultNum)
        expect(vaultInfo.daiDebt).to.be.equal('0', 'Dai debt is wrong')
        expect(vaultInfo.collateralLocked).to.be.equal('0', 'Collateral lock is wrong')
      })

      it('Should calculate interestEarned correctly', async function () {
        await controller.updateInterestFee(pool.address, '0')
        await deposit(pool, collateralToken, 100, user2)
        await pool.rebalance()
        let interestEarned = await strategy.interestEarned()
        expect(interestEarned).to.be.equal('0', 'Interest earned should be zero')

        const totalValue1 = await pool.totalValue()
        // Time travel
        await time.increase(6 * 60 * 60)
        interestEarned = await strategy.interestEarned()
        await pool.rebalance()
        const totalValue2 = await pool.totalValue()

        const actualInterestEarned = totalValue2.sub(totalValue1)
        expect(actualInterestEarned).to.be.gte(interestEarned, 'Actual interest earned is not correct')
      })
    })

    describe(`${poolName}:: Updates via Controller`, function () {
      it('Should call withdraw() in strategy', async function () {
        await deposit(pool, collateralToken, 100, user4)
        await pool.rebalance()
        await executeIfExist(providerToken.exchangeRateCurrent)
        await executeIfExist(providerToken.rebalance)
        const vPoolBalanceBefore = await pool.balanceOf(user4.address)

        const totalSupply = await pool.totalSupply()
        const price = await pool.getPricePerShare()
        const withdrawAmount = totalSupply.mul(price).div(DECIMAL).toString()

        const target = strategy.address
        const methodSignature = 'withdraw(uint256)'
        const data = defaultAbiCoder.encode(['uint256'], [withdrawAmount])
        await controller.connect(owner).executeTransaction(target, 0, methodSignature, data)

        const vPoolBalance = await pool.balanceOf(user4.address)
        const collateralBalance = await collateralToken.balanceOf(pool.address)

        expect(collateralBalance).to.be.eq(withdrawAmount, `${collateralName} balance of pool is wrong`)
        expect(vPoolBalance).to.be.eq(vPoolBalanceBefore, `${poolName} balance of user is wrong`)
      })

      it('Should call withdrawAll() in strategy', async function () {
        await deposit(pool, collateralToken, 100, user3)
        await pool.rebalance()

        const totalLocked = await strategy.totalLocked()
        const vInfo = await cm.getVaultInfo(vaultNum)
        expect(vInfo.daiDebt).to.be.gte('0', 'Dai debt is wrong')
        await executeIfExist(providerToken.exchangeRateCurrent)
        await executeIfExist(providerToken.rebalance)
        const target = strategy.address
        const methodSignature = 'withdrawAll()'
        const data = '0x'
        await controller.connect(owner).executeTransaction(target, 0, methodSignature, data)

        const vInfo2 = await cm.getVaultInfo(vaultNum)
        expect(vInfo2.collateralLocked).to.be.equal('0', 'Collateral locked is wrong')
        expect(vInfo2.daiDebt).to.be.equal('0', 'Dai debt is wrong')
        expect(vInfo2.collateralRatio).to.be.equal('0', 'Collateral ratio is wrong')

        const tokensInPool = await pool.tokensHere()
        expect(tokensInPool).to.be.equal(totalLocked, 'TokensHere in pool is not correct')
      })

      it('Should call withdrawAllWithRebalance() in strategy', async function () {
        await deposit(pool, collateralToken, 80, user3)
        await pool.rebalance()
        // Time travel 6 hours for some earning
        await timeTravel()
        await executeIfExist(providerToken.exchangeRateCurrent)
        await executeIfExist(providerToken.rebalance)
        const totalLocked = await strategy.totalLocked()

        const target = strategy.address
        const methodSignature = 'withdrawAllWithRebalance()'
        const data = '0x'
        await controller.connect(owner).executeTransaction(target, 0, methodSignature, data)

        const tokensInPool = await pool.tokensHere()
        // Withdraw all will do rebalanceEarned too, which can increase locked
        expect(tokensInPool).to.be.gte(totalLocked, 'TokensHere in pool is not correct')
      })

      it('Should rebalance after withdrawAll() and adding AaveStrategy', async function () {
        await deposit(pool, collateralToken, 100, user3)
        await pool.rebalance()
        // Time travel 12 hours
        await timeTravel()
        await executeIfExist(providerToken.exchangeRateCurrent)
        await executeIfExist(providerToken.rebalance)
        const lockedWithMaker = await strategy.totalLocked()

        const target = strategy.address
        const methodSignature = 'withdrawAll()'
        const data = '0x'
        await controller.connect(owner).executeTransaction(target, 0, methodSignature, data)

        strategy = await deployContract(this.newStrategy, [controller.address, pool.address])
        await controller.updateStrategy(pool.address, strategy.address)
        await approveToken(controller, strategy.address)
        await createKeeperList(controller, strategy.address)
        const keepers = await strategy.keepers()
        await addInList(controller, keepers, user1.address)
        await strategy.connect(user1).rebalance()

        const lockedWithAave = await strategy.totalLocked()
        expect(lockedWithAave).to.be.equal(lockedWithMaker, 'Total locked with direct Aave is wrong')
      })
    })
  })
}

module.exports = {shouldBehaveLikeStrategy}
