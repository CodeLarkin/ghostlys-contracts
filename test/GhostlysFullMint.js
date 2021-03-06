const { expect } = require("chai");

const { ethers, waffle } = hre;
const { BigNumber, utils } = ethers;
const { constants, expectRevert } = require('@openzeppelin/test-helpers')

/******************************************************************************
 * Logging functions, log-level Enums, and LOG_LEVEL setting
 ******************************************************************************/
const WARN  = 1
const INFO  = 2
const DEBUG = 3
const ULTRA = 4

// SET LOG_LEVEL HERE - Change log level to control verbosity
const LOG_LEVEL = DEBUG

const logging = {
    warn: function(...args) {
        if (LOG_LEVEL >= WARN) {
            console.log(...args)
        }
    },
    info: function(...args) {
        if (LOG_LEVEL >= INFO) {
            console.log(...args)
        }
    },
    debug: function(...args) {
        if (LOG_LEVEL >= DEBUG) {
            console.log(...args)
        }
    },
    ultra: function(...args) {
        if (LOG_LEVEL >= ULTRA) {
            console.log(...args)
        }
    },
}


/******************************************************************************
 * Hardhat Tests for the Ghostlys
 ******************************************************************************/
describe("Full mint test harness for Ghostlys", function () {
    const MAX_SUPPLY = 8888
    const COST = ethers.utils.parseEther("50.0")
    const PRESALE_TIME = 24  // hours
    // team wallets
    const artist    = "0xC87bf1972Dd048404CBd3FbA300b69277552C472"
    const dev       = "0x14E8F54f35eE42Cdf436A19086659B34dA6D9D47"
    // MINT
    const artistMintShares = 75
    const devMintShares    = 25

    // start helpers
    async function startPublicSaleNow (provider, ghostlys) {
        // set presale to 24 hours ago so public sale is live now
        let blockNum = await provider.getBlockNumber()
        let initTime = (await provider.getBlock(blockNum)).timestamp
        let initDate = new Date(initTime)
        initDate.setHours(initDate.getHours() - 24)
        await ghostlys.setPreSaleTime(BigNumber.from(initDate.valueOf()))
    }
    // end helpers

    before(async function () {
        this.provider = ethers.provider;
        this.Ghostlys   = await ethers.getContractFactory("Ghostlys")
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

        // Deploy Ghostlys
        this.ghostlys = await this.Ghostlys.connect(this.alice).deploy()
        await this.ghostlys.deployed()
    });

    it("In public-sale, can mint Ghostlys (multiple) whether whitelisted or not", async function () {
        // get the original artist and developer balances before this test
        // these are leftover from previous tests and will be subtracted from balances below
        let origArtBal  = await this.provider.getBalance(artist)
        let origDevBal  = await this.provider.getBalance(dev)

        const wallets = await ethers.getSigners()
        const numWallets = wallets.length
        const MAX_GHOSTLYS = await this.ghostlys.MAX_GHOSTLYS()
        const MAX_MINT = 20
        const ghostlysPerWallet = MAX_MINT
        console.log(`\tUsing ${numWallets} wallets to mint ghostlys (${ghostlysPerWallet}) per wallet`)

        await startPublicSaleNow(this.provider, this.ghostlys)

        // Every wallet mints some ghostlys
        let mintCount = 0
        let mintPromises = new Array()
        for (let w = 0; w < numWallets; w++) {
            mintPromises.push(this.ghostlys.connect(wallets[w]).mintGhostlys(MAX_MINT, { value: COST.mul(MAX_MINT) }))
            mintCount++
            logging.debug(`Wallet ${w + 1}/444 is minting...`)

            if (w % 10 == 0) {
                await ethers.provider.send("evm_increaseTime", [10])
                await ethers.provider.send("evm_mine", []) // force mine the next block
            }
        }
        // We didn't wait for one mint to finish before calling the next
        // Now we wait for all of them to complete
        for (let w = 0; w < numWallets; w++) {
            await mintPromises[w]
        }
        for (let w = 0; w < numWallets; w++) {
            logging.ultra(`Printing tokenIds for wallet ${w}`)
            const bal = await this.ghostlys.balanceOf(wallets[w].address);
            for (let i = 0; i < bal; i++) {
                logging.ultra(`${await this.ghostlys.tokenOfOwnerByIndex(wallets[w].address, i)}`);
            }
        }
        let supplyLeft = MAX_GHOSTLYS - await this.ghostlys.totalSupply()
        console.log(`Supply Left: ${supplyLeft}`)
        console.log("Minting the rest...")
        console.log("Wallet 1 Balance: ", (await this.provider.getBalance(wallets[1].address)).toString())
        for (let s = 0; s < supplyLeft; s++) {
            await this.ghostlys.connect(wallets[1]).mintGhostlys(1, { value: COST })
            mintCount++
        }
        const finalSupply = await this.ghostlys.totalSupply()
        supplyLeft = MAX_GHOSTLYS - finalSupply
        console.log(`Final MintCount: ${mintCount}`)
        console.log(`Final SupplyLeft: ${supplyLeft}`)
        console.log(`Final Supply: ${finalSupply}`)
        expect(supplyLeft).to.equal(BigNumber.from(0))
        expect(finalSupply).to.equal(MAX_GHOSTLYS)

        await expectRevert(
            this.ghostlys.connect(wallets[1]).mintGhostlys(1, { value: COST }),
            "Sold out"
        )

        // Artist should have the full mint fees from all Ghostlys
        // COST*8888
        let artBalAfterMint  = await this.provider.getBalance(artist)
        let devBalAfterMint  = await this.provider.getBalance(dev)
        let artEarned = artBalAfterMint.sub(origArtBal)
        let devEarned = devBalAfterMint.sub(origDevBal)
        let totalCost = COST.mul(MAX_GHOSTLYS)
        expect(artEarned).to.equal(totalCost.sub(totalCost.div(4)))
        expect(devEarned).to.equal(totalCost.div(4))
    });

});
