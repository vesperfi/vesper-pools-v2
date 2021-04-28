'use strict'

const hre = require('hardhat')
const ethers = hre.ethers
const {defaultAbiCoder} = ethers.utils

// const StrategyType = require('../utils/strategyTypes')

const mcdEthAJoin = '0x2F0b23f53734252Bda2277357e97e1517d6B042A'
const mcdEthCJoin = '0xF04a5cC80B1E94C69B48f5ee68a08CD2F09A7c3E'
const mcdWbtcJoin = '0xBF72Da2Bd84c5170618Fbe5914B0ECA9638d5eb5'
const mcdLinkJoin = '0xdFccAf8fDbD2F4805C174f856a317765B49E4a50'
const mcdUniAJoin = '0x3BC3A58b4FC1CbE7e98bB4aB7c99535e8bA9b8F1'
const gemJoins = [mcdEthAJoin, mcdWbtcJoin, mcdLinkJoin, mcdEthCJoin, mcdUniAJoin]
const SWAP = '0xe382d9f2394A359B01006faa8A1864b8a60d2710'
// Contract names
const IVesperPool = 'IVesperPool'
const CToken = 'CToken'
const TokenLike = 'TokenLikeTest'
// const CollateralManager = 'CollateralManager'
const address = require('../../helper/ethereum/address')
hre.address = address


/**
 * Send Ether
 *
 * @param {string} from - From address
 * @param {string} to - To address
 * @param {BigNumber} amount - Amount in wei
 */
async function send(from, to, amount) {
  await ethers.provider.send('eth_sendTransaction', [
    {
      from,
      to,
      value: amount.toHexString(),
      gasPrice: '0x0'      
    },
  ])
}

/**
 * 
 * @param {string} _address - address to be unlocked
 * @returns {object} - Unlocked Signer object
 */
async function unlock(_address) {
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [_address],
  })
  return ethers.getSigner(_address)
}
/**
 * Deploy contract
 *
 * @param {string} name Name of contract
 * @param {any[]} [params] Constructor params
 * @returns {object} Contract instance
 */
async function deployContract(name, params = []) {
  const contractFactory = await ethers.getContractFactory(name)
  return contractFactory.deploy(...params)
}

/**
 *  Add gem join in Collateral Manager via Controller's executeTransaction
 *
 * @param {object} controller Controller contract instance
 * @param {string} target Collateral Manager contract address
 * @param {string[]} gemJoinArray Array of gem join address
 */
async function addGemJoin(controller, target, gemJoinArray) {
  const value = 0
  const methodSignature = 'addGemJoin(address[])'
  const data = defaultAbiCoder.encode(['address[]'], [gemJoinArray])
  await controller.executeTransaction(target, value, methodSignature, data)
}

async function addInList(controller, target, _address) {
  const methodSignature = 'add(address)'
  const data = defaultAbiCoder.encode(['address'], [_address])
  await controller.executeTransaction(target, 0, methodSignature, data)
}

/**
 *  Approve token in strategy via Controller's executeTransaction
 *
 * @param {object} controller Controller contract instance
 * @param {string} target Aave-Maker Strategy contract address
 */
async function approveToken(controller, target) {
  const methodSignature = 'approveToken()'
  const data = '0x'
  await controller.executeTransaction(target, 0, methodSignature, data)
}

/**
 *  Add balancing factors in Aave-Maker Strategy via Controller's executeTransaction
 *
 * @param {object} controller Controller contract instance
 * @param {string} target Aave-Maker Strategy contract address
 * @param {string[]} factors balancing factors in array [highWater, lowWater]
 */
async function updateBalancingFactor(controller, target, factors) {
  const methodSignature = 'updateBalancingFactor(uint256,uint256)'
  const data = defaultAbiCoder.encode(['uint256', 'uint256'], factors)
  await controller.executeTransaction(target, 0, methodSignature, data)
}

/**
 *  Create keeper list in maker strategies
 *
 * @param {object} controller Controller contract instance
 * @param {string} target Aave-Maker Strategy contract address
 */
async function createKeeperList(controller, target) {
  const methodSignature = 'createKeeperList()'
  await controller.executeTransaction(target, 0, methodSignature, '0x')
}

/**
 * Create and configure Aave Maker strategy. Also update test class object with required data.
 *
 * @param {object} obj Test class object
 * @param {object} strategyName  Strategy Name
 */
async function createMakerStrategy(obj, strategyName) {
  obj.collateralManager = await deployContract('CollateralManager', [obj.controller.address])
  obj.strategy = await deployContract(strategyName, [
    obj.controller.address,
    obj.pool.address,
    obj.collateralManager.address,
  ])
  obj.vaultNum = await obj.strategy.vaultNum()
  await Promise.all([
    updateBalancingFactor(obj.controller, obj.strategy.address, [300, 250]),
    addGemJoin(obj.controller, obj.collateralManager.address, gemJoins),
    approveToken(obj.controller, obj.strategy.address),
  ])
}

/**
 *  Create and configure Vesper Maker Strategy. Also update test class object with required data.
 *
 * @param {object} obj Test class object
 * @param {object} strategyName Strategy name
 * @param {object} vPool Vesper pool instance
 */
