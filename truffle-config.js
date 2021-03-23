'use strict'
require('regenerator-runtime/runtime')
const HDWalletProvider = require('@truffle/hdwallet-provider')
const LedgerWalletProvider = require('ledger-provider')
require('dotenv').config()
const gasPrice = 55000000000
let provider
if (process.env.MNEMONIC) {
  provider = new HDWalletProvider(process.env.MNEMONIC, process.env.NODE_URL)
}
if (process.env.ledger) {
  const options = {
    networkId: 1,
    paths: ["44'/60'/0'/0/0"],
    accountsLength: 1,
    askConfirm: false,
    accountsOffset: 0
  }
  provider = new LedgerWalletProvider(process.env.NODE_URL, options)
}

module.exports = {
  networks: {
    development: {
      host: '127.0.0.1',
      port: 8545,
      network_id: '*',
      skipDryRun: true,
      gasPrice
    },
    mainnet: {
      provider,
      network_id: 1,
      gas: 6700000,
      gasPrice
    },
  },
  compilers: {
    solc: {
      version: '0.6.12',
      settings: {
        optimizer: {
          enabled: true,
          runs: 200  // Optimize for how many times you intend to run the code
        }
      }
    }
  },
  plugins: ['solidity-coverage', 'truffle-contract-size']
}
