'use strict'

const {ethers} = require('hardhat')
const {assert} = require('chai')
const {utils, BigNumber: BN} = require('ethers')
const {defaultAbiCoder} = ethers.utils
const address = require('../helper/ethereum/address')
const DECIMAL18 = BN.from('1000000000000000000')
const {unlock, send} = require('./utils/setupHelper')
describe('Controller', function () {
  let controller, signer, poolList, user1
  beforeEach(async function () {
    controller = await ethers.getContractAt('Controller', address.CONTROLLER)
    poolList = await ethers.getContractAt('IAddressListExt', await controller.pools())
    signer = await unlock(address.GOVERNOR)
    ;[user1] = await ethers.getSigners()
  })

  it('Add new admin and a pool in pool list', async function () {
    const amount = BN.from('10').mul(DECIMAL18)
    const ADMIN_ROLE = utils.keccak256(utils.toUtf8Bytes('LIST_ADMIN'))
    await send(user1.address, address.GOVERNOR, amount)
    const signature = 'grantRole(bytes32,address)'
    const calldata = defaultAbiCoder.encode(['bytes32', 'address'], [ADMIN_ROLE, address.GOVERNOR])
    await controller.connect(signer).executeTransaction(poolList.address, 0, signature, calldata)
    const newPool = '0xF8A34bBC245AdFeA5A634C8856E2fD54034eC378'
    await poolList.connect(signer).add(newPool)
    const isPool = await controller.isPool(newPool)
    assert(isPool, 'Pool is not added in list')
  })
})