async function createVesperMakerStrategy(obj, strategyName, vPool) {
  obj.collateralManager = await deployContract('CollateralManager', [obj.controller.address])
  obj.strategy = await deployContract(strategyName, [
    obj.controller.address,
    obj.pool.address,
    obj.collateralManager.address,
    vPool.address,
  ])
  obj.vaultNum = await obj.strategy.vaultNum()
  await Promise.all([
    updateBalancingFactor(obj.controller, obj.strategy.address, [300, 250]),
    addGemJoin(obj.controller, obj.collateralManager.address, gemJoins),
    approveToken(obj.controller, obj.strategy.address),
  ])
  const target = await vPool.feeWhiteList()
  await addInList(obj.controller, target, obj.strategy.address)
}

/**
 * Create strategy instance and set it in test class object
 *
 * @param {*} obj Test class object
 * @param {object} strategyName Strategy Name
 */
async function createStrategy(obj, strategyName) {
  if (obj.receiptToken === undefined)
    obj.strategy = await deployContract(strategyName, [obj.controller.address, obj.pool.address])
  else {
    obj.strategy = await deployContract(strategyName, [obj.controller.address, obj.pool.address, obj.receiptToken])
  }

  // FIXME once we migrate all strategy as child of Strategy.sol, it should be removed
  approveToken(obj.controller, obj.strategy.address)
}

/**
 * Create strategy instance and set it in test class object
 *
 * @param {*} obj Test class object
 * @param {*} strategyName Strategy Name
 */
async function createCrvStrategy(obj, strategyName) {
  obj.strategy = await deployContract(strategyName, [obj.controller.address, obj.pool.address])
  approveToken(obj.controller, obj.strategy.address)
}

/**
 * @typedef {object} PoolData
 * @property {object} controller - Controller 
 * @property {object} pool - Pool 
 * @property {object} strategy - Strategy 
 * @property {string} feeCollector - Fee collector 
 */

/**
 * Setup Vesper pool for testing
 *
 * @param {object} obj Current calling object aka 'this'
 * @param {PoolData} poolData Data for pool setup
 */
/* eslint-disable complexity */
async function setupVPool(obj, poolData) {
  const {
    pool: poolName,
    strategy,
    feeCollector,
    strategyType,
    underlayStrategy,
    vPool,
    contracts,
  } = poolData
  const swapMan = await ethers.getContractAt('ISwapManager', SWAP)
  let interestFee = '50000000000000000' // 5%
  if (strategyType === 'vesperv3') {
    // No interest fee for direct-to-vesper-v3 strategy
    // V3 Strategies should already collect interest fees
    interestFee = '0' // 0%
  }
  obj.feeCollector = feeCollector
  obj.strategyType = strategyType
  obj.swapManager = swapMan
  obj.underlayStrategy = underlayStrategy
  obj.controller = contracts && contracts.controller ? contracts.controller : await deployContract('Controller')
  obj.pool = await deployContract(poolName, [obj.controller.address])
  await obj.controller.addPool(obj.pool.address)
  // FIXME We are going to retire AaveMakerStrategy soon. using 'maker' type for retiring strategies
  if (strategyType === 'aaveMaker' || strategyType === 'compoundMaker' || strategyType === 'maker') {
    await createMakerStrategy(obj, strategy)
  } else if (strategyType === 'vesperMaker') {
    await createVesperMakerStrategy(obj, strategy, vPool)
  } else if (strategyType === 'crv') {
    await createCrvStrategy(obj, strategy)
  } else {
    await createStrategy(obj, strategy)
  }
  // FIXME These are temporary conditions until we port all strategies as child of Strategy.sol
  await createKeeperList(obj.controller, obj.strategy.address)
  const target = await obj.strategy.keepers()
  await addInList(obj.controller, target, obj.accounts[0].address)
  // FIXME Many of the tests are calling pool.rebalance(), and those will fail
  // if we do not add pool as keeper. In near future we want to remove pool
  // from keeper and fix those tests. NOTE: DO NOT ADD POOL AS KEEPER IN PROD
  await addInList(obj.controller, target, obj.pool.address)
  await Promise.all([
    obj.controller.updateStrategy(obj.pool.address, obj.strategy.address),
    obj.controller.updateFeeCollector(obj.pool.address, feeCollector.address),
    obj.controller.updateInterestFee(obj.pool.address, interestFee),
  ])
  const pTokenAddress = await obj.strategy.token()
  const pToken = strategyType === 'vesperMaker' ? IVesperPool : strategyType.includes('compound') ? CToken : TokenLike
  obj.providerToken = await ethers.getContractAt(pToken, pTokenAddress)
  const collateralTokenAddress = await obj.pool.token()
  obj.collateralToken = await ethers.getContractAt(TokenLike, collateralTokenAddress)
}

module.exports = {
  addGemJoin,
  addInList,
  updateBalancingFactor,
  approveToken,
  createKeeperList,
  setupVPool,
  deployContract,
  unlock,
  send
}
