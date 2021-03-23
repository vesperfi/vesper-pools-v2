'use strict'

const {assert} = require('chai')
const timeMachine = require('ganache-time-traveler')
const VSP = artifacts.require('VSP')
const BN = require('bn.js')

const {getDelegateData, getPermitData} = require('./utils/signHelper')
const {MNEMONIC} = require('./utils/testkey')

const DECIMAL = new BN('1000000000000000000')

contract('Vesper Token', function (accounts) {
  describe('Basic function tests', function () {
    it('Owner should be able to mint max 10M token in one year', async function () {
      const vsp = await VSP.new()
      let thrown
      try {
        await vsp.mint(accounts[1], '10000000000000000000000001')
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Should not allow to mint more than 10M')
      await vsp.mint(accounts[1], '10000000000000000000000000')
      const total = await vsp.totalSupply()
      assert.equal(total.toString(), '10000000000000000000000000', 'Should mint 10M')
    })

    it('Should be able to mint more than 10M token after one year', async function () {
      const vsp = await VSP.new()
      await vsp.mint(accounts[1], '10000000000000000000000000')
      await timeMachine.advanceTimeAndBlock(366 * 24 * 60 * 60)
      await vsp.mint(accounts[1], '10000000000000000000000000')
      const total = await vsp.totalSupply()
      assert.equal(total.toString(), '20000000000000000000000000', 'Minting failed')
    })

    it('Should be able to burn VSP', async function () {
      const vsp = await VSP.new()
      const mintAmount = new BN('1000').mul(DECIMAL).toString()
      await vsp.mint(accounts[1], mintAmount)

      let votes = await vsp.getCurrentVotes(accounts[1])
      assert.equal(votes.toString(), 0, 'Current vote should be zero')

      await vsp.delegate(accounts[1], {from: accounts[1]})

      votes = await vsp.getCurrentVotes(accounts[1])
      assert.equal(votes.toString(), mintAmount, 'Current vote should be equal to mintAmount')

      const burnAmount = new BN('500').mul(DECIMAL)
      const remainingAmount = new BN(mintAmount).sub(burnAmount).toString()
      await vsp.burn(burnAmount, {from: accounts[1]})

      votes = await vsp.getCurrentVotes(accounts[1])
      const total = await vsp.totalSupply()
      assert.equal(total.toString(), remainingAmount, 'Total supply is wrong')
      assert.equal(votes.toString(), remainingAmount, 'Votes should be equal to remainingAmount')
    })

    it('Should be able to burn VSP for other account', async function () {
      const vsp = await VSP.new()
      const mintAmount = new BN('1000').mul(DECIMAL).toString()
      await vsp.mint(accounts[0], mintAmount)

      let votes = await vsp.getCurrentVotes(accounts[1])
      assert.equal(votes.toString(), 0, 'Current vote should be zero')

      const transferAmount = new BN('500').mul(DECIMAL).toString()
      await vsp.transfer(accounts[1], transferAmount)
      await vsp.delegate(accounts[1], {from: accounts[1]})

      votes = await vsp.getCurrentVotes(accounts[1])
      assert.equal(votes.toString(), transferAmount, 'Votes should be equal to transferAmount')

      await vsp.approve(accounts[2], transferAmount, {from: accounts[1]})

      const burnAmount = await vsp.balanceOf(accounts[1])
      await vsp.burnFrom(accounts[1], burnAmount, {from: accounts[2]})

      votes = await vsp.getCurrentVotes(accounts[1])
      const balance = await vsp.balanceOf(accounts[1])
      assert.equal(balance.toString(), '0', 'VSP balance of accounts[1] should be zero')
      assert.equal(votes.toString(), '0', 'Votes should be zero')
    })

    it('Should delegate vote and check current and prior votes', async function () {
      const vsp = await VSP.new()
      const mintAmount = new BN('1000').mul(DECIMAL).toString()
      await vsp.mint(accounts[0], mintAmount)
      await vsp.delegate(accounts[0], {from: accounts[0]})
      const blockNumber = (await web3.eth.getBlock('latest')).number

      let votes = await vsp.getCurrentVotes(accounts[0])
      assert.equal(votes.toString(), mintAmount, 'Votes should be equal to mintAmount')

      const transferAmount = new BN('100').mul(DECIMAL)
      const remainingAmount = new BN(mintAmount).sub(transferAmount).toString()
      await vsp.transfer(accounts[1], transferAmount)
      votes = await vsp.getCurrentVotes(accounts[0])
      assert.equal(votes.toString(), remainingAmount, 'Votes should be equal to remainingAmount')

      votes = await vsp.getPriorVotes(accounts[0], blockNumber)
      assert.equal(votes.toString(), mintAmount, 'Prior votes should be equal to mintAmount')
    })

    it('Should delegate vote using signature', async function () {
      const vsp = await VSP.new()
      const mintAmount = new BN('1000').mul(DECIMAL).toString()
      await vsp.mint(accounts[0], mintAmount)
      const delegatee = accounts[1]
      const {deadline, nonce, sign} = await getDelegateData(vsp, MNEMONIC, delegatee)
      await vsp.delegateBySig(delegatee, nonce, deadline, sign.v, sign.r, sign.s)

      const votes = await vsp.getCurrentVotes(delegatee)
      assert.equal(votes.toString(), mintAmount, 'Votes should be equal to mintAmount')
    })

    it('Should allow gasless approval using permit()', async function () {
      const vsp = await VSP.new()
      const amount = '100000000000000000'
      const {owner, deadline, sign} = await getPermitData(vsp, amount, MNEMONIC, accounts[1])
      await vsp.permit(owner, accounts[1], amount, deadline, sign.v, sign.r, sign.s)
      const allowance = await vsp.allowance(owner, accounts[1])
      assert.equal(allowance.toString(), amount, 'Allowance using permit is wrong')
    })
  })
})
