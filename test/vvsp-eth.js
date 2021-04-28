'use strict'
const {ethers} = require('hardhat')
const {defaultAbiCoder} = ethers.utils
const {getDelegateData, getPermitData} = require('./utils/signHelper')
const {addInList, createKeeperList, approveToken, deployContract} = require('./utils/setupHelper')
const swapper = require('./utils/tokenSwapper')
const {MNEMONIC} = require('./utils/testkey')
const {expect} = require('chai')
const time = require('./utils/time')
const {BigNumber: BN} = require('ethers')
const pSeries = require('p-series')
const DECIMAL = BN.from('1000000000000000000')
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const wbtcAddress = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
const UNI_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'
const SUSHI_ROUTER = '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F'
const MAX_UINT256 = BN.from('2').pow(BN.from('256')).sub(BN.from('1'))

describe('VVSP Pool', function () {
  let vsp, vvsp, controller, uniFactory, uniRouter, timestamp, veth, vwbtc, as, asWBTC, vs, sushiFactory, sushiRouter
  let accounts
  const fee = '200000000000000000'

  async function updateLockPeriod(lockPeriod) {
    const target = vvsp.address
    const methodSignature = 'updateLockPeriod(uint256)'
    const data = defaultAbiCoder.encode(['uint256'], [lockPeriod])
    await controller.executeTransaction(target, 0, methodSignature, data)
  }
  async function setupVWBTC() {
    vwbtc = await deployContract('VWBTC', [controller.address])
    await controller.addPool(vwbtc.address)
    asWBTC = await deployContract('AaveV2StrategyWBTC', [controller.address, vwbtc.address])
    await Promise.all([
      controller.updateStrategy(vwbtc.address, asWBTC.address),
      controller.updateFeeCollector(vwbtc.address, vvsp.address),
      controller.updateWithdrawFee(vwbtc.address, fee),
    ])

    let target = await vwbtc.feeWhiteList()
    let methodSignature = 'add(address)'
    let data = defaultAbiCoder.encode(['address'], [vs.address])
    await controller.executeTransaction(target, 0, methodSignature, data)

    target = vs.address
    methodSignature = 'updateLiquidationQueue(address[],uint256[])'
    data = defaultAbiCoder.encode(
      ['address[]', 'uint256[]'],
      [
        [vwbtc.address, veth.address],
        [BN.from(1).mul(DECIMAL).toString(), BN.from(25).mul(DECIMAL).toString()],
      ]
    )
    await controller.executeTransaction(target, 0, methodSignature, data)

    target = vvsp.address
    methodSignature = 'approveToken(address,address)'
    data = defaultAbiCoder.encode(['address', 'address'], [vwbtc.address, vs.address])
    await controller.executeTransaction(target, 0, methodSignature, data)

    await approveToken(controller, asWBTC.address)
    await createKeeperList(controller, asWBTC.address)
    const keepers = await asWBTC.keepers()
    await addInList(controller, keepers, accounts[0].address)
  }

  async function setupVPool() {
    accounts = await ethers.getSigners()
    vvsp = await deployContract('VVSP', [controller.address, vsp.address])
    veth = await deployContract('VETH', [controller.address])
    await controller.addPool(veth.address)
    as = await deployContract('AaveV2StrategyETH', [controller.address, veth.address])
    ;[uniFactory, uniRouter, timestamp] = await Promise.all([
      ethers.getContractAt('IUniswapFactoryTest', '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'),
      ethers.getContractAt('IUniswapRouterTest', UNI_ROUTER),
      await time.latestBlock(),
    ])
    ;[sushiFactory, sushiRouter, timestamp] = await Promise.all([
      ethers.getContractAt('IUniswapFactoryTest', '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac'),
      ethers.getContractAt('IUniswapRouterTest', SUSHI_ROUTER),
      await time.latestBlock(),
    ])
    vs = await deployContract('VSPStrategy', [controller.address, vvsp.address])

    await controller.addPool(vvsp.address)
    const liquidityAmt = BN.from('10000000000000000000')
    await Promise.all([uniFactory.createPair(WETH, vsp.address), sushiFactory.createPair(WETH, vsp.address)])

    await Promise.all([
      await vsp.mint(accounts[0].address, BN.from(20000).mul(DECIMAL)),
      await vsp.approve(uniRouter.address, MAX_UINT256),
      await vsp.approve(sushiRouter.address, MAX_UINT256),
    ])
    await Promise.all([
      uniRouter
        .connect(accounts[0])
        .addLiquidityETH(vsp.address, liquidityAmt, '0', '0', accounts[0].address, timestamp + 120, {
          value: liquidityAmt,
        }),
      sushiRouter
        .connect(accounts[0])
        .addLiquidityETH(vsp.address, liquidityAmt, '0', '0', accounts[0].address, timestamp + 120, {
          value: liquidityAmt,
        }),

      controller.updateStrategy(veth.address, as.address),
      controller.updateFeeCollector(veth.address, vvsp.address),
      controller.updateWithdrawFee(veth.address, fee),
      controller.updateStrategy(vvsp.address, vs.address),
      controller.updateFounderVault(accounts[8].address),
    ])

    const path = [WETH, vsp.address]
    await uniRouter.connect(accounts[0]).swapExactETHForTokens(1, path, accounts[0].address, timestamp + 120, {
      value: '500000000000000000',
    })

    let target = await veth.feeWhiteList()
    let methodSignature = 'add(address)'
    let data = defaultAbiCoder.encode(['address'], [vs.address])
    await controller.executeTransaction(target, 0, methodSignature, data)
    // Add keeper in VSP Strategy
    target = await vs.keepers()
    methodSignature = 'add(address)'
    data = defaultAbiCoder.encode(['address'], [accounts[0].address])
    await controller.executeTransaction(target, 0, methodSignature, data)
    target = vs.address
    methodSignature = 'updateLiquidationQueue(address[],uint256[])'
    data = defaultAbiCoder.encode(['address[]', 'uint256[]'], [[veth.address], [BN.from(25).mul(DECIMAL).toString()]])
    await controller.executeTransaction(target, 0, methodSignature, data)
    await approveToken(controller, as.address)
    await createKeeperList(controller, as.address)
    const keepers = await as.keepers()
    await addInList(controller, keepers, accounts[0].address)
  }

  describe('Basic function tests', function () {
    beforeEach(async function () {
      ;[controller, vsp] = await Promise.all([deployContract('Controller'), deployContract('VSP')])
      await setupVPool()
    })

    it('Should deposit VSP in pool', async function () {
      const depositAmount = BN.from(10).mul(DECIMAL).toString()
      return vsp.approve(vvsp.address, depositAmount).then(async function () {
        return vvsp.deposit(depositAmount).then(function () {
          return Promise.all([vvsp.totalSupply(), vvsp.totalValue()]).then(function ([supply, value]) {
            expect(supply.toString()).to.be.equal( depositAmount, 'total supply wrong')
            expect(value.toString()).to.be.equal( depositAmount, 'pool total value wrong wrong')
          })
        })
      })
    })

    it('deposit with permit', async function () {
      const amount = '100000000000000000'
      const {deadline, sign} = await getPermitData(vsp, amount, MNEMONIC, vvsp.address)
      await vvsp.depositWithPermit(amount, deadline, sign.v, sign.r, sign.s)
      const vBalance = await vvsp.balanceOf(accounts[0].address)
      expect(vBalance.toString()).to.be.equal( amount, 'deposit with permit failed')
    })

    it('Should withdraw VSP in pool', async function () {
      const depositAmount = BN.from(10).mul(DECIMAL).toString()
      const tasks = [
        () => updateLockPeriod(0),
        () => vsp.approve(vvsp.address, depositAmount),
        () => vvsp.deposit(depositAmount),
        () => controller.updateFeeCollector(vvsp.address, accounts[0].address),
        () => controller.updateWithdrawFee(vvsp.address, '100000000000000000'),
        () => vvsp.withdraw(depositAmount),
        () => vvsp.totalSupply(),
        () => vvsp.totalValue(),
      ]
      return pSeries(tasks).then(function ([, , , , , , supply, value]) {
        expect(supply.toString()).to.be.equal( BN.from(1).mul(DECIMAL).toString(), 'total supply wrong')
        expect(value.toString()).to.be.equal( BN.from(1).mul(DECIMAL).toString(), 'pool total value wrong wrong')
      })
    })

    it('Should withdraw partial VSP in pool', async function () {
      const depositAmount = BN.from(10).mul(DECIMAL)
      const withdrawAmount = BN.from(1).mul(DECIMAL)
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
        expect(supply.toString()).to.be.equal( remainingAmount, 'total supply wrong')
        expect(value.toString()).to.be.equal( remainingAmount, 'pool total value wrong')
      })
    })

    it('Should not allowed withdraw during lock period', async function () {
      const depositAmount = BN.from(10).mul(DECIMAL)
      const withdrawAmount = BN.from(1).mul(DECIMAL)
      const tasks = [
        () => vsp.approve(vvsp.address, depositAmount),
        () => vvsp.deposit(depositAmount),
        () => vvsp.withdraw(withdrawAmount),
      ]
      const error = await pSeries(tasks).catch(exp => exp.message)
      expect(error.includes('Operation not allowed'), 'Withdraw should fail')
    })

    it('Should allow withdraw after lock period', async function () {
      const depositAmount = BN.from(10).mul(DECIMAL)
      const withdrawAmount = BN.from(1).mul(DECIMAL)
      const tasks = [
        () => vsp.approve(vvsp.address, depositAmount),
        () => vvsp.deposit(depositAmount),
        () => time.increase(25 * 60 * 60),
        () => vvsp.withdraw(withdrawAmount),
        () => vvsp.totalSupply(),
        () => vvsp.totalValue(),
      ]
      const remainingAmount = depositAmount.sub(withdrawAmount).toString()
      return pSeries(tasks).then(function ([, , , , supply, value]) {
        expect(supply.toString()).to.be.equal( remainingAmount, 'total supply wrong')
        expect(value.toString()).to.be.equal( remainingAmount, 'pool total value wrong')
      })
    })

    it('Should be able to liquidate veth', async function () {
      const amount = '20000000000000000000'
      const tasks = [
        () => veth.connect(accounts[0])['deposit()']({value: amount}),
        () => as.rebalance(),
        () => veth.withdraw(amount),
      ]
      await pSeries(tasks)
      await vs.connect(accounts[0]).rebalance()
      const vvspValue = await vvsp.totalValue()
      expect(vvspValue).to.be.gt('0', 'VVSP value is wrong')
    })

    it('only keeper should be able to do rebalance', async function () {
      const amount = '20000000000000000000'
      const tasks = [
        () => veth.connect(accounts[0])['deposit()']({value: amount}),
        () => as.rebalance(),
        () => veth.withdraw(amount),
      ]
      await pSeries(tasks)
      const tx = vs.connect(accounts[1]).rebalance()
      await expect(tx).to.be.revertedWith('caller-is-not-keeper')
      await vs.connect(accounts[0]).rebalance()
      const vvspValue = await vvsp.totalValue()
      expect(BN.from(vvspValue)).to.be.gt(BN.from(0), 'VVSP value is wrong')
    })

    it('keeper should not be able to rebalance when contract paused', async function () {
      const amount = '20000000000000000000'
      const tasks = [
        () => veth.connect(accounts[0])['deposit()']({value: amount}),
        () => as.rebalance(),
        () => veth.withdraw(amount),
      ]
      await pSeries(tasks)
      const target = await vs.address
      await controller.executeTransaction(target, 0, 'pause()', '0x')
      const tx = vs.connect(accounts[0]).rebalance()
      await expect(tx).to.be.revertedWith('Pausable: paused')
      await controller.executeTransaction(target, 0, 'unpause()', '0x')
      await vs.connect(accounts[0]).rebalance()
      const vvspValue = await vvsp.totalValue()
      expect(BN.from(vvspValue)).to.be.gt(BN.from(0), 'VVSP value is wrong')
    })

    it('Should be able to liquidate vWBTC', async function () {
      await setupVWBTC()
      await swapper.swapEthForToken(10, wbtcAddress, accounts[0], accounts[0].address)
      const wbtc = await ethers.getContractAt('TokenLike', wbtcAddress)
      const wbtcBalance = await wbtc.balanceOf(accounts[0].address)
      await wbtc.approve(vwbtc.address, wbtcBalance)
      await vwbtc.deposit(wbtcBalance)
      await asWBTC.rebalance()
      const vwbtcBalance = await vwbtc.balanceOf(accounts[0].address)
      await vwbtc.withdraw(vwbtcBalance)
      await vs.connect(accounts[0]).rebalance()
      const vvspValue = await vvsp.totalValue()
      expect(BN.from(vvspValue)).to.be.gt(BN.from(0), 'VVSP value is wrong')
    })

    it('Should not be able to sweep vToken', async function () {
      const amount = '20000000000000000000'
      const tasks = [
        () => veth.connect(accounts[0])['deposit()']({value: amount}),
        () => as.rebalance(),
        () => veth.withdraw('10000000000000000000'),
        () => vvsp.sweepErc20(veth.address),
      ]
      const error = await pSeries(tasks).catch(exp => exp.message)
      expect(error.includes('Not allowed to sweep'), 'Sweep should fail')
      const weth = await ethers.getContractAt('TokenLike', WETH)
      await weth.deposit({value: amount})
      await weth.transfer(vvsp.address, amount)
      let balance = await weth.balanceOf(vvsp.address)
      vvsp.sweepErc20(WETH)
      balance = await weth.balanceOf(vvsp.address)
      expect(balance.toString()).to.be.equal( '0', 'Sweep failed')
    })

    it('Should be able to sweep any non-vToken', async function () {
      await swapper.swapEthForToken(10, wbtcAddress, accounts[0], accounts[0].address)
      const wbtc = await ethers.getContractAt('TokenLike', wbtcAddress)
      let balance = await wbtc.balanceOf(accounts[0].address)
      await wbtc.transfer(vvsp.address, balance)
      await vvsp.sweepErc20(wbtcAddress)
      balance = await wbtc.balanceOf(vvsp.address)
      expect(balance.toString()).to.be.equal( '0', 'Sweep failed')
    })

    it('Rebalance friction should prevent too frequent rebalance', async function () {
      const amount = '20000000000000000000'
      const tasks = [
        () => veth.connect(accounts[0])['deposit()']({value: amount}),
        () => as.rebalance(),
        () => veth.withdraw(amount),
      ]
      await pSeries(tasks)
      await controller.updateFounderFee('500000000000000000')
      await controller.updateRebalanceFriction(vvsp.address, '4')
      await vs.connect(accounts[0]).rebalance()
      const error = await vs
        .connect(accounts[0])
        .rebalance()
        .catch(exp => exp.message)
        expect(error.includes('Can not rebalance'), 'Should not allow to rebalance')
      await veth.connect(accounts[0])['deposit()']({value: amount})
      await veth.connect(accounts[0])['deposit()']({value: amount})
      await vs.connect(accounts[0]).rebalance()
    })

    it('Should be able to liquidate veth multiple time', async function () {
      const amount = '20000000000000000000'
      let tasks = [
        () => veth.connect(accounts[0])['deposit()']({value: amount}),
        () => as.rebalance(),
        () => veth.withdraw(amount),
      ]
      await pSeries(tasks)
      await vs.connect(accounts[0]).rebalance()
      const vvspValue1 = await vvsp.totalValue()
      expect(BN.from(vvspValue1)).to.be.gt(BN.from(0), 'VVSP value is wrong')
      tasks = [
        () => veth.connect(accounts[0])['deposit()']({value: amount}),
        () => as.rebalance(),
        () => veth.withdraw(amount),
      ]
      await pSeries(tasks)
      await vs.connect(accounts[0]).rebalance()
      await vs.connect(accounts[0]).rebalance()
      const vvspValue2 = await vvsp.totalValue()
      expect(BN.from(vvspValue2)).to.be.gt(BN.from(vvspValue1), 'New VVSP value is wrong')
    })

    it('Should be able to liquidate vWBTC and vETH in order', async function () {
      // Setup and liquidate vWBTC
      await setupVWBTC()
      await swapper.swapEthForToken(10, wbtcAddress, accounts[0], accounts[0].address)
      const wbtc = await ethers.getContractAt('TokenLike', wbtcAddress)
      const wbtcBalance = await wbtc.balanceOf(accounts[0].address)
      await wbtc.approve(vwbtc.address, wbtcBalance)
      await vwbtc.deposit(wbtcBalance)
      await asWBTC.rebalance()
      const vwbtcBalance = await vwbtc.balanceOf(accounts[0].address)
      await vwbtc.withdraw(vwbtcBalance)
      await vs.connect(accounts[0]).rebalance()

      const vvspValue1 = await vvsp.totalValue()
      expect(BN.from(vvspValue1)).to.be.gt(BN.from(0), 'VVSP value is wrong')

      // Liduidate vETH
      const amount = '20000000000000000000'
      await veth.connect(accounts[0])['deposit()']({value: amount})
      await as.rebalance()
      await veth.withdraw(amount)
      await vs.connect(accounts[0]).rebalance()

      const vvspValue2 = await vvsp.totalValue()
      expect(BN.from(vvspValue2)).to.be.gt(BN.from(vvspValue1), 'New VVSP value is wrong')
    })

    it('Should be able to liquidate veth without fee', async function () {
      const amount = BN.from(10).mul(DECIMAL)
      const tasks = [() => veth.connect(accounts[0])['deposit()']({value: amount}), () => veth.withdraw(amount)]
      await pSeries(tasks)
      const vvspValue1 = await vvsp.totalValue()
      await vs.connect(accounts[0]).rebalance()
      const vvspValue2 = await vvsp.totalValue()
      expect(BN.from(vvspValue2)).to.be.gt(BN.from(vvspValue1), 'New VVSP value is wrong')
      const totalSupply = (await veth.totalSupply()).toString()
      expect(totalSupply).to.be.equal( '0', 'VETH total supply is wrong')
    })

    it('Should continue to liquidate even if pool count is decreased', async function () {
      const amount = '20000000000000000000'
      const tasks = [
        () => veth.connect(accounts[0])['deposit()']({value: amount}),
        () => as.rebalance(),
        () => veth.withdraw(amount),
      ]
      await pSeries(tasks)
      await vs.connect(accounts[0]).rebalance()
      await vs.connect(accounts[0]).rebalance()
      // Remove veth pool, vvsp still in list
      await controller.removePool(veth.address)
      let isPassed = true
      try {
        await vs.connect(accounts[0]).rebalance()
      } catch (exp) {
        isPassed = false
      }
      expect(isPassed, 'Rebalance should work without error')
    })

    it('Should delegate vote and check current and prior votes', async function () {
      await updateLockPeriod(0)
      const depositAmount = BN.from(10).mul(DECIMAL).toString()
      const withdrawAmount = BN.from(1).mul(DECIMAL)

      await vsp.approve(vvsp.address, depositAmount)
      await vvsp.deposit(depositAmount)

      await vvsp.delegate(accounts[0].address)
      const blockNumber = (await time.latestBlock())
      let votes = await vvsp.getCurrentVotes(accounts[0].address)
      expect(votes.toString()).to.be.equal( depositAmount, 'Votes should be equal to depositAmount')

      const transferAmount = BN.from('2').mul(DECIMAL).toString()
      let remainingAmount = BN.from(depositAmount).sub(BN.from(transferAmount)).toString()
      await vvsp.transfer(accounts[1].address, transferAmount)
      await vvsp.connect(accounts[1]).delegate(accounts[1].address)
      votes = await vvsp.getCurrentVotes(accounts[1].address)
      expect(votes.toString()).to.be.equal( transferAmount, 'Votes should be equal to transferAmount')
      votes = await vvsp.getCurrentVotes(accounts[0].address)
      expect(votes.toString()).to.be.equal( remainingAmount, 'Votes should be equal to remainingAmount')

      await vvsp.withdraw(withdrawAmount)
      remainingAmount = BN.from(remainingAmount).sub(withdrawAmount).toString()
      votes = await vvsp.getCurrentVotes(accounts[0].address)
      expect(votes.toString()).to.be.equal( remainingAmount, 'Votes should be equal to remainingAmount')

      votes = await vvsp.getPriorVotes(accounts[0].address, blockNumber)
      expect(votes.toString()).to.be.equal( depositAmount, 'Prior votes should be equal to depositAmount')
    })

    it('Should delegate vote using signature', async function () {
      const delegator = accounts[0]
      const delegatee = accounts[1]
      const depositAmount = BN.from(10).mul(DECIMAL).toString()
      await vsp.connect(delegator).approve(vvsp.address, depositAmount)
      await vvsp.connect(delegator).deposit(depositAmount)

      const {deadline, nonce, sign} = await getDelegateData(vvsp, MNEMONIC, delegatee.address)
      await vvsp.delegateBySig(delegatee.address, nonce, deadline, sign.v, sign.r, sign.s)

      const votes = await vvsp.getCurrentVotes(delegatee.address)
      const vvspBalance = (await vvsp.balanceOf(delegator.address)).toString()
      expect(votes.toString()).to.be.equal( vvspBalance, 'Votes should be equal to vvspBalance')
    })

    it('Should allow gasless approval using permit()', async function () {
      const amount = BN.from(10).mul(DECIMAL).toString()
      const {owner, deadline, sign} = await getPermitData(vvsp, amount, MNEMONIC, accounts[1].address)
      await vvsp.permit(owner, accounts[1].address, amount, deadline, sign.v, sign.r, sign.s)
      const allowance = await vvsp.allowance(owner, accounts[1].address)
      expect(allowance.toString()).to.be.equal( amount, 'Allowance using permit is wrong')
    })

    describe('Sandwich Attacks', function () {
      it('Should avoid a sandwich attack on Uni', async function () {
        const amount = '20000000000000000000'
        const tasks = [
          () => veth.connect(accounts[0])['deposit()']({value: amount}),
          () => as.rebalance(),
          () => veth.withdraw(amount),
        ]
        await pSeries(tasks)
        await swapper.swapEthForToken(20, vsp.address, accounts[5], accounts[5].address)
        const sushiAmtOutBefore = await sushiRouter.getAmountsOut(amount, [WETH, vsp.address])
        await vs.connect(accounts[0]).rebalance()
        const sushiAmtOutAfter = await sushiRouter.getAmountsOut(amount, [WETH, vsp.address])
        const vvspValue = await vvsp.totalValue()
        expect(vvspValue).to.be.gt('0', 'VVSP value is wrong')
        expect(sushiAmtOutBefore[1]).to.be.gt(sushiAmtOutAfter[1], 'Trade didnt happen on Sushi')
      })
    })
  })
})
