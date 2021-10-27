const { expect } = require("chai");

const { ethers, waffle } = hre;
const { BigNumber, utils } = ethers;
const { constants, expectRevert } = require('@openzeppelin/test-helpers')

describe("Full mint test harness for Skullys", function () {
    const artist = "0xC87bf1972Dd048404CBd3FbA300b69277552C472"
    const dev    = "0x14E8F54f35eE42Cdf436A19086659B34dA6D9D47"

    const COST = ethers.utils.parseEther("150.0")

    // start helpers
    async function startPublicSaleNow (provider, skullys) {
        // set presale to 24 hours ago so public sale is live now
        let blockNum = await provider.getBlockNumber()
        let initTime = (await provider.getBlock(blockNum)).timestamp
        let initDate = new Date(initTime)
        initDate.setHours(initDate.getHours() - 24)
        await skullys.setPreSaleTime(BigNumber.from(initDate.valueOf()))
    }
    // end helpers

    before(async function () {
        this.provider = ethers.provider;
        this.Skullys   = await ethers.getContractFactory("Skullys")
    });

    beforeEach(async function () {
        // Create some wallets with non-zero balance
        [this.alice, this.bobby, this.carly, this.dobby, this.erkle] = await ethers.getSigners()
        this.wallets = [this.alice, this.bobby, this.carly, this.dobby, this.erkle];

        // Create two wallets with 0 balance
        this.provider = ethers.provider;
        this.owner0 = ethers.Wallet.createRandom()
        this.owner0.connect(this.provider)
        this.owner1 = ethers.Wallet.createRandom()
        this.owner1.connect(this.provider)

        // Deploy Skullys
        this.skullys = await this.Skullys.connect(this.alice).deploy()
        await this.skullys.deployed()
    });

    it("In public-sale, can mint Skullys (multiple) whether whitelisted or not", async function () {
        // get the original artist and developer balances before this test
        // these are leftover from previous tests and will be subtracted from balances below
        let origArtBal  = await this.provider.getBalance(artist)
        let origDevBal  = await this.provider.getBalance(dev)

        const wallets = await ethers.getSigners()
        const numWallets = wallets.length
        const MAX_SKULLYS = await this.skullys.MAX_SKULLYS()
        const skullysPerWallet = Math.floor(MAX_SKULLYS / (numWallets - 1))
        console.log(`\tUsing ${numWallets} wallets to mint skullys (${skullysPerWallet}) per wallet`)

        await startPublicSaleNow(this.provider, this.skullys)
        //await this.skullys.connect(this.alice).setManyWhiteList([this.bobby.address, this.carly.address])
        //await this.skullys.connect(this.bobby).mintFreeSkully()

        // Every wallet mints some skullys
        let mintCount = 0
        let mintPromises = new Array()
        for (let w = 1; w < numWallets; w++) {
            mintPromises.push(new Array())
            for (let s = 0; s < skullysPerWallet; s++) {
                mintPromises[w-1].push(this.skullys.connect(wallets[w]).mintSkully({ value: COST }))
                mintCount++
            }
        }
        // We didn't wait for one mint to finish before calling the next
        // Now we wait for all of them to complete
        for (let w = 1; w < numWallets; w++) {
            for (let s = 0; s < skullysPerWallet; s++) {
                await mintPromises[w-1][s]
            }
        }
        let supplyLeft = MAX_SKULLYS - await this.skullys.totalSupply()
        console.log(`Supply Left: ${supplyLeft}`)
        console.log("Minting the rest...")
        console.log("Wallet 1 Balance: ", (await this.provider.getBalance(wallets[1].address)).toString())
        for (let s = 0; s < supplyLeft; s++) {
            await this.skullys.connect(wallets[1]).mintSkully({ value: COST })
            mintCount++
        }
        const finalSupply = await this.skullys.totalSupply()
        supplyLeft = MAX_SKULLYS - finalSupply
        console.log(`Final MintCount: ${mintCount}`)
        console.log(`Final SupplyLeft: ${supplyLeft}`)
        console.log(`Final Supply: ${finalSupply}`)
        expect(supplyLeft).to.equal(BigNumber.from(0))
        expect(finalSupply).to.equal(MAX_SKULLYS)

        await expectRevert(
            this.skullys.connect(wallets[1]).mintSkully({ value: COST }),
            "Sold out"
        )

        // Artist should have the full mint fees from all Skullys
        // COST*1000
        let artBalAfterMint  = await this.provider.getBalance(artist)
        let devBalAfterMint  = await this.provider.getBalance(dev)
        let artEarned = artBalAfterMint.sub(origArtBal)
        let devEarned = devBalAfterMint.sub(origDevBal)
        let totalCost = COST.mul(MAX_SKULLYS)
        expect(artEarned).to.equal(totalCost.sub(totalCost.div(40)))
        expect(devEarned).to.equal(totalCost.div(40))

        // get original balances of the special token owners to subtract later
        // after withdrawal of royalties from the contract address
        let ownerOf6    = await this.skullys.ownerOf(6)
        let ownerOf66   = await this.skullys.ownerOf(66)
        let ownerOf69   = await this.skullys.ownerOf(69)
        let ownerOf420  = await this.skullys.ownerOf(420)
        let ownerOf666  = await this.skullys.ownerOf(666)

        let origBal6    = await this.provider.getBalance(ownerOf6)
        let origBal66   = await this.provider.getBalance(ownerOf66)
        let origBal69   = await this.provider.getBalance(ownerOf69)
        let origBal420  = await this.provider.getBalance(ownerOf420)
        let origBal666  = await this.provider.getBalance(ownerOf666)

        await this.alice.sendTransaction({ to: this.skullys.address, value: COST })
        let skullysBal = await this.provider.getBalance(this.skullys.address)
        expect(skullysBal).to.equal(COST)

        // alice triggers the withrawAll function which distributes the contract balance back to the team, etc
        await this.skullys.connect(this.alice).withdrawAll()
        skullysBal = await this.provider.getBalance(this.skullys.address)

        // make sure artist and dev have appropriate amounts
        let artBal  = (await this.provider.getBalance(artist)).sub(artBalAfterMint)
        let devBal  = (await this.provider.getBalance(dev)).sub(devBalAfterMint)
        let bal6    = (await this.provider.getBalance(ownerOf6)).sub(origBal6)
        let bal66   = (await this.provider.getBalance(ownerOf66)).sub(origBal66)
        let bal69   = (await this.provider.getBalance(ownerOf69)).sub(origBal69)
        let bal420  = (await this.provider.getBalance(ownerOf420)).sub(origBal420)
        let bal666  = (await this.provider.getBalance(ownerOf666)).sub(origBal666)
        // artist should have the full payments from minting plus the 65/COST from royalties
        expect(artBal).to.equal(BigNumber.from(ethers.utils.parseEther("97.5")))
        // dev should get 25/100 from royalties
        expect(devBal).to.equal(BigNumber.from(ethers.utils.parseEther("37.5")))
        // special token holders should get the last 10/100 from royalties (split 5 ways)
        expect(bal6).to.equal(BigNumber.from(ethers.utils.parseEther("3")))
        expect(bal66).to.equal(BigNumber.from(ethers.utils.parseEther("3")))
        expect(bal69).to.equal(BigNumber.from(ethers.utils.parseEther("3")))
        expect(bal420).to.equal(BigNumber.from(ethers.utils.parseEther("3")))
        expect(bal666).to.equal(BigNumber.from(ethers.utils.parseEther("3")))
    });

});
