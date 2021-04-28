'use strict'

const colors = require('ansi-colors')
const {ethers} = require('hardhat')
const {BigNumber} = require('ethers')

// Copied from https://github.com/OpenZeppelin/openzeppelin-test-helpers/blob/master/src/time.js
// Modified to support hardhat and ethers
/* eslint-disable */

async function advanceBlock(blockCount = 1) {
  if (blockCount === 1) {
    return ethers.provider.send('evm_mine')
  }
  const block = await latestBlock()
  return advanceBlockTo(block.add(blockCount))
}

// Advance the block to the passed height
async function advanceBlockTo(target) {
  if (!BigNumber.isBigNumber(target)) {
    target = BigNumber.from(target)
  }

  const currentBlock = await latestBlock()
  const start = Date.now()
  let notified
  if (target.lt(currentBlock)) throw Error(`Target block #(${target}) is lower than current block #(${currentBlock})`)
  while ((await latestBlock()).lt(target)) {
    if (!notified && Date.now() - start >= 5000) {
      notified = true
      console.log(
        `\
${colors.white.bgBlack('@openzeppelin/test-helpers')} ${colors.black.bgYellow('WARN')} advanceBlockTo: Advancing too ` +
          'many blocks is causing this test to be slow.'
      )
    }
    await advanceBlock()
  }
}

// Returns the time of the last mined block in seconds
async function latest() {
  const block = await ethers.provider.getBlock()
  return BigNumber.from(block.timestamp)
}

async function latestBlock() {
  const block = await ethers.provider.getBlock()
  return BigNumber.from(block.number)
}

// Increases time by the passed duration in seconds
async function increase(duration) {
  if (!BigNumber.isBigNumber(duration)) {
    duration = BigNumber.from(duration)
  }

  if (duration.lt('0')) throw Error(`Cannot increase time by a negative amount (${duration})`)

  await ethers.provider.send('evm_increaseTime', [duration.toNumber()])
  await advanceBlock()
}

/**
 * Beware that due to the need of calling two separate ganache methods and rpc calls overhead
 * it's hard to increase time precisely to a target point so design your test to tolerate
 * small fluctuations from time to time.
 *
 * @param {string | number} target time in seconds
 * @returns {Promise<void>} Promise
 */
async function increaseTo(target) {
  if (!BigNumber.isBigNumber(target)) {
    target = BigNumber.from(target)
  }

  const now = await latest()

  if (target.lt(now)) throw Error(`Cannot increase current time (${now}) to a moment in the past (${target})`)
  const diff = target.sub(now)
  return increase(diff)
}

const duration = {
  seconds(val) {
    return BigNumber.from(val)
  },
  minutes(val) {
    return BigNumber.from(val).mul(this.seconds('60'))
  },
  hours(val) {
    return BigNumber.from(val).mul(this.minutes('60'))
  },
  days(val) {
    return BigNumber.from(val).mul(this.hours('24'))
  },
  weeks(val) {
    return BigNumber.from(val).mul(this.days('7'))
  },
  years(val) {
    return BigNumber.from(val).mul(this.days('365'))
  },
}

module.exports = {
  advanceBlock,
  advanceBlockTo,
  latest,
  latestBlock,
  increase,
  increaseTo,
  duration,
}
/* eslint-enable */
