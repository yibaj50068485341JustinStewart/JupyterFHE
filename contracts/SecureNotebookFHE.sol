// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SecureNotebookFHE is SepoliaConfig {
    struct EncryptedVariable {
        uint256 variableId;
        euint32 encryptedValue;    // Encrypted variable value
        euint32 encryptedType;     // Encrypted data type
        string name;               // Variable name (unencrypted)
        uint256 timestamp;
    }

    struct EncryptedOperation {
        uint256 operationId;
        euint32 encryptedResult;   // Encrypted operation result
        uint256[] inputIds;        // Input variable IDs
        string operationType;      // Operation type (e.g., "add", "multiply")
        uint256 timestamp;
    }

    struct DecryptedResult {
        uint32 value;
        bool isRevealed;
    }

    uint256 public variableCount;
    uint256 public operationCount;
    mapping(uint256 => EncryptedVariable) public encryptedVariables;
    mapping(uint256 => EncryptedOperation) public encryptedOperations;
    mapping(uint256 => DecryptedResult) public decryptedResults;
    
    mapping(uint256 => uint256) private requestToVariableId;
    mapping(uint256 => uint256) private resultRequestToId;
    
    event VariableCreated(uint256 indexed variableId, string name, uint256 timestamp);
    event OperationPerformed(uint256 indexed operationId, uint256 timestamp);
    event ResultRequested(uint256 indexed requestId, uint256 variableId);
    event ResultDecrypted(uint256 indexed resultId);

    modifier onlyOwner(uint256 variableId) {
        // Add proper ownership check in production
        _;
    }

    function createEncryptedVariable(
        euint32 encryptedValue,
        euint32 encryptedType,
        string memory name
    ) public {
        variableCount += 1;
        uint256 newVariableId = variableCount;
        
        encryptedVariables[newVariableId] = EncryptedVariable({
            variableId: newVariableId,
            encryptedValue: encryptedValue,
            encryptedType: encryptedType,
            name: name,
            timestamp: block.timestamp
        });
        
        emit VariableCreated(newVariableId, name, block.timestamp);
    }

    function performEncryptedOperation(
        uint256[] memory inputIds,
        string memory operationType
    ) public {
        require(inputIds.length > 0, "No inputs provided");
        
        operationCount += 1;
        uint256 newOperationId = operationCount;
        
        // Get first input to initialize result
        EncryptedVariable storage firstVar = encryptedVariables[inputIds[0]];
        euint32 result = firstVar.encryptedValue;
        
        // Perform operation (simplified for demo)
        if (keccak256(bytes(operationType)) == keccak256(bytes("add"))) {
            for (uint i = 1; i < inputIds.length; i++) {
                EncryptedVariable storage var = encryptedVariables[inputIds[i]];
                result = FHE.add(result, var.encryptedValue);
            }
        } else if (keccak256(bytes(operationType)) == keccak256(bytes("multiply"))) {
            for (uint i = 1; i < inputIds.length; i++) {
                EncryptedVariable storage var = encryptedVariables[inputIds[i]];
                result = FHE.mul(result, var.encryptedValue);
            }
        }
        
        encryptedOperations[newOperationId] = EncryptedOperation({
            operationId: newOperationId,
            encryptedResult: result,
            inputIds: inputIds,
            operationType: operationType,
            timestamp: block.timestamp
        });
        
        emit OperationPerformed(newOperationId, block.timestamp);
    }

    function requestResultDecryption(uint256 variableId) public onlyOwner(variableId) {
        euint32 valueToDecrypt;
        
        if (variableId <= variableCount) {
            EncryptedVariable storage var = encryptedVariables[variableId];
            valueToDecrypt = var.encryptedValue;
        } else {
            EncryptedOperation storage op = encryptedOperations[variableId - variableCount];
            valueToDecrypt = op.encryptedResult;
        }
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(valueToDecrypt);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptValue.selector);
        requestToVariableId[reqId] = variableId;
        
        emit ResultRequested(reqId, variableId);
    }

    function decryptValue(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 variableId = requestToVariableId[requestId];
        require(variableId != 0, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 value = abi.decode(cleartexts, (uint32));
        
        decryptedResults[variableId] = DecryptedResult({
            value: value,
            isRevealed: true
        });
        
        emit ResultDecrypted(variableId);
    }

    function getDecryptedResult(uint256 variableId) public view returns (
        uint32 value,
        bool isRevealed
    ) {
        DecryptedResult storage r = decryptedResults[variableId];
        return (r.value, r.isRevealed);
    }

    function getEncryptedVariable(uint256 variableId) public view returns (
        euint32 value,
        euint32 varType,
        string memory name,
        uint256 timestamp
    ) {
        EncryptedVariable storage v = encryptedVariables[variableId];
        return (v.encryptedValue, v.encryptedType, v.name, v.timestamp);
    }

    function getEncryptedOperation(uint256 operationId) public view returns (
        euint32 result,
        uint256[] memory inputIds,
        string memory operationType,
        uint256 timestamp
    ) {
        EncryptedOperation storage o = encryptedOperations[operationId];
        return (o.encryptedResult, o.inputIds, o.operationType, o.timestamp);
    }
}