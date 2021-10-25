'use strict'
const { ethers } = require('hardhat')
const { shouldBehaveLikePool } = require('./behavior/vesper-pool')
const { shouldBehaveLikeStrategy } = require('./behavior/vesper-v3-strategy')
const { setupVPool, unlock } = require('./utils/setupHelper')

describe('vDAI Pool with VesperV3Strategy', function () {


  const poolV3Address = '0xB4eDcEFd59750144882170FCc52ffeD40BfD5f7d'
  const vesperDeployer = '0xB5AbDABE50b5193d4dB92a16011792B22bA3Ef51'

  const abiV3Pool = [
    {
      inputs: [],
      name: 'getStrategies',
      outputs: [
        {
          internalType: 'address[]',
          name: '',
          type: 'address[]'
        }
      ],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [
        {
          internalType: 'uint256',
          name: '_shares',
          type: 'uint256'
        }
      ],
      name: 'withdraw',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      inputs: [
        {
          internalType: 'address',
          name: '_listToUpdate',
          type: 'address'
        },
        {
          internalType: 'address',
          name: '_addressToAdd',
          type: 'address'
        }
      ],
      name: 'addInList',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      inputs: [
        {
          internalType: 'address',
          name: 'account',
          type: 'address'
        }
      ],
      name: 'balanceOf',
      outputs: [
        {
          internalType: 'uint256',
          name: '',
          type: 'uint256'
        }
      ],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [],
      name: 'feeWhitelist',
      outputs: [
        {
          internalType: 'address',
          name: '',
          type: 'address'
        }
      ],
      stateMutability: 'view',
      type: 'function'
    },
    {
      inputs: [
        {
          internalType: 'uint256',
          name: '_newWithdrawFee',
          type: 'uint256'
        }
      ],
      name: 'updateWithdrawFee',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function'
    },
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          internalType: 'address',
          name: 'owner',
          type: 'address'
        },
        {
          indexed: false,
          internalType: 'uint256',
          name: 'shares',
          type: 'uint256'
        },
        {
          indexed: false,
          internalType: 'uint256',
          name: 'amount',
          type: 'uint256'
        }
      ],
      name: 'Withdraw',
      type: 'event'
    }
  ]

  beforeEach(async function () {

    this.accounts = await ethers.getSigners()
    // vDAI-v3 Pool
    this.receiptToken = '0xB4eDcEFd59750144882170FCc52ffeD40BfD5f7d'

    await setupVPool(this, {
      controller: 'Controller',
      pool: 'VDAI',
      strategy: 'VesperV3StrategyDAI',
      feeCollector: this.accounts[9],
      strategyType: 'vesperv3',
    })
    this.newStrategy = 'VesperV3StrategyDAI'

    this.v3Keeper = await unlock(vesperDeployer)
    this.v3Pool = await ethers.getContractAt(abiV3Pool, poolV3Address)
    await this.v3Pool.connect(this.v3Keeper).addInList(await this.v3Pool.feeWhitelist(), this.strategy.address)
  })

  shouldBehaveLikePool('vDAI', 'DAI', 'aDAI')
  shouldBehaveLikeStrategy('vDAI', 'DAI')
})
