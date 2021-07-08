'use strict'
require('@nomiclabs/hardhat-truffle5')
require('solidity-coverage')

const { parseEther } = require('ethers/lib/utils')

module.exports = {
  networks: {
    hardhat: {
      forking: {
        url: process.env.NODE_URL,
        blockNumber: 12370796,
      },
      chainId: 1,
      accounts: { 
        mnemonic: 'opera tired scrap latin mosquito wall file diesel mad aware one merry', 
        accountsBalance: `${parseEther('100000')}`
      },
    },
  },
  solidity: {
    compilers: [
      {
        version: '0.6.12',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  mocha: { timeout: 0 },
}
