'use strict'

const {addGemJoin, approveToken, updateBalancingFactor} = require('./utils/setupHelper')
const {assert} = require('chai')
const BN = require('bn.js')
const VETH = artifacts.require('VETH')
const AaveMakerStrategy = artifacts.require('AaveMakerStrategyETH')
const AaveStrategy = artifacts.require('AaveStrategyETH')
const CollateralManager = artifacts.require('CollateralManager')
const Controller = artifacts.require('Controller')
const ERC20 = artifacts.require('ERC20')

const DECIMAL = new BN('1000000000000000000')
const aDaiAddress = '0xfC1E690f61EFd961294b3e1Ce3313fBD8aa4f85d'
const wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const mcdEthJoin = '0x2F0b23f53734252Bda2277357e97e1517d6B042A'
const mcdManaJoin = '0xA6EA3b9C04b8a38Ff5e224E7c3D6937ca44C0ef9'
const gemJoins = [mcdEthJoin, mcdManaJoin]
contract('Controller', function (accounts) {
  let veth, cm, strategy, vaultNum, controller, veth2, aaveStrategy

  async function getAllowance(token, owner, spender) {
    const Token = await ERC20.at(token)
    return Token.allowance(owner, spender)
  }

  async function setupVPool() {
    controller = await Controller.new()
    cm = await CollateralManager.new(controller.address)
    veth = await VETH.new(controller.address)
    veth2 = await VETH.new(controller.address)
    await controller.addPool(veth.address)
    await controller.addPool(veth2.address)
    strategy = await AaveMakerStrategy.new(controller.address, veth.address, cm.address)
    aaveStrategy = await AaveStrategy.new(controller.address, veth2.address)
    await Promise.all([
      controller.updateStrategy(veth.address, strategy.address),
      controller.updateStrategy(veth2.address, aaveStrategy.address),
      updateBalancingFactor(controller, strategy.address, [300, 250]),
      addGemJoin(controller, cm.address, gemJoins),
      approveToken(controller, strategy.address),
    ])
    vaultNum = await strategy.vaultNum()
  }

  describe('Only controller action tests', function () {
    beforeEach(async function () {
      await setupVPool()
      assert.isNotNull(veth.address)
      assert.isNotNull(vaultNum)
    })

    it('Should withdraw all', async function () {
      const aDAI = await ERC20.at(aDaiAddress)
      const depositAmount = new BN(10).mul(new BN(DECIMAL))

      await veth.methods['deposit()']({value: depositAmount})
      await strategy.rebalanceCollateral()
      const tokenLocked = await veth.tokenLocked()
      assert(tokenLocked.gt(new BN(0)), 'Token locked is not correct')
      const aDaiBalance = await aDAI.balanceOf(veth.address)
      assert(aDaiBalance.gt(new BN(0)), 'aToken balance is wrong')

      const target = strategy.address
      const methodSignature = 'withdrawAllWithRebalance()'
      const data = '0x'
      await controller.executeTransaction(target, 0, methodSignature, data, {from: accounts[0]})
      const tokenLockedAfter = await veth.tokenLocked()
      assert.equal(tokenLockedAfter.toString(), '0', 'Token locked should be 0')
      const aDaiBalanceAfter = await aDAI.balanceOf(veth.address)
      assert.equal(aDaiBalanceAfter.toString(), '0', 'aToken balance should be 0')
      const tokensHere = await veth.tokensHere()
      assert(tokensHere.gte(tokenLocked), 'Incorrect balance after withdrawAllWithRebalance')
    })

    it('Should leave aToken if withdrawAll without rebalance', async function () {
      const aDAI = await ERC20.at(aDaiAddress)
      const depositAmount = new BN(10).mul(new BN(DECIMAL))

      await veth.methods['deposit()']({value: depositAmount})
      await veth.rebalance()
      const tokenLocked = await veth.tokenLocked()
      assert(tokenLocked.gt(new BN(0)), 'Token locked is not correct')
      const aDaiBalance = await aDAI.balanceOf(veth.address)
      assert(aDaiBalance.gt(new BN(0)), 'aToken balance is wrong')

      const target = strategy.address
      const methodSignature = 'withdrawAll()'
      const data = '0x'
      await controller.executeTransaction(target, 0, methodSignature, data, {from: accounts[0]})
      const tokenLockedAfter = await veth.tokenLocked()
      assert.equal(tokenLockedAfter.toString(), '0', 'Token locked should be 0')
      const aDaiBalanceAfter = await aDAI.balanceOf(veth.address)
      assert(aDaiBalanceAfter.gt(new BN(0)), 'aToken balance should be greater than 0')
      const tokensHere = await veth.tokensHere()
      assert(tokensHere.gte(tokenLocked), 'Incorrect balance after withdrawAll')
    })

    it('Should be able to withdrawAll when 0 debt and dust collateral in vault', async function () {
      const depositAmount = new BN(3).mul(new BN(DECIMAL))
      await veth.methods['deposit()']({value: depositAmount})
      await strategy.rebalanceCollateral()
      let o = await veth.balanceOf(accounts[0])
      await veth.withdraw(new BN(o).sub(new BN('100000000000000')).toString())
      const target = strategy.address
      const methodSignature = 'withdrawAll()'
      const data = '0x'
      await controller.executeTransaction(target, 0, methodSignature, data, {from: accounts[0]})
      o = await cm.getVaultInfo(vaultNum)
      assert.equal(o.collateralLocked, '0', 'Token locked should be 0')
      assert.equal(o.daiDebt, '0', 'DaiDebt should be 0')
    })

    it('Should allow controller to pause unpause deposit', async function () {
      const depositAmount = new BN(10).mul(DECIMAL)
      await veth.methods['deposit()']({value: depositAmount, from: accounts[1]})

      await strategy.rebalanceCollateral()

      let thrown
      try {
        await veth.pause({from: accounts[1]})
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Only controller should be able to pause')
      const withdrawAmount = new BN(2).mul(DECIMAL)
      const target = veth.address
      let methodSignature = 'pause()'
      const data = '0x'
      await controller.executeTransaction(target, 0, methodSignature, data, {from: accounts[0]})
      await veth.withdrawETH(withdrawAmount, {from: accounts[1]})
      thrown = false
      try {
        await veth.methods['deposit()']({value: depositAmount, from: accounts[8]})
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'should not be able to deposit after pause')
      thrown = false
      try {
        await veth.unpause({from: accounts[1]})
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'non owner should not be able to unpause')
      methodSignature = 'unpause()'
      await controller.executeTransaction(target, 0, methodSignature, data, {from: accounts[0]})
      await veth.methods['deposit()']({value: depositAmount, from: accounts[9]})
      await veth.withdrawETH(withdrawAmount, {from: accounts[1]})
      await strategy.rebalanceCollateral()
      const remaining = depositAmount.sub(withdrawAmount).sub(withdrawAmount).toString()
      const balance = (await veth.balanceOf(accounts[1])).toString()
      assert.equal(balance, remaining, 'veth balance is wrong')
    })

    it('Should allow controller to shutdown, open and unpause', async function () {
      const depositAmount = new BN(10).mul(DECIMAL).toString()
      await veth.methods['deposit()']({value: depositAmount, from: accounts[1]})
      let thrown
      try {
        await veth.shutdown({from: accounts[1]})
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Only controller should be able to shutdown')
      const withdrawAmount = new BN(2).mul(DECIMAL).toString()
      const target = veth.address
      let methodSignature = 'shutdown()'
      const data = '0x'
      await controller.executeTransaction(target, 0, methodSignature, data, {from: accounts[0]})

      thrown = false
      try {
        await veth.withdrawETH(withdrawAmount)
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Wwithdraw is not allowed after shutdown')
      thrown = false
      try {
        await veth.methods['deposit()']({value: depositAmount, from: accounts[8]})
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Deposit is not allowed after shutdown')
      thrown = false
      try {
        await veth.open({from: accounts[1]})
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Only controller should be able to re-open')
      methodSignature = 'open()'
      await controller.executeTransaction(target, 0, methodSignature, data, {from: accounts[0]})
      try {
        await veth.methods['deposit()']({value: depositAmount, from: accounts[8]})
      } catch (e) {
        thrown = true
      }
      assert(thrown, "Deposit requires 'unpause' after reopen")
      methodSignature = 'unpause()'
      await controller.executeTransaction(target, 0, methodSignature, data, {from: accounts[0]})
      await veth.methods['deposit()']({value: depositAmount, from: accounts[8]})
      await veth.withdrawETH(withdrawAmount, {from: accounts[1]})
      await strategy.rebalanceCollateral()
      const remaining = new BN(depositAmount).sub(new BN(withdrawAmount)).toString()
      const balance = (await veth.balanceOf(accounts[1])).toString()
      assert.equal(balance, remaining, 'veth balance is wrong')
    })

    it('MakerStrategy: Should allow controller to Rebalance when paused', async function () {
      const depositAmount = new BN(10).mul(DECIMAL).toString()
      await veth.methods['deposit()']({value: depositAmount, from: accounts[1]})
      let methodSignature = 'pause()'
      let target = strategy.address
      const data = '0x'
      await controller.executeTransaction(target, 0, methodSignature, data, {from: accounts[0]})
      let thrown
      thrown = false
      try {
        await strategy.rebalanceCollateral({from: accounts[1]})
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Normal user should not be able to rebalance after pause')
      thrown = false
      try {
        await strategy.rebalanceEarned({from: accounts[1]})
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Normal user should not be able to rebalanceEarned after pause')

      thrown = false
      try {
        await strategy.rebalance({from: accounts[1]})
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Normal user should not be able to rebalance after pause')

      thrown = false
      try {
        await strategy.resurface({from: accounts[1]})
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Normal user should not be able to resurface after pause')

      target = strategy.address
      methodSignature = 'rebalanceCollateral()'
      await controller.executeTransaction(target, 0, methodSignature, data, {from: accounts[0]})
      let collateralRatio = (await cm.getVaultInfo(vaultNum)).collateralRatio.toString()
      let highWater = (await strategy.highWater()).toString()
      assert.equal(collateralRatio, highWater, 'collateral ratio is not balanced')
      methodSignature = 'rebalanceEarned()'
      await controller.executeTransaction(target, 0, methodSignature, data, {from: accounts[0]})
      await veth.methods['deposit()']({value: depositAmount, from: accounts[1]})
      methodSignature = 'rebalanceEarned()'
      await controller.executeTransaction(target, 0, methodSignature, data, {from: accounts[0]})

      target = strategy.address
      methodSignature = 'unpause()'
      await controller.executeTransaction(target, 0, methodSignature, data, {from: accounts[0]})
      await veth.methods['deposit()']({value: depositAmount, from: accounts[1]})
      await strategy.rebalance({from: accounts[1]})
      collateralRatio = (await cm.getVaultInfo(vaultNum)).collateralRatio
      highWater = await strategy.highWater()
      const lowWater = await strategy.lowWater()
      assert(collateralRatio.lte(highWater), 'collateral ratio is not balanced')
      assert(collateralRatio.gte(lowWater), 'collateral ratio is not balanced')
      await strategy.rebalanceEarned({from: accounts[1]})
      await veth.methods['deposit()']({value: depositAmount, from: accounts[1]})
      const isUnderwater = await strategy.isUnderwater()
      if (isUnderwater) {
        await strategy.resurface({from: accounts[1]})
      }
      await strategy.rebalance({from: accounts[1]})
    })

    it('AaveStrategy: Should allow controller to Rebalance when paused', async function () {
      const depositAmount = new BN(10).mul(DECIMAL).toString()
      await veth2.methods['deposit()']({value: depositAmount, from: accounts[1]})
      let methodSignature = 'pause()'
      let target = aaveStrategy.address
      const data = '0x'
      await controller.executeTransaction(target, 0, methodSignature, data, {from: accounts[0]})
      let thrown
      thrown = false
      try {
        await aaveStrategy.rebalance({from: accounts[1]})
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Normal user should not be able to rebalance after shutdown')

      target = aaveStrategy.address
      methodSignature = 'rebalance()'
      await controller.executeTransaction(target, 0, methodSignature, data, {from: accounts[0]})
      const aEthAddress = await aaveStrategy.token()
      const aEth = await ERC20.at(aEthAddress)
      let aEthBalance = await aEth.balanceOf(veth2.address)
      let vEthBalance = await veth2.balanceOf(accounts[1])
      assert.equal(aEthBalance.toString(), depositAmount, 'aEth balance wrong')
      assert.equal(vEthBalance.toString(), depositAmount, 'vEth balance wrong')
      target = aaveStrategy.address
      methodSignature = 'unpause()'
      await controller.executeTransaction(target, 0, methodSignature, data, {from: accounts[0]})
      await veth2.methods['deposit()']({value: depositAmount, from: accounts[1]})
      await aaveStrategy.rebalance({from: accounts[1]})
      aEthBalance = await aEth.balanceOf(veth2.address)
      vEthBalance = await veth2.balanceOf(accounts[1])
      const totalDeposited = new BN(depositAmount).mul(new BN(2))
      assert(new BN(aEthBalance).gt(new BN(totalDeposited)), 'aEth balance wrong')
    })

    it('Owner should be able to transfer ownership', async function () {
      const controllerHere = await Controller.new()
      const owner = await controllerHere.owner()
      assert.equal(owner, accounts[0], 'Owner is not correct')
      await controllerHere.transferOwnership(accounts[2])

      assert.equal(await controllerHere.owner(), accounts[0], "Owner shouldn't change")

      await controllerHere.acceptOwnership({from: accounts[2]})

      const newOwner = await controllerHere.owner()
      assert.equal(newOwner, accounts[2], 'New owner is not correct')
    })

    it('Should be able to update Strategy', async function () {
      const aEthAddress = await aaveStrategy.token()
      // Check allowance
      let aEthAllowance = await getAllowance(aEthAddress, veth2.address, aaveStrategy.address)
      let wethAllowance = await getAllowance(wethAddress, veth2.address, aaveStrategy.address)
      assert(aEthAllowance.gt(new BN('0')), 'aEth allowance should be greater than zero')
      assert(wethAllowance.gt(new BN('0')), 'WETH allowance should be greater than zero')

      const newStrategy = await AaveStrategy.new(controller.address, veth2.address)
      await controller.updateStrategy(veth2.address, newStrategy.address)

      // Allowance on old address
      aEthAllowance = await getAllowance(aEthAddress, veth2.address, aaveStrategy.address)
      wethAllowance = await getAllowance(wethAddress, veth2.address, aaveStrategy.address)
      assert(aEthAllowance.eq(new BN('0')), 'aEth allowance should be equal to zero')
      assert(wethAllowance.eq(new BN('0')), 'WETH allowance should be equal to zero')

      // Allowance on new address
      aEthAllowance = await getAllowance(aEthAddress, veth2.address, newStrategy.address)
      wethAllowance = await getAllowance(wethAddress, veth2.address, newStrategy.address)
      assert(aEthAllowance.gt(new BN('0')), 'new aEth allowance should be greater than zero')
      assert(wethAllowance.gt(new BN('0')), 'new WETH allowance should be greater than zero')
    })
  })
})
