'use strict'

const {assert} = require('chai')
const {BigNumber: BN} = require('ethers')
const {deployContract} = require('./utils/setupHelper')
const DECIMAL = BN.from('1000000000000000000')
let veth, controller, accounts
async function setupVPool() {
  controller = await deployContract('Controller')
  veth = await deployContract('VETH', [controller.address])
  await controller.addPool(veth.address)
  const strategy = await deployContract('AaveV2StrategyWBTC',[controller.address, veth.address])
  await controller.updateStrategy(veth.address, strategy.address)
}

describe('Vesper Pool Token Multitransfer', function() {
  it('Should test multi transfer of vesper pool tokens', async function() {
    accounts = await ethers.getSigners()
    await setupVPool()
    const depositAmount = BN.from(1).mul(DECIMAL).toString()
    await veth['deposit()']({value: depositAmount})
    const vBalancebefore = await veth.balanceOf(accounts[0].address)
    const tokenAmount = '000000000000000000000001'
    const RECIPIENTS = [accounts[4], accounts[5], accounts[6], accounts[7], accounts[8], accounts[9]]
    const bitParam = []
    for (let idx = 0; idx < RECIPIENTS.length; idx++) {
      const recipient = RECIPIENTS[idx]
      bitParam.push(recipient.address + tokenAmount)
    }

    await veth.multiTransfer(bitParam)

    for (let idx = 0; idx < RECIPIENTS.length; idx++) {
      const recipient = RECIPIENTS[idx]
      const balance = await veth.balanceOf(recipient.address)
      assert.equal(balance.toString(), '1', `multi-transfer failed for ${idx}`)
    }
    const vBalanceAfter = await veth.balanceOf(accounts[0].address)
    assert.equal(BN.from(vBalancebefore).sub(BN.from(vBalanceAfter)).toString(), '6', 'multi transfer wrong')
  })

  it('Should multi transfer of VSP tokens', async function() {
    const vsp = await deployContract('VSP')
    const mintAmount = BN.from('3000').mul(DECIMAL)
    await vsp.mint(accounts[0].address, mintAmount)

    const tokenAmount = '000000000000000000000001' // 1 wei VSP
    const RECIPIENTS = [accounts[4], accounts[5], accounts[6], accounts[7], accounts[8], accounts[9]]

    const bitParam = []
    for (let idx = 0; idx < RECIPIENTS.length; idx++) {
      const recipient = RECIPIENTS[idx]
      bitParam.push(recipient.address + tokenAmount)
    }

    await vsp.multiTransfer(bitParam)

    for (let idx = 0; idx < RECIPIENTS.length; idx++) {
      const recipient = RECIPIENTS[idx]
      const balance = await vsp.balanceOf(recipient.address)
      assert.equal(balance.toString(), '1', `multi-transfer failed for ${idx}`)
    }
    const vspBalace = await vsp.balanceOf(accounts[0].address)
    assert.equal(mintAmount.sub(vspBalace).toString(), '6', 'multi transfer wrong')
  })
})
