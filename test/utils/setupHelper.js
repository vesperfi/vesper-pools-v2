'use strict'
const IVesperPool = artifacts.require('IVesperPool')
const CToken = artifacts.require('CToken')
const TokenLike = artifacts.require('TokenLikeTest')

const mcdEthJoin = '0x2F0b23f53734252Bda2277357e97e1517d6B042A'
const mcdWbtcJoin = '0xBF72Da2Bd84c5170618Fbe5914B0ECA9638d5eb5'
const mcdLinkJoin = '0xdFccAf8fDbD2F4805C174f856a317765B49E4a50'
const gemJoins = [mcdEthJoin, mcdWbtcJoin, mcdLinkJoin]

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
  const data = web3.eth.abi.encodeParameter('address[]', gemJoinArray)
  await controller.executeTransaction(target, value, methodSignature, data)
}

async function addInList(controller, target, address) {
  const methodSignature = 'add(address)'
  const data = web3.eth.abi.encodeParameter('address', address)
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
  const data = web3.eth.abi.encodeParameters(['uint256', 'uint256'], factors)
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
 * @param {object} collateralManager CollateralManager artifact
 * @param {object} strategy  Strategy artifact
 */
async function createMakerStrategy(obj, collateralManager, strategy) {
  obj.collateralManager = await collateralManager.new(obj.controller.address)
  obj.strategy = await strategy.new(obj.controller.address, obj.pool.address, obj.collateralManager.address)
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
 * @param {object} collateralManager CollateralManager artifact
 * @param {object} strategy Strategy artifact
 * @param {object} vPool Vesper pool instance
 */
async function createVesperMakerStrategy(obj, collateralManager, strategy, vPool) {
  obj.collateralManager = await collateralManager.new(obj.controller.address)
  obj.strategy = await strategy.new(
    obj.controller.address,
    obj.pool.address,
    obj.collateralManager.address,
    vPool.address
  )
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
 * @param {*} strategy Strategy artifact
 */
async function createStrategy(obj, strategy) {
  obj.strategy = await strategy.new(obj.controller.address, obj.pool.address)
}

/**
 * @typedef {object} PoolData
 * @property {object} controller - Controller artifact
 * @property {object} pool - Pool artifact
 * @property {object} strategy - Strategy artifact
 * @property {object} [collateralManager] - CollateralManager artifact
 * @property {string} feeCollector - Fee collector address
 */

/**
 * Setup Vesper pool for testing
 *
 * @param {object} obj Current calling object aka 'this'
 * @param {PoolData} poolData Data for pool setup
 */
async function setupVPool(obj, poolData) {
  const {
    controller,
    pool,
    strategy,
    collateralManager,
    feeCollector,
    strategyType,
    underlayStrategy,
    vPool,
    contracts,
  } = poolData
  const interestFee = '50000000000000000' // 5%
  obj.feeCollector = feeCollector
  obj.strategyType = strategyType
  obj.underlayStrategy = underlayStrategy
  obj.controller = contracts && contracts.controller ? contracts.controller : await controller.new()
  obj.pool = await pool.new(obj.controller.address)
  await obj.controller.addPool(obj.pool.address)
  // FIXME We are going to retire AaveMakerStrategy soon. using 'maker' type for retiring strategies
  if (strategyType === 'aaveMaker' || strategyType === 'compoundMaker' || strategyType === 'maker') {
    await createMakerStrategy(obj, collateralManager, strategy)
  } else if (strategyType === 'vesperMaker') {
    await createVesperMakerStrategy(obj, collateralManager, strategy, vPool)
  } else {
    await createStrategy(obj, strategy)
  }
  if (strategyType.includes('Maker')) {
    await createKeeperList(obj.controller, obj.strategy.address)
    const target = await obj.strategy.keepers()
    await addInList(obj.controller, target, obj.accounts[0])
    // FIXME Many of the tests are calling pool.rebalance(), and those will fail
    // if we do not add pool as keeper. In near future we want to remove pool 
    // from keeper and fix those tests. NOTE: DO NOT ADD POOL AS KEEPER IN PROD
    await addInList(obj.controller, target, obj.pool.address)
  }
  await Promise.all([
    obj.controller.updateStrategy(obj.pool.address, obj.strategy.address),
    obj.controller.updateFeeCollector(obj.pool.address, feeCollector),
    obj.controller.updateInterestFee(obj.pool.address, interestFee),
  ])
  const pTokenAddress = await obj.strategy.token()
  const pToken = strategyType === 'vesperMaker' ? IVesperPool : strategyType.includes('compound') ? CToken : TokenLike
  obj.providerToken = await pToken.at(pTokenAddress)
  const collateralTokenAddress = await obj.pool.token()
  obj.collateralToken = await TokenLike.at(collateralTokenAddress)
}

module.exports = {addGemJoin, updateBalancingFactor, approveToken, setupVPool}
