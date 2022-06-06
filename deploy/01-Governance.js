'use strict'

const Address = require('../helper/ethereum/address')
const {ethers} = require('hardhat')
const {BigNumber: BN} = require('ethers')
const {defaultAbiCoder} = ethers.utils
const TEN_MINUTES = 10 * 60
const deployFunction = async function ({getNamedAccounts, deployments}) {
  const {deploy, execute} = deployments
  const {deployer} = await getNamedAccounts()

  const timelock = await deploy('Timelock', {
    from: deployer,
    log: true,
    args: [deployer, TEN_MINUTES],
  })

  const governor = await deploy('GovernorAlpha', {
    from: deployer,
    log: true,
    args: [timelock.address, Address.VVSP, deployer],
  })

  const target = timelock.address
  const value = BN.from(0)
  const signature = 'setPendingAdmin(address)'
  const calldata = defaultAbiCoder.encode(['address'], [governor.address])
  const eta = 1632436200
  await execute('Timelock', {from: deployer, log: true}, 'queueTransaction', target, value, signature, calldata, eta)
  deployFunction.id = 'governance-1'
  return true
}
module.exports = deployFunction
module.exports.tags = ['governance-1']
