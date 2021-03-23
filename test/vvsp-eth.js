'use strict'

const {getDelegateData, getPermitData} = require('./utils/signHelper')
const {expectRevert} = require('@openzeppelin/test-helpers')
const swapper = require('./utils/tokenSwapper')
const {MNEMONIC} = require('./utils/testkey')
const {assert} = require('chai')
const BN = require('bn.js')
const timeMachine = require('ganache-time-traveler')
const VVSP = artifacts.require('VVSP')
const TokenLike = artifacts.require('TokenLike')
const Controller = artifacts.require('Controller')
const IUniswapFactory = artifacts.require('IUniswapFactoryTest')
const IUniswapRouterTest = artifacts.require('IUniswapRouterTest')
const VSP = artifacts.require('VSP')
const VETH = artifacts.require('VETH')
const VWBTC = artifacts.require('VWBTC')
const pSeries = require('p-series')
const AaveStrategy = artifacts.require('AaveStrategyETH')
const AaveStrategyWBTC = artifacts.require('AaveStrategyWBTC')
const VSPStrategy = artifacts.require('VSPStrategy')
const DECIMAL = new BN('1000000000000000000')
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const wbtcAddress = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'

contract('VVSP Pool', function (accounts) {
  let vsp, vvsp, controller, uniFactory, uniRouter, block, veth, vwbtc, as, asWBTC, vs

  const fee = '200000000000000000'

  async function updateLockPeriod(lockPeriod) {
    const target = vvsp.address
    const methodSignature = 'updateLockPeriod(uint256)'
    const data = web3.eth.abi.encodeParameter('uint256', lockPeriod)
    await controller.executeTransaction(target, 0, methodSignature, data)
  }
  async function setupVWBTC() {
    vwbtc = await VWBTC.new(controller.address)
    await controller.addPool(vwbtc.address)
    asWBTC = await AaveStrategyWBTC.new(controller.address, vwbtc.address)
    await Promise.all([
      controller.updateStrategy(vwbtc.address, asWBTC.address),
      controller.updateFeeCollector(vwbtc.address, vvsp.address),
      controller.updateWithdrawFee(vwbtc.address, fee),
    ])

    let target = await vwbtc.feeWhiteList()
    let methodSignature = 'add(address)'
    let data = web3.eth.abi.encodeParameter('address', vs.address)
    await controller.executeTransaction(target, 0, methodSignature, data)

    target = vs.address
    methodSignature = 'updateLiquidationQueue(address[],uint256[])'
    data = web3.eth.abi.encodeParameters(
      ['address[]', 'uint256[]'],
      [
        [vwbtc.address, veth.address],
        [new BN(1).mul(DECIMAL).toString(), new BN(25).mul(DECIMAL).toString()],
      ]
    )
    await controller.executeTransaction(target, 0, methodSignature, data)

    target = vvsp.address
    methodSignature = 'approveToken(address,address)'
    data = web3.eth.abi.encodeParameters(['address', 'address'], [vwbtc.address, vs.address])
    await controller.executeTransaction(target, 0, methodSignature, data)
  }

  async function setupVPool() {
    vvsp = await VVSP.new(controller.address, vsp.address)
    veth = await VETH.new(controller.address)
    await controller.addPool(veth.address)
    as = await AaveStrategy.new(controller.address, veth.address);
    [uniFactory, uniRouter, block] = await Promise.all([
      IUniswapFactory.at('0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'),
      IUniswapRouterTest.at('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'),
      web3.eth.getBlock('latest'),
    ])
    vs = await VSPStrategy.new(controller.address, vvsp.address)

    await controller.addPool(vvsp.address)
    await Promise.all([
      uniFactory.createPair(WETH, vsp.address),
      vsp.mint(accounts[0], new BN(10000).mul(DECIMAL)),
      vsp.approve(uniRouter.address, -1),
      uniRouter.addLiquidityETH(
        vsp.address,
        '10000000000000000000',
        '0',
        '0',
        accounts[0],
        block.timestamp + 30,
        {value: '10000000000000000000'}
      ),
      controller.updateStrategy(veth.address, as.address),
      controller.updateFeeCollector(veth.address, vvsp.address),
      controller.updateWithdrawFee(veth.address, fee),
      controller.updateStrategy(vvsp.address, vs.address),
      controller.updateFounderVault(accounts[8]),
    ])
    const path = [WETH, vsp.address]
    await uniRouter.swapExactETHForTokens(1, path, accounts[0], block.timestamp + 60, {
      value: '500000000000000000',
    })

    let target = await veth.feeWhiteList()
    let methodSignature = 'add(address)'
    let data = web3.eth.abi.encodeParameter('address', vs.address)
    await controller.executeTransaction(target, 0, methodSignature, data)

    target = vs.address
    methodSignature = 'updateLiquidationQueue(address[],uint256[])'
    data = web3.eth.abi.encodeParameters(
      ['address[]', 'uint256[]'],
      [[veth.address], [new BN(25).mul(DECIMAL).toString()]]
    )
    await controller.executeTransaction(target, 0, methodSignature, data)

    target = await vs.keepers()
    methodSignature = 'add(address)'
    data = web3.eth.abi.encodeParameter('address', accounts[0])
    await controller.executeTransaction(target, 0, methodSignature, data)
  }

  describe('Basic function tests', function () {
    beforeEach(async function () {
      [controller, vsp] = await Promise.all([Controller.new(), VSP.new()])
      await setupVPool()
    })

    it('Should deposit VSP in pool', async function () {
      const depositAmount = new BN(10).mul(DECIMAL).toString()
      return vsp.approve(vvsp.address, depositAmount).then(function () {
        return vvsp.deposit(depositAmount).then(function () {
          return Promise.all([vvsp.totalSupply(), vvsp.totalValue()]).then(function ([
            supply,
            value,
          ]) {
            assert.equal(supply.toString(), depositAmount, 'total supply wrong')
            assert.equal(value.toString(), depositAmount, 'pool total value wrong wrong')
          })
        })
      })
    })

    it('deposit with permit', async function () {
      const amount = '100000000000000000'
      const {owner, deadline, sign} = await getPermitData(vsp, amount, MNEMONIC, vvsp.address)
      await vvsp.depositWithPermit(amount, deadline, sign.v, sign.r, sign.s, {from: owner})
      const vBalance = await vvsp.balanceOf(accounts[0])
      assert.equal(vBalance.toString(), amount, 'deposit with permit failed')
    })

    it('Should withdraw VSP in pool', async function () {
      const depositAmount = new BN(10).mul(DECIMAL).toString()
      const tasks = [
        () => updateLockPeriod(0),
        () => vsp.approve(vvsp.address, depositAmount),
        () => vvsp.deposit(depositAmount),
        () => controller.updateFeeCollector(vvsp.address, accounts[0]),
        () => controller.updateWithdrawFee(vvsp.address, '100000000000000000'),
        () => vvsp.withdraw(depositAmount),
        () => vvsp.totalSupply(),
        () => vvsp.totalValue(),
      ]
      return pSeries(tasks).then(function ([, , , , , , supply, value]) {
        assert.equal(supply.toString(), new BN(1).mul(DECIMAL).toString(), 'total supply wrong')
        assert.equal(
          value.toString(),
          new BN(1).mul(DECIMAL).toString(),
          'pool total value wrong wrong'
        )
      })
    })

    it('Should withdraw partial VSP in pool', async function () {
      const depositAmount = new BN(10).mul(DECIMAL)
      const withdrawAmount = new BN(1).mul(DECIMAL)
      const tasks = [
        () => updateLockPeriod(0),
        () => vsp.approve(vvsp.address, depositAmount),
        () => vvsp.deposit(depositAmount),
        () => vvsp.withdraw(withdrawAmount),
        () => vvsp.totalSupply(),
        () => vvsp.totalValue(),
      ]
      const remainingAmount = depositAmount.sub(withdrawAmount).toString()
      return pSeries(tasks).then(function ([, , , , supply, value]) {
        assert.equal(supply.toString(), remainingAmount, 'total supply wrong')
        assert.equal(value.toString(), remainingAmount, 'pool total value wrong')
      })
    })

    it('Should not allowed withdraw during lock period', async function () {
      const depositAmount = new BN(10).mul(DECIMAL)
      const withdrawAmount = new BN(1).mul(DECIMAL)
      const tasks = [
        () => vsp.approve(vvsp.address, depositAmount),
        () => vvsp.deposit(depositAmount),
        () => vvsp.withdraw(withdrawAmount),
      ]
      const error = await pSeries(tasks).catch(exp => exp.message)
      assert(error.includes('Operation not allowed'), 'Withdraw should fail')
    })

    it('Should allow withdraw after lock period', async function () {
      const depositAmount = new BN(10).mul(DECIMAL)
      const withdrawAmount = new BN(1).mul(DECIMAL)
      const tasks = [
        () => vsp.approve(vvsp.address, depositAmount),
        () => vvsp.deposit(depositAmount),
        () => timeMachine.advanceTime(25 * 60 * 60),
        () => vvsp.withdraw(withdrawAmount),
        () => vvsp.totalSupply(),
        () => vvsp.totalValue(),
      ]
      const remainingAmount = depositAmount.sub(withdrawAmount).toString()
      return pSeries(tasks).then(function ([, , , , supply, value]) {
        assert.equal(supply.toString(), remainingAmount, 'total supply wrong')
        assert.equal(value.toString(), remainingAmount, 'pool total value wrong')
      })
    })

    it('Should be able to liquidate veth', async function () {
      const amount = '20000000000000000000'
      const tasks = [
        () => veth.methods['deposit()']({value: amount}),
        () => veth.rebalance(),
        () => veth.withdraw(amount),
      ]
      await pSeries(tasks)
      await vs.rebalance({from:accounts[0]})
      const vvspValue = await vvsp.totalValue()
      assert(new BN(vvspValue).gt(new BN(0), 'VVSP value is wrong'))
    })

    it('only keeper should be able to do rebalance', async function () {
      const amount = '20000000000000000000'
      const tasks = [
        () => veth.methods['deposit()']({value: amount}),
        () => veth.rebalance(),
        () => veth.withdraw(amount),
      ]
      await pSeries(tasks)
      const tx = vs.rebalance({from:accounts[1]})
      await expectRevert(tx, 'caller-is-not-keeper')
      await vs.rebalance({from:accounts[0]})
      const vvspValue = await vvsp.totalValue()
      assert(new BN(vvspValue).gt(new BN(0), 'VVSP value is wrong'))
    })

    it('keeper should not be able to rebalance when contract paused', async function () {
      const amount = '20000000000000000000'
      const tasks = [
        () => veth.methods['deposit()']({value: amount}),
        () => veth.rebalance(),
        () => veth.withdraw(amount),
      ]
      await pSeries(tasks)
      const target = await vs.address
      await controller.executeTransaction(target, 0, 'pause()', '0x')
      const tx = vs.rebalance({from:accounts[0]})
      await expectRevert(tx, 'Pausable: paused')
      await controller.executeTransaction(target, 0, 'unpause()', '0x')
      await vs.rebalance({from:accounts[0]})
      const vvspValue = await vvsp.totalValue()
      assert(new BN(vvspValue).gt(new BN(0), 'VVSP value is wrong'))
    })

    it('Should be able to liquidate vWBTC', async function () {
      await setupVWBTC()
      await swapper.swapEthForToken(10, wbtcAddress, accounts[0], accounts[0])
      const wbtc = await TokenLike.at(wbtcAddress)
      const wbtcBalance = await wbtc.balanceOf(accounts[0])
      await wbtc.approve(vwbtc.address, wbtcBalance, {from: accounts[0]})
      await vwbtc.deposit(wbtcBalance)
      await vwbtc.rebalance()
      const vwbtcBalance = await vwbtc.balanceOf(accounts[0])
      await vwbtc.withdraw(vwbtcBalance)
      await vs.rebalance({from:accounts[0]})
      const vvspValue = await vvsp.totalValue()
      assert(new BN(vvspValue).gt(new BN(0), 'VVSP value is wrong'))
    })

    it('Should not be able to sweep vToken', async function () {
      const amount = '20000000000000000000'
      const tasks = [
        () => veth.methods['deposit()']({value: amount, from: accounts[0]}),
        () => veth.rebalance(),
        () => veth.withdraw('10000000000000000000', {from: accounts[0]}),
        () => vvsp.sweepErc20(veth.address),
      ]
      const error = await pSeries(tasks).catch(exp => exp.message)
      assert(error.includes('Not allowed to sweep'), 'Sweep should fail')
      const weth = await TokenLike.at(WETH)
      await weth.deposit({value: amount})
      await weth.transfer(vvsp.address, amount)
      let balance = await weth.balanceOf(vvsp.address)
      vvsp.sweepErc20(WETH)
      balance = await weth.balanceOf(vvsp.address)
      assert.equal(balance.toString(), '0', 'Sweep failed')
    })

    it('Should be able to sweep any non-vToken', async function () {
      await swapper.swapEthForToken(10, wbtcAddress, accounts[0], accounts[0])
      const wbtc = await TokenLike.at(wbtcAddress)
      let balance = await wbtc.balanceOf(accounts[0])
      await wbtc.transfer(vvsp.address, balance)
      vvsp.sweepErc20(wbtcAddress)
      balance = await wbtc.balanceOf(vvsp.address)
      assert.equal(balance.toString(), '0', 'Sweep failed')
    })

    it('Rebalance friction should prevent too frequent rebalance', async function () {
      const amount = '20000000000000000000'
      const tasks = [
        () => veth.methods['deposit()']({value: amount}),
        () => veth.rebalance(),
        () => veth.withdraw(amount),
      ]
      await pSeries(tasks)
      await controller.updateFounderFee('500000000000000000')
      await controller.updateRebalanceFriction(vvsp.address, '4')
      await vs.rebalance({from:accounts[0]})
      const error = await vs.rebalance({from:accounts[0]}).catch(exp => exp.message)
      assert(error.includes('Can not rebalance'), 'Should not allow to rebalance')
      await veth.methods['deposit()']({value: amount})
      await veth.methods['deposit()']({value: amount})
      await vs.rebalance({from:accounts[0]})
    })

    it('Should be able to liquidate veth multiple time', async function () {
      const amount = '20000000000000000000'
      let tasks = [
        () => veth.methods['deposit()']({value: amount}),
        () => veth.rebalance(),
        () => veth.withdraw(amount),
      ]
      await pSeries(tasks)
      await vs.rebalance({from:accounts[0]})
      const vvspValue1 = await vvsp.totalValue()
      assert(new BN(vvspValue1).gt(new BN(0), 'VVSP value is wrong'))
      tasks = [
        () => veth.methods['deposit()']({value: amount}),
        () => veth.rebalance(),
        () => veth.withdraw(amount),
      ]
      await pSeries(tasks)
      await vs.rebalance({from:accounts[0]})
      await vs.rebalance({from:accounts[0]})
      const vvspValue2 = await vvsp.totalValue()
      assert(new BN(vvspValue2).gt(new BN(vvspValue1), 'New VVSP value is wrong'))
    })

    it('Should be able to liquidate vWBTC and vETH in order', async function () {
      // Setup and liquidate vWBTC
      await setupVWBTC()
      await swapper.swapEthForToken(10, wbtcAddress, accounts[0], accounts[0])
      const wbtc = await TokenLike.at(wbtcAddress)
      const wbtcBalance = await wbtc.balanceOf(accounts[0])
      await wbtc.approve(vwbtc.address, wbtcBalance, {from: accounts[0]})
      await vwbtc.deposit(wbtcBalance)
      await vwbtc.rebalance()
      const vwbtcBalance = await vwbtc.balanceOf(accounts[0])
      await vwbtc.withdraw(vwbtcBalance)
      await vs.rebalance({from:accounts[0]})

      const vvspValue1 = await vvsp.totalValue()
      assert(new BN(vvspValue1).gt(new BN(0), 'VVSP value is wrong'))

      // Liduidate vETH
      const amount = '20000000000000000000'
      await veth.methods['deposit()']({value: amount})
      await veth.rebalance()
      await veth.withdraw(amount)
      await vs.rebalance({from:accounts[0]})

      const vvspValue2 = await vvsp.totalValue()
      assert(new BN(vvspValue2).gt(new BN(vvspValue1), 'New VVSP value is wrong'))
    })

    it('Should be able to liquidate veth without fee', async function () {
      const amount = new BN(10).mul(DECIMAL)
      const tasks = [() => veth.methods['deposit()']({value: amount}), () => veth.withdraw(amount)]
      await pSeries(tasks)
      const vvspValue1 = await vvsp.totalValue()
      await vs.rebalance({from:accounts[0]})
      const vvspValue2 = await vvsp.totalValue()
      assert(new BN(vvspValue2).gt(new BN(vvspValue1), 'New VVSP value is wrong'))
      const totalSupply = (await veth.totalSupply()).toString()
      assert.equal(totalSupply, '0', 'VETH total supply is wrong')
    })

    it('Should continue to liquidate even if pool count is decreased', async function () {
      const amount = '20000000000000000000'
      const tasks = [
        () => veth.methods['deposit()']({value: amount}),
        () => veth.rebalance(),
        () => veth.withdraw(amount),
      ]
      await pSeries(tasks)
      await vs.rebalance({from:accounts[0]})
      await vs.rebalance({from:accounts[0]})
      // Remove veth pool, vvsp still in list
      await controller.removePool(veth.address)
      let isPassed = true
      try {
        await vs.rebalance({from:accounts[0]})
      } catch (exp) {
        isPassed = false
      }
      assert(isPassed, 'Rebalance should work without error')
    })

    it('Should delegate vote and check current and prior votes', async function () {
      await updateLockPeriod(0)
      const depositAmount = new BN(10).mul(DECIMAL).toString()
      const withdrawAmount = new BN(1).mul(DECIMAL)

      await vsp.approve(vvsp.address, depositAmount)
      await vvsp.deposit(depositAmount)

      await vvsp.delegate(accounts[0], {from: accounts[0]})
      const blockNumber = (await web3.eth.getBlock('latest')).number
      let votes = await vvsp.getCurrentVotes(accounts[0])
      assert.equal(votes.toString(), depositAmount, 'Votes should be equal to depositAmount')

      const transferAmount = new BN('2').mul(DECIMAL).toString()
      let remainingAmount = new BN(depositAmount).sub(new BN(transferAmount)).toString()
      await vvsp.transfer(accounts[1], transferAmount)
      await vvsp.delegate(accounts[1], {from: accounts[1]})
      votes = await vvsp.getCurrentVotes(accounts[1])
      assert.equal(votes.toString(), transferAmount, 'Votes should be equal to transferAmount')
      votes = await vvsp.getCurrentVotes(accounts[0])
      assert.equal(votes.toString(), remainingAmount, 'Votes should be equal to remainingAmount')

      await vvsp.withdraw(withdrawAmount)
      remainingAmount = new BN(remainingAmount).sub(withdrawAmount).toString()
      votes = await vvsp.getCurrentVotes(accounts[0])
      assert.equal(votes.toString(), remainingAmount, 'Votes should be equal to remainingAmount')

      votes = await vvsp.getPriorVotes(accounts[0], blockNumber)
      assert.equal(votes.toString(), depositAmount, 'Prior votes should be equal to depositAmount')
    })

    it('Should delegate vote using signature', async function () {
      const delegator = accounts[0]
      const delegatee = accounts[1]
      const depositAmount = new BN(10).mul(DECIMAL).toString()
      await vsp.approve(vvsp.address, depositAmount, {from: delegator})
      await vvsp.deposit(depositAmount, {from: delegator})

      const {deadline, nonce, sign} = await getDelegateData(vvsp, MNEMONIC, delegatee)
      await vvsp.delegateBySig(delegatee, nonce, deadline, sign.v, sign.r, sign.s)

      const votes = await vvsp.getCurrentVotes(delegatee)
      const vvspBalance = (await vvsp.balanceOf(delegator)).toString()
      assert.equal(votes.toString(), vvspBalance, 'Votes should be equal to vvspBalance')
    })

    it('Should allow gasless approval using permit()', async function () {
      const amount = new BN(10).mul(DECIMAL).toString()
      const {owner, deadline, sign} = await getPermitData(vvsp, amount, MNEMONIC, accounts[1])
      await vvsp.permit(owner, accounts[1], amount, deadline, sign.v, sign.r, sign.s)
      const allowance = await vvsp.allowance(owner, accounts[1])
      assert.equal(allowance.toString(), amount, 'Allowance using permit is wrong')
    })
  })
})
