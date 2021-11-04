/*
  █████▒█    ██  ███▄    █ ▓█████  ██▀███   ▄▄▄       ██▓
▓██   ▒ ██  ▓██▒ ██ ▀█   █ ▓█   ▀ ▓██ ▒ ██▒▒████▄    ▓██▒
▒████ ░▓██  ▒██░▓██  ▀█ ██▒▒███   ▓██ ░▄█ ▒▒██  ▀█▄  ▒██░
░▓█▒  ░▓▓█  ░██░▓██▒  ▐▌██▒▒▓█  ▄ ▒██▀▀█▄  ░██▄▄▄▄██ ▒██░
░▒█░   ▒▒█████▓ ▒██░   ▓██░░▒████▒░██▓ ▒██▒ ▓█   ▓██▒░██████▒
 ▒ ░   ░▒▓▒ ▒ ▒ ░ ▒░   ▒ ▒ ░░ ▒░ ░░ ▒▓ ░▒▓░ ▒▒   ▓▒█░░ ▒░▓  ░
 ░     ░░▒░ ░ ░ ░ ░░   ░ ▒░ ░ ░  ░  ░▒ ░ ▒░  ▒   ▒▒ ░░ ░ ▒  ░
 ░ ░    ░░░ ░ ░    ░   ░ ░    ░     ░░   ░   ░   ▒     ░ ░
          ░              ░    ░  ░   ░           ░  ░    ░  ░

░█████╗░███╗░░██╗██████╗░  ██╗░░░░░░█████╗░██████╗░██╗░░██╗██╗███╗░░██╗
██╔══██╗████╗░██║██╔══██╗  ██║░░░░░██╔══██╗██╔══██╗██║░██╔╝██║████╗░██║
███████║██╔██╗██║██║░░██║  ██║░░░░░███████║██████╔╝█████═╝░██║██╔██╗██║
██╔══██║██║╚████║██║░░██║  ██║░░░░░██╔══██║██╔══██╗██╔═██╗░██║██║╚████║
██║░░██║██║░╚███║██████╔╝  ███████╗██║░░██║██║░░██║██║░╚██╗██║██║░╚███║
╚═╝░░╚═╝╚═╝░░╚══╝╚═════╝░  ╚══════╝╚═╝░░╚═╝╚═╝░░╚═╝╚═╝░░╚═╝╚═╝╚═╝░░╚══╝
*/
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

