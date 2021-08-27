'use strict'

const {ethers} = require('hardhat')
const {
  addGemJoin,
  approveToken,
  updateBalancingFactor,
  createKeeperList,
  addInList,
  deployContract
} = require('./utils/setupHelper')
const {rebalance} = require('./utils/poolOps')
const {assert} = require('chai')
const {BigNumber: BN} = require('ethers')

const DECIMAL = BN.from('1000000000000000000')
const aDaiAddress = '0x028171bCA77440897B824Ca71D1c56caC55b68A3'
const wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const mcdEthJoin = '0x2F0b23f53734252Bda2277357e97e1517d6B042A'
const mcdManaJoin = '0xA6EA3b9C04b8a38Ff5e224E7c3D6937ca44C0ef9'
const gemJoins = [mcdEthJoin, mcdManaJoin]
describe('Controller', function() {
  let veth, cm, strategy, vaultNum, controller, veth2, aaveStrategy, accounts

  async function getAllowance(token, owner, spender) {
    const Token = await ethers.getContractAt('ERC20', token)
    return Token.allowance(owner, spender)
  }

  async function setupVPool() {
    accounts = await ethers.getSigners()
    controller = await deployContract('Controller')
    cm = await deployContract('CollateralManager',[controller.address])
    veth = await deployContract('VETH', [controller.address])
    veth2 = await deployContract('VETH', [controller.address])
    await controller.addPool(veth.address)
    await controller.addPool(veth2.address)
    strategy = await deployContract('AaveV2MakerStrategyETH', [controller.address, veth.address, cm.address])
    aaveStrategy = await deployContract('AaveV2StrategyETH', [controller.address, veth2.address])
    await Promise.all([
      controller.updateStrategy(veth.address, strategy.address),
      controller.updateStrategy(veth2.address, aaveStrategy.address),

      updateBalancingFactor(controller, strategy.address, [300, 250]),
      addGemJoin(controller, cm.address, gemJoins)
    ])

    await approveToken(controller, strategy.address)
    await createKeeperList(controller, strategy.address)
    const keepers = await strategy.keepers()
    await addInList(controller, keepers, accounts[0].address)
    await addInList(controller, keepers, controller.address)

    await approveToken(controller, aaveStrategy.address)
    await createKeeperList(controller, aaveStrategy.address)
    const keepers2 = await aaveStrategy.keepers()
    await addInList(controller, keepers2, accounts[0].address)
    await addInList(controller, keepers2, controller.address)

    vaultNum = await strategy.vaultNum()
  }

  describe('Only controller action tests', function() {
    beforeEach(async function() {
      await setupVPool()
      assert.isNotNull(veth.address)
      assert.isNotNull(vaultNum.toString())
    })

    it('Should withdraw all', async function() {
      const aDAI = await ethers.getContractAt('ERC20', aDaiAddress)
      const depositAmount = BN.from(100).mul(BN.from(DECIMAL))
      await veth.connect(accounts[0])['deposit()']({value: depositAmount})
      await strategy.rebalanceCollateral()
      const tokenLocked = await veth.tokenLocked()
      assert(tokenLocked.gt(BN.from(0)), 'Token locked is not correct')
      const aDaiBalance = await aDAI.balanceOf(strategy.address)
      assert(aDaiBalance.gt(BN.from(0)), 'aToken balance is wrong')

      const target = strategy.address
      const methodSignature = 'withdrawAllWithRebalance()'
      const data = '0x'
      await controller.executeTransaction(target, 0, methodSignature, data)
      const tokenLockedAfter = await veth.tokenLocked()
      assert.equal(tokenLockedAfter.toString(), '0', 'Token locked should be 0')
      const aDaiBalanceAfter = await aDAI.balanceOf(veth.address)
      assert.equal(aDaiBalanceAfter.toString(), '0', 'aToken balance should be 0')
      const tokensHere = await veth.tokensHere()
      assert(tokensHere.gte(tokenLocked), 'Incorrect balance after withdrawAllWithRebalance')
    })

    it('Should leave aToken if withdrawAll without rebalance', async function() {
      const aDAI = await ethers.getContractAt('ERC20', aDaiAddress)
      const depositAmount = BN.from(100).mul(BN.from(DECIMAL))
      await veth.connect(accounts[0])['deposit()']({value: depositAmount})
      await strategy.rebalance()
      const tokenLocked = await veth.tokenLocked()

      assert(tokenLocked.gt(BN.from(0)), 'Token locked is not correct')
      const aDaiBalance = await aDAI.balanceOf(strategy.address)
      assert(aDaiBalance.gt(BN.from(0)), 'aToken balance is wrong')

      const target = strategy.address
      const methodSignature = 'withdrawAll()'
      const data = '0x'
      await controller.executeTransaction(target, 0, methodSignature, data)
      const tokenLockedAfter = await veth.tokenLocked()
      assert.equal(tokenLockedAfter.toString(), '0', 'Token locked should be 0')
      const aDaiBalanceAfter = await aDAI.balanceOf(strategy.address)
      assert(aDaiBalanceAfter.gt(BN.from(0)), 'aToken balance should be greater than 0')
      const tokensHere = await veth.tokensHere()
      assert(tokensHere.gte(tokenLocked), 'Incorrect balance after withdrawAll')
    })

    it('Should be able to withdrawAll when 0 debt and dust collateral in vault', async function() {
      const depositAmount = BN.from(3).mul(BN.from(DECIMAL))
      await veth.connect(accounts[0])['deposit()']({value: depositAmount})
      await strategy.rebalanceCollateral()
      let o = await veth.balanceOf(accounts[0].address)
      await veth.withdraw(BN.from(o).sub(BN.from('100000000000000')).toString())
      const target = strategy.address
      const methodSignature = 'withdrawAll()'
      const data = '0x'
      await controller.executeTransaction(target, 0, methodSignature, data)
      o = await cm.getVaultInfo(vaultNum)
      assert.equal(o.collateralLocked, '0', 'Token locked should be 0')
      assert.equal(o.daiDebt, '0', 'DaiDebt should be 0')
    })

    it('Should allow controller to pause unpause deposit', async function() {
      const depositAmount = BN.from(10).mul(DECIMAL)
      await veth.connect(accounts[1])['deposit()']({value: depositAmount})

      await strategy.rebalanceCollateral()

      let thrown
      try {
        await veth.connect(accounts[1]).pause()
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Only controller should be able to pause')
      const withdrawAmount = BN.from(2).mul(DECIMAL)
      const target = veth.address
      let methodSignature = 'pause()'
      const data = '0x'
      await controller.executeTransaction(target, 0, methodSignature, data)
      await veth.connect(accounts[1]).withdrawETH(withdrawAmount)
      thrown = false
      try {
        await veth.connect(accounts[8])['deposit()']({value: depositAmount})
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'should not be able to deposit after pause')
      thrown = false
      try {
        await veth.connect(accounts[1]).unpause()
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'non owner should not be able to unpause')
      methodSignature = 'unpause()'
      await controller.executeTransaction(target, 0, methodSignature, data)
      await veth.connect(accounts[9])['deposit()']({value: depositAmount})
      await veth.connect(accounts[1]).withdrawETH(withdrawAmount)
      await strategy.rebalanceCollateral()
      const remaining = depositAmount
        .sub(withdrawAmount)
        .sub(withdrawAmount)
        .toString()
      const balance = (await veth.balanceOf(accounts[1].address)).toString()
      assert.equal(balance, remaining, 'veth balance is wrong')
    })

    it('Should allow controller to shutdown, open and unpause', async function() {
      const depositAmount = BN.from(10).mul(DECIMAL).toString()
      await veth.connect(accounts[1])['deposit()']({value: depositAmount})
      let thrown
      try {
        await veth.connect(accounts[1]).shutdown()
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Only controller should be able to shutdown')
      const withdrawAmount = BN.from(2).mul(DECIMAL).toString()
      const target = veth.address
      let methodSignature = 'shutdown()'
      const data = '0x'
      await controller.executeTransaction(target, 0, methodSignature, data)

      thrown = false
      try {
        await veth.withdrawETH(withdrawAmount)
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Wwithdraw is not allowed after shutdown')
      thrown = false
      try {
        await veth.connect(accounts[8])['deposit()']({value: depositAmount})
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Deposit is not allowed after shutdown')
      thrown = false
      try {
        await veth.connect(accounts[1]).open()
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Only controller should be able to re-open')
      methodSignature = 'open()'
      await controller.executeTransaction(target, 0, methodSignature, data)
      try {
        await veth.connect(accounts[8])['deposit()']({value: depositAmount})
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Deposit requires \'unpause\' after reopen')
      methodSignature = 'unpause()'
      await controller.executeTransaction(target, 0, methodSignature, data)
      await veth.connect(accounts[8])['deposit()']({value: depositAmount})
      await veth.connect(accounts[1]).withdrawETH(withdrawAmount)
      await strategy.rebalanceCollateral()
      const remaining = BN.from(depositAmount).sub(BN.from(withdrawAmount)).toString()
      const balance = (await veth.balanceOf(accounts[1].address)).toString()
      assert.equal(balance, remaining, 'veth balance is wrong')
    })

    it('MakerStrategy: Should allow controller to Rebalance when paused', async function() {
      const depositAmount = BN.from(100).mul(DECIMAL).toString()
      await veth.connect(accounts[1])['deposit()']({value: depositAmount})
      let methodSignature = 'pause()'
      let target = strategy.address
      const data = '0x'
      await controller.executeTransaction(target, 0, methodSignature, data)
      let thrown
      thrown = false
      try {
        await strategy.connect(accounts[1]).rebalanceCollateral()
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Normal user should not be able to rebalance after pause')
      thrown = false
      try {
        await strategy.connect(accounts[1]).rebalanceEarned()
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Normal user should not be able to rebalanceEarned after pause')

      thrown = false
      try {
        await strategy.connect(accounts[1]).rebalance()
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Normal user should not be able to rebalance after pause')

      thrown = false
      try {
        await strategy.connect(accounts[1]).resurface()
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Normal user should not be able to resurface after pause')

      target = strategy.address
      methodSignature = 'rebalanceCollateral()'
      await controller.executeTransaction(target, 0, methodSignature, data)
      let collateralRatio = (await cm.getVaultInfo(vaultNum)).collateralRatio.toString()
      let highWater = (await strategy.highWater()).toString()
      assert.equal(collateralRatio, highWater, 'collateral ratio is not balanced')
      methodSignature = 'rebalanceEarned()'
      await controller.executeTransaction(target, 0, methodSignature, data)
      await veth.connect(accounts[1])['deposit()']({value: depositAmount})
      methodSignature = 'rebalanceEarned()'
      await controller.executeTransaction(target, 0, methodSignature, data)

      target = strategy.address
      methodSignature = 'unpause()'
      await controller.executeTransaction(target, 0, methodSignature, data)
      await veth.connect(accounts[1])['deposit()']({value: depositAmount})
      rebalance(strategy, accounts)
      collateralRatio = (await cm.getVaultInfo(vaultNum)).collateralRatio
      highWater = await strategy.highWater()
      const lowWater = await strategy.lowWater()
      assert(collateralRatio.lte(highWater), 'collateral ratio is not balanced')
      assert(collateralRatio.gte(lowWater), 'collateral ratio is not balanced')
      await strategy.connect(accounts[0]).rebalanceEarned()
      await veth.connect(accounts[1])['deposit()']({value: depositAmount})
      rebalance(strategy, accounts)
    })

    it('AaveStrategy: Should allow controller to Rebalance when paused', async function() {
      const depositAmount = BN.from(100).mul(DECIMAL).toString()
      await veth2.connect(accounts[1])['deposit()']({value: depositAmount})
      let methodSignature = 'pause()'
      let target = aaveStrategy.address
      const data = '0x'
      await controller.executeTransaction(target, 0, methodSignature, data)
      let thrown
      thrown = false
      try {
        await aaveStrategy.connect(accounts[1]).rebalance()
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Normal user should not be able to rebalance after shutdown')

      target = aaveStrategy.address
      methodSignature = 'rebalance()'
      await controller.executeTransaction(target, 0, methodSignature, data)
      const aEthAddress = await aaveStrategy.token()
      const aEth = await ethers.getContractAt('ERC20', aEthAddress)
      let aEthBalance = await aEth.balanceOf(aaveStrategy.address)
      let vEthBalance = await veth2.balanceOf(accounts[1].address)
      assert.equal(aEthBalance.toString(), depositAmount, 'aEth balance wrong')
      assert.equal(vEthBalance.toString(), depositAmount, 'vEth balance wrong')
      target = aaveStrategy.address
      methodSignature = 'unpause()'
      await controller.executeTransaction(target, 0, methodSignature, data)
      await veth2.connect(accounts[1])['deposit()']({value: depositAmount})
      await aaveStrategy.rebalance()
      aEthBalance = await aEth.balanceOf(aaveStrategy.address)
      vEthBalance = await veth2.balanceOf(accounts[1].address)
      const totalDeposited = BN.from(depositAmount).mul(BN.from(2))
      assert(BN.from(aEthBalance).gt(BN.from(totalDeposited)), 'aEth balance wrong')
    })

    it('Owner should be able to transfer ownership', async function() {
      const controllerHere = await deployContract('Controller')
      const owner = await controllerHere.owner()
      assert.equal(owner, accounts[0].address, 'Owner is not correct')
      await controllerHere.transferOwnership(accounts[2].address)

      assert.equal(await controllerHere.owner(), accounts[0].address, 'Owner shouldn\'t change')

      await controllerHere.connect(accounts[2]).acceptOwnership()

      const newOwner = await controllerHere.owner()
      assert.equal(newOwner, accounts[2].address, 'New owner is not correct')
    })

    it('Should be able to update Strategy', async function() {
      const aEthAddress = await aaveStrategy.token()
      // Check allowance
      let aEthAllowance = await getAllowance(aEthAddress, veth2.address, aaveStrategy.address)
      let wethAllowance = await getAllowance(wethAddress, veth2.address, aaveStrategy.address)
      assert(aEthAllowance.gt(BN.from('0')), 'aEth allowance should be greater than zero')
      assert(wethAllowance.gt(BN.from('0')), 'WETH allowance should be greater than zero')

      const newStrategy = await deployContract('AaveV2StrategyETH',[controller.address, veth2.address])
      await controller.updateStrategy(veth2.address, newStrategy.address)

      // Allowance on old address
      aEthAllowance = await getAllowance(aEthAddress, veth2.address, aaveStrategy.address)
      wethAllowance = await getAllowance(wethAddress, veth2.address, aaveStrategy.address)
      assert(aEthAllowance.eq(BN.from('0')), 'aEth allowance should be equal to zero')
      assert(wethAllowance.eq(BN.from('0')), 'WETH allowance should be equal to zero')

      // Allowance on new address
      aEthAllowance = await getAllowance(aEthAddress, veth2.address, newStrategy.address)
      wethAllowance = await getAllowance(wethAddress, veth2.address, newStrategy.address)
      assert(aEthAllowance.gt(BN.from('0')), 'new aEth allowance should be greater than zero')
      assert(wethAllowance.gt(BN.from('0')), 'new WETH allowance should be greater than zero')
    })
  })
})
