'use strict'
// eslint-disable-next-line no-shadow
const {deployContract, send, unlock} = require('./utils/setupHelper')
const {getEthQuote} = require('./utils/tokenSwapper')
const {deposit} = require('./utils/poolOps')
const hre = require('hardhat')
const ethers = hre.ethers
const provider = hre.waffle.provider
const {BigNumber: BN} = require('ethers')
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const VESPER_DEPLOYER = '0xB5AbDABE50b5193d4dB92a16011792B22bA3Ef51'
const DECIMAL18 = BN.from('1000000000000000000')
const {constants} = require('@openzeppelin/test-helpers')
const {expect, assert} = require('chai')
const TokenLike = 'TokenLikeTest'
const {ZERO_ADDRESS} = constants

describe('PaymentSplitter', function () {
  let controller

  async function initStrategy(poolAddress, strategyName) {
    await controller.addPool(poolAddress)
    const strategy = await deployContract(strategyName, [controller.address, poolAddress])
    await controller.updateStrategy(poolAddress, strategy.address)
  }

  describe('Payment Splitter Contract deployed', function () {
    let payee1, payee2, payee3, payer1, nonpayee1, user6
    context('General validations', function () {
      beforeEach(async function () {
        ;[payee1, payee2, payee3, payer1, nonpayee1, user6] = await ethers.getSigners()
        controller = await deployContract('Controller')
      })

      it('rejects an empty set of payees', async function () {
        await expect(deployContract('PaymentSplitter', [[], []])).to.be.revertedWith('no-payees')
      })

      it('rejects more payees than share', async function () {
        await expect(
          deployContract('PaymentSplitter', [
            [payee1.address, payee2.address, payee3.address],
            [20, 30],
          ])
        ).to.be.revertedWith('payees-and-share-length-mismatch')
      })

      it('rejects more share than payees', async function () {
        await expect(
          deployContract('PaymentSplitter', [
            [payee1.address, payee2.address],
            [20, 30, 40],
          ])
        ).to.be.revertedWith('payees-and-share-length-mismatch')
      })

      it('rejects null payees', async function () {
        await expect(
          deployContract('PaymentSplitter', [
            [payee1.address, ZERO_ADDRESS],
            [20, 30],
          ])
        ).to.be.revertedWith('payee-is-zero-address')
      })

      it('rejects zero-valued share', async function () {
        await expect(
          deployContract('PaymentSplitter', [
            [payee1.address, payee2.address],
            [20, 0],
          ])
        ).to.be.revertedWith('payee-with-zero-share')
      })

      it('rejects repeated payees', async function () {
        await expect(
          deployContract('PaymentSplitter', [
            [payee1.address, payee1.address],
            [20, 30],
          ])
        ).to.be.revertedWith('payee-exists-with-share')
      })
    })

    context('without any ERC20 tokens', function () {
      let payees, shares, psContract, asset1
      beforeEach(async function () {
        payees = [payee1.address, payee2.address]
        shares = [5, 95]
        controller = await deployContract('Controller')
        const veth = await deployContract('VETH', [controller.address])
        await initStrategy(veth.address, 'AaveV2StrategyETH')
        psContract = await deployContract('PaymentSplitter', [payees, shares])
        await psContract.addVToken(veth.address, ZERO_ADDRESS)
        asset1 = await deployContract('VSP')
        const token = await veth.token()
        const weth = await ethers.getContractAt('TokenLikeTest', token)
        await deposit(veth, weth, 1, user6)
      })

      it('has total shares', async function () {
        expect(await psContract.totalShare()).to.be.equal('100')
      })

      it('has all payees', async function () {
        await Promise.all(payees.map(async (payee, index) => expect(await psContract.payees(index)).to.equal(payee)))
      })

      it('all payees initial balance zero', async function () {
        await Promise.all(
          payees.map(async function (payee) {
            expect(await psContract.released(payee, asset1.address)).to.be.equal('0')
          })
        )
      })

      describe('share', function () {
        it('stores shares if address is payee1.address', async function () {
          expect(await psContract.share(payee1.address)).to.be.equal('5')
        })

        it('stores shares if address is payee2.address', async function () {
          expect(await psContract.share(payee2.address)).to.be.equal('95')
        })

        it('does not store shares if address is not payee', async function () {
          expect(await psContract.share(payee3.address)).to.be.equal('0')
        })
      })

      describe('release', function () {
        it('release tokens without balance to payee1.address', async function () {
          await expect(psContract.release(payee1.address, asset1.address)).to.be.revertedWith(
            'payee-is-not-due-for-tokens'
          )
        })

        it('release tokens without balance to payee2.address', async function () {
          await expect(psContract.release(payee2.address, asset1.address)).to.be.revertedWith(
            'payee-is-not-due-for-tokens'
          )
        })
      })
    })

    context('with ethers', function () {
      let payees, shares, psContract, amount

      beforeEach(async function () {
        ;[payee1, payee2, payee3, payer1, nonpayee1, user6] = await ethers.getSigners()
        amount = BN.from('10').mul(DECIMAL18)
        payees = [payee1.address, payee2.address]
        shares = [5, 95]
        controller = await deployContract('Controller')
        const veth = await deployContract('VETH', [controller.address])
        await initStrategy(veth.address, 'AaveV2StrategyETH')
        psContract = await deployContract('PaymentSplitter', [payees, shares])
        await psContract.addVToken(veth.address, ZERO_ADDRESS)
        const token = await veth.token()
        const weth = await ethers.getContractAt('TokenLikeTest', token)
        await deposit(veth, weth, 1, user6)
      })

      it('accepts payments', async function () {
        await send(payer1.address, psContract.address, amount)
        expect(await provider.getBalance(psContract.address)).to.be.equal(amount)
      })

      describe('share', function () {
        it('stores shares if address is payee', async function () {
          expect(await psContract.share(payee1.address)).to.be.not.equal('0')
        })

        it('does not store shares if address is not payee', async function () {
          expect(await psContract.share(nonpayee1.address)).to.be.equal('0')
        })
      })

      describe('release', function () {
        it('reverts if no funds to claim', async function () {
          await expect(psContract.releaseEther(payee1.address)).to.be.revertedWith('payee-is-not-due-for-tokens')
        })
        it('reverts if non-payee want to claim', async function () {
          await send(payer1.address, psContract.address, amount)
          await expect(psContract.releaseEther(nonpayee1.address)).to.be.revertedWith('payee-does-not-have-share')
        })

        it('release ether to payee1.address', async function () {
          // receive funds
          await send(payer1.address, psContract.address, amount)
          const initBalance = await provider.getBalance(psContract.address)
          expect(initBalance).to.be.equal(amount)

          // distribute ether to payee1.address
          const initAmount1 = await provider.getBalance(payee1.address)
          await psContract.connect(user6).releaseEther(payee1.address)
          const profit1 = (await provider.getBalance(payee1.address)).sub(initAmount1)
          expect(profit1).to.be.equal(ethers.utils.parseUnits('0.50', 'ether'))
        })

        it('release ether to payee2.address', async function () {
          // receive funds
          await send(payer1.address, psContract.address, amount)
          const initBalance = await provider.getBalance(psContract.address)
          expect(initBalance).to.be.equal(amount)

          // distribute ether to payee2.address
          const initAmount2 = await provider.getBalance(payee2.address)
          await psContract.releaseEther(payee2.address)
          const profit2 = (await provider.getBalance(payee2.address)).sub(initAmount2)
          expect(profit2).to.be.equal(ethers.utils.parseUnits('9.50', 'ether'))
        })
      })
    })

    context('with some ERC20 tokens for two payees', function () {
      let asset1, payees, shares, psContract, mintAmount
      const amount = '10000000000000000'
      describe('release tokens to', function () {
        beforeEach(async function () {
          ;[payee1, payee2, payee3, payer1, nonpayee1, user6] = await ethers.getSigners()
          mintAmount = BN.from(amount).toString()
          asset1 = await deployContract('VSP')
          payees = [payee1.address, payee2.address]
          shares = [5, 95]
          controller = await deployContract('Controller')
          const veth = await deployContract('VETH', [controller.address])
          await initStrategy(veth.address, 'AaveV2StrategyETH')
          psContract = await deployContract('PaymentSplitter', [payees, shares])
          await psContract.addVToken(veth.address, ZERO_ADDRESS)
          await asset1.mint(psContract.address, mintAmount)
          const token = await veth.token()
          const weth = await ethers.getContractAt('TokenLikeTest', token)
          await deposit(veth, weth, 1, user6)
        })

        it('payee1.address', async function () {
          await psContract.release(payee1.address, asset1.address)
          const payee1Balance = (await asset1.balanceOf(payee1.address)).toString()
          assert.equal(payee1Balance, '500000000000000', 'releasing-tokens-failed-for-payee1.address.')
        })

        it('non-payee want to claim', async function () {
          await expect(psContract.releaseEther(nonpayee1.address)).to.be.revertedWith('payee-does-not-have-share')
        })

        it('payee2.address', async function () {
          await psContract.release(payee2.address, asset1.address)
          const payee2Balance = (await asset1.balanceOf(payee2.address)).toString()
          assert.equal(payee2Balance, '9500000000000000', 'releasing-tokens-failed-for-payee2.address.')
        })

        it('payee1.address multiple times', async function () {
          await psContract.release(payee1.address, asset1.address)
          await expect(psContract.release(payee1.address, asset1.address)).to.be.revertedWith(
            'payee-is-not-due-for-tokens'
          )
        })

        it('payee2.address multiple times', async function () {
          await psContract.release(payee2.address, asset1.address)
          await expect(psContract.release(payee2.address, asset1.address)).to.be.revertedWith(
            'payee-is-not-due-for-tokens'
          )
        })

        it('payee1.address and then transfer to other payee', async function () {
          await psContract.release(payee1.address, asset1.address)
          let payee1Balance = (await asset1.balanceOf(payee1.address)).toString()
          assert.equal(payee1Balance, '500000000000000', 'releasing-tokens-failed-for-payee1.address.')

          await asset1.connect(payee1).transfer(payee3.address, '100000000000000')

          payee1Balance = (await asset1.balanceOf(payee1.address)).toString()
          assert.equal(payee1Balance, '400000000000000', 'failed-to-transfer-to-other-account')
          const payee3Balance = (await asset1.balanceOf(payee3.address)).toString()
          assert.equal(payee3Balance, '100000000000000', 'failed-to-transfer-to-other-account')
        })

        it('payee2.address and then transfer to other payee', async function () {
          await psContract.release(payee2.address, asset1.address)
          let payee2Balance = (await asset1.balanceOf(payee2.address)).toString()
          assert.equal(payee2Balance, '9500000000000000', 'releasing-tokens-failed-for-payee2.address.')

          await asset1.connect(payee2).transfer(payee3.address, '100000000000000')

          payee2Balance = (await asset1.balanceOf(payee2.address)).toString()
          assert.equal(payee2Balance, '9400000000000000', 'failed-to-transfer-to-other-account')
          const payee3Balance = (await asset1.balanceOf(payee3.address)).toString()
          assert.equal(payee3Balance, '100000000000000', 'failed-to-transfer-to-other-account')
        })

        it('payee1.address, add more tokens and release again', async function () {
          await psContract.release(payee1.address, asset1.address)
          let payee1Balance = (await asset1.balanceOf(payee1.address)).toString()
          assert.equal(payee1Balance, '500000000000000', 'releasing-tokens-failed-for-payee1.address.')

          await asset1.mint(psContract.address, mintAmount)

          await psContract.release(payee1.address, asset1.address)
          payee1Balance = (await asset1.balanceOf(payee1.address)).toString()
          assert.equal(payee1Balance, '1000000000000000', 'releasing-tokens-failed-for-payee1.address.')
        })

        it('payee2.address, add more tokens and release again', async function () {
          await psContract.release(payee2.address, asset1.address)
          let payee2Balance = (await asset1.balanceOf(payee2.address)).toString()
          assert.equal(payee2Balance, '9500000000000000', 'releasing-tokens-failed-for-payee2.address.')

          await asset1.mint(psContract.address, mintAmount)

          await psContract.release(payee2.address, asset1.address)
          payee2Balance = (await asset1.balanceOf(payee2.address)).toString()
          assert.equal(payee2Balance, '19000000000000000', 'releasing-tokens-failed-for-payee2.address.')
        })

        it('payee2.address, add tokens multiple times and release to payee2.address', async function () {
          await psContract.release(payee2.address, asset1.address)
          let payee2Balance = (await asset1.balanceOf(payee2.address)).toString()
          assert.equal(payee2Balance, '9500000000000000', 'releasing-tokens-failed-for-payee2.address.')
          // Add more tokens multiple times.
          await asset1.mint(psContract.address, mintAmount)
          await asset1.mint(psContract.address, mintAmount)
          await asset1.mint(psContract.address, mintAmount)

          await psContract.release(payee2.address, asset1.address)
          payee2Balance = (await asset1.balanceOf(payee2.address)).toString()
          assert.equal(payee2Balance, '38000000000000000', 'releasing-tokens-failed-for-payee2.address.')
        })

        it('add tokens multiple times and then release for both payees multiple times', async function () {
          await psContract.release(payee2.address, asset1.address)
          let payee2Balance = (await asset1.balanceOf(payee2.address)).toString()
          assert.equal(payee2Balance, '9500000000000000', 'releasing-tokens-failed-for-payee2.address.')
          // Add more tokens multiple times.
          await asset1.mint(psContract.address, mintAmount)
          await asset1.mint(psContract.address, mintAmount)

          await psContract.release(payee2.address, asset1.address)
          payee2Balance = (await asset1.balanceOf(payee2.address)).toString()
          assert.equal(payee2Balance, '28500000000000000', 'releasing-tokens-failed-for-payee2.address.')

          // Add more tokens again
          await asset1.mint(psContract.address, mintAmount)

          await psContract.release(payee1.address, asset1.address)
          let payee1Balance = (await asset1.balanceOf(payee1.address)).toString()
          assert.equal(payee1Balance, '2000000000000000', 'releasing-tokens-failed-for-payee1.address.')

          // Add more tokens again
          await asset1.mint(psContract.address, mintAmount)

          await psContract.release(payee1.address, asset1.address)
          payee1Balance = (await asset1.balanceOf(payee1.address)).toString()
          assert.equal(payee1Balance, '2500000000000000', 'releasing-tokens-failed-for-payee1.address.')

          await psContract.release(payee2.address, asset1.address)
          payee2Balance = (await asset1.balanceOf(payee2.address)).toString()
          assert.equal(payee2Balance, '47500000000000000', 'releasing-tokens-failed-for-payee2.address.')
        })
      })
    })

    context('with some ERC20 tokens for three payees', function () {
      let asset1, payees, shares, psContract
      const amount = '10000000000000000'
      describe('release tokens to', function () {
        beforeEach(async function () {
          ;[payee1, payee2, payee3, payer1, nonpayee1, user6] = await ethers.getSigners()
          asset1 = await deployContract('VSP')
          payees = [payee1.address, payee3.address, payee2.address]
          shares = [20, 30, 950]
          controller = await deployContract('Controller')
          const veth = await deployContract('VETH', [controller.address])
          await initStrategy(veth.address, 'AaveV2StrategyETH')
          psContract = await deployContract('PaymentSplitter', [payees, shares])
          await psContract.addVToken(veth.address, ZERO_ADDRESS)
          const token = await veth.token()
          const weth = await ethers.getContractAt('TokenLikeTest', token)
          await deposit(veth, weth, 1, user6)
          const mintAmount = BN.from(amount).toString()
          await asset1.mint(psContract.address, mintAmount)
        })
        it('payee1.address', async function () {
          await psContract.release(payee1.address, asset1.address)
          const payee1Balance = (await asset1.balanceOf(payee1.address)).toString()
          assert.equal(payee1Balance, '200000000000000', 'releasing-tokens-failed-for-payee1.address.')
        })

        it('payee2.address', async function () {
          await psContract.release(payee3.address, asset1.address)
          const payee3Balance = (await asset1.balanceOf(payee3.address)).toString()
          assert.equal(payee3Balance, '300000000000000', 'releasing-tokens-failed-for-payee2.address.')
        })

        it('payee3.address', async function () {
          await psContract.release(payee2.address, asset1.address)
          const payee2Balance = (await asset1.balanceOf(payee2.address)).toString()
          assert.equal(payee2Balance, '9500000000000000', 'releasing-tokens-failed-for-payee2.address.')
        })
      })
    })

    context('with some tokens for two assets', function () {
      let asset1, asset2, payees, shares, psContract, mintAmount, asset2MintAmount, veth
      const amount = '10000000000000000'
      const asset2Amount = '100000000000'

      beforeEach(async function () {
        ;[payee1, payee2, payee3, payer1, nonpayee1, user6] = await ethers.getSigners()
        mintAmount = BN.from(amount).toString()
        asset2MintAmount = BN.from(asset2Amount).toString()
        asset1 = await deployContract('VSP')
        asset2 = await deployContract('VSP')
        payees = [payee1.address, payee2.address]
        shares = [5, 95]
        controller = await deployContract('Controller')
        veth = await deployContract('VETH', [controller.address])
        await initStrategy(veth.address, 'AaveV2StrategyETH')
        psContract = await deployContract('PaymentSplitter', [payees, shares])
        await psContract.addVToken(veth.address, ZERO_ADDRESS)
        await asset1.mint(psContract.address, mintAmount)
        await asset2.mint(psContract.address, asset2MintAmount)
        const token = await veth.token()
        const weth = await ethers.getContractAt('TokenLikeTest', token)
        await deposit(veth, weth, 5, user6)
      })
      describe('release tokens to', function () {
        it('payee1.address for asset 1', async function () {
          await psContract.release(payee1.address, asset1.address)
          const payee1Balance = (await asset1.balanceOf(payee1.address)).toString()
          assert.equal(payee1Balance, '500000000000000', 'releasing-tokens-failed-for-payee1.address-asset-1')
        })

        it('payee1.address for asset 2', async function () {
          await psContract.release(payee1.address, asset2.address)
          const payee1Balance = (await asset2.balanceOf(payee1.address)).toString()
          assert.equal(payee1Balance, '5000000000', 'releasing-tokens-failed-for-payee1.address-asset-2')
        })

        it('payee2.address for asset 1', async function () {
          await psContract.release(payee2.address, asset1.address)
          const payee2Balance = (await asset1.balanceOf(payee2.address)).toString()
          assert.equal(payee2Balance, '9500000000000000', 'releasing-tokens-failed-for-payee2.address-asset-1')
        })
        it('payee2.address for asset 2', async function () {
          await psContract.release(payee2.address, asset2.address)
          const payee2Balance = (await asset2.balanceOf(payee2.address)).toString()
          assert.equal(payee2Balance, '95000000000', 'releasing-tokens-failed-for-payee2.address-asset-2')
        })

        it('payee1.address/asset1, add more tokens and release again for payee1.address/asset1', async function () {
          await psContract.release(payee1.address, asset1.address)
          let payee1Balance = (await asset1.balanceOf(payee1.address)).toString()
          assert.equal(payee1Balance, '500000000000000', 'releasing-tokens-failed-for-payee1.address.')

          await asset1.mint(psContract.address, mintAmount)

          await psContract.release(payee1.address, asset1.address)
          payee1Balance = (await asset1.balanceOf(payee1.address)).toString()
          assert.equal(payee1Balance, '1000000000000000', 'releasing-tokens-failed-for-payee1.address.')
        })

        it('payee1.address multiple times for asset1', async function () {
          await psContract.release(payee1.address, asset1.address)
          const payee1Balance = (await asset1.balanceOf(payee1.address)).toString()
          assert.equal(payee1Balance, '500000000000000', 'releasing-tokens-failed-for-payee1.address.')
          await expect(psContract.release(payee1.address, asset1.address)).to.be.revertedWith(
            'payee-is-not-due-for-tokens'
          )
        })

        it('payee2.address multiple times for asset1', async function () {
          await psContract.release(payee2.address, asset1.address)
          const payee2Balance = (await asset1.balanceOf(payee2.address)).toString()
          assert.equal(payee2Balance, '9500000000000000', 'releasing-tokens-failed-for-payee2.address.')
          await expect(psContract.release(payee2.address, asset1.address)).to.be.revertedWith(
            'payee-is-not-due-for-tokens'
          )
        })

        it('payee1.address multiple times for asset2', async function () {
          await psContract.release(payee1.address, asset2.address)
          const payee1Balance = (await asset2.balanceOf(payee1.address)).toString()
          assert.equal(payee1Balance, '5000000000', 'releasing-tokens-failed-for-payee1.address.')
          await expect(psContract.release(payee1.address, asset2.address)).to.be.revertedWith(
            'payee-is-not-due-for-tokens'
          )
        })

        it('payee2.address multiple times for asset2', async function () {
          await psContract.release(payee2.address, asset2.address)
          const payee2Balance = (await asset2.balanceOf(payee2.address)).toString()
          assert.equal(payee2Balance, '95000000000', 'releasing-tokens-failed-for-payee2.address.')
          await expect(psContract.release(payee2.address, asset2.address)).to.be.revertedWith(
            'payee-is-not-due-for-tokens'
          )
        })

        it('payee1.address/asset1, add more tokens for asset2 & release for payee1.address/asset1', async function () {
          await psContract.release(payee1.address, asset1.address)
          const payee1Balance = (await asset1.balanceOf(payee1.address)).toString()
          assert.equal(payee1Balance, '500000000000000', 'releasing-tokens-failed-for-payee1.address.')

          await asset2.mint(psContract.address, mintAmount)

          await expect(psContract.release(payee1.address, asset1.address)).to.be.revertedWith(
            'payee-is-not-due-for-tokens'
          )
        })

        it('payee1.address/asset2, add more tokens for asset1 & release for payee1.address/asset2', async function () {
          await psContract.release(payee1.address, asset2.address)
          const payee1Balance = (await asset2.balanceOf(payee1.address)).toString()
          assert.equal(payee1Balance, '5000000000', 'releasing-tokens-failed-for-payee1.address.')

          await asset1.mint(psContract.address, mintAmount)

          await expect(psContract.release(payee1.address, asset2.address)).to.be.revertedWith(
            'payee-is-not-due-for-tokens'
          )
        })
      })

      it('add tokens multiple times for two assets and release for both payees multiple times', async function () {
        await psContract.release(payee2.address, asset1.address)
        let payee2Balance = (await asset1.balanceOf(payee2.address)).toString()
        assert.equal(payee2Balance, '9500000000000000', 'releasing-tokens-failed-for-payee2.address.')
        // Add more tokens multiple times for both assets
        await asset1.mint(psContract.address, mintAmount)
        await asset1.mint(psContract.address, mintAmount)
        await asset2.mint(psContract.address, asset2MintAmount)
        await asset2.mint(psContract.address, asset2MintAmount)

        await psContract.release(payee2.address, asset1.address)
        payee2Balance = (await asset1.balanceOf(payee2.address)).toString()
        assert.equal(payee2Balance, '28500000000000000', 'releasing-tokens-failed-for-payee2.address.')

        await psContract.release(payee2.address, asset2.address)
        payee2Balance = (await asset2.balanceOf(payee2.address)).toString()
        assert.equal(payee2Balance, '285000000000', 'releasing-tokens-failed-for-payee2.address.')

        // Add more tokens again
        await asset1.mint(psContract.address, mintAmount)
        await asset2.mint(psContract.address, asset2MintAmount)

        await psContract.release(payee1.address, asset1.address)
        let payee1Balance = (await asset1.balanceOf(payee1.address)).toString()
        assert.equal(payee1Balance, '2000000000000000', 'releasing-tokens-failed-for-payee1.address.')

        await psContract.release(payee1.address, asset2.address)
        payee1Balance = (await asset2.balanceOf(payee1.address)).toString()
        assert.equal(payee1Balance, '20000000000', 'releasing-tokens-failed-for-payee1.address.')

        // Add more tokens again
        await asset1.mint(psContract.address, mintAmount)
        await asset2.mint(psContract.address, asset2MintAmount)

        await psContract.release(payee1.address, asset1.address)
        payee1Balance = (await asset1.balanceOf(payee1.address)).toString()
        assert.equal(payee1Balance, '2500000000000000', 'releasing-tokens-failed-for-payee1.address.')

        await psContract.release(payee2.address, asset1.address)
        payee2Balance = (await asset1.balanceOf(payee2.address)).toString()
        assert.equal(payee2Balance, '47500000000000000', 'releasing-tokens-failed-for-payee2.address.')

        await psContract.release(payee1.address, asset2.address)
        payee1Balance = (await asset2.balanceOf(payee1.address)).toString()
        assert.equal(payee1Balance, '25000000000', 'releasing-tokens-failed-for-payee1.address.')

        await psContract.release(payee2.address, asset2.address)
        payee2Balance = (await asset2.balanceOf(payee2.address)).toString()
        assert.equal(payee2Balance, '475000000000', 'releasing-tokens-failed-for-payee2.address.')
      })
    })

    context('Vesper Deployer Account top-up with vETH token', function () {
      let payees, shares, psContract, veth, asset1
      const low = '10000000000000000000' // 10 eth
      const high = '20000000000000000000' // 20 eth

      beforeEach(async function () {
        ;[payee1, payee2, payee3, payer1, nonpayee1, user6] = await ethers.getSigners()
        payees = [payee1.address, payee2.address]
        shares = [5, 95]
        controller = await deployContract('Controller')
        veth = await deployContract('VETH', [controller.address])
        await initStrategy(veth.address, 'AaveV2StrategyETH')
        psContract = await deployContract('PaymentSplitter', [payees, shares])
        asset1 = await deployContract('VSP')
        const amount = '10000000000000000'
        const mintAmount = BN.from(amount).toString()
        await asset1.mint(psContract.address, mintAmount)
        await psContract.addVToken(veth.address, ZERO_ADDRESS)
        const token = await veth.token()
        const weth = await ethers.getContractAt('TokenLikeTest', token)
        await deposit(veth, weth, 1, user6)
      })

      it('should not top-up by default on release', async function () {
        // Keep 10 ether at VESPER_DEPLOYER
        const signer = await unlock(VESPER_DEPLOYER)
        await hre.network.provider.send('hardhat_setBalance', [VESPER_DEPLOYER, '0x0'])
        await send(user6.address, VESPER_DEPLOYER, BN.from('10').mul(DECIMAL18))

        // Transfer some vETH at payment splitter contract address to bring VESPER_DEPLOYER balance < low level
        await veth.connect(signer)['deposit()']({value: BN.from('8').mul(DECIMAL18).toString()})
        const vethAmount = BN.from('6').mul(DECIMAL18)
        await veth.connect(signer).transfer(psContract.address, vethAmount.toString())

        // eth balance below low level
        const ethBalanceBefore = await provider.getBalance(VESPER_DEPLOYER)
        expect(ethBalanceBefore).to.be.lt(BN.from(low), 'eth balance is above low value')

        // Check vETH at payment splitter contract address
        const psVethBalanceBefore = await veth.balanceOf(psContract.address)
        expect(psVethBalanceBefore).to.be.equal(BN.from(vethAmount), 'wrong veth amount')
        const vdVethBalanceBefore = await veth.balanceOf(VESPER_DEPLOYER)

        // release
        await psContract.release(payee1.address, asset1.address)
        const vdVethBalanceAfter = await veth.balanceOf(VESPER_DEPLOYER)

        expect(vdVethBalanceBefore).to.be.equal(vdVethBalanceAfter, 'Top-up should not have done')
      })

      it('should top-up on release when allowAutoTopUp is set to true', async function () {
        await psContract.setAllowAutoTopUp(true)

        // Keep 10 ether at VESPER_DEPLOYER
        const signer = await unlock(VESPER_DEPLOYER)
        await hre.network.provider.send('hardhat_setBalance', [VESPER_DEPLOYER, '0x0'])
        await send(user6.address, VESPER_DEPLOYER, BN.from('10').mul(DECIMAL18))

        // Transfer some vETH at payment splitter contract address to bring VESPER_DEPLOYER balance < low level
        await veth.connect(signer)['deposit()']({value: BN.from('8').mul(DECIMAL18).toString()})
        const vethAmount = BN.from('6').mul(DECIMAL18)
        await veth.connect(signer).transfer(psContract.address, vethAmount.toString())

        // eth balance below low level
        const ethBalanceBefore = await provider.getBalance(VESPER_DEPLOYER)
        expect(ethBalanceBefore).to.be.lt(BN.from(low), 'eth balance is above low value')

        // Check vETH at payment splitter contract address
        const psVethBalanceBefore = await veth.balanceOf(psContract.address)
        expect(psVethBalanceBefore).to.be.equal(BN.from(vethAmount), 'wrong veth amount')
        const vdVethBalanceBefore = await veth.balanceOf(VESPER_DEPLOYER)

        // release
        await psContract.release(payee1.address, asset1.address)
        const vdVethBalanceAfter = await veth.balanceOf(VESPER_DEPLOYER)

        expect(vdVethBalanceAfter).to.be.gt(vdVethBalanceBefore, 'top-up failed')
      })

      it('should top-up vesper deployer to exact high level', async function () {
        // Keep 23 ether at VESPER_DEPLOYER
        const signer = await unlock(VESPER_DEPLOYER)
        await hre.network.provider.send('hardhat_setBalance', [VESPER_DEPLOYER, '0x0'])
        await send(user6.address, VESPER_DEPLOYER, BN.from('10').mul(DECIMAL18))
        await send(user6.address, VESPER_DEPLOYER, BN.from('13').mul(DECIMAL18))

        // Transfer some vETH at payment splitter contract address to bring VESPER_DEPLOYER balance < low level
        await veth.connect(signer)['deposit()']({value: BN.from('22').mul(DECIMAL18).toString()})
        const vethAmount = BN.from('21').mul(DECIMAL18)
        await veth.connect(signer).transfer(psContract.address, vethAmount.toString())

        // new vETH pool have do not increase pricePerShare
        const pricePerShare = await veth.getPricePerShare()
        expect(pricePerShare).to.be.equal(DECIMAL18, 'wrong pricePerShare')

        // eth balance below low level
        const vesperEthBalanceBefore = await provider.getBalance(VESPER_DEPLOYER)
        const vdVethBalanceBefore = await veth.balanceOf(VESPER_DEPLOYER)
        const totalVesperBefore = vesperEthBalanceBefore.add(vdVethBalanceBefore)
        expect(totalVesperBefore).to.be.lt(BN.from(low), 'eth balance is above low value')

        // Check vETH at payment splitter contract address
        const psVethBalanceBefore = await veth.balanceOf(psContract.address)
        expect(psVethBalanceBefore).to.be.equal(BN.from(vethAmount), 'wrong veth amount')

        // Top-up vesper deployer
        await psContract.connect(user6).topUp()
        const vesperEthBalanceAfter = await provider.getBalance(VESPER_DEPLOYER)
        const vdVethBalanceAfter = await veth.balanceOf(VESPER_DEPLOYER)
        const totalVesperAfter = vesperEthBalanceAfter.add(vdVethBalanceAfter)
        const psVethBalanceAfter = await veth.balanceOf(psContract.address)
        const expectedAmountTransfer = psVethBalanceBefore.sub(psVethBalanceAfter)
        const actualAmountTransfer = vdVethBalanceAfter.sub(vdVethBalanceBefore)

        expect(expectedAmountTransfer).to.be.equal(actualAmountTransfer, 'Top-up done with wrong amount')
        expect(totalVesperAfter).to.be.equal(high, 'vesper deployer have > high balance')
      })

      it('should top-up vesper deployer with less than high level amount', async function () {
        // Keep 25 ether at VESPER_DEPLOYER
        const signer = await unlock(VESPER_DEPLOYER)
        await hre.network.provider.send('hardhat_setBalance', [VESPER_DEPLOYER, '0x0'])
        await send(user6.address, VESPER_DEPLOYER, BN.from('10').mul(DECIMAL18))
        await send(user6.address, VESPER_DEPLOYER, BN.from('15').mul(DECIMAL18))

        // Transfer some vETH at payment splitter contract address to bring VESPER_DEPLOYER balance < low level
        await veth.connect(signer)['deposit()']({value: BN.from('23').mul(DECIMAL18).toString()})
        const vethAmount = BN.from('22').mul(DECIMAL18) // high level is 20 so transfer > 20
        await veth.connect(signer).transfer(psContract.address, vethAmount.toString())

        // eth balance below low level
        const ethBalanceBefore = await provider.getBalance(VESPER_DEPLOYER)
        expect(ethBalanceBefore).to.be.lt(BN.from(low), 'eth balance is above low value')

        // Check vETH at payment splitter contract address
        const psVethBalanceBefore = await veth.balanceOf(psContract.address)
        expect(psVethBalanceBefore).to.be.equal(BN.from(vethAmount), 'wrong veth amount')

        // calculate total vesper deployer balance
        const weth = await ethers.getContractAt(TokenLike, WETH)
        const vesperWethBalanceBefore = await weth.balanceOf(VESPER_DEPLOYER)
        const vdVethBalanceBefore = await veth.balanceOf(VESPER_DEPLOYER)
        const totalVesperBalanceBefore = ethBalanceBefore.add(BN.from(vesperWethBalanceBefore)).add(vdVethBalanceBefore)
        // Top-up vesper deployer
        await psContract.connect(user6).topUp()
        const vdVethBalanceAfter = await veth.balanceOf(VESPER_DEPLOYER)
        const psVethBalanceAfter = await veth.balanceOf(psContract.address)

        const actualDiff = BN.from(vdVethBalanceAfter).sub(BN.from(vdVethBalanceBefore))
        const expectedDiff = BN.from(high).sub(BN.from(totalVesperBalanceBefore))
        expect(vdVethBalanceAfter).to.be.lte(high, 'vesper deployer have > high balance')
        expect(expectedDiff).to.be.equal(actualDiff, 'Top-up amount not matching')
        expect(psVethBalanceAfter).to.be.lt(psVethBalanceBefore, 'failed to transfer partial amount')
      })

      it('should not top-up vesper deployer when balance is greater than low level', async function () {
        const signer = await unlock(VESPER_DEPLOYER)
        // Transfer 25 ether at VESPER_DEPLOYER
        await send(user6.address, VESPER_DEPLOYER, BN.from('15').mul(DECIMAL18))
        await send(user6.address, VESPER_DEPLOYER, BN.from('15').mul(DECIMAL18))

        // add some vETH at payment splitter contract address
        await veth.connect(signer)['deposit()']({value: BN.from('15').mul(DECIMAL18).toString()})
        const vethAmount = BN.from('11').mul(DECIMAL18)
        await veth.connect(signer).transfer(psContract.address, vethAmount.toString())

        // Check eth balance is > low level.
        const ethBalanceBefore = await provider.getBalance(VESPER_DEPLOYER)
        expect(ethBalanceBefore).to.be.gt(BN.from(low), 'eth balance is below low value')

        // VESPER_DEPLOYER has eth balance > low so top-up will be skipped.
        const vdVethBalanceBefore = await veth.balanceOf(VESPER_DEPLOYER)
        await psContract.connect(user6).topUp()
        const vdVethBalanceAfter = await veth.balanceOf(VESPER_DEPLOYER)

        expect(vdVethBalanceBefore).to.be.equal(vdVethBalanceAfter, 'Top-up should not change balance')
      })
    })

    context('Vesper Deployer Account top-up with vUSDC token', function () {
      let payees, shares, psContract, vusdc
      const chainLinkUsdc2EthOracle = '0x986b5e1e1755e3c2440e960477f25201b0a8bbd4'

      beforeEach(async function () {
        ;[payee1, payee2, payee3, payer1, nonpayee1, user6] = await ethers.getSigners()
        payees = [payee1.address, payee2.address]
        shares = [5, 95]
        controller = await deployContract('Controller')
        vusdc = await deployContract('VUSDC', [controller.address])
        await initStrategy(vusdc.address, 'AaveV2StrategyUSDC')
        psContract = await deployContract('PaymentSplitter', [payees, shares])
        await psContract.addVToken(vusdc.address, chainLinkUsdc2EthOracle)
      })

      it('should top-up vesper deployer with vUSDC token', async function () {
        // Keep 25 ether at VESPER_DEPLOYER
        const signer = await unlock(VESPER_DEPLOYER)
        await hre.network.provider.send('hardhat_setBalance', [VESPER_DEPLOYER, '0x0'])
        await send(user6.address, VESPER_DEPLOYER, BN.from('10').mul(DECIMAL18))
        await send(user6.address, VESPER_DEPLOYER, BN.from('15').mul(DECIMAL18))
        const token = await vusdc.token()
        const usdc = await ethers.getContractAt('ERC20', token)

        // deposit 24 eth into vUSDC pool
        await deposit(vusdc, usdc, 24, signer)
        const vusdcBal = await vusdc.balanceOf(signer.address)

        // Transfer vUSDC balance to PS contract to bring VESPER_DEPLOYER balance < low level
        await vusdc.connect(signer).approve(psContract.address, vusdcBal)
        await vusdc.connect(signer).transfer(psContract.address, vusdcBal)

        // Set ETH and vUSDC balance to 0 for VESPER_DEPLOYER
        const vesperVusdcBalance = await vusdc.balanceOf(VESPER_DEPLOYER)
        await hre.network.provider.send('hardhat_setBalance', [VESPER_DEPLOYER, '0x0'])
        expect(vesperVusdcBalance).to.be.equal(0, 'vUSDC vesper deployer balance is not 0')
        expect(await provider.getBalance(VESPER_DEPLOYER)).to.be.equal(0, 'eth balance is not 0')

        // Check vUSDC at payment splitter contract address
        const psVusdcBalanceBefore = await vusdc.balanceOf(psContract.address)
        expect(psVusdcBalanceBefore).to.be.equal(vusdcBal, 'wrong vusdc amount')

        // Top-up vesper deployer
        await psContract.connect(user6).topUp()
        const vdVusdcBalanceAfter = await vusdc.balanceOf(VESPER_DEPLOYER)
        const psVusdcBalanceAfter = await vusdc.balanceOf(psContract.address)

        const perSharePrice = await vusdc.getPricePerShare()

        // safe high levels to avoid any exchange/slippage loss.
        // keeping here a bit higher margins (2 eth) in case test executed with fork (older block number)
        const safeAboveHighLevel = BN.from(await getEthQuote('22', token))
          .mul(DECIMAL18)
          .div(perSharePrice)
        const safeUnderHighLevel = BN.from(await getEthQuote('18', token))
          .mul(DECIMAL18)
          .div(perSharePrice)

        expect(vdVusdcBalanceAfter).to.be.gte(safeUnderHighLevel, 'vesper deployer have < safe under high balance')
        expect(vdVusdcBalanceAfter).to.be.lte(safeAboveHighLevel, 'vesper deployer have > safe above high balance')
        expect(psVusdcBalanceBefore.sub(psVusdcBalanceAfter)).to.be.eq(
          vdVusdcBalanceAfter,
          'failed to top-up vesper deployer with usdc'
        )
      })
    })

    context('Only owner', function () {
      let payees, shares, psContract, vusdc, vwbtc, veth
      const chainLinkUsdc2EthOracle = '0x986b5e1e1755e3c2440e960477f25201b0a8bbd4'
      const chainLinkBtc2EthOracle = '0xF7904a295A029a3aBDFFB6F12755974a958C7C25'
      beforeEach(async function () {
        ;[payee1, payee2, payee3, payer1, nonpayee1, user6] = await ethers.getSigners()
        payees = [payee1.address, payee2.address]
        shares = [5, 95]
        controller = await deployContract('Controller')
        vusdc = await deployContract('VUSDC', [controller.address])
        vwbtc = await deployContract('VWBTC', [controller.address])
        veth = await deployContract('VETH', [controller.address])
        await initStrategy(veth.address, 'AaveV2StrategyETH')
        await initStrategy(vwbtc.address, 'AaveV2StrategyWBTC')
        await initStrategy(vusdc.address, 'AaveV2StrategyUSDC')
        psContract = await deployContract('PaymentSplitter', [payees, shares])
      })

      it('should allow to add vToken by owner', async function () {
        await expect(psContract.addVToken(veth.address, ZERO_ADDRESS)).not.to.be.reverted
        await expect(psContract.addVToken(vwbtc.address, chainLinkBtc2EthOracle)).not.to.be.reverted
        await expect(psContract.addVToken(vusdc.address, chainLinkUsdc2EthOracle)).not.to.be.reverted
        expect(await psContract.vTokens([0])).to.be.equal(veth.address)
        expect(await psContract.vTokens([1])).to.be.equal(vwbtc.address)
        expect(await psContract.vTokens([2])).to.be.equal(vusdc.address)
      })

      it('should not allow to add vToken if already present', async function () {
        await expect(psContract.addVToken(veth.address, ZERO_ADDRESS)).not.to.be.reverted
        await expect(psContract.addVToken(veth.address, ZERO_ADDRESS)).to.be.revertedWith('duplicate-vToken')
        await expect(psContract.addVToken(vwbtc.address, chainLinkBtc2EthOracle)).not.to.be.reverted
        await expect(psContract.addVToken(vwbtc.address, chainLinkBtc2EthOracle)).to.be.revertedWith('duplicate-vToken')
      })

      it('should not allow to add vToken with zero oracle address for non WETH pool', async function () {
        await expect(psContract.addVToken(vwbtc.address, ZERO_ADDRESS)).to.be.revertedWith('oracle-is-zero-address')
        await expect(psContract.addVToken(vusdc.address, ZERO_ADDRESS)).to.be.revertedWith('oracle-is-zero-address')
      })

      it('should allow to add vToken with zero oracle address for WETH pool', async function () {
        await expect(psContract.addVToken(veth.address, ZERO_ADDRESS)).not.to.be.reverted
      })

      it('should not allow to add vToken with zero address', async function () {
        await expect(psContract.addVToken(ZERO_ADDRESS, ZERO_ADDRESS)).to.be.revertedWith('vToken-is-zero-address')
      })

      it('should not allow to add vToken using non owner', async function () {
        await expect(psContract.connect(user6).addVToken(veth.address, ZERO_ADDRESS)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        )
      })

      it('should allow to remove vToken by owner', async function () {
        await psContract.addVToken(veth.address, ZERO_ADDRESS)
        await psContract.addVToken(vwbtc.address, chainLinkBtc2EthOracle)
        await psContract.addVToken(vusdc.address, chainLinkUsdc2EthOracle)

        await expect(psContract.removeVToken(vwbtc.address)).not.to.be.reverted
        await expect(psContract.removeVToken(veth.address)).not.to.be.reverted
        await expect(psContract.removeVToken(vusdc.address)).not.to.be.reverted

        await expect(psContract.vTokens([0])).to.be.reverted
      })

      it('should allow to add, remove and add vToken', async function () {
        await psContract.addVToken(veth.address, ZERO_ADDRESS)
        await psContract.addVToken(vwbtc.address, chainLinkBtc2EthOracle)
        await psContract.addVToken(vusdc.address, chainLinkUsdc2EthOracle)

        await expect(psContract.removeVToken(veth.address)).not.to.be.reverted
        await expect(psContract.addVToken(veth.address, ZERO_ADDRESS)).not.to.be.reverted
        await expect(psContract.removeVToken(vusdc.address)).not.to.be.reverted
        await expect(psContract.removeVToken(veth.address)).not.to.be.reverted
        await expect(psContract.addVToken(veth.address, ZERO_ADDRESS)).not.to.be.reverted
      })

      it('should not allow to remove vToken if not present', async function () {
        await expect(psContract.removeVToken(veth.address)).to.be.revertedWith('vToken-not-found')
        await expect(psContract.removeVToken(vusdc.address)).to.be.revertedWith('vToken-not-found')
        await psContract.addVToken(veth.address, ZERO_ADDRESS)
        await expect(psContract.removeVToken(veth.address)).not.to.be.reverted
        await expect(psContract.removeVToken(veth.address)).to.be.revertedWith('vToken-not-found')
      })

      it('should not allow to remove vToken with zero address', async function () {
        await expect(psContract.removeVToken(ZERO_ADDRESS)).to.be.revertedWith('vToken-is-zero-address')
      })

      it('should not allow to remove vToken using non owner', async function () {
        await expect(psContract.connect(user6).removeVToken(veth.address)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        )
      })

      it('should allow auto top-up update using owner', async function () {
        await psContract.setAllowAutoTopUp(false)
        expect(await psContract.allowAutoTopUp()).to.be.equal(false)
      })

      it('should not allow auto top-up update using non owner', async function () {
        await expect(psContract.connect(user6).setAllowAutoTopUp(false)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        )
      })
    })
  })
})
