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
        require(_amount < MAX_MINT, "Tried to mint too many at once");
        require(getStatus() == Status.PublicSaleStart, "Public sale has not started");
        require(GHOSTLYS_PRICE * _amount <= msg.value, "Didn't send enough payment");
        require(totalSupply().add(_amount) <= MAX_GHOSTLYS, "Purchase would exceed max supply");
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

    function teamMint() external onlyTeam {
        address _to = msg.sender;

        uint mintId = totalSupply() + 1;

        _safeMint(_to, mintId);
    }

    function mintFreeGhostly() external verifyFreeMint(msg.sender) {
        address _to = msg.sender;

        uint mintId = totalSupply() + 1;

        _safeMint(_to, mintId);

        freeMints[_to]--;
    }

    function mintGhostly(uint _amount) external payable verifyMint(msg.sender, _amount) {
        address _to = msg.sender;

        for (uint i = 0; i < _amount; i++) {
            uint mintId = totalSupply() + 1;

            _safeMint(_to, mintId);
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
