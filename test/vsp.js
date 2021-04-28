'use strict'

const {assert} = require('chai')
const {ethers} = require('hardhat')
const {deployContract} = require('./utils/setupHelper')
const time = require('./utils/time')
const {BigNumber: BN} = require('ethers')

const {getDelegateData, getPermitData} = require('./utils/signHelper')
const {MNEMONIC} = require('./utils/testkey')

const DECIMAL = BN.from('1000000000000000000')

describe('Vesper Token', function () {
  let accounts
  beforeEach(async function () {
    accounts = await ethers.getSigners()
  })
  
  describe('Basic function tests', function () {
    it('Owner should be able to mint max 10M token in one year', async function () {
      const vsp = await deployContract('VSP')
      let thrown
      try {
        await vsp.mint(accounts[1].address, '10000000000000000000000001')
      } catch (e) {
        thrown = true
      }
      assert(thrown, 'Should not allow to mint more than 10M')
      await vsp.mint(accounts[1].address, '10000000000000000000000000')
      const total = await vsp.totalSupply()
      assert.equal(total.toString(), '10000000000000000000000000', 'Should mint 10M')
    })

    it('Should be able to mint more than 10M token after one year', async function () {
      const vsp = await deployContract('VSP')
      await vsp.mint(accounts[1].address, '10000000000000000000000000')
      await time.increase(366 * 24 * 60 * 60)
      await vsp.mint(accounts[1].address, '10000000000000000000000000')
      const total = await vsp.totalSupply()
      assert.equal(total.toString(), '20000000000000000000000000', 'Minting failed')
    })

    it('Should be able to burn VSP', async function () {
      const vsp = await deployContract('VSP')
      const mintAmount = BN.from('1000').mul(DECIMAL).toString()
      await vsp.mint(accounts[1].address, mintAmount)

      let votes = await vsp.getCurrentVotes(accounts[1].address)
      assert.equal(votes.toString(), 0, 'Current vote should be zero')

      await vsp.connect(accounts[1]).delegate(accounts[1].address)

      votes = await vsp.getCurrentVotes(accounts[1].address)
      assert.equal(votes.toString(), mintAmount, 'Current vote should be equal to mintAmount')

      const burnAmount = BN.from('500').mul(DECIMAL)
      const remainingAmount = BN.from(mintAmount).sub(burnAmount).toString()
      await vsp.connect(accounts[1]).burn(burnAmount)

      votes = await vsp.getCurrentVotes(accounts[1].address)
      const total = await vsp.totalSupply()
      assert.equal(total.toString(), remainingAmount, 'Total supply is wrong')
      assert.equal(votes.toString(), remainingAmount, 'Votes should be equal to remainingAmount')
    })

    it('Should be able to burn VSP for other account', async function () {
      const vsp = await deployContract('VSP')
      const mintAmount = BN.from('1000').mul(DECIMAL).toString()
      await vsp.mint(accounts[0].address, mintAmount)

      let votes = await vsp.getCurrentVotes(accounts[1].address)
      assert.equal(votes.toString(), 0, 'Current vote should be zero')

      const transferAmount = BN.from('500').mul(DECIMAL).toString()
      await vsp.transfer(accounts[1].address, transferAmount)
      await vsp.connect(accounts[1]).delegate(accounts[1].address)

      votes = await vsp.getCurrentVotes(accounts[1].address)
      assert.equal(votes.toString(), transferAmount, 'Votes should be equal to transferAmount')

      await vsp.connect(accounts[1]).approve(accounts[2].address, transferAmount)

      const burnAmount = await vsp.balanceOf(accounts[1].address)
      await vsp.connect(accounts[2]).burnFrom(accounts[1].address, burnAmount)

      votes = await vsp.getCurrentVotes(accounts[1].address)
      const balance = await vsp.balanceOf(accounts[1].address)
      assert.equal(balance.toString(), '0', 'VSP balance of accounts[1] should be zero')
      assert.equal(votes.toString(), '0', 'Votes should be zero')
    })

    it('Should delegate vote and check current and prior votes', async function () {
      const vsp = await deployContract('VSP')
      const mintAmount = BN.from('1000').mul(DECIMAL).toString()
      await vsp.mint(accounts[0].address, mintAmount)
      await vsp.delegate(accounts[0].address)
      const blockNumber = await time.latestBlock()

      let votes = await vsp.getCurrentVotes(accounts[0].address)
      assert.equal(votes.toString(), mintAmount, 'Votes should be equal to mintAmount')

      const transferAmount = BN.from('100').mul(DECIMAL)
      const remainingAmount = BN.from(mintAmount).sub(transferAmount).toString()
      await vsp.transfer(accounts[1].address, transferAmount)
      votes = await vsp.getCurrentVotes(accounts[0].address)
      assert.equal(votes.toString(), remainingAmount, 'Votes should be equal to remainingAmount')

      votes = await vsp.getPriorVotes(accounts[0].address, blockNumber)
      assert.equal(votes.toString(), mintAmount, 'Prior votes should be equal to mintAmount')
    })

    it('Should delegate vote using signature', async function () {
      const vsp = await deployContract('VSP')
      const mintAmount = BN.from('1000').mul(DECIMAL).toString()
      await vsp.mint(accounts[0].address, mintAmount)
      const delegatee = accounts[1].address
      const {deadline, nonce, sign} = await getDelegateData(vsp, MNEMONIC, delegatee)
      await vsp.delegateBySig(delegatee, nonce, deadline, sign.v, sign.r, sign.s)

      const votes = await vsp.getCurrentVotes(delegatee)
      assert.equal(votes.toString(), mintAmount, 'Votes should be equal to mintAmount')
    })

    it('Should allow gasless approval using permit()', async function () {
      const vsp = await deployContract('VSP')
      const amount = '100000000000000000'
      const {owner, deadline, sign} = await getPermitData(vsp, amount, MNEMONIC, accounts[1].address)
      await vsp.permit(owner, accounts[1].address, amount, deadline, sign.v, sign.r, sign.s)
      const allowance = await vsp.allowance(owner, accounts[1].address)
      assert.equal(allowance.toString(), amount, 'Allowance using permit is wrong')
    })
  })
})
