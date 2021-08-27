'use strict'

const {ethers} = require('hardhat')
const {defaultAbiCoder} = ethers.utils
const {getDelegateData, getPermitData} = require('./utils/signHelper')
const {addInList, createKeeperList, approveToken} = require('./utils/setupHelper')
const {deployContract} = require('./utils/setupHelper')
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
const SWAP_MANAGER = '0xe382d9f2394A359B01006faa8A1864b8a60d2710'
const MAX_UINT256 = BN.from('2').pow(BN.from('256')).sub(BN.from('1'))

describe('VVSP Pool', function () {
  let vsp,
    vvsp,
    controller,
    uniFactory,
    uniRouter,
    timestamp,
    veth,
    vwbtc,
    as,
    asWBTC,
    vs,
    sushiFactory,
    sushiRouter,
    auctionMgr,
    weth,
    swapManager
  let owner, user1, accounts

  const blockMineFn = async function (blocks) {
    time.advanceBlockTo((await time.latestBlock()).add(BN.from(blocks)))
    await swapManager['updateOracles()']()
  }

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
    await addInList(controller, keepers, owner.address)

    await time.increase(3600)
    await swapManager['updateOracles()']()
  }

  async function setupVPool() {
    accounts = await ethers.getSigners()
    ;[owner, user1] = accounts
    vvsp = await deployContract('VVSP', [controller.address, vsp.address])
    veth = await deployContract('VETH', [controller.address])
    weth = await ethers.getContractAt('TokenLike', WETH)
    auctionMgr = await deployContract('DescendingPriceAuction')
    await controller.addPool(veth.address)
    as = await deployContract('AaveV2StrategyETH', [controller.address, veth.address])
    ;[uniFactory, uniRouter, timestamp] = await Promise.all([
      ethers.getContractAt('IUniswapFactoryTest', '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'),
      ethers.getContractAt('IUniswapRouterTest', UNI_ROUTER),
      await time.latest(),
    ])
    ;[sushiFactory, sushiRouter, timestamp] = await Promise.all([
      ethers.getContractAt('IUniswapFactoryTest', '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac'),
      ethers.getContractAt('IUniswapRouterTest', SUSHI_ROUTER),
      await time.latest(),
    ])
    swapManager = await ethers.getContractAt('ISwapManager', SWAP_MANAGER)
    vs = await deployContract('VSPAuctionStrategy', [controller.address, vvsp.address, auctionMgr.address])

    await controller.addPool(vvsp.address)

    await uniFactory.createPair(WETH, vsp.address)
    await sushiFactory.createPair(WETH, vsp.address)
    await vsp.mint(owner.address, BN.from(20000).mul(DECIMAL))
    await vsp.mint(user1.address, BN.from(20000).mul(DECIMAL))
    await vsp.approve(uniRouter.address, MAX_UINT256)
    await vsp.approve(sushiRouter.address, MAX_UINT256)
    await vsp.connect(user1).approve(auctionMgr.address, MAX_UINT256)
    await uniRouter.addLiquidityETH(vsp.address, '10000000000000000000', '0', '0', owner.address, timestamp + 60, {
      value: '10000000000000000000',
    })
    await sushiRouter.addLiquidityETH(vsp.address, '10000000000000000000', '0', '0', owner.address, timestamp + 60, {
      value: '10000000000000000000',
    })
    await controller.updateStrategy(veth.address, as.address)
    await controller.updateFeeCollector(veth.address, vvsp.address)
    await controller.updateWithdrawFee(veth.address, fee)
    await controller.updateStrategy(vvsp.address, vs.address)
    await controller.updateFounderVault(accounts[8].address)

    const path = [WETH, vsp.address]
    await uniRouter.swapExactETHForTokens(1, path, owner.address, timestamp + 120, {
      value: '500000000000000000',
    })

    let target = await veth.feeWhiteList()
    let methodSignature = 'add(address)'
    let data = defaultAbiCoder.encode(['address'], [vs.address])
    await controller.executeTransaction(target, 0, methodSignature, data)
    // Add keeper in VSP Strategy
    target = await vs.keepers()
    methodSignature = 'add(address)'
    data = defaultAbiCoder.encode(['address'], [owner.address])
    await controller.executeTransaction(target, 0, methodSignature, data)
    target = vs.address
    methodSignature = 'updateLiquidationQueue(address[],uint256[])'
    data = defaultAbiCoder.encode(['address[]', 'uint256[]'], [[veth.address], [BN.from(25000000000000).toString()]])
    await controller.executeTransaction(target, 0, methodSignature, data)
    await approveToken(controller, as.address)
    await createKeeperList(controller, as.address)
    const keepers = await as.keepers()
    await addInList(controller, keepers, owner.address)

    await time.increase(3600)
    await swapManager['updateOracles()']()
  }

  describe('Basic function tests', function () {
    beforeEach(async function () {
      ;[controller, vsp] = await Promise.all([deployContract('Controller'), deployContract('VSP')])
      await setupVPool()
    })

    it('Should deposit VSP in pool', async function () {
      const depositAmount = BN.from(10).mul(DECIMAL).toString()
      return vsp.approve(vvsp.address, depositAmount).then(function () {
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
      const {owner: _owner, deadline, sign} = await getPermitData(vsp, amount, MNEMONIC, vvsp.address)
      await vvsp.depositWithPermit(amount, deadline, sign.v, sign.r, sign.s)
      const vBalance = await vvsp.balanceOf(_owner)
      expect(vBalance.toString()).to.be.equal( amount, 'deposit with permit failed')
    })

    it('Should withdraw VSP in pool', async function () {
      const depositAmount = BN.from(10).mul(DECIMAL).toString()
      const tasks = [
        () => updateLockPeriod(0),
        () => vsp.approve(vvsp.address, depositAmount),
        () => vvsp.deposit(depositAmount),
        () => controller.updateFeeCollector(vvsp.address, owner.address),
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
        () => veth.connect(owner)['deposit()']({value: amount.toString()}),
        () => as.rebalance(),
        () => veth.withdraw(amount),
      ]
      await pSeries(tasks)
      const totalAuctions = await auctionMgr.totalAuctions()
      await vs.connect(owner).rebalance()
      const auctionId = await auctionMgr.totalAuctions()
      expect(auctionId.sub(totalAuctions)).to.be.equal('1', 'Auction was not created properly')
      const auction = await auctionMgr.getAuction(auctionId)
      expect(auction.tokens[0]).to.equal(WETH, 'Wrong token in auction')
      await blockMineFn(200)
      // bid
      await auctionMgr.connect(user1).bid(auctionId)
      const endedAuction = await auctionMgr.getAuction(auctionId)
      expect(endedAuction.winner).to.equal(user1.address, 'incorrect auction winner')
      const wethBalance = await weth.balanceOf(user1.address)
      expect(endedAuction.tokenAmounts[0]).to.equal(wethBalance.toString(), 'incorrect WETH amount sent to winner')
      // rebalance so VSP ends up back in pool
      await vs.connect(owner).rebalance()
      const vvspValue = await vvsp.totalValue()
      expect(vvspValue).to.be.gt('0', 'VVSP value is wrong')
    })

    it('only keeper should be able to do rebalance', async function () {
      const amount = '20000000000000000000'
      const tasks = [
        () => veth.connect(owner)['deposit()']({value: amount.toString()}),
        () => as.rebalance(),
        () => veth.withdraw(amount),
      ]
      await pSeries(tasks)
      const tx = vs.connect(user1).rebalance()
      await expect(tx).to.be.revertedWith('caller-is-not-keeper')
    })

    it('keeper should not be able to rebalance when contract paused', async function () {
      const amount = '20000000000000000000'
      const tasks = [
        () => veth.connect(owner)['deposit()']({value: amount.toString()}),
        () => as.rebalance(),
        () => veth.withdraw(amount),
      ]
      await pSeries(tasks)
      const target = await vs.address
      await controller.executeTransaction(target, 0, 'pause()', '0x')
      const tx = vs.connect(owner).rebalance()
      await expect(tx).to.be.revertedWith('Pausable: paused')
      await controller.executeTransaction(target, 0, 'unpause()', '0x')
      await vs.connect(owner).rebalance()
    })

    it('Should be able to liquidate vWBTC', async function () {
      await setupVWBTC()
      await swapper.swapEthForToken(10, wbtcAddress, owner)
      const wbtc = await ethers.getContractAt('TokenLike', wbtcAddress)
      const wbtcBalance = await wbtc.balanceOf(owner.address)
      await wbtc.connect(owner).approve(vwbtc.address, wbtcBalance)
      await vwbtc.deposit(wbtcBalance)
      await asWBTC.rebalance()
      const vwbtcBalance = await vwbtc.balanceOf(owner.address)
      await vwbtc.withdraw(vwbtcBalance)
      const totalAuctions = await auctionMgr.totalAuctions()
      await vs.connect(owner).rebalance()
      const auctionId = await auctionMgr.totalAuctions()
      expect(auctionId.sub(totalAuctions)).to.be.equal('1', 'Auction was not created properly')
      const auction = await auctionMgr.getAuction(auctionId)
      expect(auction.tokens[0]).to.equal(wbtcAddress, 'Wrong token in auction')
      await blockMineFn(400)
      // bid
      await auctionMgr.connect(user1).bid(auctionId)
      const endedAuction = await auctionMgr.getAuction(auctionId)
      expect(endedAuction.winner).to.equal(user1.address, 'incorrect auction winner')
      const user1WbtcBalance = await wbtc.balanceOf(user1.address)
      expect(endedAuction.tokenAmounts[0]).to.equal(user1WbtcBalance.toString(), 'incorrect WBTC amount sent to winner')
      // rebalance so VSP ends up back in pool
      await vs.connect(owner).rebalance()
      const vvspValue = await vvsp.totalValue()
      expect(vvspValue).to.be.gt('0', 'VVSP value is wrong')
    })

    it('Should not be able to sweep vToken', async function () {
      const amount = '20000000000000000000'
      const tasks = [
        () => veth.connect(owner)['deposit()']({value: amount}),
        () => as.rebalance(),
        () => veth.connect(owner).withdraw('10000000000000000000'),
        () => vvsp.sweepErc20(veth.address),
      ]
      const error = await pSeries(tasks).catch(exp => exp.message)
      expect(error.includes('Not allowed to sweep'), 'Sweep should fail')
      await weth.deposit({value: amount})
      await weth.transfer(vvsp.address, amount)
      let balance = await weth.balanceOf(vvsp.address)
      vvsp.sweepErc20(WETH)
      balance = await weth.balanceOf(vvsp.address)
      expect(balance.toString()).to.be.equal( '0', 'Sweep failed')
    })

    it('Should be able to sweep any non-vToken', async function () {
      const wbtc = await ethers.getContractAt('TokenLike', wbtcAddress)
      await swapper.swapEthForToken(10, wbtcAddress, owner)      
      let balance = await wbtc.balanceOf(owner.address)
      await wbtc.transfer(vvsp.address, balance)
      await vvsp.sweepErc20(wbtcAddress)
      balance = await wbtc.balanceOf(vvsp.address)
      expect(balance.toString()).to.be.equal( '0', 'Sweep failed')
    })

    it('Rebalance friction should prevent too frequent rebalance', async function () {
      const amount = '20000000000000000000'
      const tasks = [
        () => veth.connect(owner)['deposit()']({value: amount.toString()}),
        () => as.rebalance(),
        () => veth.withdraw(amount),
      ]
      await pSeries(tasks)
      await controller.updateFounderFee('500000000000000000')
      await controller.updateRebalanceFriction(vvsp.address, '4')
      await vs.connect(owner).rebalance()
      const error = await vs
        .connect(owner)
        .rebalance()
        .catch(exp => exp.message)
      expect(error.includes('Can not rebalance'), 'Should not allow to rebalance')
      await veth.connect(owner)['deposit()']({value: amount.toString()})
      await veth.connect(owner)['deposit()']({value: amount.toString()})
      await vs.connect(owner).rebalance()
    })

    it('Should be able to liquidate veth multiple times', async function () {
      const amount = '20000000000000000000'
      let tasks = [
        () => veth.connect(owner)['deposit()']({value: amount.toString()}),
        () => as.rebalance(),
        () => veth.withdraw(amount),
      ]
      await pSeries(tasks)

      let totalAuctions = await auctionMgr.totalAuctions()
      await vs.connect(owner).rebalance()
      let auctionId = await auctionMgr.totalAuctions()
      expect(auctionId.sub(totalAuctions)).to.be.equal('1', 'Auction was not created properly')
      totalAuctions = auctionId
      tasks = [() => veth.connect(owner)['deposit()']({value: amount.toString()}), () => as.rebalance()]
      await pSeries(tasks)
      const vBal = await veth.balanceOf(owner.address)
      await veth.withdraw(vBal)
      await vs.connect(owner).rebalance()
      auctionId = await auctionMgr.totalAuctions()
      expect(auctionId.sub(totalAuctions)).to.be.equal('1', 'Auction 2 was not created properly')
      totalAuctions = auctionId
      await vs.connect(owner).rebalance()
      auctionId = await auctionMgr.totalAuctions()
      expect(auctionId.sub(totalAuctions)).to.be.equal('1', 'Auction 3 was not created properly')
    })

    it('Should be able to liquidate vWBTC and vETH in order', async function () {
      // Setup and liquidate vWBTC
      await setupVWBTC()
      await swapper.swapEthForToken(10, wbtcAddress, owner)

      const wbtc = await ethers.getContractAt('TokenLike', wbtcAddress)
      const wbtcBalance = await wbtc.balanceOf(owner.address)
      await wbtc.connect(owner).approve(vwbtc.address, wbtcBalance)
      await vwbtc.deposit(wbtcBalance)
      await asWBTC.rebalance()
      const vwbtcBalance = await vwbtc.balanceOf(owner.address)
      await vwbtc.withdraw(vwbtcBalance)

      const totalAuctions = await auctionMgr.totalAuctions()
      await vs.connect(owner).rebalance()
      const auctionId = await auctionMgr.totalAuctions()
      expect(auctionId.sub(totalAuctions)).to.be.equal('1', 'Auction was not created properly')

      // Liduidate vETH
      const amount = '20000000000000000000'
      await veth.connect(owner)['deposit()']({value: amount.toString()})
      await as.rebalance()
      await veth.withdraw(amount)
      await vs.connect(owner).rebalance()
      const newAuctionId = await auctionMgr.totalAuctions()
      expect(newAuctionId.sub(auctionId)).to.be.equal('1', 'Auction 2 was not created properly')
    })

    it('Should be able to liquidate veth without fee', async function () {
      const amount = BN.from(125000000000000)
      const tasks = [
        () => veth.connect(owner)['deposit()']({value: amount.toString()}),
        () => veth.withdraw(amount),
      ]
      await pSeries(tasks)
      await vs.connect(owner).rebalance()

      const totalSupply = (await veth.totalSupply()).toString()
      expect(totalSupply).to.be.eq('0', 'VETH total supply is wrong')
    })

    it('Should continue to liquidate even if pool count is decreased', async function () {
      const amount = BN.from(125000000000000)
      const tasks = [
        () => veth.connect(owner)['deposit()']({value: amount.toString()}),
        () => as.rebalance(),
        () => veth.withdraw(amount),
      ]
      await pSeries(tasks)
      await vs.connect(owner).rebalance()
      await vs.connect(owner).rebalance()
      // // Remove veth pool, vwbtc still in list
      await controller.removePool(veth.address)
      let isPassed = true
      try {
        await vs.connect(owner).rebalance()
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

      await vvsp.connect(owner).delegate(owner.address)
      const blockNumber = await time.latestBlock()
      let votes = await vvsp.getCurrentVotes(owner.address)
      expect(votes.toString()).to.be.equal( depositAmount, 'Votes should be equal to depositAmount')

      const transferAmount = BN.from('2').mul(DECIMAL).toString()
      let remainingAmount = BN.from(depositAmount).sub(BN.from(transferAmount)).toString()
      await vvsp.transfer(user1.address, transferAmount)
      await vvsp.connect(user1).delegate(user1.address)
      votes = await vvsp.getCurrentVotes(user1.address)
      expect(votes.toString()).to.be.equal( transferAmount, 'Votes should be equal to transferAmount')
      votes = await vvsp.getCurrentVotes(owner.address)
      expect(votes.toString()).to.be.equal( remainingAmount, 'Votes should be equal to remainingAmount')

      await vvsp.withdraw(withdrawAmount)
      remainingAmount = BN.from(remainingAmount).sub(withdrawAmount).toString()
      votes = await vvsp.getCurrentVotes(owner.address)
      expect(votes.toString()).to.be.equal( remainingAmount, 'Votes should be equal to remainingAmount')

      votes = await vvsp.getPriorVotes(owner.address, blockNumber)
      expect(votes.toString()).to.be.equal( depositAmount, 'Prior votes should be equal to depositAmount')
    })

    it('Should delegate vote using signature', async function () {
      const delegator = owner
      const delegatee = user1.address
      const depositAmount = BN.from(10).mul(DECIMAL).toString()
      await vsp.connect(delegator).approve(vvsp.address, depositAmount)
      await vvsp.connect(delegator).deposit(depositAmount)

      const {deadline, nonce, sign} = await getDelegateData(vvsp, MNEMONIC, delegatee)
      await vvsp.delegateBySig(delegatee, nonce, deadline, sign.v, sign.r, sign.s)

      const votes = await vvsp.getCurrentVotes(delegatee)
      const vvspBalance = (await vvsp.balanceOf(delegator.address)).toString()
      expect(votes.toString()).to.be.equal( vvspBalance, 'Votes should be equal to vvspBalance')
    })

    it('Should allow gasless approval using permit()', async function () {
      const amount = BN.from(10).mul(DECIMAL).toString()
      const {deadline, sign} = await getPermitData(vvsp, amount, MNEMONIC, user1.address)
      await vvsp.permit(owner.address, user1.address, amount, deadline, sign.v, sign.r, sign.s)
      const allowance = await vvsp.allowance(owner.address, user1.address)
      expect(allowance.toString()).to.be.equal( amount, 'Allowance using permit is wrong')
    })
  })
})
