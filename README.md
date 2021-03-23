# Vesper Pools

Please read and get familiar with [Vesper](https://docs.vesper.finance/). This repository contains set of smart contracts and test cases of Vesper pools.

## Setup

1. Install 

   ```sh
   git clone --recursive https://github.com/vesperfi/vesper-pools.git
   cd vesper-pools
   npm install 
   npm run truffle compile
   ```
2. set NODE_URL in env
    ```sh
    export NODE_URL=<eth mainnet url>
    ```

3. Test

Note: These tests will fork the mainnet as required in step 3. It is not recommended to run all tests at once, but rather to specify a single file.

  - Run single file
   ```sh
   npm test test/veth-aave.js
   ```

  - Or run them all (but some will fail, because of state modifications to the forked chain)
   ```sh
   npm test
   ```

## Mainnet fork deployment

Fork mainnet using ganache
   ```sh
   npm run fork
   ```

## Run test with coverage

Coverage will launch its own in-process ganache server, so all you need to run is below command.
```sh
npm run coverage
```
If you get heap memory error in solidity coverage then try below command
```sh
   node --max-old-space-size=4096 ./node_modules/.bin/truffle run coverage
```
