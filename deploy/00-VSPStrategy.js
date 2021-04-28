'use strict'

const Address = require('../helper/ethereum/address')
const vDAI = require('../release/2.0.9/contracts.json').networks.mainnet.VDAI.pool
const v3PoolToken = '0xB4eDcEFd59750144882170FCc52ffeD40BfD5f7d'
const deployFunction = async function ({getNamedAccounts, deployments}) {
  const {deploy} = deployments
  const {deployer} = await getNamedAccounts()
  await deploy('VesperV3StrategyDAI', {
    from: deployer,
    log: true,
    args: [Address.CONTROLLER, vDAI, v3PoolToken]
  })
  
  console.log('2')
  deployFunction.id = 'VesperV3StrategyDAI-v2'
  return true
}
module.exports = deployFunction
module.exports.tags = ['VesperV3StrategyDAI-v2']
