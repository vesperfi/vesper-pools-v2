'use strict'
require('@nomiclabs/hardhat-waffle')
require('@nomiclabs/hardhat-ethers')
require('solidity-coverage')
require('hardhat-deploy')
require('hardhat-log-remover')
require('hardhat-gas-reporter')
require('dotenv').config()

if (process.env.RUN_CONTRACT_SIZER === 'true') {
  require('hardhat-contract-sizer')
}

module.exports = {
  defaultNetwork: 'hardhat',
  networks: {
    localhost: {
      saveDeployments: true,
    },
    hardhat: {
      forking: {
        url: process.env.NODE_URL,
        blockNumber: process.env.BLOCK_NUMBER ? parseInt(process.env.BLOCK_NUMBER) : undefined,
      },
      saveDeployments: true,
    },
    mainnet: {
      url: process.env.NODE_URL,
      chainId: 1,
      gas: 6700000,
    }
  },
  paths: {
    deployments: 'deployments',
  },
  namedAccounts: {
    deployer: process.env.DEPLOYER || 0,
  },
  contractSizer: {
    alphaSort: true,
    runOnCompile: true,
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === 'true',
  },
  solidity: {
    version: '0.6.12',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  mocha: {
    timeout: 200000,
  },
}
