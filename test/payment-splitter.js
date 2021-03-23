'use strict'
const VSP = artifacts.require('VSP')
const BN = require('bn.js')
const {
  balance,
  constants,
  ether,
  send,
  expectEvent,
  expectRevert,
} = require('@openzeppelin/test-helpers')
const {expect, assert} = require('chai')

const PaymentSplitter = artifacts.require('PaymentSplitter')

const {ZERO_ADDRESS} = constants

contract('PaymentSplitter', function (accounts) {
  const [payee1, payee2, payee3, payer1, nonpayee1] = accounts
  describe('Payment Splitter Contract deployed', function () {
    context('General validations', function () {
      it('rejects an empty set of payees', async function () {
        await expectRevert(PaymentSplitter.new([], []), 'no-payees')
      })

      it('rejects more payees than share', async function () {
        await expectRevert(
          PaymentSplitter.new([payee1, payee2, payee3], [20, 30]),
          'payees-and-share-length-mismatch'
        )
      })

      it('rejects more share than payees', async function () {
        await expectRevert(
          PaymentSplitter.new([payee1, payee2], [20, 30, 40]),
          'payees-and-share-length-mismatch'
        )
      })

      it('rejects null payees', async function () {
        await expectRevert(
          PaymentSplitter.new([payee1, ZERO_ADDRESS], [20, 30]),
          'payee-is-zero-address'
        )
      })

      it('rejects zero-valued share', async function () {
        await expectRevert(PaymentSplitter.new([payee1, payee2], [20, 0]), 'payee-with-zero-share')
      })

      it('rejects repeated payees', async function () {
        await expectRevert(
          PaymentSplitter.new([payee1, payee1], [20, 30]),
          'payee-exists-with-share'
        )
      })
    })

    context('without any ERC20 tokens', function () {
      let payees, shares, psContract, asset1
      beforeEach(async function () {
        payees = [payee1, payee2]
        shares = [5, 95]
        psContract = await PaymentSplitter.new(payees, shares)
        asset1 = await VSP.new()
      })

      it('has total shares', async function () {
        expect(await psContract.totalShare()).to.be.bignumber.equal('100')
      })

      it('has all payees', async function () {
        await Promise.all(
          payees.map(async (payee, index) => expect(await psContract.payees(index)).to.equal(payee))
        )
      })

      it('all payees initial balance zero', async function () {
        await Promise.all(
          payees.map(async payee =>
            expect(await psContract.released(payee, asset1.address)).to.be.bignumber.equal('0')
          )
        )
      })

      describe('share', function () {
        it('stores shares if address is payee1', async function () {
          expect(await psContract.share(payee1)).to.be.bignumber.equal('5')
        })

        it('stores shares if address is payee2', async function () {
          expect(await psContract.share(payee2)).to.be.bignumber.equal('95')
        })

        it('does not store shares if address is not payee', async function () {
          expect(await psContract.share(payee3)).to.be.bignumber.equal('0')
        })
      })

      describe('release', function () {
        it('release tokens without balance to payee1', async function () {
          await expectRevert(psContract.release(payee1, asset1.address), 'revert')
        })

        it('release tokens without balance to payee2', async function () {
          await expectRevert(psContract.release(payee2, asset1.address), 'revert')
        })
      })
    })

    context('with ethers', function () {
      let payees, shares, psContract, amount
      const etherAsset = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

      beforeEach(async function () {
        amount = ether('1')
        payees = [payee1, payee2]
        shares = [5, 95]
        psContract = await PaymentSplitter.new(payees, shares)
      })

      it('accepts payments', async function () {
        await send.ether(payer1, psContract.address, amount)
        expect(await balance.current(psContract.address)).to.be.bignumber.equal(amount)
      })

      describe('share', function () {
        it('stores shares if address is payee', async function () {
          expect(await psContract.share(payee1)).to.be.bignumber.not.equal('0')
        })

        it('does not store shares if address is not payee', async function () {
          expect(await psContract.share(nonpayee1)).to.be.bignumber.equal('0')
        })
      })

      describe('release', function () {
        it('reverts if no funds to claim', async function () {
          await expectRevert(psContract.releaseEther(payee1), 'payee-is-not-due-for-tokens')
        })
        it('reverts if non-payee want to claim', async function () {
          await send.ether(payer1, psContract.address, amount)
          await expectRevert(psContract.releaseEther(nonpayee1), 'payee-dont-have-share')
        })

        it('release ether to payee1', async function () {
          // receive funds
          await send.ether(payer1, psContract.address, amount)
          const initBalance = await balance.current(psContract.address)
          expect(initBalance).to.be.bignumber.equal(amount)

          // distribute ether to payee1
          const initAmount1 = await balance.current(payee1)
          const {logs} = await psContract.releaseEther(payee1, {gasPrice: 0})
          const profit1 = (await balance.current(payee1)).sub(initAmount1)
          expect(profit1).to.be.bignumber.equal(ether('0.05'))
          expectEvent.inLogs(logs, 'PaymentReleased', {
            payee: payee1,
            asset: etherAsset,
            tokens: profit1,
          })
        })

        it('release ether to payee2', async function () {
          // receive funds
          await send.ether(payer1, psContract.address, amount)
          const initBalance = await balance.current(psContract.address)
          expect(initBalance).to.be.bignumber.equal(amount)

          // distribute ether to payee2
          const initAmount2 = await balance.current(payee2)
          const {logs} = await psContract.releaseEther(payee2, {gasPrice: 0})
          const profit2 = (await balance.current(payee2)).sub(initAmount2)
          expect(profit2).to.be.bignumber.equal(ether('0.95'))
          expectEvent.inLogs(logs, 'PaymentReleased', {
            payee: payee2,
            asset: etherAsset,
            tokens: profit2,
          })
        })
      })
    })

    context('with some ERC20 tokens for two payees', function () {
      let asset1, payees, shares, psContract, mintAmount
      const amount = '10000000000000000'
      describe('release tokens to', function () {
        beforeEach(async function () {
          mintAmount = new BN(amount).toString()
          asset1 = await VSP.new()
          payees = [payee1, payee2]
          shares = [5, 95]
          psContract = await PaymentSplitter.new(payees, shares)
          await asset1.mint(psContract.address, mintAmount)
        })

        it('payee1', async function () {
          await psContract.release(payee1, asset1.address)
          const payee1Balance = (await asset1.balanceOf(payee1)).toString()
          assert.equal(payee1Balance, '500000000000000', 'releasing-tokens-failed-for-payee1.')
        })

        it('non-payee want to claim', async function () {
          await expectRevert(psContract.releaseEther(nonpayee1), 'payee-dont-have-share')
        })

        it('payee2', async function () {
          await psContract.release(payee2, asset1.address)
          const payee2Balance = (await asset1.balanceOf(payee2)).toString()
          assert.equal(payee2Balance, '9500000000000000', 'releasing-tokens-failed-for-payee2.')
        })

        it('payee1 multiple times', async function () {
          await psContract.release(payee1, asset1.address)
          await expectRevert(
            psContract.release(payee1, asset1.address),
            'payee-is-not-due-for-tokens'
          )
        })

        it('payee2 multiple times', async function () {
          await psContract.release(payee2, asset1.address)
          await expectRevert(
            psContract.release(payee2, asset1.address),
            'payee-is-not-due-for-tokens'
          )
        })

        it('payee1 and then transfer to other payee', async function () {
          await psContract.release(payee1, asset1.address)
          let payee1Balance = (await asset1.balanceOf(payee1)).toString()
          assert.equal(payee1Balance, '500000000000000', 'releasing-tokens-failed-for-payee1.')

          await asset1.transfer(payee3, '100000000000000', {from: payee1})

          payee1Balance = (await asset1.balanceOf(payee1)).toString()
          assert.equal(payee1Balance, '400000000000000', 'failed-to-transfer-to-other-account')
          const payee3Balance = (await asset1.balanceOf(payee3)).toString()
          assert.equal(payee3Balance, '100000000000000', 'failed-to-transfer-to-other-account')
        })

        it('payee2 and then transfer to other payee', async function () {
          await psContract.release(payee2, asset1.address)
          let payee2Balance = (await asset1.balanceOf(payee2)).toString()
          assert.equal(payee2Balance, '9500000000000000', 'releasing-tokens-failed-for-payee2.')

          await asset1.transfer(payee3, '100000000000000', {from: payee2})

          payee2Balance = (await asset1.balanceOf(payee2)).toString()
          assert.equal(payee2Balance, '9400000000000000', 'failed-to-transfer-to-other-account')
          const payee3Balance = (await asset1.balanceOf(payee3)).toString()
          assert.equal(payee3Balance, '100000000000000', 'failed-to-transfer-to-other-account')
        })

        it('payee1, add more tokens and release again', async function () {
          await psContract.release(payee1, asset1.address)
          let payee1Balance = (await asset1.balanceOf(payee1)).toString()
          assert.equal(payee1Balance, '500000000000000', 'releasing-tokens-failed-for-payee1.')

          await asset1.mint(psContract.address, mintAmount)

          await psContract.release(payee1, asset1.address)
          payee1Balance = (await asset1.balanceOf(payee1)).toString()
          assert.equal(payee1Balance, '1000000000000000', 'releasing-tokens-failed-for-payee1.')
        })

        it('payee2, add more tokens and release again', async function () {
          await psContract.release(payee2, asset1.address)
          let payee2Balance = (await asset1.balanceOf(payee2)).toString()
          assert.equal(payee2Balance, '9500000000000000', 'releasing-tokens-failed-for-payee2.')

          await asset1.mint(psContract.address, mintAmount)

          await psContract.release(payee2, asset1.address)
          payee2Balance = (await asset1.balanceOf(payee2)).toString()
          assert.equal(payee2Balance, '19000000000000000', 'releasing-tokens-failed-for-payee2.')
        })

        it('payee2, add tokens multiple times and release to payee2', async function () {
          await psContract.release(payee2, asset1.address)
          let payee2Balance = (await asset1.balanceOf(payee2)).toString()
          assert.equal(payee2Balance, '9500000000000000', 'releasing-tokens-failed-for-payee2.')
          // Add more tokens multiple times.
          await asset1.mint(psContract.address, mintAmount)
          await asset1.mint(psContract.address, mintAmount)
          await asset1.mint(psContract.address, mintAmount)

          await psContract.release(payee2, asset1.address)
          payee2Balance = (await asset1.balanceOf(payee2)).toString()
          assert.equal(payee2Balance, '38000000000000000', 'releasing-tokens-failed-for-payee2.')
        })

        it('add tokens multiple times and then release for both payees multiple times', 
        async function () {
          await psContract.release(payee2, asset1.address)
          let payee2Balance = (await asset1.balanceOf(payee2)).toString()
          assert.equal(payee2Balance, '9500000000000000', 'releasing-tokens-failed-for-payee2.')
          // Add more tokens multiple times.
          await asset1.mint(psContract.address, mintAmount)
          await asset1.mint(psContract.address, mintAmount)

          await psContract.release(payee2, asset1.address)
          payee2Balance = (await asset1.balanceOf(payee2)).toString()
          assert.equal(payee2Balance, '28500000000000000', 'releasing-tokens-failed-for-payee2.')

          // Add more tokens again
          await asset1.mint(psContract.address, mintAmount)

          await psContract.release(payee1, asset1.address)
          let payee1Balance = (await asset1.balanceOf(payee1)).toString()
          assert.equal(payee1Balance, '2000000000000000', 'releasing-tokens-failed-for-payee1.')

          // Add more tokens again
          await asset1.mint(psContract.address, mintAmount)

          await psContract.release(payee1, asset1.address)
          payee1Balance = (await asset1.balanceOf(payee1)).toString()
          assert.equal(payee1Balance, '2500000000000000', 'releasing-tokens-failed-for-payee1.')

          await psContract.release(payee2, asset1.address)
          payee2Balance = (await asset1.balanceOf(payee2)).toString()
          assert.equal(payee2Balance, '47500000000000000', 'releasing-tokens-failed-for-payee2.')
        })
      })
    })

    context('with some ERC20 tokens for three payees', function () {
      let asset1, payees, shares, psContract
      const amount = '10000000000000000'
      describe('release tokens to', function () {
        beforeEach(async function () {
          asset1 = await VSP.new()
          payees = [payee1, payee3, payee2]
          shares = [20, 30, 950]
          psContract = await PaymentSplitter.new(payees, shares)
          const mintAmount = new BN(amount).toString()
          await asset1.mint(psContract.address, mintAmount)
        })
        it('payee1', async function () {
          await psContract.release(payee1, asset1.address)
          const payee1Balance = (await asset1.balanceOf(payee1)).toString()
          assert.equal(payee1Balance, '200000000000000', 'releasing-tokens-failed-for-payee1.')
        })

        it('payee2', async function () {
          await psContract.release(payee3, asset1.address)
          const payee3Balance = (await asset1.balanceOf(payee3)).toString()
          assert.equal(payee3Balance, '300000000000000', 'releasing-tokens-failed-for-payee2.')
        })

        it('payee3', async function () {
          await psContract.release(payee2, asset1.address)
          const payee2Balance = (await asset1.balanceOf(payee2)).toString()
          assert.equal(payee2Balance, '9500000000000000', 'releasing-tokens-failed-for-payee2.')
        })
      })
    })

    context('with some tokens for two assets', function () {
      let asset1, asset2, payees, shares, psContract, mintAmount, asset2MintAmount
      const amount = '10000000000000000'
      const asset2Amount = '100000000000'

      beforeEach(async function () {
        mintAmount = new BN(amount).toString()
        asset2MintAmount = new BN(asset2Amount).toString()
        asset1 = await VSP.new()
        asset2 = await VSP.new()
        payees = [payee1, payee2]
        shares = [5, 95]
        psContract = await PaymentSplitter.new(payees, shares)
        await asset1.mint(psContract.address, mintAmount)
        await asset2.mint(psContract.address, asset2MintAmount)
      })
      describe('release tokens to', function () {
        it('payee1 for asset 1', async function () {
          await psContract.release(payee1, asset1.address)
          const payee1Balance = (await asset1.balanceOf(payee1)).toString()
          assert.equal(
            payee1Balance,
            '500000000000000',
            'releasing-tokens-failed-for-payee1-asset-1'
          )
        })

        it('payee1 for asset 2', async function () {
          await psContract.release(payee1, asset2.address)
          const payee1Balance = (await asset2.balanceOf(payee1)).toString()
          assert.equal(payee1Balance, '5000000000', 'releasing-tokens-failed-for-payee1-asset-2')
        })

        it('payee2 for asset 1', async function () {
          await psContract.release(payee2, asset1.address)
          const payee2Balance = (await asset1.balanceOf(payee2)).toString()
          assert.equal(
            payee2Balance,
            '9500000000000000',
            'releasing-tokens-failed-for-payee2-asset-1'
          )
        })
        it('payee2 for asset 2', async function () {
          await psContract.release(payee2, asset2.address)
          const payee2Balance = (await asset2.balanceOf(payee2)).toString()
          assert.equal(payee2Balance, '95000000000', 'releasing-tokens-failed-for-payee2-asset-2')
        })

        it('payee1/asset1, add more tokens and release again for payee1/asset1', async function () {
          await psContract.release(payee1, asset1.address)
          let payee1Balance = (await asset1.balanceOf(payee1)).toString()
          assert.equal(payee1Balance, '500000000000000', 'releasing-tokens-failed-for-payee1.')

          await asset1.mint(psContract.address, mintAmount)

          await psContract.release(payee1, asset1.address)
          payee1Balance = (await asset1.balanceOf(payee1)).toString()
          assert.equal(payee1Balance, '1000000000000000', 'releasing-tokens-failed-for-payee1.')
        })

        it('payee1 multiple times for asset1', async function () {
          await psContract.release(payee1, asset1.address)
          const payee1Balance = (await asset1.balanceOf(payee1)).toString()
          assert.equal(payee1Balance, '500000000000000', 'releasing-tokens-failed-for-payee1.')
          await expectRevert(
            psContract.release(payee1, asset1.address),
            'payee-is-not-due-for-tokens'
          )
        })

        it('payee2 multiple times for asset1', async function () {
          await psContract.release(payee2, asset1.address)
          const payee2Balance = (await asset1.balanceOf(payee2)).toString()
          assert.equal(payee2Balance, '9500000000000000', 'releasing-tokens-failed-for-payee2.')
          await expectRevert(
            psContract.release(payee2, asset1.address),
            'payee-is-not-due-for-tokens'
          )
        })

        it('payee1 multiple times for asset2', async function () {
          await psContract.release(payee1, asset2.address)
          const payee1Balance = (await asset2.balanceOf(payee1)).toString()
          assert.equal(payee1Balance, '5000000000', 'releasing-tokens-failed-for-payee1.')
          await expectRevert(
            psContract.release(payee1, asset2.address),
            'payee-is-not-due-for-tokens'
          )
        })

        it('payee2 multiple times for asset2', async function () {
          await psContract.release(payee2, asset2.address)
          const payee2Balance = (await asset2.balanceOf(payee2)).toString()
          assert.equal(payee2Balance, '95000000000', 'releasing-tokens-failed-for-payee2.')
          await expectRevert(
            psContract.release(payee2, asset2.address),
            'payee-is-not-due-for-tokens'
          )
        })

        it('payee1/asset1, add more tokens for asset2 and release for payee1/asset1', 
        async function () {
          await psContract.release(payee1, asset1.address)
          const payee1Balance = (await asset1.balanceOf(payee1)).toString()
          assert.equal(payee1Balance, '500000000000000', 'releasing-tokens-failed-for-payee1.')

          await asset2.mint(psContract.address, mintAmount)

          await expectRevert(
            psContract.release(payee1, asset1.address),
            'payee-is-not-due-for-tokens'
          )
        })

        it('payee1/asset2, add more tokens for asset1 and release for payee1/asset2',
        async function () {
          await psContract.release(payee1, asset2.address)
          const payee1Balance = (await asset2.balanceOf(payee1)).toString()
          assert.equal(payee1Balance, '5000000000', 'releasing-tokens-failed-for-payee1.')

          await asset1.mint(psContract.address, mintAmount)

          await expectRevert(
            psContract.release(payee1, asset2.address),
            'payee-is-not-due-for-tokens'
          )
        })
      })

      it('add tokens multiple times for two assets and release for both payees multiple times', 
      async function () {
        await psContract.release(payee2, asset1.address)
        let payee2Balance = (await asset1.balanceOf(payee2)).toString()
        assert.equal(payee2Balance, '9500000000000000', 'releasing-tokens-failed-for-payee2.')
        // Add more tokens multiple times for both assets
        await asset1.mint(psContract.address, mintAmount)
        await asset1.mint(psContract.address, mintAmount)
        await asset2.mint(psContract.address, asset2MintAmount)
        await asset2.mint(psContract.address, asset2MintAmount)

        await psContract.release(payee2, asset1.address)
        payee2Balance = (await asset1.balanceOf(payee2)).toString()
        assert.equal(payee2Balance, '28500000000000000', 'releasing-tokens-failed-for-payee2.')

        await psContract.release(payee2, asset2.address)
        payee2Balance = (await asset2.balanceOf(payee2)).toString()
        assert.equal(payee2Balance, '285000000000', 'releasing-tokens-failed-for-payee2.')

        // Add more tokens again
        await asset1.mint(psContract.address, mintAmount)
        await asset2.mint(psContract.address, asset2MintAmount)

        await psContract.release(payee1, asset1.address)
        let payee1Balance = (await asset1.balanceOf(payee1)).toString()
        assert.equal(payee1Balance, '2000000000000000', 'releasing-tokens-failed-for-payee1.')

        await psContract.release(payee1, asset2.address)
        payee1Balance = (await asset2.balanceOf(payee1)).toString()
        assert.equal(payee1Balance, '20000000000', 'releasing-tokens-failed-for-payee1.')

        // Add more tokens again
        await asset1.mint(psContract.address, mintAmount)
        await asset2.mint(psContract.address, asset2MintAmount)

        await psContract.release(payee1, asset1.address)
        payee1Balance = (await asset1.balanceOf(payee1)).toString()
        assert.equal(payee1Balance, '2500000000000000', 'releasing-tokens-failed-for-payee1.')

        await psContract.release(payee2, asset1.address)
        payee2Balance = (await asset1.balanceOf(payee2)).toString()
        assert.equal(payee2Balance, '47500000000000000', 'releasing-tokens-failed-for-payee2.')

        await psContract.release(payee1, asset2.address)
        payee1Balance = (await asset2.balanceOf(payee1)).toString()
        assert.equal(payee1Balance, '25000000000', 'releasing-tokens-failed-for-payee1.')

        await psContract.release(payee2, asset2.address)
        payee2Balance = (await asset2.balanceOf(payee2)).toString()
        assert.equal(payee2Balance, '475000000000', 'releasing-tokens-failed-for-payee2.')
      })
    })
  })
})
