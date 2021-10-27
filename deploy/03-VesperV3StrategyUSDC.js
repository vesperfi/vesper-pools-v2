'use strict'

const Address = require('../helper/ethereum/address')
const vUSDC = require('../release/2.0.9/contracts.json').networks.mainnet.VUSDC.pool
const vUsdcV3Token = '0x3553e7420B1D68A010ad447b782fae6388f5F37F'
const deployFunction = async function ({ getNamedAccounts, deployments }) {
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()
  await deploy('VesperV3StrategyUSDC', {
    from: deployer,
    log: true,
    args: [Address.CONTROLLER, vUSDC, vUsdcV3Token]
  })
  deployFunction.id = 'VesperV3StrategyUSDC-v2'
  return true
}
module.exports = deployFunction
module.exports.tags = ['VesperV3StrategyUSDC-v2']
