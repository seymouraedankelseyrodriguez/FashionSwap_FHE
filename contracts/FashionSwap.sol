// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract FashionSwap is SepoliaConfig {
    struct EncryptedItem {
        address owner;
        euint32 encryptedCategory; // Encrypted item category
        euint32 encryptedCondition; // Encrypted condition rating
        euint32 encryptedSize;     // Encrypted size
        uint256 timestamp;
        bool isListed;
    }
    
    struct SwapRequest {
        address requester;
        uint256 requestedItemId;
        uint256 offeredItemId;
        euint32 encryptedMessage; // Encrypted message
        bool isAccepted;
    }
    
    struct Reputation {
        euint32 encryptedRating; // Encrypted user rating
        uint32 successfulSwaps;
    }

    // Contract state
    uint256 public itemCount;
    mapping(uint256 => EncryptedItem) public items;
    mapping(uint256 => SwapRequest) public swapRequests;
    mapping(address => Reputation) public reputations;
    mapping(address => uint256[]) public userItems;
    
    // Decryption tracking
    mapping(uint256 => uint256) private requestToItemId;
    mapping(uint256 => uint256) private requestToSwapId;
    
    // Events
    event ItemListed(uint256 indexed id, address owner);
    event SwapRequested(uint256 indexed requestId, address requester);
    event SwapAccepted(uint256 indexed requestId);
    event SwapCompleted(uint256 indexed requestId);
    event DecryptionRequested(uint256 indexed itemId);

    /// @notice List a new fashion item
    function listItem(
        euint32 encryptedCategory,
        euint32 encryptedCondition,
        euint32 encryptedSize
    ) public {
        itemCount++;
        uint256 newId = itemCount;
        
        items[newId] = EncryptedItem({
            owner: msg.sender,
            encryptedCategory: encryptedCategory,
            encryptedCondition: encryptedCondition,
            encryptedSize: encryptedSize,
            timestamp: block.timestamp,
            isListed: true
        });
        
        userItems[msg.sender].push(newId);
        
        emit ItemListed(newId, msg.sender);
    }

    /// @notice Create a swap request
    function requestSwap(
        uint256 requestedItemId,
        uint256 offeredItemId,
        euint32 encryptedMessage
    ) public {
        require(items[requestedItemId].isListed, "Item not available");
        require(items[offeredItemId].owner == msg.sender, "Not your item");
        require(items[offeredItemId].isListed, "Item not listed");
        
        uint256 requestId = uint256(keccak256(abi.encodePacked(requestedItemId, offeredItemId)));
        require(!swapRequests[requestId].isAccepted, "Already accepted");
        
        swapRequests[requestId] = SwapRequest({
            requester: msg.sender,
            requestedItemId: requestedItemId,
            offeredItemId: offeredItemId,
            encryptedMessage: encryptedMessage,
            isAccepted: false
        });
        
        emit SwapRequested(requestId, msg.sender);
    }

    /// @notice Accept a swap request
    function acceptSwap(uint256 requestId) public {
        SwapRequest storage request = swapRequests[requestId];
        require(items[request.requestedItemId].owner == msg.sender, "Not your item");
        require(!request.isAccepted, "Already accepted");
        
        request.isAccepted = true;
        
        emit SwapAccepted(requestId);
    }

    /// @notice Complete a swap
    function completeSwap(uint256 requestId) public {
        SwapRequest storage request = swapRequests[requestId];
        require(request.isAccepted, "Not accepted");
        
        // Transfer ownership
        items[request.requestedItemId].owner = request.requester;
        items[request.offeredItemId].owner = items[request.requestedItemId].owner;
        
        // Update listing status
        items[request.requestedItemId].isListed = false;
        items[request.offeredItemId].isListed = false;
        
        // Update reputations
        reputations[request.requester].successfulSwaps++;
        reputations[items[request.requestedItemId].owner].successfulSwaps++;
        
        emit SwapCompleted(requestId);
    }

    /// @notice Rate swap partner
    function ratePartner(
        uint256 requestId,
        euint32 encryptedRating
    ) public {
        SwapRequest storage request = swapRequests[requestId];
        require(!request.isAccepted, "Swap not completed");
        require(
            msg.sender == request.requester || 
            msg.sender == items[request.requestedItemId].owner,
            "Not a participant"
        );
        
        // Add to existing rating
        reputations[msg.sender].encryptedRating = FHE.add(
            reputations[msg.sender].encryptedRating,
            encryptedRating
        );
    }

    /// @notice Request item details decryption
    function requestItemDecryption(uint256 itemId) public {
        require(items[itemId].owner == msg.sender, "Not your item");
        
        EncryptedItem storage item = items[itemId];
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(item.encryptedCategory);
        ciphertexts[1] = FHE.toBytes32(item.encryptedCondition);
        ciphertexts[2] = FHE.toBytes32(item.encryptedSize);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptItemCallback.selector);
        requestToItemId[reqId] = itemId;
        
        emit DecryptionRequested(itemId);
    }

    /// @notice Handle item decryption callback
    function decryptItemCallback(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 itemId = requestToItemId[requestId];
        require(itemId != 0, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        // Process decrypted values
        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        // Handle decrypted item details as needed
    }

    /// @notice Get user's items
    function getUserItems(address user) public view returns (uint256[] memory) {
        return userItems[user];
    }

    /// @notice Check if item is listed
    function isItemListed(uint256 itemId) public view returns (bool) {
        return items[itemId].isListed;
    }

    /// @notice Get encrypted reputation rating
    function getEncryptedReputation(address user) public view returns (euint32) {
        return reputations[user].encryptedRating;
    }

    /// @notice Get successful swaps count
    function getSuccessfulSwaps(address user) public view returns (uint32) {
        return reputations[user].successfulSwaps;
    }
}