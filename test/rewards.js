'use strict'

const {assert} = require('chai')
const BN = require('bn.js')
const timeMachine = require('ganache-time-traveler')
const PoolRewards = artifacts.require('PoolRewards')
const VETH = artifacts.require('VETH')
const VSP = artifacts.require('VSP')
const AaveStrategy = artifacts.require('AaveStrategyETH')
const Controller = artifacts.require('Controller')
const TokenLike = artifacts.require('TokenLike')

const DECIMAL = new BN('1000000000000000000')
const wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const TOTAL_REWARD = new BN(150000).mul(DECIMAL)
contract('Reward in VETH Pool', function (accounts) {
  let veth, strategy, controller, vsp, poolRewards

  async function setupVPool() {
    vsp = await VSP.new()
    controller = await Controller.new()
    veth = await VETH.new(controller.address)
    await controller.addPool(veth.address)
    poolRewards = await PoolRewards.new(veth.address, vsp.address, controller.address)
    strategy = await AaveStrategy.new(controller.address, veth.address)
    await Promise.all([
      controller.updateStrategy(veth.address, strategy.address),
      controller.updatePoolRewards(veth.address, poolRewards.address),
    ])

    await vsp.mint(poolRewards.address, TOTAL_REWARD)
    const methodSignature = 'notifyRewardAmount(uint256)'
    const data = web3.eth.abi.encodeParameters(['uint256'], [TOTAL_REWARD.toString()])
    await controller.executeTransaction(poolRewards.address, 0, methodSignature, data, {
      from: accounts[0],
    })
  }
  
  describe('Basic function tests', function () {
    beforeEach(async function () {
      controller = await Controller.new()
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
        const data = web3.eth.abi.encodeParameters(['uint256'], [TOTAL_REWARD.toString()])
        await controller.executeTransaction(poolRewards.address, 0, methodSignature, data, {
          from: accounts[0],
        })
      } catch (e) {
        thrown = true
      }
      assert(!thrown, 'Only controller should be able to distribute reward')
    })

    it('Ensure contract has balance before reward distribution starts', async function () {
      let thrown
      try {
        const methodSignature = 'notifyRewardAmount(uint256)'
        const data = web3.eth.abi.encodeParameters(['uint256'], [TOTAL_REWARD.toString()])
        await controller.executeTransaction(poolRewards.address, 0, methodSignature, data, {
          from: accounts[0],
        })
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Should not allow to distribute reward without sufficient balance')
    })

    it('Should claim Rewards', async function () {
      const depositAmount = new BN(10).mul(DECIMAL).toString()
      await veth.methods['deposit()']({value: depositAmount})
      await timeMachine.advanceTimeAndBlock(34 * 24 * 60 * 60)
      await veth.rebalance()
      await poolRewards.claimReward(accounts[0], {from: accounts[0]})
      const claimable = await poolRewards.claimable(accounts[0])
      assert.equal(claimable, '0', 'Claimable balance after withdraw should be 0')
      await veth.withdrawETH(depositAmount, {from: accounts[0]})
      const reward = await vsp.balanceOf(accounts[0])
      // ensure result is within .01%
      assert(TOTAL_REWARD.sub(reward).lte(reward.div(new BN(10000))), 'Should get correct reward')
    })

    it('Should claim Rewards of two rewards period', async function () {
      const depositAmount = new BN(3).mul(DECIMAL)
      await veth.methods['deposit()']({value: depositAmount})

      await veth.methods['deposit()']({value: depositAmount, from: accounts[1]})

      await timeMachine.advanceTimeAndBlock(34 * 24 * 60 * 60)
      await veth.rebalance()
      const user1Claimable = await poolRewards.claimable(accounts[0])
      assert(user1Claimable.gt(new BN('0')), 'Claimable should be greater than zero')
      const user2Claimable = await poolRewards.claimable(accounts[1])
      assert(user2Claimable.gt(new BN('0')), 'Claimable should be greater than zero')

      await vsp.mint(poolRewards.address, TOTAL_REWARD)
      const methodSignature = 'notifyRewardAmount(uint256)'
      const data = web3.eth.abi.encodeParameters(['uint256'], [TOTAL_REWARD.toString()])
      await controller.executeTransaction(poolRewards.address, 0, methodSignature, data, {
        from: accounts[0],
      })
      await timeMachine.advanceTimeAndBlock(34 * 24 * 60 * 60)

      const user1ClaimableAfter = await poolRewards.claimable(accounts[0])
      let totalClaimable = user1ClaimableAfter
      assert(user1ClaimableAfter.gt(user1Claimable), 'Claimable after should be greater')
      const user2ClaimableAfter = await poolRewards.claimable(accounts[1])
      totalClaimable = totalClaimable.add(user2ClaimableAfter)
      assert(user2ClaimableAfter.gt(user2Claimable), 'Claimable after should be greater')

      const totalDistributed = TOTAL_REWARD.mul(new BN(2))
      // ensure result is within .01%
      assert(
        totalDistributed.sub(totalClaimable).lte(totalClaimable.div(new BN(10000))),
        'Should get correct reward'
      )
    })

    it('Should withdraw and get all rewards', async function () {
      const depositAmount = new BN(10).mul(DECIMAL).toString()
      await veth.methods['deposit()']({value: depositAmount})
      await timeMachine.advanceTimeAndBlock(34 * 24 * 60 * 60)
      await veth.rebalance()
      await veth.withdrawETH(depositAmount, {from: accounts[0]})
      await poolRewards.claimReward(accounts[0], {from: accounts[0]})
      const claimable = await poolRewards.claimable(accounts[0])
      assert.equal(claimable, '0', 'Claimable balance after withdraw should be 0')
      const reward = await vsp.balanceOf(accounts[0])
      // ensure result is within .01%
      assert(TOTAL_REWARD.sub(reward).lte(reward.div(new BN(10000))), 'Should get correct reward')
    })

    it('Should get all rewards when withdraw is called', async function () {
      const weth = await TokenLike.at(wethAddress)
      const amount = new BN(3).mul(DECIMAL)
      await weth.deposit({value: amount})

      const depositAmount = (await weth.balanceOf(accounts[0])).toString()
      await weth.approve(veth.address, depositAmount, {from: accounts[0]})
      await veth.deposit(depositAmount)
      await timeMachine.advanceTimeAndBlock(34 * 24 * 60 * 60)
      await veth.rebalance()
      await veth.withdraw(depositAmount, {from: accounts[0]})
      await poolRewards.claimReward(accounts[0], {from: accounts[0]})
      const claimable = await poolRewards.claimable(accounts[0])
      assert.equal(claimable.toString(), '0', 'Claimable balance after withdraw should be 0')
      const reward = await vsp.balanceOf(accounts[0])
      // ensure result is within .01%
      assert(TOTAL_REWARD.sub(reward).lte(reward.div(new BN(10000))), 'Should get correct reward')
    })

    it('Should be able to claim rewards before withdraw', async function () {
      const depositAmount = new BN(10).mul(DECIMAL).toString()
      await veth.methods['deposit()']({value: depositAmount})
      await timeMachine.advanceTimeAndBlock(34 * 24 * 60 * 60)
      await veth.rebalance()
      await poolRewards.claimReward(accounts[0], {from: accounts[0]})
      const claimable = await poolRewards.claimable(accounts[0])
      assert.equal(claimable, '0', 'Claimable balance after withdraw should be 0')
      await veth.withdrawETH(depositAmount, {from: accounts[0]})
      const vBalance = await veth.balanceOf(accounts[0])
      assert.equal(vBalance, '0', 'vToken balance after withdraw should be 0')
      await poolRewards.claimReward(accounts[0], {from: accounts[0]})
      const reward = await vsp.balanceOf(accounts[0])
      // ensure result is within .01%
      assert(TOTAL_REWARD.sub(reward).lte(reward.div(new BN(10000))), 'Should get correct reward')
    })

    it('Should claim rewards- multiple users', async function () {
      const depositAmount = new BN(10).mul(DECIMAL).toString()
      await veth.methods['deposit()']({value: depositAmount})
      await veth.methods['deposit()']({value: depositAmount, from: accounts[1]})
      await veth.rebalance()
      await timeMachine.advanceTimeAndBlock(34 * 24 * 60 * 60)
      await veth.withdrawETH(depositAmount, {from: accounts[0]})
      await veth.withdrawETH(depositAmount, {from: accounts[1]})
      await poolRewards.claimReward(accounts[0], {from: accounts[0]})
      await poolRewards.claimReward(accounts[1], {from: accounts[1]})
      const vspBalance1 = await vsp.balanceOf(accounts[0])
      const vspBalance2 = await vsp.balanceOf(accounts[1])
      const totalGiven = new BN(vspBalance1).add(new BN(vspBalance2))
      assert(
        TOTAL_REWARD.sub(totalGiven).lte(totalGiven.div(new BN(10000))),
        'Total rewards is wrong'
      ) // ensure result is within .01%
    })

    it('Should be able to withdraw rewards anytime', async function () {
      const depositAmount = new BN(10).mul(DECIMAL).toString()
      await veth.methods['deposit()']({value: depositAmount})
      await veth.methods['deposit()']({value: depositAmount, from: accounts[1]})
      await timeMachine.advanceTimeAndBlock(34 * 24 * 60 * 60)
      await poolRewards.claimReward(accounts[0], {from: accounts[0]})
      await poolRewards.claimReward(accounts[1], {from: accounts[1]})
      const vspBalance1 = await vsp.balanceOf(accounts[0])
      const vspBalance2 = await vsp.balanceOf(accounts[1])
      assert(new BN(vspBalance1).gt(new BN(0)), 'rewards of user a is wrong')
      assert(new BN(vspBalance2).gt(new BN(0)), 'rewards of user b is wrong')
    })

    it('Should get proper rewards even after pool token transfer', async function () {
      const weth = await TokenLike.at(wethAddress)
      const amount = new BN(3).mul(DECIMAL)
      await weth.deposit({value: amount})

      const depositAmount = (await weth.balanceOf(accounts[0])).toString()
      await weth.approve(veth.address, depositAmount, {from: accounts[0]})
      await veth.deposit(depositAmount)
      // Time travel
      await timeMachine.advanceTimeAndBlock(3 * 24 * 60 * 60)
      await veth.rebalance()
      let claimable = await poolRewards.claimable(accounts[0])
      assert(claimable.gt(new BN('0')), 'Claimable should be greater than 0')
      claimable = await poolRewards.claimable(accounts[1])
      assert.equal(claimable.toString(), '0', 'Claimable should be 0')
      let vethBalance = await veth.balanceOf(accounts[0])
      await veth.transfer(accounts[1], vethBalance.div(new BN(2)), {from: accounts[0]})
      // Time travel
      await timeMachine.advanceTimeAndBlock(2 * 24 * 60 * 60)

      claimable = await poolRewards.claimable(accounts[0])
      assert(claimable.gt(new BN('0')), 'Claimable should be greater than 0')
      claimable = await poolRewards.claimable(accounts[1])
      assert(claimable.gt(new BN('0')), 'Claimable should be greater than 0')

      // Withdraw vETH and claim reward for account 1
      vethBalance = await veth.balanceOf(accounts[1])
      await veth.withdraw(vethBalance, {from: accounts[1]})
      await poolRewards.claimReward(accounts[1], {from: accounts[1]})

      claimable = await poolRewards.claimable(accounts[1])
      assert.equal(claimable.toString(), '0', 'Claimable should be 0')

      let reward = await vsp.balanceOf(accounts[1])
      assert(reward.gt(new BN('0')), 'Reward balance should be greater than 0')

      // Withdraw vETH and claim reward for account 0
      vethBalance = await veth.balanceOf(accounts[0])
      await veth.withdraw(vethBalance, {from: accounts[0]})
      await poolRewards.claimReward(accounts[0], {from: accounts[0]})

      claimable = await poolRewards.claimable(accounts[0])
      assert.equal(claimable.toString(), '0', 'Claimable should be 0')

      reward = await vsp.balanceOf(accounts[0])
      assert(reward.gt(new BN('0')), 'Reward balance should be greater than 0')
      const reward1 = await vsp.balanceOf(accounts[1])
      assert(reward.gt(reward1), 'Reward of account 0 should be higher')
    })
  })
})
