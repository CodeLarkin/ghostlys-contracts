// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

/**
   ▄██████▄     ▄█    █▄     ▄██████▄     ▄████████     ███      ▄█       ▄██   ▄      ▄████████
  ███    ███   ███    ███   ███    ███   ███    ███ ▀█████████▄ ███       ███   ██▄   ███    ███
  ███    █▀    ███    ███   ███    ███   ███    █▀     ▀███▀▀██ ███       ███▄▄▄███   ███    █▀
 ▄███         ▄███▄▄▄▄███▄▄ ███    ███   ███            ███   ▀ ███       ▀▀▀▀▀▀███   ███
▀▀███ ████▄  ▀▀███▀▀▀▀███▀  ███    ███ ▀███████████     ███     ███       ▄██   ███ ▀███████████
  ███    ███   ███    ███   ███    ███          ███     ███     ███       ███   ███          ███
  ███    ███   ███    ███   ███    ███    ▄█    ███     ███     ███▌    ▄ ███   ███    ▄█    ███
  ████████▀    ███    █▀     ▀██████▀   ▄████████▀     ▄████▀   █████▄▄██  ▀█████▀   ▄████████▀
                                                                ▀
**/

//import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./ERC2981.sol";

import "hardhat/console.sol";


contract Ghostlys is ERC721Enumerable, ERC2981 {

    using SafeMath for uint;
    using SafeMath for uint256;
    //using Counters for Counters.Counter;

    enum Status {
        Closed,
        PresaleStart,
        PublicSaleStart
    }

    string public PROVENANCE = "";
    string private _baseURIextended = "";

    uint constant public MAX_GHOSTLYS = 8888;
    uint constant public MAX_MINT = 20;
    uint constant public GHOSTLYS_PRICE = 50 ether;

    uint public presaleStartTime = 2547586402; // default to some time far in the future
    uint public publicSaleStartTime = presaleStartTime + 24 hours; // starts 24 hours after the presale

    uint constant private RAND_ID_POOL_SIZE = 100;
    uint private randIdPoolSize = RAND_ID_POOL_SIZE;
    uint[RAND_ID_POOL_SIZE] private randIdPool;
    //uint[] private ;

    mapping(address => bool) private isTeam;
    mapping(address => uint) public freeMints;

    // Team Addresses
    address[] private _team = [
        0xC87bf1972Dd048404CBd3FbA300b69277552C472, // 38 - FUNERAL - Art, Generative Art, UI, Community
        0x14E8F54f35eE42Cdf436A19086659B34dA6D9D47, // 12 - LARKIN  - Dev
        0xA4f7a42F2569f97de8218Aa875F58533Fe842FEe  // 50 - Community

    ];

    // team address and community wallet payout shares
    uint256[] private _team_shares = [38, 12, 50];  // 38 and 12 for team, and then 50% for community wallet


    // For EIP-2981
    uint256 constant private ROYALTIES_PERCENTAGE = 5;

    constructor()
        ERC721("Ghostlys... Enter the summoning circle.", "GHOSTLY")
    {
        isTeam[msg.sender] = true;
        isTeam[0xC87bf1972Dd048404CBd3FbA300b69277552C472] = true;
        isTeam[0x14E8F54f35eE42Cdf436A19086659B34dA6D9D47] = true;

        _setReceiver(address(this));
        _setRoyaltyPercentage(ROYALTIES_PERCENTAGE);

        for (uint i = 0; i < RAND_ID_POOL_SIZE; i++) {
            randIdPool[i] = i+1;
        }
        // initialize tokenIdsLeft to range(1, 100)
        // choose a random index into tokenIdsLeft, mint that ID
        // delete that ID from tokenIdsLeft, add totalSupply() + 1 to tokenIdsLeft
    }

    modifier onlyTeam() {
        require(isTeam[msg.sender], "Can't do that, you are not part of the team");
        _;
    }

    modifier verifyFreeMint(address _to) {
        require(freeMints[_to] > 0, "Must have a skully before snapshot for free mint");
        require(getStatus() == Status.PresaleStart || getStatus() == Status.PublicSaleStart, "Minting has not started");
        require(totalSupply() < MAX_GHOSTLYS, "Sold out");
        _;
    }

    modifier verifyMint(address _to, uint _amount) {
        require(_amount <= MAX_MINT, "Tried to mint too many at once");
        require(getStatus() == Status.PublicSaleStart, "Public sale has not started");
        require(GHOSTLYS_PRICE * _amount <= msg.value, "Didn't send enough payment");
        require(totalSupply().add(_amount) <= MAX_GHOSTLYS, "Sold out");
        _;
    }

    function setProvenanceHash(string memory _provenanceHash) external onlyTeam {
        PROVENANCE = _provenanceHash;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseURIextended;
    }

    function setBaseURI(string memory baseURI_) external onlyTeam {
        _baseURIextended = baseURI_;
    }

    function setManyWhiteList(address[] memory _addr, uint[] memory _bals) external onlyTeam {
        require(_addr.length == _bals.length, "Addresses and balances must have same array length");
        for(uint i = 0; i < _addr.length; i++){
            freeMints[_addr[i]] = _bals[i];
        }
    }

    function getStatus() public view returns (Status) {
        if(block.timestamp >= publicSaleStartTime) {
            return Status.PublicSaleStart;
        } else if (block.timestamp >= presaleStartTime) {
            return Status.PresaleStart;
        }
        return Status.Closed;
    }

    function setPreSaleTime(uint _newTime) public onlyTeam {
        presaleStartTime = _newTime;
        publicSaleStartTime = _newTime + 24 hours;
    }

    function _safeRandMint(address _to, uint256 _idx) internal {
        uint mintIdx = random("MINT_FREE", _idx) % randIdPoolSize;
        uint tokenId = randIdPool[mintIdx];
        // If the randIdPool hasn't reached the end of the supply yet,
        // replace the chosen tokenId with the next one in the supply
        // Example:
        //     RAND_ID_POOL_SIZE=100
        //     randIdPool is initialized to just an enumerated list from 1 to 100 inclusive
        //     For the first mint, say the random index 20 is chosen, which corresponds to tokenId 20 in randIdPool (since it is initialized as just 1 to 100)
        //     Since we are nowhere near the end of the supply yet on this first iteration,
        //     index 20 in randIdPool is replaced with the next unminted tokenId that has been
        //     outside of the randIdPool thus far: 101
        //     Mint is completed, and next time, if index 20 is randomly chosen, it will be tokenId 101
        // Edge case:
        //     Once mints near the end of the max supply, begin decremeting the size of the randIdPool
        //     Instead of just replacing the tokenId being currently claimed wtih
        //     the next one outside the pool, just replace it wiht the last ID in the pool.
        //     If it IS the last ID in the pool, replace with the second-to-last
        //     If this is the last token in the supply, skip all of this and just mint
        if (totalSupply().add(1) < MAX_GHOSTLYS) {
            if (MAX_GHOSTLYS.sub(totalSupply()) >= RAND_ID_POOL_SIZE) {
                randIdPool[mintIdx] = totalSupply().add(RAND_ID_POOL_SIZE).add(1);
            } else {
                randIdPoolSize = randIdPoolSize.sub(1);
                if (randIdPool[mintIdx] == randIdPool[randIdPoolSize]) {
                    randIdPool[mintIdx] = randIdPool[randIdPoolSize.sub(1)];
                } else {
                    randIdPool[mintIdx] = randIdPool[randIdPoolSize];
                }
            }
        }

        _safeMint(_to, tokenId);
    }

    function teamMint() external onlyTeam {
        _safeRandMint(msg.sender, 0);
    }

    function mintFreeGhostly() external verifyFreeMint(msg.sender) {
        _safeRandMint(msg.sender, 0);
        freeMints[msg.sender]--;
    }

    function mintGhostly(uint _amount) external payable verifyMint(msg.sender, _amount) {
        for (uint i = 0; i < _amount; i++) {
            _safeRandMint(msg.sender, i);
        }
        payable(_team[0]).transfer(msg.value.sub(msg.value.div(4)));  // team member 0 gets 75% of mint revenue
        payable(_team[1]).transfer(msg.value.div(4));                 // team member 1 gets 25% of mint revenue
    }

    function totalSupply() public view override(ERC721Enumerable) returns (uint256) {
        return super.totalSupply();
    }


    function _getTotalPaymentShares() internal view returns (uint256) {
        uint256 totalShares = 0;
        for (uint i = 0; i < _team.length; i++) {
            totalShares += _team_shares[i];
        }
        return totalShares;
    }

    function withdrawAll() public onlyTeam {
        require(address(this).balance > 0, "Cannot withdraw, balance is empty");

        uint256 totalShares = _getTotalPaymentShares();

        uint256 totalReceived = address(this).balance;

        for (uint i = 0; i < _team.length; i++) {
            address payable wallet = payable(_team[i]);
            uint256 payment = (totalReceived * _team_shares[i]) / totalShares;
            Address.sendValue(wallet, payment);
        }
    }

    // ensure this contract can receive payments (royalties)
    receive () external payable {}

    /**************************************************************************
     * Helper functions
     **************************************************************************/
    function random(string memory _tag, uint256 _int0) internal view returns (uint256) {
        return uint256(keccak256(abi.encodePacked(_tag, toString(_int0), toString(block.timestamp), msg.sender)));
    }

    function toString(uint256 value) internal pure returns (string memory) {
    // Inspired by OraclizeAPI's implementation - MIT license
    // https://github.com/oraclize/ethereum-api/blob/b42146b063c7d6ee1358846c198246239e9360e8/oraclizeAPI_0.4.25.sol

        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
    /* End helper functions
     **************************************************************************/
}
/**

 Art, Generative Art, UI: Funeral - @yolofinancial
 Solidity & React:        Larkin  - @CodeLarkin
 Community: @farmgoddao, @SkullysNFT

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
