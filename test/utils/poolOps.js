'use strict'

const hre = require('hardhat')
const provider = hre.waffle.provider
const swapper = require('./tokenSwapper')
const {BigNumber: BN} = require('ethers')

const DECIMAL = BN.from('1000000000000000000')
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'


/**
 *  Swap given ETH for given token type and deposit tokens into Vesper pool
 *
 * @param {object} pool Vesper pool instance where we want to deposit tokens
 * @param {object} token Collateral token instance, the token you want to deposit
 * @param {number|string} amount Amount in ETH, ETH will be swapped for required token
 * @param {object} depositor User who will pay ETH and also deposit in Vesper pool
 * @returns {Promise<BigNumber>} Promise of collateral amount which was deposited in Vesper pool
 */
 async function deposit(pool, token, amount, depositor) {
  let depositAmount
  if (token.address === WETH_ADDRESS) {
    await token.connect(depositor).deposit({value: BN.from(amount).mul(DECIMAL)})
    depositAmount = await token.balanceOf(depositor.address)
    await token.connect(depositor).approve(pool.address, depositAmount)
    await pool.connect(depositor)['deposit(uint256)'](depositAmount)
  } else {
    depositAmount = await swapper.swapEthForToken(amount, token.address, depositor)
    await token.connect(depositor).approve(pool.address, depositAmount)
    await pool.connect(depositor).deposit(depositAmount)
  }
  return depositAmount
}

async function timeTravel(seconds = 6 * 60 * 60, blocks = 25, strategyType = '', underlayStrategy = '') {
  const timeTravelFn = async function() {
    await provider.send('evm_increaseTime', [seconds])
    await provider.send('evm_mine')
  }  
  const blockMineFn = async function() {
    for (let i = 0; i < blocks; i++) {
      await provider.send('evm_mine')
    }
  }
  return strategyType.includes('compound') || underlayStrategy.includes('compound') ? blockMineFn() : timeTravelFn()
}


async function resurface(_strategy, _accounts) {
  try {
    const isUnderwater = await _strategy.isUnderwater()
    if (isUnderwater) {
      await _strategy.connect(_accounts[0]).resurface()
    }  
  } catch(error) {
    // ignore error
  }    
}
/** Safely rebalance a pool. 
 * 
 * @param {object} _strategy strategy 
 * @param {object} _accounts list of accounts
 */
async function rebalance(_strategy, _accounts) {
  try {
    await resurface(_strategy, _accounts) 
    await _strategy.rebalance()  
  } catch(error) {
    // give one more retry incase of failure
    await resurface(_strategy, _accounts) 
    await _strategy.rebalance() 
  }
}

/**
 * Simulates a VesperV3 Strategy making profit
 * by artificially increasing its pricePerShare
 *
 * @param {object} _strategy strategy
 * @param {object} _accounts list of accounts
 */
async function simulateV3Profit(_strategy, _accounts) {
  const v3Pool = await _strategy.receiptToken()
  const collateralToken = await _strategy.collateralToken()
  await swapper.swapEthForToken(5, collateralToken, _accounts[0], v3Pool)
}


async function reset() {
  // eslint-disable-next-line
  console.log('Resetting Network...')
  await provider.send(
    'hardhat_reset',
    [{
      forking: {
        jsonRpcUrl: process.env.NODE_URL,
        blockNumber: process.env.BLOCK_NUMBER ? parseInt(process.env.BLOCK_NUMBER) : undefined
      }
    }]
  )
}


module.exports = {deposit, rebalance, simulateV3Profit, reset, timeTravel}
