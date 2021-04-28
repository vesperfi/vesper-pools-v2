'use strict'

const {ethers} = require('hardhat')
const {defaultAbiCoder} = ethers.utils
const {assert} = require('chai')
const {BigNumber: BN} = require('ethers')
const time = require('./utils/time')
const {deployContract} = require('./utils/setupHelper')
const TokenLike = 'TokenLikeTest'
const {approveToken, createKeeperList, addInList} = require('./utils/setupHelper')

const DECIMAL = BN.from('1000000000000000000')
const wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const TOTAL_REWARD = BN.from(150000).mul(DECIMAL)
describe('Reward in VETH Pool', function () {
  let veth, strategy, controller, vsp, poolRewards, accounts

  async function setupVPool() {
    accounts = await ethers.getSigners()
    vsp = await deployContract('VSP')
    controller = await deployContract('Controller')
    veth = await deployContract('VETH', [controller.address] )
    await controller.addPool(veth.address)
    poolRewards = await deployContract('PoolRewards',[veth.address, vsp.address, controller.address])
    strategy = await deployContract('AaveV2StrategyETH',[controller.address, veth.address])
    await Promise.all([
      controller.updateStrategy(veth.address, strategy.address),
      controller.updatePoolRewards(veth.address, poolRewards.address),
    ])

    await approveToken(controller, strategy.address)
    await createKeeperList(controller, strategy.address)
    const keepers = await strategy.keepers()
    await addInList(controller, keepers, accounts[0].address)
    await vsp.mint(poolRewards.address, TOTAL_REWARD)
    const methodSignature = 'notifyRewardAmount(uint256)'
    const data = defaultAbiCoder.encode(['uint256'], [TOTAL_REWARD.toString()])
    await controller.executeTransaction(poolRewards.address, 0, methodSignature, data)
  }

  describe('Basic function tests', function () {
    beforeEach(async function () {
      controller = await deployContract('Controller')
      await setupVPool()
      assert.isNotNull(veth.address)
    })

    it('Only controller should be able to distribute rewards', async function () {
      let thrown
      await vsp.mint(poolRewards.address, TOTAL_REWARD)
      try {
        await poolRewards.notifyRewardAmount(TOTAL_REWARD)
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Only controller should be able to distribute reward')
      thrown = false
      try {
        const methodSignature = 'notifyRewardAmount(uint256)'
        const data = defaultAbiCoder.encode(['uint256'], [TOTAL_REWARD.toString()])
        await controller.executeTransaction(poolRewards.address, 0, methodSignature, data)
      } catch (e) {
        thrown = true
      }
      assert(!thrown, 'Only controller should be able to distribute reward')
    })

    it('Ensure contract has balance before reward distribution starts', async function () {
      let thrown
      try {
        const methodSignature = 'notifyRewardAmount(uint256)'
        const data = defaultAbiCoder.encode(['uint256'], [TOTAL_REWARD.toString()])
        await controller.executeTransaction(poolRewards.address, 0, methodSignature, data)
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Should not allow to distribute reward without sufficient balance')
    })

    it('Should claim Rewards', async function () {
      const depositAmount = BN.from(10).mul(DECIMAL).toString()
      await veth.connect(accounts[0])['deposit()']({value: depositAmount})
      await time.increase(34 * 24 * 60 * 60)
      await strategy.rebalance()
      await poolRewards.claimReward(accounts[0].address)
      const claimable = await poolRewards.claimable(accounts[0].address)
      assert.equal(claimable, '0', 'Claimable balance after withdraw should be 0')
      await veth.withdrawETH(depositAmount)
      const reward = await vsp.balanceOf(accounts[0].address)
      // ensure result is within .01%
      assert(TOTAL_REWARD.sub(reward).lte(reward.div(BN.from(10000))), 'Should get correct reward')
    })

    it('Should claim Rewards of two rewards period', async function () {
      const depositAmount = BN.from(3).mul(DECIMAL)
      await veth.connect(accounts[0])['deposit()']({value: depositAmount})

      await veth.connect(accounts[1])['deposit()']({value: depositAmount})

      await time.increase(34 * 24 * 60 * 60)
      await strategy.rebalance()
      const user1Claimable = await poolRewards.claimable(accounts[0].address)
      assert(user1Claimable.gt(BN.from('0')), 'Claimable should be greater than zero')
      const user2Claimable = await poolRewards.claimable(accounts[1].address)
      assert(user2Claimable.gt(BN.from('0')), 'Claimable should be greater than zero')

      await vsp.mint(poolRewards.address, TOTAL_REWARD)
      const methodSignature = 'notifyRewardAmount(uint256)'
      const data = defaultAbiCoder.encode(['uint256'], [TOTAL_REWARD.toString()])
      await controller.executeTransaction(poolRewards.address, 0, methodSignature, data)
      await time.increase(34 * 24 * 60 * 60)

      const user1ClaimableAfter = await poolRewards.claimable(accounts[0].address)
      let totalClaimable = user1ClaimableAfter
      assert(user1ClaimableAfter.gt(user1Claimable), 'Claimable after should be greater')
      const user2ClaimableAfter = await poolRewards.claimable(accounts[1].address)
      totalClaimable = totalClaimable.add(user2ClaimableAfter)
      assert(user2ClaimableAfter.gt(user2Claimable), 'Claimable after should be greater')

      const totalDistributed = TOTAL_REWARD.mul(BN.from(2))
      // ensure result is within .01%
      assert(totalDistributed.sub(totalClaimable).lte(totalClaimable.div(BN.from(10000))), 'Should get correct reward')
    })

    it('Should withdraw and get all rewards', async function () {
      const depositAmount = BN.from(10).mul(DECIMAL).toString()
      await veth.connect(accounts[0])['deposit()']({value: depositAmount})
      await time.increase(34 * 24 * 60 * 60)
      await strategy.rebalance()
      await veth.withdrawETH(depositAmount)
      await poolRewards.claimReward(accounts[0].address)
      const claimable = await poolRewards.claimable(accounts[0].address)
      assert.equal(claimable, '0', 'Claimable balance after withdraw should be 0')
      const reward = await vsp.balanceOf(accounts[0].address)
      // ensure result is within .01%
      assert(TOTAL_REWARD.sub(reward).lte(reward.div(BN.from(10000))), 'Should get correct reward')
    })

    it('Should get all rewards when withdraw is called', async function () {
      const weth = await ethers.getContractAt(TokenLike, wethAddress)
      const amount = BN.from(3).mul(DECIMAL)
      await weth.deposit({value: amount})

      const depositAmount = (await weth.balanceOf(accounts[0].address)).toString()
      await weth.approve(veth.address, depositAmount)
      await veth.connect(accounts[0])['deposit()']({value: depositAmount})
      await time.increase(34 * 24 * 60 * 60)
      await strategy.rebalance()
      await veth.connect(accounts[0]).withdraw(depositAmount)
      await poolRewards.claimReward(accounts[0].address)
      const claimable = await poolRewards.claimable(accounts[0].address)
      assert.equal(claimable.toString(), '0', 'Claimable balance after withdraw should be 0')
      const reward = await vsp.balanceOf(accounts[0].address)
      // ensure result is within .01%
      assert(TOTAL_REWARD.sub(reward).lte(reward.div(BN.from(10000))), 'Should get correct reward')
    })

    it('Should be able to claim rewards before withdraw', async function () {
      const depositAmount = BN.from(10).mul(DECIMAL).toString()
      await veth.connect(accounts[0])['deposit()']({value: depositAmount})
      await time.increase(34 * 24 * 60 * 60)
      await strategy.rebalance()
      await poolRewards.claimReward(accounts[0].address)
      const claimable = await poolRewards.claimable(accounts[0].address)
      assert.equal(claimable, '0', 'Claimable balance after withdraw should be 0')
      await veth.withdrawETH(depositAmount)
      const vBalance = await veth.balanceOf(accounts[0].address)
      assert.equal(vBalance, '0', 'vToken balance after withdraw should be 0')
      await poolRewards.claimReward(accounts[0].address)
      const reward = await vsp.balanceOf(accounts[0].address)
      // ensure result is within .01%
      assert(TOTAL_REWARD.sub(reward).lte(reward.div(BN.from(10000))), 'Should get correct reward')
    })

    it('Should claim rewards- multiple users', async function () {
      const depositAmount = BN.from(10).mul(DECIMAL).toString()
      await veth.connect(accounts[0])['deposit()']({value: depositAmount})
      await veth.connect(accounts[1])['deposit()']({value: depositAmount})
      await strategy.rebalance()
      await time.increase(34 * 24 * 60 * 60)
      await veth.withdrawETH(depositAmount)
      await veth.connect(accounts[1]).withdrawETH(depositAmount)
      await poolRewards.claimReward(accounts[0].address)
      await poolRewards.connect(accounts[1]).claimReward(accounts[1].address)
      const vspBalance1 = await vsp.balanceOf(accounts[0].address)
      const vspBalance2 = await vsp.balanceOf(accounts[1].address)
      const totalGiven = BN.from(vspBalance1).add(BN.from(vspBalance2))
      // ensure result is within .01%
      assert(TOTAL_REWARD.sub(totalGiven).lte(totalGiven.div(BN.from(10000))), 'Total rewards is wrong') 
    })

    it('Should be able to withdraw rewards anytime', async function () {
      const depositAmount = BN.from(10).mul(DECIMAL).toString()
      await veth.connect(accounts[0])['deposit()']({value: depositAmount})
      await veth.connect(accounts[1])['deposit()']({value: depositAmount})
      await time.increase(34 * 24 * 60 * 60)
      await poolRewards.claimReward(accounts[0].address)
      await poolRewards.connect(accounts[1]).claimReward(accounts[1].address)
      const vspBalance1 = await vsp.balanceOf(accounts[0].address)
      const vspBalance2 = await vsp.balanceOf(accounts[1].address)
      assert(BN.from(vspBalance1).gt(BN.from(0)), 'rewards of user a is wrong')
      assert(BN.from(vspBalance2).gt(BN.from(0)), 'rewards of user b is wrong')
    })

    it('Should get proper rewards even after pool token transfer', async function () {
      const weth = await ethers.getContractAt('TokenLike',wethAddress)
      const amount = BN.from(3).mul(DECIMAL)
      await weth.deposit({value: amount})

      const depositAmount = (await weth.balanceOf(accounts[0].address)).toString()
      await weth.approve(veth.address, depositAmount)
      await veth.connect(accounts[0])['deposit()']({value: depositAmount})
      // Time travel
      await time.increase(3 * 24 * 60 * 60)
      await strategy.rebalance()
      let claimable = await poolRewards.claimable(accounts[0].address)
      assert(claimable.gt(BN.from('0')), 'Claimable should be greater than 0')
      claimable = await poolRewards.claimable(accounts[1].address)
      assert.equal(claimable.toString(), '0', 'Claimable should be 0')
      let vethBalance = await veth.balanceOf(accounts[0].address)
      await veth.transfer(accounts[1].address, vethBalance.div(BN.from(2)))
      // Time travel
      await time.increase(2 * 24 * 60 * 60)

      claimable = await poolRewards.claimable(accounts[0].address)
      assert(claimable.gt(BN.from('0')), 'Claimable should be greater than 0')
      claimable = await poolRewards.claimable(accounts[1].address)
      assert(claimable.gt(BN.from('0')), 'Claimable should be greater than 0')

      // Withdraw vETH and claim reward for account 1
      vethBalance = await veth.balanceOf(accounts[1].address)
      await veth.connect(accounts[1]).withdraw(vethBalance)
      await poolRewards.connect(accounts[1]).claimReward(accounts[1].address)

      claimable = await poolRewards.claimable(accounts[1].address)
      assert.equal(claimable.toString(), '0', 'Claimable should be 0')

      let reward = await vsp.balanceOf(accounts[1].address)
      assert(reward.gt(BN.from('0')), 'Reward balance should be greater than 0')

      // Withdraw vETH and claim reward for account 0
      vethBalance = await veth.balanceOf(accounts[0].address)
      await veth.withdraw(vethBalance)
      await poolRewards.claimReward(accounts[0].address)

      claimable = await poolRewards.claimable(accounts[0].address)
      assert.equal(claimable.toString(), '0', 'Claimable should be 0')

      reward = await vsp.balanceOf(accounts[0].address)
      assert(reward.gt(BN.from('0')), 'Reward balance should be greater than 0')
      const reward1 = await vsp.balanceOf(accounts[1].address)
      assert(reward.gt(reward1), 'Reward of account 0 should be higher')
    })
  })
})
