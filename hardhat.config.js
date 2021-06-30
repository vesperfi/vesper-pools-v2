'use strict'
require('@nomiclabs/hardhat-truffle5')
require('solidity-coverage')

module.exports = {
  networks: {
    hardhat: {
      forking: {
        url: process.env.NODE_URL,
      },
      chainId: 1,
      accounts: { 
        mnemonic: 'opera tired scrap latin mosquito wall file diesel mad aware one merry', 
        accountsBalance: '100000000000000000000000' 
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
