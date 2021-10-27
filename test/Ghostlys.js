const { expect } = require("chai");

const { ethers, waffle } = hre;
const { BigNumber, utils } = ethers;
const { constants, expectRevert } = require('@openzeppelin/test-helpers')


describe("Test harness for Ghostlys", function () {
    const MAX_SUPPLY = 8888
    const COST = ethers.utils.parseEther("50.0")
    const PRESALE_TIME = 24  // hours
    // team wallets
    const artist    = "0xC87bf1972Dd048404CBd3FbA300b69277552C472"
    const dev       = "0x14E8F54f35eE42Cdf436A19086659B34dA6D9D47"
    const community = "0xA4f7a42F2569f97de8218Aa875F58533Fe842FEe"
    // MINT
    const artistMintShares = 75
    const devMintShares    = 25
    // ROYALTIES
    const artistShares    = 38
    const devShares       = 12
    const communityShares = 50

    // start helpers
    async function startPreSaleNow (provider, ghostlys) {
        // Get the current block time and set the PreSale time to now
        // this ensures that the test starts in PreSale and not PublicSale
        let blockNum = await provider.getBlockNumber()
        let initTime = (await provider.getBlock(blockNum)).timestamp
        await ghostlys.setPreSaleTime(BigNumber.from(initTime))
    }
    async function startPreSaleLater (provider, ghostlys) {
        let blockNum = await provider.getBlockNumber()
        let initTime = (await provider.getBlock(blockNum)).timestamp
        await ghostlys.setPreSaleTime(BigNumber.from(initTime + 100000))
    }
    async function startPublicSaleNow (provider, ghostlys) {
        // set presale to 24 hours ago so public sale is live now
        let blockNum = await provider.getBlockNumber()
        let initTime = (await provider.getBlock(blockNum)).timestamp
        let initDate = new Date(initTime)
        initDate.setHours(initDate.getHours() - PRESALE_TIME)
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

    it("Check some constants", async function () {
        let maxSupply = await this.ghostlys.MAX_GHOSTLYS()
        expect(maxSupply).to.equal(BigNumber.from(MAX_SUPPLY))

        let price = await this.ghostlys.GHOSTLYS_PRICE()
        expect(price).to.equal(BigNumber.from(COST))
    });

    it("Starting supply and balances are 0", async function () {
        let supply = await this.ghostlys.totalSupply()
        expect(supply).to.equal(BigNumber.from(0))

        let bobbyBal = await this.ghostlys.balanceOf(this.bobby.address)
        expect(bobbyBal).to.equal(BigNumber.from(0))
    });

    it("Can't withdraw earnings (royalties) when there are none", async function () {
        await expectRevert(
            this.ghostlys.connect(this.alice).withdrawAll(),
            "Cannot withdraw, balance is empty"
        )
    });

    it("Can't withdraw earnings (royalties) if you aren't on the team", async function () {
        await expectRevert(
            this.ghostlys.connect(this.carly).withdrawAll(),
             "Can't do that, you are not part of the team"
        )
    });

    it("Can withdraw earnings (royalties) from contract", async function () {
        // alice sends some ether to the ghostlys contract (emulate a marketplace paying royalties to the contract address)
        await this.alice.sendTransaction({ to: this.ghostlys.address, value: ethers.utils.parseEther("100.1") })
        let ghostlysBal = await this.provider.getBalance(this.ghostlys.address)
        expect(ghostlysBal).to.equal(BigNumber.from(ethers.utils.parseEther("100.1")))

        // alice triggers the withrawAll function which distributes the contract balance back to the team, etc
        await this.ghostlys.connect(this.alice).withdrawAll()
        ghostlysBal = await this.provider.getBalance(this.ghostlys.address)

        // Make sure the contract has approximately 0 balance left
        expect(ghostlysBal).to.equal(BigNumber.from(0))

        // make sure artist and dev have appropriate amounts
        let artBal = await this.provider.getBalance(artist)
        let devBal = await this.provider.getBalance(dev)
        let comBal = await this.provider.getBalance(community)
        expect(artBal).to.equal(BigNumber.from(ethers.utils.parseEther("38.038")))
        expect(devBal).to.equal(BigNumber.from(ethers.utils.parseEther("12.012")))
        expect(comBal).to.equal(BigNumber.from(ethers.utils.parseEther("50.050")))
    });

    it("Team can mint before pre-sale", async function () {
        await startPreSaleLater(this.provider, this.ghostlys)
        let status = await this.ghostlys.getStatus()
        expect(status).to.equal(0)  // 0 is the enum Status.Closed

        await expectRevert(
            this.ghostlys.connect(this.bobby).mintFreeGhostly(),
             "Must have a skully before snapshot for free mint"
        )
        await this.ghostlys.connect(this.alice).teamMint()
        let aliceBal = await this.ghostlys.balanceOf(this.alice.address)
        expect(aliceBal).to.equal(BigNumber.from(1))
    });

    it("In pre-sale, can't mint if not whitelisted", async function () {
        await startPreSaleNow(this.provider, this.ghostlys)
        let status = await this.ghostlys.getStatus()
        expect(status).to.equal(1)  // 1 is the enum Status.PresaleStart

        await expectRevert(
            this.ghostlys.connect(this.bobby).mintFreeGhostly(),
             "Must have a skully before snapshot for free mint"
        )

        let bobbyBal = await this.ghostlys.balanceOf(this.bobby.address)
        expect(bobbyBal).to.equal(BigNumber.from(0))
    });

    it("In pre-sale, can mint a Ghostly if whitelisted", async function () {
        await startPreSaleNow(this.provider, this.ghostlys)
        await this.ghostlys.connect(this.alice).setManyWhiteList([this.bobby.address, this.carly.address], [1, 1])

        await this.ghostlys.connect(this.bobby).mintFreeGhostly()
        let bobbyBal = await this.ghostlys.balanceOf(this.bobby.address)
        expect(bobbyBal).to.equal(BigNumber.from(1))
    });

    it("In pre-sale, can't mint >#skullys Ghostlys", async function () {
        await startPreSaleNow(this.provider, this.ghostlys)
        await this.ghostlys.connect(this.alice).setManyWhiteList([this.bobby.address, this.carly.address], [2, 1])

        await this.ghostlys.connect(this.bobby).mintFreeGhostly()
        await this.ghostlys.connect(this.bobby).mintFreeGhostly()
        await expectRevert(
            this.ghostlys.connect(this.bobby).mintFreeGhostly(),
            "Must have a skully before snapshot for free mint"
        )
        let bobbyBal = await this.ghostlys.balanceOf(this.bobby.address)
        expect(bobbyBal).to.equal(BigNumber.from(2))
    });

    it("In pre-sale, can't pay to mint a Ghostly", async function () {
        await startPreSaleNow(this.provider, this.ghostlys)
        // Can't pay to mint in pre-sale if not whitelisted
        await expectRevert(
            this.ghostlys.connect(this.bobby).mintGhostly({ value: COST }),
            "Public sale has not started"
        )
        // Can't pay to mint in pre-sale even if whitelisted
        await expectRevert(
            this.ghostlys.connect(this.bobby).mintGhostly({ value: COST }),
            "Public sale has not started"
        )
        let bobbyBal = await this.ghostlys.balanceOf(this.bobby.address)
        expect(bobbyBal).to.equal(BigNumber.from(0))
    });

    it("Can mint a bunch of Ghostlys", async function () {
        await startPublicSaleNow(this.provider, this.ghostlys)
        await this.ghostlys.connect(this.alice).setManyWhiteList([this.bobby.address, this.carly.address], [4, 1])

        // mint some
        await this.ghostlys.connect(this.bobby).mintFreeGhostly()
        await this.ghostlys.connect(this.bobby).mintFreeGhostly()
        await this.ghostlys.connect(this.bobby).mintFreeGhostly()
        await this.ghostlys.connect(this.bobby).mintFreeGhostly()
        await this.ghostlys.connect(this.bobby).mintGhostly({ value: COST })
        await this.ghostlys.connect(this.bobby).mintGhostly({ value: COST })
        await this.ghostlys.connect(this.bobby).mintGhostly({ value: COST })
        await this.ghostlys.connect(this.bobby).mintGhostly({ value: COST })
        await this.ghostlys.connect(this.bobby).mintGhostly({ value: COST })
        await this.ghostlys.connect(this.bobby).mintGhostly({ value: COST })
        expect(await this.ghostlys.balanceOf(this.bobby.address)).to.equal(BigNumber.from(10))
    });

    it("In public-sale, can mint Ghostlys (multiple) whether whitelisted or not", async function () {
        let initArtBal = await this.provider.getBalance(artist);
        let initDevBal = await this.provider.getBalance(dev);
        await startPublicSaleNow(this.provider, this.ghostlys)
        await this.ghostlys.connect(this.alice).setManyWhiteList([this.bobby.address, this.carly.address], [1, 1])

        // mint some
        await this.ghostlys.connect(this.bobby).mintFreeGhostly()
        await this.ghostlys.connect(this.bobby).mintGhostly({ value: COST })
        await this.ghostlys.connect(this.dobby).mintGhostly({ value: COST })
        await this.ghostlys.connect(this.dobby).mintGhostly({ value: COST })
        await this.ghostlys.connect(this.erkle).mintGhostly({ value: COST })

        // check balances
        let bobbyBal = await this.ghostlys.balanceOf(this.bobby.address)
        let dobbyBal = await this.ghostlys.balanceOf(this.dobby.address)
        let erkleBal = await this.ghostlys.balanceOf(this.erkle.address)
        expect(bobbyBal).to.equal(BigNumber.from(2))
        expect(dobbyBal).to.equal(BigNumber.from(2))
        expect(erkleBal).to.equal(BigNumber.from(1))

        let artEarned = (await this.provider.getBalance(artist)).sub(initArtBal);
        let devEarned = (await this.provider.getBalance(dev)).sub(initDevBal);
        let totalCost = COST.mul(4)
        expect(artEarned).to.equal(totalCost.sub(totalCost.div(4)))
        expect(devEarned).to.equal(totalCost.div(4))
    });

    it("Expected URI failures", async function () {
        await expectRevert(
            this.ghostlys.tokenURI(1),
            "ERC721Metadata: URI query for nonexistent token"
        )
        await expectRevert(
            this.ghostlys.connect(this.bobby).setBaseURI('SHOULD NOT WORK'),
            "Can't do that, you are not part of the team"
        )
    });
    it("Base URI and tokenURIs work", async function () {
        await startPublicSaleNow(this.provider, this.ghostlys)

        // mint some
        await this.ghostlys.connect(this.bobby).mintGhostly({ value: COST })

        const baseURI = 'ipfs://<ghostlys-test-base-uri>/'
        await this.ghostlys.connect(this.alice).setBaseURI(baseURI)
        const tokenURI = await this.ghostlys.tokenURI(1)
        expect(tokenURI).to.equal(baseURI + 1)
    });

    it("Expected provenance hash failures", async function () {
        await expectRevert(
            this.ghostlys.connect(this.bobby).setProvenanceHash('SHOULD NOT WORK'),
            "Can't do that, you are not part of the team"
        )
    });
    it("Set the provenance hash", async function () {
        const setProvenance = '<TEST-PROVENANCE-HASH>'
        await this.ghostlys.connect(this.alice).setProvenanceHash(setProvenance)
        const probedProvenance = await this.ghostlys.PROVENANCE()
        expect(setProvenance).to.equal(probedProvenance)
    });
});
