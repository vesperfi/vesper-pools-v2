"use strict"
require("dotenv").config()

const {MNEMONIC} = require('./test/utils/testkey')

module.exports = {
  providerOptions: {
    fork: process.env.NODE_URL,
    default_balance_ether: 50000,
    network_id: 1,
    mnemonic: MNEMONIC
  }
}