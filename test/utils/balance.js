'use strict'

const hre = require('hardhat')
const Address = require('../../helper/ethereum/address')
const ethers = hre.ethers
const { BigNumber } = require('ethers')
const { hexlify, solidityKeccak256, zeroPad, getAddress } = ethers.utils

// Slot number mapping for a token. Prepared using utility https://github.com/kendricktan/slot20
const slots = {
  [Address.DAI]: 2,
  [Address.WETH]: 3,
  [Address.USDC]: 9,
  [Address.USDT]: 2,
  '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643': 14, // cDAI
  '0xc00e94Cb662C3520282E6f5717214004A7f26888': 1 // COMP
}

/**
 * Get slot number for a token
 *
 * @param {string} token  token address
 * @returns {number} slot number for provided token address
 */
function getSlot(token) {
  // only use checksum address
  return slots[getAddress(token)]
}

/**
 * Update token balance for a given target address
 *
 * @param {string} token  token address
 * @param {string} targetAddress address at which token balance to be updated.
 * @param {BigNumber|string|number} balance balance amount to be set
 */

async function adjustBalance(token, targetAddress, balance) {
  const slot = getSlot(token)
  if (slots === undefined) {
    throw new Error(`Missing slot configuration for token ${token}`)
  }

  const index = hexlify(solidityKeccak256(['uint256', 'uint256'], [targetAddress, slot]))
    .replace('0x0', '0x') // reason: https://github.com/nomiclabs/hardhat/issues/1585 comments

  if (!BigNumber.isBigNumber(balance)) {
    // eslint-disable-next-line no-param-reassign
    balance = BigNumber.from(balance)
  }

  const value = hexlify(zeroPad(balance.toHexString(), 32))

  // Hack the balance by directly setting the EVM storage
  await ethers.provider.send('hardhat_setStorageAt', [token, index, value])
  await ethers.provider.send('evm_mine', [])
}

module.exports = { adjustBalance }
