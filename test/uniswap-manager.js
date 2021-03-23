'use strict'

const {expect} = require('chai')
const {expectRevert, BN} = require('@openzeppelin/test-helpers')
const {swapEthForToken} = require('./utils/tokenSwapper')
const UniMgr = artifacts.require('UniswapManager')
const AutonomousConverter = artifacts.require('IMetAutonomousConverter')
const ERC20 = artifacts.require('ERC20')
const IUniswapRouterTest = artifacts.require('IUniswapRouterTest')
const IUniswapFactoryTest = artifacts.require('IUniswapFactoryTest')

// We use these
const DECIMAL = new BN('1000000000000000000')
const USDC_DECIMAL = new BN('1000000')
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const VSP = '0x1b40183efb4dd766f11bda7a7c3ad8982e998421'
const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f'
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const AAVE = '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9'
const WBTC = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'
const MET = '0xa3d58c4E56fedCae3a7c43A725aeE9A71F0ece4e'
const MET_AC = '0x686e5ac50D9236A9b7406791256e47feDDB26AbA'
const UNI_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'
const UNI_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'

// globals
let uniswapManager,router, factory, mLiq, diaLiq, usdcLiq, lpMETDAI, 
  lpMETUSDC, lpMETDAIBalance, lpMETUSDCBalance
