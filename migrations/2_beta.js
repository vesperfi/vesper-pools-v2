'use strict'

const CollateralManager = artifacts.require('CollateralManager')
const Controller = artifacts.require('Controller')
const Web3 = require('web3')
const web3 = new Web3()
const VETH = artifacts.require('VETH')
const VWBTC = artifacts.require('VWBTC')
const AaveMakerEth = artifacts.require('AaveMakerStrategyETH')
const AaveBTC = artifacts.require('AaveStrategyWBTC')
const VUSDC = artifacts.require('VUSDC')
const AaveUSDC = artifacts.require('AaveStrategyUSDC')

// eslint-disable-next-line consistent-return
module.exports = async function (deployer, network) {
  // Do not deploy on dev chain, save time in testing
  if (deployer.network_id === '*' || network === 'development') {
    return
  }
  console.log('Deploying controller')
  await deployer.deploy(Controller)
  const controller = await Controller.deployed()
  console.log('Deploying collateral manager')

  await deployer.deploy(CollateralManager, controller.address)
  const mcdEthJoin = '0x2F0b23f53734252Bda2277357e97e1517d6B042A'
  const mcdWbtcJoin = '0xBF72Da2Bd84c5170618Fbe5914B0ECA9638d5eb5'

  const gemJoins = [mcdEthJoin, mcdWbtcJoin]

  const cm = await CollateralManager.deployed()

  console.log('Adding Gem Join in cm')
  let target = cm.address
  let methodSignature = 'addGemJoin(address[])'
  let data = web3.eth.abi.encodeParameter('address[]', gemJoins)
  await controller.executeTransaction(target, 0, methodSignature, data)

  // VETH ##############################
  console.log('Deploying vETH pool')
  await deployer.deploy(VETH, controller.address)
  const veth = await VETH.deployed()
  console.log('Adding vETH in controller')
  await controller.addPool(veth.address)

  console.log('Deploying aave-maker strategy')
  await deployer.deploy(AaveMakerEth, controller.address, veth.address, cm.address)
  const strategyVETH = await AaveMakerEth.deployed()

  console.log('Adding strategy of vETH in controller')
  await controller.updateStrategy(veth.address, strategyVETH.address)

  console.log('Updating balancing factor in AaveMakerStrategy for vETH pool')
  target = strategyVETH.address
  methodSignature = 'updateBalancingFactor(uint256,uint256)'
  data = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [275, 250])
  await controller.executeTransaction(target, 0, methodSignature, data)

  console.log('Large approve in AaveMakerStrategy')
  target = strategyVETH.address
  methodSignature = 'approveToken()'
  data = '0x'
  await controller.executeTransaction(target, 0, methodSignature, data)

  //  VWBTC ##############################
  console.log('Deploying vWBTC pool')
  await deployer.deploy(VWBTC, controller.address)
  const vwbtc = await VWBTC.deployed()
  console.log('Adding vWBTC in controller')
  await controller.addPool(vwbtc.address)

  console.log('Deploying direct aave strategy for wBTC')
  await deployer.deploy(AaveBTC, controller.address, vwbtc.address)
  const strategyVWBTC = await AaveBTC.deployed()

  console.log('Adding strategy of vWBTC in controller')
  await controller.updateStrategy(vwbtc.address, strategyVWBTC.address)

  // VUSDC ##############################
  console.log('Deploying vUSDC pool')
  await deployer.deploy(VUSDC, controller.address)
  const vusdc = await VUSDC.deployed()

  console.log('Adding vUSDC in controller')
  await controller.addPool(vusdc.address)

  console.log('Deploying direct aave strategy')
  await deployer.deploy(AaveUSDC, controller.address, vusdc.address)
  const strategyVusdc = await AaveUSDC.deployed()

  console.log('Adding strategy of vUSDC in controller')
  await controller.updateStrategy(vusdc.address, strategyVusdc.address)

  // WithdrawFee ##############################
  const withdrawFee = '15000000000000000' // 1.5%
  const feeCollector = '0x9520b477Aa81180E6DdC006Fc09Fb6d3eb4e807A'
  console.log(`Adding withdraw fee ${withdrawFee} and fee collector ${feeCollector} in all pools`)

  await controller.updateFeeCollector(veth.address, feeCollector)
  await controller.updateWithdrawFee(veth.address, withdrawFee)

  await controller.updateFeeCollector(vwbtc.address, feeCollector)
  await controller.updateWithdrawFee(vwbtc.address, withdrawFee)

  await controller.updateFeeCollector(vusdc.address, feeCollector)
  await controller.updateWithdrawFee(vusdc.address, withdrawFee)

  const interestFee = '150000000000000000' // 15%
  console.log(`Adding interest fee ${interestFee} in all pools`)
  await controller.updateInterestFee(veth.address, interestFee)
  await controller.updateInterestFee(vwbtc.address, interestFee)
  await controller.updateInterestFee(vusdc.address, interestFee)

  console.log('Adding fee collector in white list')

  methodSignature = 'add(address)'
  data = web3.eth.abi.encodeParameter('address', feeCollector)

  target = await veth.feeWhiteList()
  await controller.executeTransaction(target, 0, methodSignature, data)

  target = await vwbtc.feeWhiteList()
  await controller.executeTransaction(target, 0, methodSignature, data)

  target = await vusdc.feeWhiteList()
  await controller.executeTransaction(target, 0, methodSignature, data)

  const addresses = {
    collateralManager: {
      address: cm.address,
    },
    controller: {
      address: controller.address,
    },
    VETH: {
      address: veth.address,
      strategy: strategyVETH.address,
    },
    VWBTC: {
      address: vwbtc.address,
      strategy: strategyVWBTC.address,
    },
    VUSDC: {
      address: vusdc.address,
      strategy: strategyVusdc.address,
    },
  }
  console.log('\nContract addresses', addresses)
}
