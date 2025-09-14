// standalone-validator.js

/**
 * This script demonstrates how to generate a signature for an on-chain identity claim
 * and then validate that signature by calling a read-only function on the smart contract.
 *
 * It simulates the roles of both the "Issuer" (who creates the signature) and a
 * "Verifier" (who checks the signature on-chain).
 */

// 1. --- SETUP ---
// Import necessary libraries
require('dotenv').config();
const { ethers } = require('ethers');

// ABI (Application Binary Interface) for the Identity contract.
// We only need the 'getRecoveredAddress' function for this script.
const IDENTITY_ABI = [
    {
        "type": "function",
        "name": "getRecoveredAddress",
        "inputs": [
            { "name": "sig", "type": "bytes", "internalType": "bytes" },
            { "name": "dataHash", "type": "bytes32", "internalType": "bytes32" }
        ],
        "outputs": [
            { "name": "addr", "type": "address", "internalType": "address" }
        ],
        "stateMutability": "pure"
    }
];

// --- CONFIGURATION ---
// Load sensitive data from a .env file
const RPC_URL = process.env.RPC_URL;
const ISSUER_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;
const IDENTITY_CONTRACT_ADDRESS = "0xDe9Fda56D152aBe11Aa64aeb5eAbC1eA8049A2eb"; // The user's deployed Identity contract

// --- TARGET DATA ---
// The specific claim details we are signing and verifying
const claimDetails = {
    topic: 42,          // Example: KYC (Know Your Customer) topic
    data: "0x",         // Example: Empty data field
};


/**
 * Main function to run the signature generation and validation process.
 */
async function main() {
    console.log("--- On-Chain Signature Validation Script ---");

    // --- VALIDATE SETUP ---
    if (!RPC_URL || !ISSUER_PRIVATE_KEY || !IDENTITY_CONTRACT_ADDRESS) {
        console.error("❌ Error: Missing required environment variables.");
        console.error("Please create a .env file with RPC_URL, ISSUER_PRIVATE_KEY, and IDENTITY_CONTRACT_ADDRESS.");
        return;
    }
    if (!ethers.utils.isAddress(IDENTITY_CONTRACT_ADDRESS)) {
        console.error(`❌ Error: Invalid IDENTITY_CONTRACT_ADDRESS: "${IDENTITY_CONTRACT_ADDRESS}"`);
        return;
    }

    // --- INITIALIZE ETHERS ---
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const issuerWallet = new ethers.Wallet(ISSUER_PRIVATE_KEY, provider);

    console.log(`\n1. Issuer Address: ${issuerWallet.address}`);
    console.log(`2. Target Identity Contract: ${IDENTITY_CONTRACT_ADDRESS}`);


    // 2. --- GENERATE SIGNATURE (Simulating the Issuer) ---
    console.log("\n3. Generating signature off-chain...");

    // a. Create the raw data hash. This must match the hashing logic used by the verifier/contract.
    const rawDataHash = ethers.utils.solidityKeccak256(
        ['address', 'uint256', 'bytes'],
        [IDENTITY_CONTRACT_ADDRESS, claimDetails.topic, claimDetails.data]
    );

    // b. Sign the RAW HASH directly.
    //    We use signDigest to avoid the "Ethereum Signed Message" prefix that
    //    wallet.signMessage() automatically adds.
    const signatureObject = issuerWallet._signingKey().signDigest(rawDataHash);
    const signature = ethers.utils.joinSignature(signatureObject);
    
    console.log(`   - Raw Hash: ${rawDataHash}`);
    console.log(`   - Signature: ${signature}`);

    // 3. --- VALIDATE SIGNATURE ON-CHAIN (Simulating a Verifier) ---
    console.log("\n4. Validating signature on-chain...");

    try {
        // a. Create a contract instance to interact with the Identity contract.
        const identityContract = new ethers.Contract(IDENTITY_CONTRACT_ADDRESS, IDENTITY_ABI, provider);

        // b. Call the 'getRecoveredAddress' function on the smart contract.
        //    We pass the signature and the RAW hash, which now correctly correspond to each other.
        const recoveredAddress = await identityContract.getRecoveredAddress(
            signature,
            rawDataHash
        );

        console.log(`   - Address recovered by contract: ${recoveredAddress}`);

        // c. Compare the result with the known issuer address.
        if (recoveredAddress.toLowerCase() === issuerWallet.address.toLowerCase()) {
            console.log("\n✅ SUCCESS: The on-chain recovered address matches the issuer's address.");
        } else {
            console.error("\n❌ FAILURE: The on-chain recovered address does NOT match the issuer's address.");
        }

    } catch (error) {
        console.error("\n❌ An error occurred during on-chain validation:", error.message);
        console.error("   - This could mean the contract address is wrong, the network is down, or the contract does not have the getRecoveredAddress function.");
    }
}

// Execute the main function
main().catch(error => {
    console.error("An unexpected error occurred:", error);
});
