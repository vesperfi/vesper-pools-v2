'use strict'

const Address = require('../helper/ethereum/address')
const deployFunction = async function ({getNamedAccounts, deployments}) {
  const {deploy} = deployments
  const {deployer} = await getNamedAccounts()
  await deploy('RevenueSplitter', {
    from: deployer,
    log: true,
    args: [
      [Address.GOVERNOR, '0x9bcdf1130b20856f86267074de136c5902e314fe', '0xf4087b7AB24Bde9c445ddD0bc4DF257F81277214'],
      [4000, 5500, 500],
    ],
  })
  deployFunction.id = 'BuyBack'
  return true
}
module.exports = deployFunction
module.exports.tags = ['BuyBack']
