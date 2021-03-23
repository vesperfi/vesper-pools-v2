'use strict'
const swapper = require('./tokenSwapper')
const BN = require('bn.js')

const DECIMAL = new BN('1000000000000000000')
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

/**
 *  Swap given ETH for given token type and deposit tokens into Vesper pool
 *
 * @param {object} pool Vepser pool instance where we want to deposit tokens
 * @param {object} token Colalteral token instance, the token you want to deposit
 * @param {number|string} amount Amount in ETH, ETH will be swapped for required token
 * @param {string} depositor User who will pay ETH and also deposit in Vesper pool
 * @returns {Promise<BN>} Promise of collateral amount which was deposited in Vesper pool
 */
async function deposit(pool, token, amount, depositor) {
  let depositAmount
  if (token.address === WETH_ADDRESS) {
    await token.deposit({value: new BN(amount).mul(new BN(DECIMAL)), from: depositor})
    depositAmount = await token.balanceOf(depositor)
  } else {
    depositAmount = await swapper.swapEthForToken(amount, token.address, depositor)
  }
  await token.approve(pool.address, depositAmount, {from: depositor})
  await pool.deposit(depositAmount, {from: depositor})
  return depositAmount
}

module.exports = {deposit}
