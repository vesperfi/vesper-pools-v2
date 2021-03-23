'use strict'

const {assert} = require('chai')
const BN = require('bn.js')
const VETH = artifacts.require('VETH')
const VSP = artifacts.require('VSP')
const Controller = artifacts.require('Controller')
const AaveStrategy = artifacts.require('AaveStrategyWBTC')
const DECIMAL = new BN('1000000000000000000')

let veth, controller
async function setupVPool() {
  controller = await Controller.new()
  veth = await VETH.new(controller.address)
  await controller.addPool(veth.address)
  const strategy = await AaveStrategy.new(controller.address, veth.address)
  await controller.updateStrategy(veth.address, strategy.address)
}

contract('Vesper Pool Token Multitransfer', function (accounts) {
  it('Should test multi transfer of vesper pool tokens', async function () {
    await setupVPool()
    const depositAmount = new BN(1).mul(DECIMAL).toString()
    await veth.methods['deposit()']({value: depositAmount})
    const vBalancebefore = await veth.balanceOf(accounts[0])
    const tokenAmount = '000000000000000000000001'
    const RECIPIENTS = [
      accounts[4],
      accounts[5],
      accounts[6],
      accounts[7],
      accounts[8],
      accounts[9],
    ]
    const bitParam = []
    for (let idx = 0; idx < RECIPIENTS.length; idx++) {
      const recipient = RECIPIENTS[idx]
      bitParam.push(recipient + tokenAmount)
    }

    await veth.multiTransfer(bitParam)

    for (let idx = 0; idx < RECIPIENTS.length; idx++) {
      const recipient = RECIPIENTS[idx]
      const balance = await veth.balanceOf(recipient)
      assert.equal(balance.toString(), '1', `multi-transfer failed for ${idx}`)
    }
    const vBalanceAfter = await veth.balanceOf(accounts[0])
    assert.equal(
      new BN(vBalancebefore).sub(new BN(vBalanceAfter)).toString(),
      '6',
      'multi transfer wrong'
    )
  })
})

contract('Vesper (VSP) Token Multitransfer', function (accounts) {
  it('Should multi transfer of VSP tokens', async function () {
    const vsp = await VSP.new()
    const mintAmount = new BN('3000').mul(DECIMAL)
    await vsp.mint(accounts[0], mintAmount, {from: accounts[0]})

    const tokenAmount = '000000000000000000000001' // 1 wei VSP
    const RECIPIENTS = [
      accounts[4],
      accounts[5],
      accounts[6],
      accounts[7],
      accounts[8],
      accounts[9],
    ]

    const bitParam = []
    for (let idx = 0; idx < RECIPIENTS.length; idx++) {
      const recipient = RECIPIENTS[idx]
      bitParam.push(recipient + tokenAmount)
    }

    await vsp.multiTransfer(bitParam, {from: accounts[0]})

    for (let idx = 0; idx < RECIPIENTS.length; idx++) {
      const recipient = RECIPIENTS[idx]
      const balance = await vsp.balanceOf(recipient)
      assert.equal(balance.toString(), '1', `multi-transfer failed for ${idx}`)
    }
    const vspBalace = await vsp.balanceOf(accounts[0])
    assert.equal(mintAmount.sub(vspBalace).toString(), '6', 'multi transfer wrong')
  })
})
