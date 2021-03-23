'use strict'

const timeMachine = require('ganache-time-traveler')
const {assert} = require('chai')
const VETH = artifacts.require('VETH')
const AaveStrategy = artifacts.require('AaveMakerStrategyETH')
const Controller = artifacts.require('Controller')
const CollateralManager = artifacts.require('CollateralManager')

const Timelock = artifacts.require('Timelock')
const IAddressList = artifacts.require('IAddressList')

contract('Timelock', async function (accounts) {
  let veth, cm, strategy, controller, timelock

  const TWO_DAYS = 172800
  const ETA_BUFFER = TWO_DAYS + 5
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

  async function getETA() {
    return (await web3.eth.getBlock('latest')).timestamp + ETA_BUFFER
  }

  describe('Basic functionality tests', function () {
    before(async function () {
      controller = await Controller.new()
      timelock = await Timelock.new(accounts[0], TWO_DAYS)
      cm = await CollateralManager.new(controller.address)
      veth = await VETH.new(controller.address)
    })

    it('Should accept ownership in controller', async function () {
      await controller.transferOwnership(timelock.address)

      const target = controller.address
      const value = 0
      const methodSignature = 'acceptOwnership()'
      const data = '0x'
      const eta = await getETA()
      await timelock.queueTransaction(target, value, methodSignature, data, eta)

      let owner = await controller.owner()
      assert.notEqual(owner, timelock.address, 'Timelock is not the owner')

      await timeMachine.advanceTimeAndBlock(ETA_BUFFER)
      await timelock.executeTransaction(target, value, methodSignature, data, eta)

      owner = await controller.owner()
      assert.equal(owner, timelock.address, 'Timelock is the owner')
    })

    it('Should add pool in controller', async function () {
      const target = controller.address
      const value = 0
      const methodSignature = 'addPool(address)'
      const data = web3.eth.abi.encodeParameter('address', veth.address)
      const eta = await getETA()
      await timelock.queueTransaction(target, value, methodSignature, data, eta)
      const poolListAddress = await controller.pools()
      const poolList = await IAddressList.at(poolListAddress)
      let v = await poolList.get(veth.address)
      assert.equal(v, 0, 'Not a pool address')

      await timeMachine.advanceTimeAndBlock(ETA_BUFFER)
      await timelock.executeTransaction(target, value, methodSignature, data, eta)
      v = await poolList.get(veth.address)
      assert.equal(v, 1, 'Pool is added correctly')
    })

    it('Should update pool strategy in controller', async function () {
      strategy = await AaveStrategy.new(controller.address, veth.address, cm.address)

      const target = controller.address
      const value = 0
      const methodSignature = 'updateStrategy(address,address)'
      const data = web3.eth.abi.encodeParameters(
        ['address', 'address'],
        [veth.address, strategy.address]
      )
      const eta = await getETA()
      await timelock.queueTransaction(target, value, methodSignature, data, eta)

      let poolStrategy = await controller.strategy(veth.address)
      assert.equal(poolStrategy, ZERO_ADDRESS, 'Pool strategy should be zero')
      await timeMachine.advanceTimeAndBlock(ETA_BUFFER)
      await timelock.executeTransaction(target, value, methodSignature, data, eta)

      poolStrategy = await controller.strategy(veth.address)
      assert.equal(poolStrategy, strategy.address, 'pool strategy is updated correctly')
    })

    it('Should set new pending admin and accept it', async function () {
      const newPendingAdmin = accounts[2]

      const target = timelock.address
      const value = 0
      const methodSignature = 'setPendingAdmin(address)'
      const data = web3.eth.abi.encodeParameter('address', newPendingAdmin)
      const eta = await getETA()
      await timelock.queueTransaction(target, value, methodSignature, data, eta)

      let admin = await timelock.admin()
      assert.equal(admin, accounts[0], 'Timelock admin is not correct')

      await timeMachine.advanceTimeAndBlock(ETA_BUFFER)
      await timelock.executeTransaction(target, value, methodSignature, data, eta)

      await timelock.acceptAdmin({from: newPendingAdmin})
      admin = await timelock.admin()
      assert.equal(admin, newPendingAdmin, 'Timelock admin is not correct')
    })
  })
})
