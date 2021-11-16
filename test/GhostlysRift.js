const { expect } = require("chai");

const { ethers, waffle } = hre;
const { BigNumber, utils } = ethers;
const { constants, expectRevert } = require('@openzeppelin/test-helpers')

const fs = require('fs');


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

const sum = (arr) => {return arr.reduce(add,0)}

function add(accumulator, a) {
    return accumulator + a;
}


/******************************************************************************
 * Hardhat Tests for the GhostlyRift rewards pool
 ******************************************************************************/
describe("GhostlyRift", function () {
    const PRICE = ethers.utils.parseEther("50")
    const ZERO_ADDR = "0x0000000000000000000000000000000000000000"
    const ZERO_BN = BigNumber.from(0)
    const ONE_BN = BigNumber.from(1)
    const FIFTY_E18_BN = ethers.utils.parseEther("50")

    const SECONDS_IN_HOUR = 60*60
    const SECONDS_IN_DAY  = SECONDS_IN_HOUR*24

    const BASE_REWARDS_PER_SECOND = 0.000578703703703703;  // 100 per day = 0.0011574 per hour (e18 for 18 decimals)
    const HALF_REWARDS            = 0.000289351851851851;  // BASE_REWARDS_PER_SECOND / 2;
    const QUARTER_REWARDS         = 0.000144675925925925;  // HALF_REWARDS/ 2;

    before(async function () {
        this.Ghostlys        = await ethers.getContractFactory("Ghostlys")
        this.ERC20Mintable   = await ethers.getContractFactory("ERC20Mintable")
        this.HealingRift     = await ethers.getContractFactory("contracts/GhostlysRift.sol:GhostlysRift")
    });

    beforeEach(async function () {
        // Create some wallets with non-zero balance
        [this.alice, this.bobby, this.carly, this.dobby, this.erkle] = await ethers.getSigners()
        this.wallets = [this.alice, this.bobby, this.carly, this.dobby, this.erkle];

        // Deploy Ghostlys
        this.nfts = await this.Ghostlys.deploy()
        await this.nfts.deployed()

        this.rewardToken = await this.ERC20Mintable.deploy("EGUNK", "EntGunk")
        await this.rewardToken.deployed()

        this.rift = await this.HealingRift.deploy(this.nfts.address, this.rewardToken.address)
        await this.rift.deployed()

    });
    it("Only owner can withdraw EntGunk update reward rate", async function () {
        await expectRevert(
            this.rift.connect(this.bobby).withdrawRewardToken(),
            "Ownable: caller is not the owner"
        );
        await expectRevert(
            this.rift.connect(this.bobby).setRewardsRate(1),
            "Ownable: caller is not the owner"
        );
        await this.rift.connect(this.alice).setRewardsRate(1);
    });

    it("Only token owner can enter/leave", async function () {
        await expectRevert(
            this.rift.connect(this.bobby).enter(1),
             "ERC721: owner query for nonexistent token"
        )
        await this.nfts.connect(this.alice).mintGhostlys(1, { value: PRICE })
        const tokenId = await this.nfts.tokenOfOwnerByIndex(this.alice.address, 0)
        await expectRevert(
            this.rift.connect(this.bobby).claimRewards(tokenId),
             "You don't own that tokenId"
        )
        await expectRevert(
            this.rift.connect(this.bobby).enter(tokenId),
             "You don't own that tokenId"
        )
        await expectRevert(
            this.rift.connect(this.bobby).leave(tokenId),
             "You don't own that tokenId"
        )
        await expectRevert(
            this.rift.connect(this.bobby).multiEnter([tokenId]),
             "You don't own that tokenId"
        )
        await expectRevert(
            this.rift.connect(this.bobby).multiLeave([tokenId]),
             "You don't own that tokenId"
        )

    });

    it("enter and leave works", async function () {
        await this.rewardToken.connect(this.alice).mint(this.rift.address, ethers.utils.parseEther("1000000"))

        await this.nfts.connect(this.bobby).mintGhostlys(1, { value: PRICE })
        const tokenId = await this.nfts.tokenOfOwnerByIndex(this.bobby.address, 0)

        expect(await this.rift.deployed_(tokenId)).to.equal(false)
        await this.rift.connect(this.bobby).enter(tokenId)
        expect(await this.rift.deployed_(tokenId)).to.equal(true)

        await ethers.provider.send("evm_increaseTime", [SECONDS_IN_DAY]) // fastforward 1 hour
        await ethers.provider.send("evm_mine", []) // force mine the next block

        await this.rift.connect(this.bobby).leave(tokenId)
        expect(await this.rift.deployed_(tokenId)).to.equal(false)

        await this.rift.connect(this.bobby).enter(tokenId)
        expect(await this.rift.deployed_(tokenId)).to.equal(true)

        await this.rift.connect(this.bobby).leave(tokenId)
        expect(await this.rift.deployed_(tokenId)).to.equal(false)
    });


    it("Expected rewards failures and base cases", async function () {
        await this.nfts.connect(this.bobby).mintGhostlys(1, { value: PRICE })
        const tokenId = await this.nfts.tokenOfOwnerByIndex(this.bobby.address, 0)

        // can reenter somewhere
        await this.rift.connect(this.bobby).enter(tokenId)

        await expectRevert(
            this.rift.connect(this.carly).claimRewards(tokenId),
             "You don't own that tokenId"
        )
        await expectRevert(
            this.rift.connect(this.bobby).claimRewards(tokenId),
            "Rewards have stopped"
        )

        expect(await this.rift.getClaimableRewards(tokenId)).to.equal(BigNumber.from(0))

        await ethers.provider.send("evm_increaseTime", [1000*SECONDS_IN_DAY]) // fastforward 1000 days
        await ethers.provider.send("evm_mine", []) // force mine the next block

        expect(await this.rift.getClaimableRewards(tokenId)).to.equal(BigNumber.from(0))
        await expectRevert(
            this.rift.connect(this.bobby).claimRewards(tokenId),
            "Rewards have stopped"
        )
    });

    it("Rewards work", async function () {
        await this.nfts.connect(this.bobby).mintGhostlys(1, { value: PRICE })
        const tokenId = await this.nfts.tokenOfOwnerByIndex(this.bobby.address, 0)

        // can reenter somewhere
        await this.rift.connect(this.bobby).enter(tokenId)

        await ethers.provider.send("evm_increaseTime", [SECONDS_IN_DAY / 2]) // fastforward 1000 days
        await ethers.provider.send("evm_mine", []) // force mine the next block

        expect(await this.rift.getClaimableRewards(tokenId)).to.equal(BigNumber.from(0))

        await this.rewardToken.connect(this.alice).mint(this.rift.address, ethers.utils.parseEther("1000000"))

        let rewards = await this.rift.getClaimableRewards(tokenId)
        expect(rewards).to.be.above(ethers.utils.parseEther("24"))
        expect(rewards).to.be.below(ethers.utils.parseEther("26"))

        await ethers.provider.send("evm_increaseTime", [SECONDS_IN_DAY / 2]) // fastforward 1000 days
        await ethers.provider.send("evm_mine", []) // force mine the next block

        rewards = await this.rift.getClaimableRewards(tokenId)
        expect(rewards).to.be.above(ethers.utils.parseEther("49"))
        expect(rewards).to.be.below(ethers.utils.parseEther("51"))

        await this.rift.connect(this.bobby).claimRewards(tokenId)

        rewards = await this.rift.getClaimableRewards(tokenId)
        expect(rewards).to.equal(ZERO_BN)

        rewards = await this.rewardToken.balanceOf(this.bobby.address)
        expect(rewards).to.be.above(ethers.utils.parseEther("49"))
        expect(rewards).to.be.below(ethers.utils.parseEther("51"))

        await ethers.provider.send("evm_increaseTime", [SECONDS_IN_DAY]) // fastforward 1000 days
        await ethers.provider.send("evm_mine", []) // force mine the next block

        rewards = await this.rift.getClaimableRewards(tokenId)
        expect(rewards).to.be.above(ethers.utils.parseEther("49"))
        expect(rewards).to.be.below(ethers.utils.parseEther("51"))

        await this.rift.connect(this.bobby).claimRewards(tokenId)

        rewards = await this.rift.getClaimableRewards(tokenId)
        expect(rewards).to.equal(ZERO_BN)

        rewards = await this.rewardToken.balanceOf(this.bobby.address)
        expect(rewards).to.be.above(ethers.utils.parseEther("99"))
        expect(rewards).to.be.below(ethers.utils.parseEther("101"))
    });

    it("Rewards work - one wallet, multi NFTs", async function () {
        await this.rewardToken.connect(this.alice).mint(this.rift.address, ethers.utils.parseEther("1000000"))

        const NUM_NFTS = 100
        for (let i = 1; i <= NUM_NFTS; i++) {
            await this.nfts.connect(this.bobby).mintGhostlys(1, { value: PRICE })
            const tokenId = await this.nfts.tokenOfOwnerByIndex(this.bobby.address, i-1)

            // can reenter somewhere
            await this.rift.connect(this.bobby).enter(tokenId)
        }

        await ethers.provider.send("evm_increaseTime", [SECONDS_IN_DAY]) // fastforward 1000 days
        await ethers.provider.send("evm_mine", []) // force mine the next block

        for (let i = 1; i <= NUM_NFTS; i++) {
            const dailyRate = BASE_REWARDS_PER_SECOND * SECONDS_IN_DAY
            const min = dailyRate-1
            const max = dailyRate+1

            const tokenId = await this.nfts.tokenOfOwnerByIndex(this.bobby.address, i-1)

            let rewards = await this.rift.getClaimableRewards(tokenId)
            expect(rewards).to.be.above(ethers.utils.parseEther(min.toString()))
            expect(rewards).to.be.below(ethers.utils.parseEther(max.toString()))
        }
        for (let i = 1; i <= NUM_NFTS; i++) {
            const tokenId = await this.nfts.tokenOfOwnerByIndex(this.bobby.address, i-1)
            await this.rift.connect(this.bobby).claimRewards(tokenId)
            let rewards = await this.rift.getClaimableRewards(tokenId)
            expect(rewards).to.equal(ZERO_BN)
        }

        // Cumulative rewards
        const dailyRate = BASE_REWARDS_PER_SECOND * NUM_NFTS * SECONDS_IN_DAY
        const min = dailyRate-50 // more buffer for error since this is for NUM_NFTS claims
        const max = dailyRate+50

        let rewards = await this.rewardToken.balanceOf(this.bobby.address)
        //console.log(`POST_CLAIM: DR: ${dailyRate}, MIN: ${min}, MAX: ${max}, REWARDS: ${rewards}`)
        expect(rewards).to.be.above(ethers.utils.parseEther(min.toString()))
        expect(rewards).to.be.below(ethers.utils.parseEther(max.toString()))

    });
    it("Rewards work - multi wallets", async function () {
        await this.rewardToken.connect(this.alice).mint(this.rift.address, ethers.utils.parseEther("1000000"))

        const wallets = await ethers.getSigners()
        const NUM_NFTS = 100
        for (let i = 1; i <= NUM_NFTS; i++) {
            await this.nfts.connect(wallets[i]).mintGhostlys(1, { value: PRICE })
            const tokenId = await this.nfts.tokenOfOwnerByIndex(wallets[i].address, 0)

            await this.rift.connect(wallets[i]).enter(tokenId)
        }

        await ethers.provider.send("evm_increaseTime", [SECONDS_IN_DAY]) // fastforward 1000 days
        await ethers.provider.send("evm_mine", []) // force mine the next block

        for (let i = 1; i <= NUM_NFTS; i++) {
            const dailyRate = BASE_REWARDS_PER_SECOND * SECONDS_IN_DAY
            const min = dailyRate-1
            const max = dailyRate+1

            const tokenId = await this.nfts.tokenOfOwnerByIndex(this.bobby.address, 0)
            let rewards = await this.rift.getClaimableRewards(tokenId)
            expect(rewards).to.be.above(ethers.utils.parseEther(min.toString()))
            expect(rewards).to.be.below(ethers.utils.parseEther(max.toString()))
        }
        for (let i = 1; i <= NUM_NFTS; i++) {
            const tokenId = await this.nfts.tokenOfOwnerByIndex(wallets[i].address, 0)
            await this.rift.connect(wallets[i]).claimRewards(tokenId)
            let rewards = await this.rift.getClaimableRewards(tokenId)
            expect(rewards).to.equal(ZERO_BN)
        }

        for (let i = 1; i <= NUM_NFTS; i++) {
            const dailyRate = BASE_REWARDS_PER_SECOND * SECONDS_IN_DAY
            const min = dailyRate-1
            const max = dailyRate+1
            rewards = await this.rewardToken.balanceOf(wallets[i].address)
            expect(rewards).to.be.above(ethers.utils.parseEther(min.toString()))
            expect(rewards).to.be.below(ethers.utils.parseEther(max.toString()))
        }

    });
    it("Rewards work - leave claims", async function () {
        await this.rewardToken.connect(this.alice).mint(this.rift.address, ethers.utils.parseEther("1000000"))

        await this.nfts.connect(this.bobby).mintGhostlys(1, { value: PRICE })
        const tokenId = await this.nfts.tokenOfOwnerByIndex(this.bobby.address, 0)

        await this.rift.connect(this.bobby).enter(tokenId)

        await ethers.provider.send("evm_increaseTime", [SECONDS_IN_DAY]) // fastforward 1000 days
        await ethers.provider.send("evm_mine", []) // force mine the next block

        await this.rift.connect(this.bobby).leave(tokenId)
        let rewards = await this.rift.getClaimableRewards(tokenId)
        expect(rewards).to.equal(ZERO_BN)

        // Cumulative rewards
        const dailyRate = BASE_REWARDS_PER_SECOND * SECONDS_IN_DAY
        const min = dailyRate-1
        const max = dailyRate+1

        rewards = await this.rewardToken.balanceOf(this.bobby.address)
        //console.log(`POST_CLAIM: DR: ${dailyRate}, MIN: ${min}, MAX: ${max}, REWARDS: ${rewards}`)
        expect(rewards).to.be.above(ethers.utils.parseEther(min.toString()))
        expect(rewards).to.be.below(ethers.utils.parseEther(max.toString()))
    });
    it("Rewards work - leave claims", async function () {
        await this.rewardToken.connect(this.alice).mint(this.rift.address, ethers.utils.parseEther("1000000"))

        await this.nfts.connect(this.bobby).mintGhostlys(1, { value: PRICE })
        const tokenId = await this.nfts.tokenOfOwnerByIndex(this.bobby.address, 0)

        await this.rift.connect(this.bobby).enter(tokenId)

        await ethers.provider.send("evm_increaseTime", [SECONDS_IN_DAY]) // fastforward 1000 days
        await ethers.provider.send("evm_mine", []) // force mine the next block

        await this.rift.connect(this.bobby).leave(tokenId)
        let rewards = await this.rift.getClaimableRewards(tokenId)
        expect(rewards).to.equal(ZERO_BN)

        const dailyRate = BASE_REWARDS_PER_SECOND * SECONDS_IN_DAY
        const min = dailyRate-1
        const max = dailyRate+1

        rewards = await this.rewardToken.balanceOf(this.bobby.address)
        //console.log(`POST_CLAIM: DR: ${dailyRate}, MIN: ${min}, MAX: ${max}, REWARDS: ${rewards}`)
        expect(rewards).to.be.above(ethers.utils.parseEther(min.toString()))
        expect(rewards).to.be.below(ethers.utils.parseEther(max.toString()))
    });
    it("Rewards work - reward rate changes work when nft doesn't leave", async function () {
        await this.rewardToken.connect(this.alice).mint(this.rift.address, ethers.utils.parseEther("1000000"))

        await this.nfts.connect(this.bobby).mintGhostlys(1, { value: PRICE })
        const tokenId = await this.nfts.tokenOfOwnerByIndex(this.bobby.address, 0)

        const rate0 = BASE_REWARDS_PER_SECOND;
        const rate1 = HALF_REWARDS;
        const rate2 = QUARTER_REWARDS;
        //console.log(`Rate #${i}: ${rate}`)

        const dailyRate0 = rate0 * SECONDS_IN_DAY
        const min0 = dailyRate0-1
        const max0 = dailyRate0+1
        const dailyRate1 = rate1 * SECONDS_IN_DAY
        const min1 = dailyRate1-1
        const max1 = dailyRate1+1
        const dailyRate2 = rate2 * SECONDS_IN_DAY
        const min2 = dailyRate2-1
        const max2 = dailyRate2+1

        await this.rift.connect(this.bobby).enter(tokenId)

        await ethers.provider.send("evm_increaseTime", [SECONDS_IN_DAY]) // fastforward 1000 days
        await ethers.provider.send("evm_mine", []) // force mine the next block

        const rewards0 = await this.rift.getClaimableRewards(tokenId)
        expect(rewards0).to.be.above(ethers.utils.parseEther(min0.toString()))
        expect(rewards0).to.be.below(ethers.utils.parseEther(max0.toString()))

        await this.rift.connect(this.alice).setRewardsRate(ethers.utils.parseEther(HALF_REWARDS.toString()))

        await ethers.provider.send("evm_increaseTime", [SECONDS_IN_DAY]) // fastforward 1000 days
        await ethers.provider.send("evm_mine", []) // force mine the next block

        const rewards1 = await this.rift.getClaimableRewards(tokenId)
        expect(rewards1.sub(rewards0)).to.be.above(ethers.utils.parseEther(min1.toString()))
        expect(rewards1.sub(rewards0)).to.be.below(ethers.utils.parseEther(max1.toString()))

        await this.rift.connect(this.alice).setRewardsRate(ethers.utils.parseEther(QUARTER_REWARDS.toString()))

        await ethers.provider.send("evm_increaseTime", [SECONDS_IN_DAY]) // fastforward 1000 days
        await ethers.provider.send("evm_mine", []) // force mine the next block

        const rewards2 = await this.rift.getClaimableRewards(tokenId)
        expect(rewards2.sub(rewards1)).to.be.above(ethers.utils.parseEther(min2.toString()))
        expect(rewards2.sub(rewards1)).to.be.below(ethers.utils.parseEther(max2.toString()))

        await this.rift.connect(this.bobby).claimRewards(tokenId)

        const rewards3 = await this.rift.getClaimableRewards(tokenId)
        expect(rewards3).to.equal(ZERO_BN)

        const claimedRewards = await this.rewardToken.balanceOf(this.bobby.address)
        //console.log(`POST_CLAIM: DR: ${dailyRate}, MIN: ${min}, MAX: ${max}, REWARDS: ${rewards}`)
        expect(claimedRewards).to.be.above(rewards2)
        expect(claimedRewards).to.be.below(rewards2.add(ethers.utils.parseEther("1")))
    });
    it("Rewards work - one wallet, multi NFTs, multiClaimRewards", async function () {
        await this.rewardToken.connect(this.alice).mint(this.rift.address, ethers.utils.parseEther("1000000"))

        const NUM_NFTS = 100
        const tokenIds = []
        for (let i = 1; i <= NUM_NFTS; i++) {
            await this.nfts.connect(this.bobby).mintGhostlys(1, { value: PRICE })
            const tokenId = await this.nfts.tokenOfOwnerByIndex(this.bobby.address, i-1)
            tokenIds.push(tokenId)

            // can reenter somewhere
            await this.rift.connect(this.bobby).enter(tokenId)
        }

        await ethers.provider.send("evm_increaseTime", [SECONDS_IN_DAY]) // fastforward 1000 days
        await ethers.provider.send("evm_mine", []) // force mine the next block

        let rewardsPerDay = BASE_REWARDS_PER_SECOND*NUM_NFTS*SECONDS_IN_DAY
        let rewards = await this.rift.getMultiClaimableRewards(tokenIds)
        expect(rewards).to.be.above(ethers.utils.parseEther((rewardsPerDay-50).toString()))
        expect(rewards).to.be.below(ethers.utils.parseEther((rewardsPerDay+50).toString()))

        await this.rift.connect(this.bobby).multiClaimRewards(tokenIds)

        rewards = await this.rift.getMultiClaimableRewards(tokenIds)
        expect(rewards).to.equal(ZERO_BN)

        // Cumulative rewards
        const dailyRate = BASE_REWARDS_PER_SECOND*NUM_NFTS*SECONDS_IN_DAY
        const totalRate = await this.rift.getMultiRewardsRatePerSecondE18(tokenIds)
        expect(totalRate).to.be.above(ethers.utils.parseEther(((BASE_REWARDS_PER_SECOND*NUM_NFTS)-1).toString()))
        expect(totalRate).to.be.below(ethers.utils.parseEther(((BASE_REWARDS_PER_SECOND*NUM_NFTS)+1).toString()))
        const min = dailyRate-50 // more buffer for error since this is for NUM_NFTS claims
        const max = dailyRate+50

        rewards = await this.rewardToken.balanceOf(this.bobby.address)
        //console.log(`POST_CLAIM: DR: ${dailyRate}, MIN: ${min}, MAX: ${max}, REWARDS: ${rewards}`)
        expect(rewards).to.be.above(ethers.utils.parseEther(min.toString()))
        expect(rewards).to.be.below(ethers.utils.parseEther(max.toString()))

    });
    it("Rewards work - one wallet, multi NFTs, multiLeave", async function () {
        await this.rewardToken.connect(this.alice).mint(this.rift.address, ethers.utils.parseEther("1000000"))

        const NUM_NFTS = 100
        const tokenIds = []
        for (let i = 1; i <= NUM_NFTS; i++) {
            await this.nfts.connect(this.bobby).mintGhostlys(1, { value: PRICE })
            const tokenId = await this.nfts.tokenOfOwnerByIndex(this.bobby.address, i-1)
            tokenIds.push(tokenId)

            // can reenter somewhere
            await this.rift.connect(this.bobby).enter(tokenId)
        }

        await ethers.provider.send("evm_increaseTime", [SECONDS_IN_DAY]) // fastforward 1000 days
        await ethers.provider.send("evm_mine", []) // force mine the next block

        await this.rift.connect(this.bobby).multiLeave(tokenIds)

        let rewards = await this.rift.getMultiClaimableRewards(tokenIds)
        expect(rewards).to.equal(ZERO_BN)

        // Cumulative rewards
        const dailyRate = BASE_REWARDS_PER_SECOND*NUM_NFTS*SECONDS_IN_DAY
        const totalRate = await this.rift.getMultiRewardsRatePerSecondE18(tokenIds)
        expect(totalRate).to.be.above(ethers.utils.parseEther(((BASE_REWARDS_PER_SECOND*NUM_NFTS)-1).toString()))
        expect(totalRate).to.be.below(ethers.utils.parseEther(((BASE_REWARDS_PER_SECOND*NUM_NFTS)+1).toString()))
        const min = dailyRate-50 // more buffer for error since this is for NUM_NFTS claims
        const max = dailyRate+50

        rewards = await this.rewardToken.balanceOf(this.bobby.address)
        //console.log(`POST_CLAIM: DR: ${dailyRate}, MIN: ${min}, MAX: ${max}, REWARDS: ${rewards}`)
        expect(rewards).to.be.above(ethers.utils.parseEther(min.toString()))
        expect(rewards).to.be.below(ethers.utils.parseEther(max.toString()))

        await this.rift.connect(this.alice).withdrawRewardToken()

        expect(await this.rewardToken.balanceOf(this.rift.address)).to.equal(ZERO_BN)


    });
});
