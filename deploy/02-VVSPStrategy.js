'use strict'

const Address = require('../helper/ethereum/address')
const deployFunction = async function ({getNamedAccounts, deployments}) {
  const {deploy} = deployments
  const {deployer} = await getNamedAccounts()
  await deploy('VSPStrategy', {
    from: deployer,
    log: true,
    args: [Address.CONTROLLER, Address.VVSP]
  })
  
  console.log('2')
  deployFunction.id = 'VSPStrategy-v2'
  return true
}
module.exports = deployFunction
module.exports.tags = ['VSPStrategy-v2']
