'use strict'
// eslint-disable-next-line no-shadow
const {deployContract, send, unlock} = require('./utils/setupHelper')
const hre = require('hardhat')
const ethers = hre.ethers
const provider = hre.waffle.provider
const {BigNumber: BN} = require('ethers')
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const VESPER_DEPLOYER = '0xB5AbDABE50b5193d4dB92a16011792B22bA3Ef51'
const DECIMAL = BN.from('1000000000000000000')
const {constants} = require('@openzeppelin/test-helpers')
const {expect, assert} = require('chai')
const TokenLike = 'TokenLikeTest'
const {ZERO_ADDRESS} = constants

describe('PaymentSplitter', function () {
  describe('Payment Splitter Contract deployed', function () {
    let payee1, payee2, payee3, payer1, nonpayee1, user6
    context('General validations', function () {
      let veth
      beforeEach(async function () {
        ;[payee1, payee2, payee3, payer1, nonpayee1, user6] = await ethers.getSigners()
        const controller = await deployContract('Controller')
        veth = await deployContract('VETH', [controller.address])
      })

      it('rejects an empty set of payees', async function () {
        await expect(deployContract('PaymentSplitter', [[], [], veth.address])).to.be.revertedWith('no-payees')
      })

      it('rejects more payees than share', async function () {
        await expect(
          deployContract('PaymentSplitter', [[payee1.address, payee2.address, payee3.address], [20, 30], veth.address])
        ).to.be.revertedWith('payees-and-share-length-mismatch')
      })

      it('rejects more share than payees', async function () {
        await expect(
          deployContract('PaymentSplitter', [[payee1.address, payee2.address], [20, 30, 40], veth.address])
        ).to.be.revertedWith('payees-and-share-length-mismatch')
      })

      it('rejects null payees', async function () {
        await expect(
          deployContract('PaymentSplitter', [[payee1.address, ZERO_ADDRESS], [20, 30], veth.address])
        ).to.be.revertedWith('payee-is-zero-address')
      })

      it('rejects zero-valued share', async function () {
        await expect(
          deployContract('PaymentSplitter', [[payee1.address, payee2.address], [20, 0], veth.address])
        ).to.be.revertedWith('payee-with-zero-share')
      })

      it('rejects repeated payees', async function () {
        await expect(
          deployContract('PaymentSplitter', [[payee1.address, payee1.address], [20, 30], veth.address])
        ).to.be.revertedWith('payee-exists-with-share')
      })
    })

    context('without any ERC20 tokens', function () {
      let payees, shares, psContract, asset1
      beforeEach(async function () {
        payees = [payee1.address, payee2.address]
        shares = [5, 95]
        const controller = await deployContract('Controller')
        const veth = await deployContract('VETH', [controller.address])
        psContract = await deployContract('PaymentSplitter', [payees, shares, veth.address])
        asset1 = await deployContract('VSP')
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
        amount = BN.from('10').mul(DECIMAL)
        payees = [payee1.address, payee2.address]
        shares = [5, 95]
        const controller = await deployContract('Controller')
        const veth = await deployContract('VETH', [controller.address])
        psContract = await deployContract('PaymentSplitter', [payees, shares, veth.address])
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
          await psContract.releaseEther(payee1.address, {gasPrice: 0})
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
          await psContract.releaseEther(payee2.address, {gasPrice: 0})
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
          const controller = await deployContract('Controller')
          const veth = await deployContract('VETH', [controller.address])
          psContract = await deployContract('PaymentSplitter', [payees, shares, veth.address])
          await asset1.mint(psContract.address, mintAmount)
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
          asset1 = await deployContract('VSP')
          payees = [payee1.address, payee3.address, payee2.address]
          shares = [20, 30, 950]
          const controller = await deployContract('Controller')
          const veth = await deployContract('VETH', [controller.address])
          psContract = await deployContract('PaymentSplitter', [payees, shares, veth.address])
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
      let asset1, asset2, payees, shares, psContract, mintAmount, asset2MintAmount
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
        const controller = await deployContract('Controller')
        const veth = await deployContract('VETH', [controller.address])
        psContract = await deployContract('PaymentSplitter', [payees, shares, veth.address])
        await asset1.mint(psContract.address, mintAmount)
        await asset2.mint(psContract.address, asset2MintAmount)
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

        it('payee1.address/asset1, add more tokens for asset2 and release for payee1.address/asset1', 
        async function () {
          await psContract.release(payee1.address, asset1.address)
          const payee1Balance = (await asset1.balanceOf(payee1.address)).toString()
          assert.equal(payee1Balance, '500000000000000', 'releasing-tokens-failed-for-payee1.address.')

          await asset2.mint(psContract.address, mintAmount)

          await expect(psContract.release(payee1.address, asset1.address)).to.be.revertedWith(
            'payee-is-not-due-for-tokens'
          )
        })

        it('payee1.address/asset2, add more tokens for asset1 and release for payee1.address/asset2', 
        async function () {
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

    context('Vesper Deployer Account topup', function () {
      let payees, shares, psContract, veth
      const low = '5000000000000000000' // 5 eth
      const high = '20000000000000000000' // 20 eth

      beforeEach(async function () {
        ;[payee1, payee2, payee3, payer1, nonpayee1, user6] = await ethers.getSigners()
        payees = [payee1.address, payee2.address]
        shares = [5, 95]
        const controller = await deployContract('Controller')
        veth = await deployContract('VETH', [controller.address])
        await controller.addPool(veth.address)
        const strategy = await deployContract('AaveV2StrategyWBTC', [controller.address, veth.address])
        await controller.updateStrategy(veth.address, strategy.address)
        psContract = await deployContract('PaymentSplitter', [payees, shares, veth.address])
      })

      it('should initialize low topup level', async function () {
        assert.equal((await psContract.LOW()).toString(), low)
      })

      it('should initialize high topup level', async function () {
        assert.equal((await psContract.HIGH()).toString(), high)
      })

      it('should topup vesper deployer with full amount', async function () {
        // Keep 10 ether at VESPER_DEPLOYER
        const signer = await unlock(VESPER_DEPLOYER)
        const ethBalance = await provider.getBalance(VESPER_DEPLOYER)
        await send(signer.address, user6.address, ethBalance)
        await send(user6.address, VESPER_DEPLOYER, BN.from('10').mul(DECIMAL))

        // Transfer some VETH at payment splitter contract address to bring VESPER_DEPLOYER balance < low level
        await veth.connect(signer)['deposit()']({value:BN.from('8').mul(DECIMAL).toString()})
        const vethAmount = BN.from('6').mul(DECIMAL)
        await veth.connect(signer).transfer(psContract.address, vethAmount.toString())

        // eth balance below low level
        const ethBalanceBefore = await provider.getBalance(VESPER_DEPLOYER)
        expect(ethBalanceBefore).to.be.lt(BN.from(low), 'eth balance is above low value')

        // Check VETH at payment splitter contract address
        const psVethBalanceBefore = await veth.balanceOf(psContract.address)
        expect(psVethBalanceBefore).to.be.equal(BN.from(vethAmount), 'wrong veth amount')

        // topup vesper deployer
        const vesperVethBalanceBefore = await veth.balanceOf(VESPER_DEPLOYER)
        await psContract.connect(user6).topUp()
        const vesperVethBalanceAfter = await veth.balanceOf(VESPER_DEPLOYER)
        const psVethBalanceAfter = await veth.balanceOf(psContract.address)

        expect(vesperVethBalanceBefore).to.be.lt(vesperVethBalanceAfter, 'topup done with wrong amount')
        expect(vesperVethBalanceAfter).to.be.lte(high, 'vesper deployer have > high balance')
        expect(psVethBalanceAfter).to.be.eq(BN.from('0'), 'failed to transfer full amount')
      })

      it('should topup vesper deployer with less than high level amount', async function () {
        // Keep 25 ether at VESPER_DEPLOYER
        const signer = await unlock(VESPER_DEPLOYER)
        const ethBalance = await provider.getBalance(VESPER_DEPLOYER)
        await send(signer.address, user6.address, ethBalance)
        await send(user6.address, VESPER_DEPLOYER, BN.from('15').mul(DECIMAL))
        await send(user6.address, VESPER_DEPLOYER, BN.from('10').mul(DECIMAL))
        
        // Transfer some VETH at payment splitter contract address to bring VESPER_DEPLOYER balance < low level
        await veth.connect(signer)['deposit()']({value: BN.from('23').mul(DECIMAL).toString()})
        const vethAmount = BN.from('22').mul(DECIMAL) // high level is 20 so transfer > 20
        await veth.connect(signer).transfer(psContract.address, vethAmount.toString())

        // eth balance below low level
        const ethBalanceBefore = await provider.getBalance(VESPER_DEPLOYER)
        expect(ethBalanceBefore).to.be.lt(BN.from(low), 'eth balance is above low value')

        // Check VETH at payment splitter contract address
        const psVethBalanceBefore = await veth.balanceOf(psContract.address)
        expect(psVethBalanceBefore).to.be.equal(BN.from(vethAmount), 'wrong veth amount')

        // calculate total vesper deployer balance
        const weth = await ethers.getContractAt(TokenLike, WETH)
        const vesperWethBalanceBefore = await weth.balanceOf(VESPER_DEPLOYER)
        const vesperVethBalanceBefore = await veth.balanceOf(VESPER_DEPLOYER)
        const totalVesperBalanceBefore = ethBalanceBefore
          .add(BN.from(vesperWethBalanceBefore))
          .add(vesperVethBalanceBefore)

        // topup vesper deployer
        await psContract.connect(user6).topUp()
        const vesperVethBalanceAfter = await veth.balanceOf(VESPER_DEPLOYER)
        const psVethBalanceAfter = await veth.balanceOf(psContract.address)

        const actualDiff = BN.from(vesperVethBalanceAfter).sub(BN.from(vesperVethBalanceBefore))
        const expectedDiff = BN.from(high).sub(BN.from(totalVesperBalanceBefore))
        expect(vesperVethBalanceAfter).to.be.lte(high, 'vesper deployer have > high balance')
        expect(actualDiff).to.be.equal(expectedDiff, 'topup amount not matching')
        expect(psVethBalanceAfter).to.be.lt(psVethBalanceBefore, 'failed to transfer partial amount')
      })

      it('should not topup vesper deployer when balance is greater than low level', async function () {
        const signer = await unlock(VESPER_DEPLOYER)
        // Transfer 25 ether at VESPER_DEPLOYER
        await send(user6.address, VESPER_DEPLOYER, BN.from('15').mul(DECIMAL))
        await send(user6.address, VESPER_DEPLOYER, BN.from('10').mul(DECIMAL))

        // add some VETH at payment splitter contract address
        await veth.connect(signer)['deposit()']({value: BN.from('20').mul(DECIMAL).toString()})
        const vethAmount = BN.from('15').mul(DECIMAL)
        await veth.connect(signer).transfer(psContract.address, vethAmount.toString())

        // Check eth balance is > low level.
        const ethBalanceBefore = await provider.getBalance(VESPER_DEPLOYER)
        expect(ethBalanceBefore).to.be.gt(BN.from(low), 'eth balance is below low value')

        // VESPER_DEPLOYER has eth balance > low so topup will be skipped.
        const vesperVethBalanceBefore = await veth.balanceOf(VESPER_DEPLOYER)
        await psContract.connect(user6).topUp()
        const vesperVethBalanceAfter = await veth.balanceOf(VESPER_DEPLOYER)

        expect(vesperVethBalanceBefore).to.be.equal(vesperVethBalanceAfter, 'topup should not change balance')
      })
    })
  })
})
