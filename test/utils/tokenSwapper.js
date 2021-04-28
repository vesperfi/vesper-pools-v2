'use strict'

const {expect} = require('chai')
const {ethers} = require('hardhat')
const {BigNumber} = require('ethers')
const DECIMAL = BigNumber.from('1000000000000000000')
const address = require('../../helper/ethereum/address')
const SUSHI_ROUTER = address.SUSHI_ROUTER
const NATIVE_TOKEN = address.NATIVE_TOKEN
/**
 * Swap ETH into given token
 *
 * @param {string} ethAmount ETH amount, it is in ETH i.e. 2 for 2 ETH
 * @param {string} toToken Address of output token
 * @param {object} caller caller with signer, who will pay for ETH
 * @param {string} [receiver] Address of token receiver
 * @returns {Promise<BigNumber>} Output amount of token swap
 */
async function swapEthForToken(ethAmount, toToken, caller, receiver) {
  const toAddress = receiver || caller.address
  const amountIn = BigNumber.from(ethAmount).mul(DECIMAL).toString()
  const uni = await ethers.getContractAt('IUniswapRouterTest', SUSHI_ROUTER)
  const block = await ethers.provider.getBlock()
  const path = [NATIVE_TOKEN, toToken]
  const token = await ethers.getContractAt('ERC20', toToken)
  await uni.connect(caller).swapExactETHForTokens(1, path, toAddress, block.timestamp + 60, {value: amountIn})
  const tokenBalance = await token.balanceOf(toAddress)
  expect(tokenBalance).to.be.gt('0', 'Token balance is not correct')
  return tokenBalance
}

module.exports = {swapEthForToken}
