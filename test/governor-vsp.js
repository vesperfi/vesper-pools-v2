'use strict'

const {assert, expect} = require('chai')
const {expectRevert, expectEvent, BN, constants, time} = require('@openzeppelin/test-helpers')
const AaveStrategy = artifacts.require('AaveStrategyWBTC')
const Controller = artifacts.require('Controller')
const GovernorAlpha = artifacts.require('GovernorAlpha')
const Timelock = artifacts.require('Timelock')
const VWBTC = artifacts.require('VWBTC')
const VSP = artifacts.require('VSP')

const oneMillion = new BN('1000000000000000000000000')

/* eslint-disable mocha/max-top-level-suites, mocha/no-top-level-hooks */
contract('GovernorAlpha', async function (accounts) {
  const [owner, proposer, proposer2, newAdmin, other] = accounts
  const TWO_DAYS = 172800
  let controller, governor, strategy, timelock, vwbtc, vsp

  async function updateControllerAdmin() {
    await controller.transferOwnership(timelock.address)
    const target = controller.address
    const value = 0
    const methodSignature = 'acceptOwnership()'
    const data = '0x'
    const eta = (await time.latest()).add(time.duration.days(3))
    await timelock.queueTransaction(target, value, methodSignature, data, eta)
    await time.increaseTo(eta)
    await timelock.executeTransaction(target, value, methodSignature, data, eta)
  }

  async function updateTimelockAdmin() {
    const target = timelock.address
    const value = 0
    const signature = 'setPendingAdmin(address)'
    const calldata = web3.eth.abi.encodeParameter('address', governor.address)
    const eta = (await time.latest()).add(time.duration.days(3))
    await timelock.queueTransaction(target, value, signature, calldata, eta, {from: owner})
    await time.increaseTo(eta)
    await timelock.executeTransaction(target, value, signature, calldata, eta, {from: owner})
  }

  async function createProposal() {
    const targets = [controller.address]
    const values = [0]
    const signatures = ['updateStrategy(address,address)']
    const calldatas = [
      web3.eth.abi.encodeParameters(['address', 'address'], [vwbtc.address, strategy.address]),
    ]
    const description = 'Update strategy for vBTC'

    await vsp.delegate(proposer, {from: proposer})
    await governor.propose(targets, values, signatures, calldatas, description, {
      from: proposer,
    })
    return governor.latestProposalIds(proposer)
  }

  beforeEach(async function () {
    vsp = await VSP.new()
    await vsp.mint(owner, oneMillion)
    timelock = await Timelock.new(owner, TWO_DAYS)
    controller = await Controller.new()
    governor = await GovernorAlpha.new(timelock.address, vsp.address, owner)

    vwbtc = await VWBTC.new(controller.address)
    await controller.addPool(vwbtc.address)
    strategy = await AaveStrategy.new(controller.address, vwbtc.address)

    const vspBalance = await vsp.balanceOf(owner)
    // Get 2% vsp to propose actions and also wait for withdraw lock
    await time.increase(25 * 60 * 60)
    await vsp.transfer(proposer, vspBalance.div(new BN(50)))
  })

  describe('Update timelock admin', function () {
    beforeEach(async function () {
      await updateTimelockAdmin()
    })

    it('Should revert if caller is not guardian', async function () {
      const tx = governor.__acceptAdmin({from: other})
      await expectRevert(tx, '__acceptAdmin: sender must be gov guardian')
    })

    it('Should accept admin role of Timelock', async function () {
      let pendingAdmin = await timelock.pendingAdmin()
      expect(pendingAdmin).to.equal(governor.address)
      await governor.__acceptAdmin({from: owner})
      const admin = await timelock.admin()
      expect(admin).to.equal(governor.address)
      pendingAdmin = await timelock.pendingAdmin()
      expect(pendingAdmin).to.equal(constants.ZERO_ADDRESS)
    })

    it('Should queue and execute pending admin in Timelock', async function () {
      const eta = (await time.latest()).add(time.duration.days(3))
      await governor.__acceptAdmin({from: owner})
      await governor.__queueSetTimelockPendingAdmin(newAdmin, eta, {from: owner})
      await time.increaseTo(eta)
      await governor.__executeSetTimelockPendingAdmin(newAdmin, eta, {from: owner})

      const pendingAdmin = await timelock.pendingAdmin()
      expect(pendingAdmin).to.equal(newAdmin)
      await timelock.acceptAdmin({from: newAdmin})
      const admin = await timelock.admin()
      expect(admin).to.equal(newAdmin)
    })
  })

  describe('Propose action', function () {
    let targets, values, signatures, calldatas, description

    beforeEach(async function () {
      targets = [controller.address]
      values = [0]
      signatures = ['updatePoolStrategy(address,address)']
      calldatas = [
        web3.eth.abi.encodeParameters(['address', 'address'], [vwbtc.address, strategy.address]),
      ]
      description = 'Update strategy for vBTC'

      await vsp.delegate(proposer, {from: proposer})
    })

    it("Should revert if proposer's vote doesn't meet thereshold", async function () {
      const tx = governor.propose(targets, values, signatures, calldatas, description, {
        from: proposer2,
      })
      await expectRevert(tx, 'proposer votes below proposal threshold')
    })

    it('Should revert if arity mismatch', async function () {
      signatures = []
      const tx = governor.propose(targets, values, signatures, calldatas, description, {
        from: proposer,
      })
      await expectRevert(tx, 'proposal function information arity mismatch')
    })

    it('Should revert if action is not provided', async function () {
      targets = []
      values = []
      signatures = []
      calldatas = []
      const tx = governor.propose(targets, values, signatures, calldatas, description, {
        from: proposer,
      })
      await expectRevert(tx, 'must provide actions')
    })

    it('Should revert if too many actions are proposed', async function () {
      for (let i = 0; i < 10; i++) {
        targets.push(strategy.address)
        values.push(0)
        signatures.push('test')
        calldatas.push('0x')
      }
      const tx = governor.propose(targets, values, signatures, calldatas, description, {
        from: proposer,
      })
      await expectRevert(tx, 'too many actions')
    })

    it('Should propose updateStrategy for vBTC', async function () {
      const tx = await governor.propose(targets, values, signatures, calldatas, description, {
        from: proposer,
      })
      expectEvent(tx, 'ProposalCreated')
      const proposalId = await governor.latestProposalIds(proposer)
      expect(proposalId.toString()).to.equal('1')
    })
  })

  describe('Voting on proposal', function () {
    let proposalId

    beforeEach(async function () {
      proposalId = await createProposal()
    })

    it('Should revert if voting when proposal is pending', async function () {
      const tx = governor.castVote(proposalId, true, {from: proposer})
      await expectRevert(tx, '_castVote: voting is closed')
      // 0 = Pending state
      assert.equal(await governor.state(proposalId), 0)
    })

    it('Should revert if user votes multiple times', async function () {
      await time.advanceBlock()
      await time.advanceBlock()
      // 1 = Active state
      assert.equal(await governor.state(proposalId), 1)
      await governor.castVote(proposalId, true, {from: proposer})
      const tx = governor.castVote(proposalId, true, {from: proposer})
      await expectRevert(tx, '_castVote: voter already voted')
    })

    it('Should be able to vote on proposal', async function () {
      await time.advanceBlock()
      await time.advanceBlock()
      // 1 = Active state
      assert.equal(await governor.state(proposalId), 1)
      const tx = await governor.castVote(proposalId, true, {from: proposer})
      expectEvent(tx, 'VoteCast', {voter: proposer, proposalId, support: true})
    })

    // Special tests, only passes when votingPeriod is 10 blocks in contract.
    // eslint-disable-next-line mocha/no-skipped-tests
    it.skip('Should revert if voting when proposal is defeated', async function () {
      const voteEndBlock = (await time.latestBlock()).add(new BN(11))
      await time.advanceBlockTo(voteEndBlock)
      const tx = governor.castVote(proposalId, true, {from: proposer})
      await expectRevert(tx, '_castVote: voting is closed')
      // 3 = Defeated state
      assert.equal(await governor.state(proposalId), 3)
    })
  })

  describe('Queue proposal', function () {
    let proposalId

    beforeEach(async function () {
      await vsp.delegate(proposer, {from: owner})
      proposalId = await createProposal()
      await time.advanceBlock()
      await time.advanceBlock()
      await governor.castVote(proposalId, true, {from: proposer})
    })

    it('Should revert if proposal is still active', async function () {
      // 1 = Active state
      assert.equal(await governor.state(proposalId), 1)

      const tx = governor.queue(proposalId, {from: other})
      await expectRevert(tx, 'proposal can only be queued if it is succeeded')
    })

    // Special tests, only passes when votingPeriod is 10 blocks in contract.
    // eslint-disable-next-line mocha/no-skipped-tests
    it.skip('Should successfully queue proposal', async function () {
      await updateTimelockAdmin()
      await governor.__acceptAdmin({from: owner})
      // 1 = Active state
      assert.equal(await governor.state(proposalId), 1)
      const voteEndBlock = (await time.latestBlock()).add(new BN(11))
      await time.advanceBlockTo(voteEndBlock)
      // 4 = Succeeded state
      assert.equal(await governor.state(proposalId), 4)
      const tx = await governor.queue(proposalId, {from: other})
      expectEvent(tx, 'ProposalQueued', {id: proposalId})
      // 5 = Queued state
      assert.equal(await governor.state(proposalId), 5)
    })
  })

  describe('Execute proposal', function () {
    let proposalId

    beforeEach(async function () {
      await updateControllerAdmin()
      await vsp.delegate(proposer, {from: owner})
      await updateTimelockAdmin()
      await governor.__acceptAdmin({from: owner})

      proposalId = await createProposal()
      await time.advanceBlock()
      await time.advanceBlock()
      await governor.castVote(proposalId, true, {from: proposer})
      const voteEndBlock = (await time.latestBlock()).add(new BN(11))
      await time.advanceBlockTo(voteEndBlock)
    })

    // Special tests, only passes when votingPeriod is 10 blocks in contract.
    // eslint-disable-next-line mocha/no-skipped-tests
    it.skip('Should revert if proposal is not queued', async function () {
      // 4 = Succeeded state
      assert.equal(await governor.state(proposalId), 4)
      const tx = governor.execute(proposalId, {from: other})
      await expectRevert(tx, 'proposal can only be executed if it is queued')
    })

    // Special tests, only passes when votingPeriod is 10 blocks in contract.
    // eslint-disable-next-line mocha/no-skipped-tests
    it.skip('Should successfully execute proposal', async function () {
      await governor.queue(proposalId, {from: other})
      // 5 = Queued state
      assert.equal(await governor.state(proposalId), 5)

      const eta = (await time.latest()).add(time.duration.days(2))
      await time.increaseTo(eta)

      const tx = await governor.execute(proposalId, {from: other})
      expectEvent(tx, 'ProposalExecuted', {id: proposalId})
    })
  })
})
