'use strict'

const { ethers } = require('hardhat')
const { defaultAbiCoder } = ethers.utils
const { BigNumber: BN } = require('ethers')
const { assert, expect } = require('chai')
const time = require('./utils/time')
const { getEvent } = require('./utils/setupHelper')
const { constants } = require('@openzeppelin/test-helpers')
const { deployContract } = require('./utils/setupHelper')
const oneMillion = BN.from('1000000000000000000000000')

/* eslint-disable mocha/max-top-level-suites, mocha/no-top-level-hooks */
describe('GovernorAlpha', function () {
  const TWO_DAYS = 172800
  let controller, governor, strategy, timelock, vwbtc, vvsp, vsp
  let owner, proposer, proposer2, newAdmin, other

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
    const value = BN.from(0)
    const signature = 'setPendingAdmin(address)'
    const calldata = defaultAbiCoder.encode(['address'], [governor.address])
    const eta = (await time.latest()).add(time.duration.days(3))
    await timelock.connect(owner).queueTransaction(target, value, signature, calldata, eta)
    await time.increaseTo(eta)
    await timelock.connect(owner).executeTransaction(target, value, signature, calldata, eta)
  }

  async function createProposal() {
    const targets = [controller.address]
    const values = [0]
    const signatures = ['updateStrategy(address,address)']
    const calldatas = [defaultAbiCoder.encode(['address', 'address'], [vwbtc.address, strategy.address])]
    const description = 'Update strategy for vWBTC'

    await vvsp.connect(proposer).delegate(proposer.address)
    await governor.connect(proposer).propose(targets, values, signatures, calldatas, description)
    return governor.latestProposalIds(proposer.address)
  }

  beforeEach(async function () {
    ;[owner, proposer, proposer2, newAdmin, other] = await ethers.getSigners()
    vsp = await deployContract('VSP')
    await vsp.mint(owner.address, oneMillion)
    controller = await deployContract('Controller')
    vvsp = await deployContract('VVSP', [controller.address, vsp.address])
    timelock = await deployContract('Timelock', [owner.address, TWO_DAYS])
    governor = await deployContract('GovernorAlpha', [timelock.address, vvsp.address, owner.address])
    vwbtc = await deployContract('VWBTC', [controller.address])
    await controller.addPool(vwbtc.address)
    strategy = await deployContract('AaveV2StrategyWBTC', [controller.address, vwbtc.address])
    // Approve and deposit in vVSP pool
    await vsp.approve(vvsp.address, oneMillion.div(2))
    await vvsp.deposit(oneMillion.div(2))
    const vvspBalance = (await vvsp.balanceOf(owner.address)).div(25)
    // Wait for vVSP withdraw/transfer lock
    await time.increase(25 * 60 * 60)
    // Transfer 4% vvsp to propose actions and reach quorum 
    await vvsp.transfer(proposer.address, vvspBalance)
  })

  describe('Update timelock admin', function () {
    beforeEach(async function () {
      await updateTimelockAdmin()
    })

    it('Should revert if caller is not guardian', async function () {
      const tx = governor.connect(other).__acceptAdmin()
      await expect(tx).to.be.revertedWith('__acceptAdmin: sender must be gov guardian')
    })

    it('Should accept admin role of Timelock', async function () {
      let pendingAdmin = await timelock.pendingAdmin()
      expect(pendingAdmin).to.equal(governor.address)
      await governor.connect(owner).__acceptAdmin()
      const admin = await timelock.admin()
      expect(admin).to.equal(governor.address)
      pendingAdmin = await timelock.pendingAdmin()
      expect(pendingAdmin).to.equal(constants.ZERO_ADDRESS)
    })

    it('Should queue and execute pending admin in Timelock', async function () {
      const eta = (await time.latest()).add(time.duration.days(3))
      await governor.connect(owner).__acceptAdmin()
      await governor.connect(owner).__queueSetTimelockPendingAdmin(newAdmin.address, eta)
      await time.increaseTo(eta)
      await governor.connect(owner).__executeSetTimelockPendingAdmin(newAdmin.address, eta)

      const pendingAdmin = await timelock.pendingAdmin()
      expect(pendingAdmin).to.equal(newAdmin.address)
      await timelock.connect(newAdmin).acceptAdmin()
      const admin = await timelock.admin()
      expect(admin).to.equal(newAdmin.address)
    })
  })

  describe('Propose action', function () {
    let targets, values, signatures, calldatas, description

    beforeEach(async function () {
      targets = [controller.address]
      values = [0]
      signatures = ['updatePoolStrategy(address,address)']
      calldatas = [defaultAbiCoder.encode(['address', 'address'], [vwbtc.address, strategy.address])]
      description = 'Update strategy for vWBTC'

      await vvsp.connect(proposer).delegate(proposer.address)
    })

    it('Should revert if proposer\'s vote doesn\'t meet threshold', async function () {
      const tx = governor.connect(proposer2).propose(targets, values, signatures, calldatas, description)
      await expect(tx).to.be.revertedWith('proposer votes below proposal threshold')
    })

    it('Should revert if arity mismatch', async function () {
      signatures = []
      const tx = governor.connect(proposer).propose(targets, values, signatures, calldatas, description)
      await expect(tx).to.be.revertedWith('proposal function information arity mismatch')
    })

    it('Should revert if action is not provided', async function () {
      targets = []
      values = []
      signatures = []
      calldatas = []
      const tx = governor.connect(proposer).propose(targets, values, signatures, calldatas, description)
      await expect(tx).to.be.revertedWith('must provide actions')
    })

    it('Should revert if too many actions are proposed', async function () {
      for (let i = 0; i < 10; i++) {
        targets.push(strategy.address)
        values.push(0)
        signatures.push('test')
        calldatas.push('0x')
      }
      const tx = governor.connect(proposer).propose(targets, values, signatures, calldatas, description)
      await expect(tx).to.be.revertedWith('too many actions')
    })

    it('Should propose updateStrategy for vWBTC', async function () {
      const tx = await governor.connect(proposer).propose(targets, values, signatures, calldatas, description)
      const event = await getEvent(tx, governor, 'ProposalCreated')
      const proposalId = await governor.latestProposalIds(proposer.address)
      expect(event.id).to.be.equal(proposalId)
    })
  })

  describe('Voting on proposal', function () {
    let proposalId

    beforeEach(async function () {
      proposalId = await createProposal()
    })

    it('Should revert if voting when proposal is pending', async function () {
      await expect(governor.castVote(proposalId, true)).to.be.revertedWith('GovernorAlpha::_castVote: voting is closed')
      // 0 = Pending state
      assert.equal(await governor.state(proposalId), 0)
    })

    it('Should revert if user votes multiple times', async function () {
      await time.advanceBlock()
      await time.advanceBlock()
      // 1 = Active state
      assert.equal(await governor.state(proposalId), 1)
      await governor.connect(proposer).castVote(proposalId, true)
      const tx = governor.connect(proposer).castVote(proposalId, true)
      await expect(tx).to.be.revertedWith('_castVote: voter already voted')
    })

    it('Should be able to vote on proposal', async function () {
      await time.advanceBlock()
      await time.advanceBlock()
      // 1 = Active state
      assert.equal(await governor.state(proposalId), 1)
      const tx = await governor.connect(proposer).castVote(proposalId, true)
      const event = await getEvent(tx, governor, 'VoteCast')
      expect(event.proposalId).to.be.equal(proposalId)
    })

    it('Should use recorded totalSupply for quorumVotes', async function () {
      await time.advanceBlock()
      await time.advanceBlock()
      // 1 = Active state
      assert.equal(await governor.state(proposalId), 1)
      const quorumVotesBefore = await governor['quorumVotes()']()
      const quorumVotesProposalBefore = await governor['quorumVotes(uint256)'](proposalId)
      // Approve and deposit more VSP in vVSP pool to increase totalSupply which will 
      // increase current quorumVotes
      const vspBalance = await vsp.balanceOf(owner.address)
      await vsp.connect(owner).approve(vvsp.address, vspBalance)
      await vvsp.connect(owner).deposit(vspBalance)

      const quorumVotesAfter = await governor['quorumVotes()']()
      const quorumVotesProposalAfter = await governor['quorumVotes(uint256)'](proposalId)
      expect(quorumVotesProposalAfter).to.eq(quorumVotesProposalBefore, 'Proposal quorum votes should not change')
      expect(quorumVotesAfter).to.gt(quorumVotesBefore, 'Current quorum votes should increase with totalSupply')
    })

    // Special tests, only passes when votingPeriod() returns 10 blocks from solidity
    // eslint-disable-next-line mocha/no-skipped-tests
    it.skip('Should reach quorum using recorded totalSupply', async function () {
      await time.advanceBlock()
      await time.advanceBlock()
      // 1 = Active state
      assert.equal(await governor.state(proposalId), 1)
      const proposalBlock = (await governor.proposals(proposalId)).startBlock
      const VotesOfProposer = await vvsp.getPriorVotes(proposer.address, proposalBlock)
      // Approve and deposit more VSP in vVSP pool to increase totalSupply which will 
      // increase current quorumVotes
      const vspBalance = await vsp.balanceOf(owner.address)
      await vsp.connect(owner).approve(vvsp.address, vspBalance)
      await vvsp.connect(owner).deposit(vspBalance)

      const quorumVotes = await governor['quorumVotes()']()
      const quorumVotesProposal = await governor['quorumVotes(uint256)'](proposalId)
      expect(VotesOfProposer).to.eq(quorumVotesProposal, 'Proposal quorum votes should = votes of proposer ')
      expect(quorumVotes).to.gt(quorumVotesProposal, 'Current quorum votes should be > proposal quorum votes')

      // Proposer voting on proposal and reaching quorum
      await governor.connect(proposer).castVote(proposalId, true)
      // Mine blocks to reach proposal end block
      await time.advanceBlock(11)
      // 4 = Succeeded state
      assert.equal(await governor.state(proposalId), 4)
    })

    // Special tests, only passes when votingPeriod() returns 10 blocks from solidity
    // eslint-disable-next-line mocha/no-skipped-tests
    it.skip('Should revert if voting when proposal is defeated', async function () {
      const voteEndBlock = (await time.latestBlock()).add(BN.from(11))
      await time.advanceBlockTo(voteEndBlock)
      const tx = governor.connect(proposer).castVote(proposalId, true)
      await expect(tx).to.be.revertedWith('GovernorAlpha::_castVote: voting is closed')
    })
  })

  describe('Queue proposal', function () {
    let proposalId

    beforeEach(async function () {
      // Owner delegate all vVSP votes to proposer
      await vvsp.connect(owner).delegate(proposer.address)
      proposalId = await createProposal()
      await time.advanceBlock()
      await time.advanceBlock()
      await governor.connect(proposer).castVote(proposalId, true)
    })

    it('Should revert if proposal is still active', async function () {
      // 1 = Active state
      assert.equal(await governor.state(proposalId), 1)
      const tx = governor.connect(other).queue(proposalId)
      await expect(tx).to.be.revertedWith('proposal can only be queued if it is succeeded')
    })

    // Special tests, only passes when votingPeriod() returns 10 blocks from solidity
    // eslint-disable-next-line mocha/no-skipped-tests
    it.skip('Should successfully queue proposal', async function () {
      await updateTimelockAdmin()
      await governor.connect(owner).__acceptAdmin()
      // 1 = Active state
      assert.equal(await governor.state(proposalId), 1)
      const voteEndBlock = (await time.latestBlock()).add(BN.from(11))
      await time.advanceBlockTo(voteEndBlock)
      // 4 = Succeeded state
      assert.equal(await governor.state(proposalId), 4)
      const tx = await governor.connect(other).queue(proposalId)
      const event = await getEvent(tx, governor, 'ProposalQueued')
      expect(event.id).to.be.equal(proposalId)
      // 5 = Queued state
      assert.equal(await governor.state(proposalId), 5)
    })
  })

  describe('Execute proposal', function () {
    let proposalId

    beforeEach(async function () {
      await updateControllerAdmin()
      // Owner delegate all vVSP votes to proposer
      await vvsp.connect(owner).delegate(proposer.address)
      await updateTimelockAdmin()
      await governor.connect(owner).__acceptAdmin()

      proposalId = await createProposal()
      await time.advanceBlock()
      await time.advanceBlock()
      await governor.connect(proposer).castVote(proposalId, true)
      const voteEndBlock = (await time.latestBlock()).add(BN.from(11))
      await time.advanceBlockTo(voteEndBlock)
    })

    // Special tests, only passes when votingPeriod() returns 10 blocks from solidity
    // eslint-disable-next-line mocha/no-skipped-tests
    it.skip('Should revert if proposal is not queued', async function () {
      // 4 = Succeeded state
      assert.equal(await governor.state(proposalId), 4)
      const tx = governor.connect(other).execute(proposalId)
      await expect(tx).to.be.revertedWith('proposal can only be executed if it is queued')
    })

    // Special tests, only passes when votingPeriod() returns 10 blocks from solidity
    // eslint-disable-next-line mocha/no-skipped-tests
    it.skip('Should successfully execute proposal', async function () {
      await governor.connect(other).queue(proposalId)
      // 5 = Queued state
      assert.equal(await governor.state(proposalId), 5)

      const eta = (await time.latest()).add(time.duration.days(2))
      await time.increaseTo(eta)

      const tx = await governor.connect(other).execute(proposalId)
      const event = await getEvent(tx, governor, 'ProposalExecuted')
      expect(event.id).to.be.equal(proposalId)
    })
  })
})