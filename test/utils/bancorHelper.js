'use strict'

const { assert, expect } = require('chai')
const {BN, time} = require('@openzeppelin/test-helpers')
const IBancorNetworkTest = artifacts.require('IBancorNetworkTest')
const ILiquidityProtectionTest = artifacts.require('ILiquidityProtectionTest')
const ILiquidityProtectionStatsTest = artifacts.require('ILiquidityProtectionStatsTest')
const ILiquidityProtectionStoreTest = artifacts.require('ILiquidityProtectionStoreTest')
const ILiquidityProtectionSystemStoreTest = artifacts.require('ILiquidityProtectionSystemStoreTest')
const ERC20 = artifacts.require('ERC20')
const DECIMAL = new BN('1000000000000000000')
const bancorNetworkAddress = '0x2F9EC37d6CcFFf1caB21733BdaDEdE11c823cCB0'
const liquidityProtectionAddress = '0xeead394A017b8428E2D5a976a054F303F78f3c0C'
const liquidityProtectionStatsAddress = '0x9712bb50dc6efb8a3d7d12cea500a50967d2d471'
const liquidityProtectionStoreAddress = '0xf5fab5dbd2f3bf675de4cb76517d4767013cfb55'
const liquidityProtectionSystemStoreAddress = '0xc4c5634de585d43daec8fa2a6fb6286cd9b87131'

const ETH = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
const ETHBNT = "0xb1cd6e4153b2a390cf00a6556b0fc1458c4a5533"
const BNT = "0x1f573d6fb3f13d689ff844b4ce37794d79a7ff1c"
const ZERO = '0x0000000000000000000000000000000000000000'

async function mineBlocks(numberOfBlocks) {
  await time.advanceBlockTo((await time.latestBlock()).add(new BN(numberOfBlocks)))
}

/**
 * @param {string} amount token amount
 * @param {string} beneficiary Address of token receiver
 * @returns {string} Output amount of token swap
 */
async function swapBNTForETH(amount, beneficiary) {
    assert(amount > 0, "need something to swap!")
    const bancorNetwork = await IBancorNetworkTest.at(bancorNetworkAddress)
    const block = await web3.eth.getBlock('latest')
    const priorETH = await web3.eth.getBalance(beneficiary)
    const token = await ERC20.at(BNT)
    const priorBnt = await token.balanceOf(beneficiary)

    await token.approve(bancorNetworkAddress, 0, {from: beneficiary})
    await token.approve(bancorNetworkAddress, amount, {from: beneficiary})

    const response = await bancorNetwork.convertByPath([BNT, ETHBNT, ETH], amount, 1, beneficiary, ZERO, 0, {from: beneficiary})
    mineBlocks(10)
    const postETH = await web3.eth.getBalance(beneficiary)
    const postBnt = await token.balanceOf(beneficiary)
    assert(priorBnt > postBnt, 'BNT did not get sent')
    assert(new BN(postETH).gt(new BN(priorETH)), 'ETH balance is not correct')
    return postETH
}

/**
 * @param {string} amount token amount in ETH
 * @param {string} beneficiary Address of token receiver
 * @returns {string} Output amount of token swap
 */
async function swapETHForBNT(amount, beneficiary) {
    assert(amount > 0, "need something to swap!")
    const bigAmount = new BN(amount).mul(DECIMAL).toString()
    const bancorNetwork = await IBancorNetworkTest.at(bancorNetworkAddress)
    const block = await web3.eth.getBlock('latest')
    const token = await ERC20.at(BNT)
    const prior = await token.balanceOf(beneficiary)
    
    await bancorNetwork.convertByPath([ETH, ETHBNT, BNT], bigAmount, 1, beneficiary, ZERO, 0, 
        { value: bigAmount, from: beneficiary })
    const result = (await token.balanceOf(beneficiary)).sub(prior)
    assert(result.gt(new BN('0')), 'Result balance is not correct')
    return result
}

async function poolAvailableSpace() {
    const liquidityProtection = await ILiquidityProtectionTest.at(liquidityProtectionAddress)
    return await liquidityProtection.poolAvailableSpace.call(ETHBNT)
}

async function addLiquidity(provider, amount) {
    const bigAmount = new BN(amount).mul(DECIMAL).toString()
    const liquidityProtection = await ILiquidityProtectionTest.at(liquidityProtectionAddress)
    await liquidityProtection.addLiquidity(ETHBNT, ETH, bigAmount, {from: provider, value: bigAmount})
    await mineBlocks(1)
    
    const liquidityProtectionStore = await ILiquidityProtectionStoreTest.at(liquidityProtectionStoreAddress)
    const ids = await liquidityProtectionStore.protectedLiquidityIds.call(provider)
    return ids[ids.length - 1].toString()
}

async function addLiquidityBnt(provider, amount) {
    const liquidityProtection = await ILiquidityProtectionTest.at(liquidityProtectionAddress)
    const token = await ERC20.at(BNT)
    await token.approve(liquidityProtectionAddress, 0, {from: provider})
    await token.approve(liquidityProtectionAddress, amount, {from: provider})
    await liquidityProtection.addLiquidity(ETHBNT, BNT, amount, {from: provider})
    await mineBlocks(1)
    
    const liquidityProtectionStore = await ILiquidityProtectionStoreTest.at(liquidityProtectionStoreAddress)
    const ids = await liquidityProtectionStore.protectedLiquidityIds.call(provider)
    return ids[ids.length - 1].toString()
}

async function removeLiquidity(provider, depositId) {
    const liquidityProtection = await ILiquidityProtectionTest.at(liquidityProtectionAddress)
    await liquidityProtection.removeLiquidity(depositId, '1000000', {from: provider})
}

async function totalPoolAmount() {
    const liquidityProtectionStats = await ILiquidityProtectionStatsTest.at(liquidityProtectionStatsAddress)
    return await liquidityProtectionStats.totalPoolAmount.call(ETHBNT);
}

async function totalReserveAmount() {
    const liquidityProtectionStats = await ILiquidityProtectionStatsTest.at(liquidityProtectionStatsAddress)
    return await liquidityProtectionStats.totalReserveAmount.call(ETHBNT, BNT);
}

async function protectedLiquidityIds(provider) {
    const liquidityProtectionStore = await ILiquidityProtectionStoreTest.at(liquidityProtectionStoreAddress)
    return await liquidityProtectionStore.protectedLiquidityIds.call(provider);
}

async function incNetworkTokensMinted(owner, amount) {
    const liquidityProtectionSystemStore = await ILiquidityProtectionSystemStoreTest.at(liquidityProtectionSystemStoreAddress)
    await liquidityProtectionSystemStore.incNetworkTokensMinted(ETHBNT, amount, {from: owner});
}

async function decNetworkTokensMinted(owner, amount) {
    const liquidityProtectionSystemStore = await ILiquidityProtectionSystemStoreTest.at(liquidityProtectionSystemStoreAddress)
    await liquidityProtectionSystemStore.decNetworkTokensMinted(ETHBNT, amount, {from: owner});
}

module.exports = {
    swapBNTForETH,
    swapETHForBNT,
    poolAvailableSpace,
    totalPoolAmount,
    totalReserveAmount,
    addLiquidity,
    addLiquidityBnt,
    removeLiquidity,
    protectedLiquidityIds,
    incNetworkTokensMinted,
    decNetworkTokensMinted
}