// Adapted and simplified from first Fantomon HealingRift
contract GhostlysRift is Ownable {
    using SafeMath for uint256;

    IERC721Enumerable nftContract_;
    IERC20 rewardToken_;

    uint256 private BASE_REWARDS_PER_SECOND_E18 = 578703703703703;  // 50 per day = 0.000578703703703703 per hour (e18 for 18 decimals)
    uint256[] private histRates_;
    uint256[] private rateEndTimes_;

    uint256 public numNFTsHealing_ = 0;
    mapping (uint256 => bool) public deployed_;   // is tokenId already deployed here
    mapping (uint256 => uint256) public entered_; // what time did this tokenId get deployed here?

    // Modifiers
    modifier onlyTokenIdOwner(uint256 _tokenId) {
        require(nftContract_.ownerOf(_tokenId) == msg.sender, "You don't own that tokenId");
        _;
    }

    constructor (address _nftContract, address _rewardToken) {
        nftContract_ = IERC721Enumerable(_nftContract);
        rewardToken_  = IERC20(_rewardToken);
    }

    function setRewardsRate(uint256 _rewardsPerSecondE18) external onlyOwner {
        histRates_.push(BASE_REWARDS_PER_SECOND_E18);
        rateEndTimes_.push(block.timestamp);
        BASE_REWARDS_PER_SECOND_E18 = _rewardsPerSecondE18;
    }

    function enter(uint256 _tokenId) external onlyTokenIdOwner(_tokenId) {
        require(!deployed_[_tokenId], "NFT already healing"); // cannot do this because of emergency flee

        if (!deployed_[_tokenId]) {
            numNFTsHealing_ = numNFTsHealing_.add(1);
            deployed_[_tokenId] = true;
        }
        entered_[_tokenId] = block.timestamp;
    }
    function multiEnter(uint256[] memory _tokenIds) external {
        uint256 numEntered = 0;
        uint256 idx;
        for (idx = 0; idx < _tokenIds.length; idx++) {
            require(nftContract_.ownerOf(_tokenIds[idx]) == msg.sender, "You don't own that tokenId");
            if (!deployed_[_tokenIds[idx]]) {
                claimRewards(_tokenIds[idx]);
                deployed_[_tokenIds[idx]] = false;
                entered_[_tokenIds[idx]] = block.timestamp;
                numEntered = numEntered.add(1);
            }
        }
        numNFTsHealing_ = numNFTsHealing_.add(numEntered);
    }

    function getRewards(uint256 _tokenId) public view returns (uint256) {
        if (deployed_[_tokenId]) {
            uint256 rewards = 0;
            uint256 startTime = entered_[_tokenId];

            uint256 idx;
            for (idx = 0; idx < rateEndTimes_.length; idx++) {
                if (startTime < rateEndTimes_[idx]) {
                    //        rewards + ((rateEndTimes_[idx] - startTime) * histRates_[idx])
                    rewards = rewards.add((rateEndTimes_[idx].sub(startTime)).mul(histRates_[idx]));
                    startTime = rateEndTimes_[idx];
                }
            }
            //     (rewards + ((block.timestamp - startTime) * BASE_REWARDS_PER_SECOND_E18)) / 1 seconds;
            return (rewards.add((block.timestamp.sub(startTime)).mul(BASE_REWARDS_PER_SECOND_E18))).div(1 seconds);
        } else {
            return 0;
        }
    }
    function getClaimableRewards(uint256 _tokenId) public view returns (uint256) {
        uint256 rewards = getRewards(_tokenId);
        if (rewardToken_.balanceOf(address(this)) >= rewards) {
            return rewards;
        }
        return 0;
    }

    function claimRewards(uint256 _tokenId) public {
        require(nftContract_.ownerOf(_tokenId) == msg.sender, "You don't own that tokenId");
        uint256 rewards = getRewards(_tokenId);
        // make sure the contract has been alotted enough rewards for this claim
        require(rewardToken_.balanceOf(address(this)) >= rewards, "Rewards have stopped");
        // reset reward balance to 0
        entered_[_tokenId] = block.timestamp;
        // send rewards to msg.sender
        rewardToken_.transfer(nftContract_.ownerOf(_tokenId), rewards);
    }

    function getMultiRewardsRatePerSecondE18(uint256[] memory _tokenIds) public view returns (uint256) {
        uint256 rate = 0;
        uint256 idx;
        for (idx = 0; idx < _tokenIds.length; idx++) {
            if (deployed_[_tokenIds[idx]]) {
                rate = rate.add(BASE_REWARDS_PER_SECOND_E18);
            }
        }
        return rate;
    }
    function getMultiRewards(uint256[] memory _tokenIds) public view returns (uint256) {
        uint256 rewards = 0;
        uint256 idx;
        for (idx = 0; idx < _tokenIds.length; idx++) {
            rewards = rewards.add(getRewards(_tokenIds[idx]));
        }
        return rewards;
    }
    function getMultiClaimableRewards(uint256[] memory _tokenIds) public view returns (uint256) {
        uint256 rewards = 0;
        uint256 idx;
        for (idx = 0; idx < _tokenIds.length; idx++) {
            rewards = rewards.add(getClaimableRewards(_tokenIds[idx]));
        }
        return rewards;
    }

    function multiClaimRewards(uint256[] memory _tokenIds) public {
        uint256 rewards = 0;
        uint256 idx;
        for (idx = 0; idx < _tokenIds.length; idx++) {
            require(nftContract_.ownerOf(_tokenIds[idx]) == msg.sender, "You don't own that TokenId");
            rewards = rewards.add(getRewards(_tokenIds[idx]));
            entered_[_tokenIds[idx]] = block.timestamp;
        }
        require(rewardToken_.balanceOf(address(this)) >= rewards, "Rewards have stopped");
        rewardToken_.transfer(msg.sender, rewards);
    }

    function leave(uint256 _tokenId) external onlyTokenIdOwner(_tokenId) {
        require(deployed_[_tokenId], "TokenId isn't healing here");

        claimRewards(_tokenId);
        deployed_[_tokenId] = false;
        numNFTsHealing_ = numNFTsHealing_.sub(1);
    }

    function multiLeave(uint256[] memory _tokenIds) external {
        uint256 numLeft = 0;
        uint256 idx;
        for (idx = 0; idx < _tokenIds.length; idx++) {
            require(nftContract_.ownerOf(_tokenIds[idx]) == msg.sender, "You don't own that tokenId");
            if (deployed_[_tokenIds[idx]]) {
                claimRewards(_tokenIds[idx]);
                deployed_[_tokenIds[idx]] = false;
                numLeft = numLeft.add(1);
            }
        }
        numNFTsHealing_ = numNFTsHealing_.sub(numLeft);
    }

    function withdrawRewardToken() external onlyOwner {
        require(rewardToken_.balanceOf(address(this)) != 0, "Contract has no reward token balance");
        rewardToken_.transfer(msg.sender, rewardToken_.balanceOf(address(this)));
    }
}
/**

 Art, Generative Art, UI: Funeral - @yolofinancial
 Solidity & React:        Larkin  - @CodeLarkin
 Communities: @farmgoddao, @SkullysNFT, @fantomonftm

  █████▒█    ██  ███▄    █ ▓█████  ██▀███   ▄▄▄       ██▓
▓██   ▒ ██  ▓██▒ ██ ▀█   █ ▓█   ▀ ▓██ ▒ ██▒▒████▄    ▓██▒
▒████ ░▓██  ▒██░▓██  ▀█ ██▒▒███   ▓██ ░▄█ ▒▒██  ▀█▄  ▒██░
░▓█▒  ░▓▓█  ░██░▓██▒  ▐▌██▒▒▓█  ▄ ▒██▀▀█▄  ░██▄▄▄▄██ ▒██░
░▒█░   ▒▒█████▓ ▒██░   ▓██░░▒████▒░██▓ ▒██▒ ▓█   ▓██▒░██████▒
 ▒ ░   ░▒▓▒ ▒ ▒ ░ ▒░   ▒ ▒ ░░ ▒░ ░░ ▒▓ ░▒▓░ ▒▒   ▓▒█░░ ▒░▓  ░
 ░     ░░▒░ ░ ░ ░ ░░   ░ ▒░ ░ ░  ░  ░▒ ░ ▒░  ▒   ▒▒ ░░ ░ ▒  ░
 ░ ░    ░░░ ░ ░    ░   ░ ░    ░     ░░   ░   ░   ▒     ░ ░
          ░              ░    ░  ░   ░           ░  ░    ░  ░

   ██╗      █████╗ ██████╗ ██╗  ██╗██╗███╗   ██╗
   ██║     ██╔══██╗██╔══██╗██║ ██╔╝██║████╗  ██║
   ██║     ███████║██████╔╝█████╔╝ ██║██╔██╗ ██║
   ██║     ██╔══██║██╔══██╗██╔═██╗ ██║██║╚██╗██║
   ███████╗██║  ██║██║  ██║██║  ██╗██║██║ ╚████║
   ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝
**/