/* eslint-disable mocha/max-top-level-suites, mocha/no-top-level-hooks */
contract('UniswapManager', async function (accounts) {

  beforeEach(async function () {
    uniswapManager = await UniMgr.new()
  })

  describe('bestPathFixedInput', function () {

    it('Should should return the shorter path if one token is WETH', async function () {
      const from = WETH
      const to = VSP
      const amountIn = new BN(3).mul(DECIMAL).toString()
      const tx = await uniswapManager.bestPathFixedInput(from, to, amountIn)
      expect(tx.path.length).to.equal(2)
    })

    it('Should should return the longer path if no direct pair exists', async function () {
      // There is no liquidity pool for VSP - AAVE and this is unlikely to change
      const from = VSP
      const to = AAVE
      const amountIn = new BN(300).mul(DECIMAL).toString()
      const tx = await uniswapManager.bestPathFixedInput(from, to, amountIn)
      expect(tx.path.length).to.equal(3)
    })

    it('Should return 0 if there is an insufficient input amount', async function () {
      // This swap will always go VSP-WETH-WBTC, and the output amount for VSP-WETH here would be 0
      // Therefore, if we were not catching the reversion, this would fail with insufficient input
      const from = VSP
      const to = WBTC
      const amountIn = new BN(1).toString()
      const tx = await uniswapManager.bestPathFixedInput(from, to, amountIn)
      expect(tx.amountOut).to.be.bignumber.equal('0')
    })
  })

  describe('bestPathOptimizeInput', function () {

    it('Should should return the shortest path if one token is WETH', async function () {
      const from = WETH
      const to = VSP
      const amountOut = new BN(3000).mul(DECIMAL).toString()
      const tx = await uniswapManager.bestPathFixedOutput(from, to, amountOut)
      expect(tx.path.length).to.equal(2)
      expect(tx.amountIn).to.be.bignumber.gte('1')
    })

    it('Should should return the longer path if no direct pair exists', async function () {
      // There is no liquidity pool for VSP - AAVE and this is unlikely to change
      const from = VSP
      const to = AAVE
      const amountOut = new BN(300).mul(DECIMAL).toString()
      const tx = await uniswapManager.bestPathFixedOutput(from, to, amountOut)
      expect(tx.path.length).to.equal(3)
      expect(tx.amountIn).to.be.bignumber.gte('1')
    })

    it('Should return the path and amount with the lowest amount of tokens for desired output', async function () {
      // There is a liquidity pool for USDC and DAI so this will test both paths
      const from = USDC
      const to = DAI
      const amountOut = new BN(300000).mul(DECIMAL).toString()
      const tx = await uniswapManager.bestPathFixedOutput(from, to, amountOut)
      expect(tx.amountIn).to.be.bignumber.gte('1')
    })

    it('Should return at least one even when the value is prohibitively small', async function () {
      const from = USDC
      const to = DAI
      const amountOut = 300
      const tx = await uniswapManager.bestPathFixedOutput(from, to, amountOut)
      expect(tx.amountIn).to.be.bignumber.equal('1')
    })

  })

  describe('safeGetAmountsOut', function () {

    it('Should succeed with a happy "path"', async function () {
      const path = [WETH, VSP]
      const amountIn = new BN(3).mul(DECIMAL).toString()
      const tx = await uniswapManager.safeGetAmountsOut(amountIn, path)
      expect(tx.length).to.equal(path.length)
    })

    it('Should return an output of 0 with insufficient liquidity', async function () {
      const path = [VSP, WETH, WBTC]
      const amountIn = new BN(1).toString()
      const tx = await uniswapManager.safeGetAmountsOut(amountIn, path)
      expect(tx[path.length - 1]).to.be.bignumber.equal('0')
    })

  })

  describe('unsafeGetAmountsOut', function () {
  
    it('Should succeed with a happy "path"', async function () {
      const path = [WETH, VSP]
      const amountIn = new BN(3).mul(DECIMAL).toString()
      const tx = await uniswapManager.unsafeGetAmountsOut(amountIn, path)
      expect(tx.length).to.equal(path.length)
    })

    it('Should fail with insufficient liquidity', async function () {
      const path = [VSP, WETH, WBTC]
      const amountIn = new BN(1).toString()
      await expectRevert(uniswapManager.unsafeGetAmountsOut(amountIn, path), 
        'UniswapV2Library: INSUFFICIENT_INPUT_AMOUNT')
    })

  })

  describe('best paths complex cases', function() {
    before(async function () {
      const metToken = await ERC20.at(MET)
      const daiToken = await ERC20.at(DAI)
      const usdcToken = await ERC20.at(USDC)
      router = await IUniswapRouterTest.at(UNI_ROUTER)
      factory = await IUniswapFactoryTest.at(UNI_FACTORY)
      const MetCon = await AutonomousConverter.at(MET_AC)

      // 1 ETH for MET
      await MetCon.convertEthToMet(1, { value: new BN(1).mul(DECIMAL).toString() })
      const metBalance = await metToken.balanceOf(accounts[0])
      await metToken.approve(router.address, metBalance)

      // 1 ETH for DAI
      await swapEthForToken(1, DAI, accounts[0], accounts[0])
      const daiBalance =await daiToken.balanceOf(accounts[0])
      await daiToken.approve(router.address, daiBalance)

      // 1 ETH for USDC
      await swapEthForToken(1, USDC, accounts[0], accounts[0])
      const usdcBalance = await usdcToken.balanceOf(accounts[0])
      await usdcToken.approve(router.address, usdcBalance)

      mLiq = (new BN('10')).mul(DECIMAL)
      diaLiq = (new BN('10')).mul(DECIMAL)
      usdcLiq = (new BN('100')).mul(USDC_DECIMAL)

      await factory.createPair(MET, DAI)
      await factory.createPair(MET, USDC)
      const lpAddressMETDAI = await factory.getPair(MET, DAI)
      const lpAddressMETUSDC = await factory.getPair(MET, USDC)

      lpMETDAI = await ERC20.at(lpAddressMETDAI)
      lpMETUSDC = await ERC20.at(lpAddressMETUSDC)
    })

    beforeEach(async function() {
      const block = await web3.eth.getBlock('latest')

      // set liquidity - current MET - USD ~1:$2.8 via MET-WETH-USDC/DAI
      // add METDAI Liq 1:$1
      await router.addLiquidity(MET, DAI, mLiq, diaLiq, 1, 1, accounts[0], block.timestamp + 60)
      // add METUSDC Liq 1:10
      await router.addLiquidity(MET, USDC, mLiq, usdcLiq, 1, 1, accounts[0], block.timestamp + 60)
      
      lpMETDAIBalance = await lpMETDAI.balanceOf(accounts[0])
      lpMETUSDCBalance = await lpMETUSDC.balanceOf(accounts[0])
      await lpMETDAI.approve(router.address, lpMETDAIBalance)
      await lpMETUSDC.approve(router.address, lpMETUSDCBalance)
    })

    afterEach(async function() {
      const block = await web3.eth.getBlock('latest')
      // remove liquidity
      await router.removeLiquidity(MET, DAI, lpMETDAIBalance, 0, 0, accounts[0], block.timestamp + 60)
      await router.removeLiquidity(MET, USDC, lpMETUSDCBalance, 0, 0, accounts[0], block.timestamp + 60)

      lpMETDAIBalance = new BN('0')
      lpMETUSDCBalance = new BN('0')
    })

    // MET - USDC supplied ratio of 1:$10 is always optimal compared to MET-WETH-USDC
    it('BestPathFixedOutput: Should return the shorter path when it is optimal', async function() {
      const from = MET
      const to = USDC
      const amountOut = new BN('1').mul(USDC_DECIMAL)
      const tx = await uniswapManager.bestPathFixedOutput(from, to, amountOut)
      expect(tx.path.length).to.equal(2)
      expect(tx.amountIn).to.be.bignumber.gte('1')
    })
    
    it('BestPathFixedInput: Should return the shorter path when it is optimal', async function() {
      const from = MET
      const to = USDC
      const amountIn = new BN('1').mul(DECIMAL)
      const tx = await uniswapManager.bestPathFixedInput(from, to, amountIn)
      expect(tx.path.length).to.equal(2)
      expect(tx.amountOut).to.be.bignumber.gte('1')
    })

    // MET : DAI supplied ratio of 1:1 is always suboptimal to MET - WETH - DAI
    it('BestPathFixedOutput: Should return the longer path when it is optimal', async function() {
      const from = MET
      const to = DAI
      const amountOut = new BN('1').mul(DECIMAL)
      const tx = await uniswapManager.bestPathFixedOutput(from, to, amountOut)
      expect(tx.path.length).to.equal(3)
      expect(tx.amountIn).to.be.bignumber.gte('1')
    })
    
    it('BestPathFixedInput: Should return the longer path when it is optimal', async function() {
      const from = MET
      const to = DAI
      const amountIn = new BN('1').mul(DECIMAL)
      const tx = await uniswapManager.bestPathFixedInput(from, to, amountIn)
      expect(tx.path.length).to.equal(3)
      expect(tx.amountOut).to.be.bignumber.gte('1')
    })
  })
})
