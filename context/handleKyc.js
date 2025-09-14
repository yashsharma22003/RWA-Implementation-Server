require('dotenv').config();
const { ethers } = require('ethers');

// ABIs (ensure these paths are correct for your project)
const ID_FACTORY_ABI = require('../out/IIdFactory.sol/IIdFactory.json');
const IDENTITY_ABI = require('../out/Identity.sol/Identity.json');
const IDENTITY_REGISTRY_ABI = require('../out/IdentityRegistry.sol/IdentityRegistry.json');

// Contract Addresses (ensure these are correct for your target network)
const ID_FACTORY = '0x39992CCEAEDB0fa8f4fd3f2FBC5134707635B371';
const IDENTITY_REGISTRY = '0xAa7bdF67038D0c8a8F14418eeDBFb965213732Da';
const CLAIM_ISSUER_ADDRESS = '0xd75849340fa68E19610791c398880D8a4a089096';
const COMPLIANCE_ADDRESS = '0x1D7763C6C7bc12fc53e6667b17671d911aE6CaEC';
const UNCOMPROMISED_IDENTITY_ADDRESS = '0x241Bd12a42C1541FCbe2A960688A1244C290D5eE'; // Example address
/**
 * Checks for required environment variables.
 */
function checkEnvVariables() {
    if (!process.env.ADMIN_PRIVATE_KEY || !process.env.RPC_URL) {
        throw new Error("Missing required environment variables (ADMIN_PRIVATE_KEY or RPC_URL).");
    }
}

/**
 * Fetches current EIP-1559 gas prices with a buffer for reliability.
 * @param {ethers.JsonRpcProvider} provider The Ethers provider.
 * @returns {Promise<object>} An object with maxFeePerGas and maxPriorityFeePerGas.
 */
async function getGasOverrides(provider) {
    console.log("Fetching current network fee data...");
    const feeData = await provider.getFeeData();

    if (!feeData.maxFeePerGas || !feeData.maxPriorityFeePerGas) {
        throw new Error("Failed to fetch complete fee data from the provider.");
    }

    // Polygon Amoy often requires a minimum priority fee (~30 Gwei).
    // v6: Use ethers.parseUnits and native bigint for comparisons.
    const amoyMinPriorityFee = ethers.parseUnits("32", "gwei");
    let priorityFee = feeData.maxPriorityFeePerGas;

    if (priorityFee < amoyMinPriorityFee) {
        console.log(`Provider's priority fee is too low. Using floor of 32 Gwei.`);
        priorityFee = amoyMinPriorityFee;
    }

    // Add a 10% buffer using bigint math.
    const bufferedPriorityFee = (priorityFee * 110n) / 100n;
    const estimatedBaseFee = feeData.maxFeePerGas - feeData.maxPriorityFeePerGas;
    const newMaxFeePerGas = estimatedBaseFee + bufferedPriorityFee;

    const gasOverrides = {
        maxFeePerGas: newMaxFeePerGas,
        maxPriorityFeePerGas: bufferedPriorityFee,
    };

    console.log(`Calculated Gas (Gwei):`);
    // v6: Use ethers.formatUnits
    console.log(`  - Max Fee: ${ethers.formatUnits(gasOverrides.maxFeePerGas, "gwei")}`);
    console.log(`  - Priority Fee (Tip): ${ethers.formatUnits(gasOverrides.maxPriorityFeePerGas, "gwei")}`);

    return gasOverrides;
}

//Used
/**
 * Deploys a new IdentityProxy contract for a user.
 * @param {string} userAddress The user's wallet address.
 * @param {string} salt A unique salt for deterministic address generation.
 * @returns {Promise<string>} The address of the newly deployed identity contract.
 */
async function createIdentity(userAddress, salt) {
    try {
        checkEnvVariables();

        // v6: Initialize provider
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        // v6: Initialize wallet and connect it to the provider
        const adminWallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);

        const idFactory = new ethers.Contract(ID_FACTORY, ID_FACTORY_ABI.abi, adminWallet);
        const gasOverrides = await getGasOverrides(provider);

        // v6: Use ethers.keccak256 and ethers.AbiCoder
        const managementKey = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(['address'], ["0x0af700A3026adFddC10f7Aa8Ba2419e8503592f7"])
        );

        console.log(`Creating identity for ${userAddress} with management key...`);
        const tx = await idFactory.createIdentityWithManagementKeys(
            userAddress,
            salt,
            [managementKey],
            gasOverrides
        );

        const receipt = await tx.wait();
        console.log("Identity creation transaction successful:", receipt.hash);

        // v6: Event parsing requires using the contract interface on the receipt logs.
        let identityAddress;
        const factoryInterface = new ethers.Interface(ID_FACTORY_ABI.abi);
        for (const log of receipt.logs) {
            try {
                const parsedLog = factoryInterface.parseLog(log);
                if (parsedLog && parsedLog.name === 'WalletLinked') {
                    identityAddress = parsedLog.args.identity;
                    break;
                }
            } catch (e) {
                // Ignore logs that don't match the factory's interface
            }
        }

        if (!identityAddress) {
            throw new Error("Could not find the WalletLinked event in the transaction receipt.");
        }

        console.log(`Identity contract for ${userAddress} deployed at: ${identityAddress}`);
        await configureAndTransferIdentity(identityAddress, userAddress);

        return identityAddress;
    } catch (error) {
        console.error("Error creating user identity:", error);
        throw error;
    }
}

//used
/**
 * Configures a new identity by adding user keys and removing the admin key.
 * @param {string} identityAddress The address of the Identity contract.
 * @param {string} userAddress The user's wallet address.
 */
async function configureAndTransferIdentity(identityAddress, userAddress) {
    try {
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        const adminWallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
        const identityProxy = new ethers.Contract(identityAddress, IDENTITY_ABI.abi, adminWallet);

        const KEY_PURPOSE_MANAGEMENT = 1;
        const KEY_PURPOSE_CLAIM = 3;
        const KEY_TYPE_ECDSA = 1;

        const userKey = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(['address'], [userAddress])
        );

        // --- Step 1: Add the user as a MANAGER ---
        console.log(`Adding MANAGEMENT key for ${userAddress}...`);
        let gasOverrides = await getGasOverrides(provider);
        const tx1 = await identityProxy.addKey(userKey, KEY_PURPOSE_MANAGEMENT, KEY_TYPE_ECDSA, gasOverrides);
        await tx1.wait();
        console.log("User successfully added as a manager.");

        // --- Step 2: Add the user as a CLAIM SIGNER ---
        console.log(`Adding CLAIM_SIGNER key for ${userAddress}...`);
        gasOverrides = await getGasOverrides(provider); // Fetch fresh gas prices
        const tx2 = await identityProxy.addKey(userKey, KEY_PURPOSE_CLAIM, KEY_TYPE_ECDSA, gasOverrides);
        await tx2.wait();
        console.log("User successfully added as a claim signer.");

        // --- Step 3 (Optional but Recommended): Remove the admin as a manager ---
        // const adminKey = ethers.keccak256(
        //     ethers.AbiCoder.defaultAbiCoder().encode(['address'], [adminWallet.address])
        // );
        // console.log("Removing admin manager to complete the ownership transfer...");
        // gasOverrides = await getGasOverrides(provider); // Fetch fresh gas prices
        // const tx3 = await identityProxy.removeKey(adminKey, KEY_PURPOSE_MANAGEMENT, gasOverrides);
        // await tx3.wait();
        // console.log("Admin removed. Configuration and transfer complete.");

    } catch (error) {
        console.error("Error during identity configuration and transfer:", error);
        throw error;
    }
}

//used
async function issueKycClaimSignature(userAddress, onchainIDAddress, claimData, topic, countryCode = 91) {
    console.log(`  - Issuing KYC claim for user: ${userAddress}, onchainID: ${onchainIDAddress}`);
    try {
        // 1. Validate addresses
        if (!ethers.isAddress(userAddress)) {
            throw new Error('Invalid user address provided.');
        }
        if (!ethers.isAddress(onchainIDAddress)) {
            throw new Error('Invalid onchain ID address provided.');
        }

        // 2. Get issuer wallet
        const issuerPrivateKey = process.env.ADMIN_PRIVATE_KEY;
        if (!issuerPrivateKey) {
            throw new Error('Issuer private key (ADMIN_PRIVATE_KEY) not found in .env');
        }
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        const issuerWallet = new ethers.Wallet(issuerPrivateKey, provider);
        console.log(`  - Signing with issuer: ${issuerWallet.address}`);

        // 3. Prepare and hash the claim data
        const claimDataBytes = ethers.toUtf8Bytes(claimData);
        const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "bytes"],
            [onchainIDAddress, topic, claimDataBytes]
        );
        const dataHash = ethers.keccak256(encoded);

        // 4. Create the EIP-191 compliant "Ethereum Signed Message" hash
        const ethHash = ethers.hashMessage(ethers.getBytes(dataHash));
        console.log(`  - Final Hash to be Signed: ${ethHash}`);

        // 5. Sign the hash to get r, s, v components
        const signature = issuerWallet.signingKey.sign(ethHash);
        console.log(`  - Signature components generated (r, s, v)`);

        // 6. Register the identity in the registry (as per the TS logic)
        // Note: The original script did this in main(), this version does it here.
        console.log(`  - Registering identity as part of the issuance flow...`);
        // await whitelistAddress(userAddress, onchainIDAddress, countryCode);

        // 7. Return the structured response
        return {
            signature: {
                r: signature.r,
                s: signature.s,
                v: signature.v
            },
            issuerAddress: CLAIM_ISSUER_ADDRESS,
            dataHash,
            topic
        };
    } catch (error) {
        console.error(`❌ Failed to issue KYC claim signature: ${error.message}`);
        throw error; // Re-throw the error to be caught by the main execution block
    }
}

// async function grantClaimPermission(identityAddress, userAddress) {
//     console.log(`\n--- Granting CLAIM Permission ---`);
//     console.log(`  - Target Identity: ${identityAddress}`);
//     console.log(`  - User to Authorize: ${userAddress}`);

//     try {
//         // 1. Connect as the admin, who has management keys
//         const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
//         const adminWallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
//         const identityContract = new ethers.Contract(identityAddress, IDENTITY_ABI.abi, adminWallet);

//         // 2. Define the permission constants
//         const KEY_PURPOSE_CLAIM = 3;
//         const KEY_TYPE_ECDSA = 1;

//         // 3. Calculate the user's key hash, just like in the setup script
//         const userKey = ethers.keccak256(
//             ethers.AbiCoder.defaultAbiCoder().encode(['address'], [userAddress])
//         );
//         console.log(`  - User's Key Hash: ${userKey}`);

//         // 4. Call addKey() to grant the permission
//         console.log(`  - Sending transaction to add KEY_PURPOSE_CLAIM (3)...`);
//         const gasOverrides = await getGasOverrides(provider);
//         const tx = await identityContract.addKey(
//             userKey,
//             KEY_PURPOSE_CLAIM,
//             KEY_TYPE_ECDSA,
//             gasOverrides
//         );

//         await tx.wait();
//         console.log(`✅ Success! User ${userAddress} is now authorized to submit claims.`);

//     } catch (error) {
//         console.error("❌ Error granting claim permission:", error);
//         throw error;
//     }
// }

//used
/**
 * Simulates an issuer signing a claim for a user off-chain.
 * @param {string} identityAddress The user's identity contract address.
 * @param {number} topic The claim topic ID.
 * @returns {Promise<object>} An object with the signature and claim details.
 */
async function generateClaimSignature(userAddress, identityAddress, topic = 42) {
    console.log("  - (Compatibility Wrapper) Calling new issuance function...");

    // For compatibility, we assume the user address is the one from the test script.
    // In a real app, you would pass this in.

    const claimData = "KYC";

    // Call the new, primary function
    const result = await issueKycClaimSignature(userAddress, identityAddress, claimData, topic);

    // Serialize the {r, s, v} signature into a single hex string for the old submitClaim function
    const flatSignature = ethers.Signature.from(result.signature).serialized;
    console.log(`  - Serialized signature for contract: ${flatSignature}`);

    const claimDataBytes = ethers.toUtf8Bytes(claimData);

    console.log("  ✅ Claim data ", {
        topic: result.topic,
        scheme: 1, // 1 = ECDSA
        issuer: result.issuerAddress,
        signature: flatSignature,
        data: ethers.hexlify(claimDataBytes),
        uri: ""
    });

    // Return the object in the format the old `submitClaim` function expects
    return {
        topic: result.topic,
        scheme: 1, // 1 = ECDSA
        issuer: result.issuerAddress,
        signature: flatSignature,
        data: ethers.hexlify(claimDataBytes),
        uri: ""
    };
}

//used
async function checkIsClaimValid(identityAddress, claim, sig, dataHash) {
    // Basic validation of the claim structure
    try {
        console.log("\n--- Validating Claim ---");
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        const identityContract = new ethers.Contract(identityAddress, IDENTITY_ABI.abi, provider);
        const claimIssuer = await identityContract.isClaimValid(identityAddress, claim, sig, dataHash);
        console.log(`  - Claim validity check result: ${claimIssuer}`);
        return claimIssuer;
    } catch
    (error) {
        console.error("Error validating claim:", error);
        throw error;
    }
}

//used
/**
 * Simulates a user submitting a pre-signed claim to their own identity contract.
 * @param {string} identityAddress The user's identity contract address.
 * @param {ethers.Wallet} userWallet The user's wallet object.
 * @param {object} claimDetails The signed claim data from generateClaimSignature.
 */
async function submitClaim(identityAddress, userWallet, claimDetails) {
    checkEnvVariables();
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const connectedUserWallet = userWallet.connect(provider);
    const identityContract = new ethers.Contract(identityAddress, IDENTITY_ABI.abi, connectedUserWallet);
    
    await checkIsClaimValid(identityAddress, claimDetails.topic, claimDetails.signature, claimDetails.data);

    console.log("\n--- User Submitting Claim ---");
    try {
        console.log(`  - User (${userWallet.address}) calling addClaim() on their Identity contract...`);
        
        // Get the best price for gas
        const gasOverrides = await getGasOverrides(provider);

        // --- THE FINAL FIX ---
        // Increase the gas limit to a higher value to prevent out-of-gas errors.
        // 500,000 is a safe and robust limit for this complex transaction.
        gasOverrides.gasLimit = 500000;
        // ---------------------

        const tx = await identityContract.addClaim(
            claimDetails.topic,
            claimDetails.scheme,
            claimDetails.issuer,
            claimDetails.signature,
            claimDetails.data,
            claimDetails.uri,
            gasOverrides // Pass the object containing both price AND the higher limit
        );
        console.log(`  - Transaction sent. Hash: ${tx.hash}`);
        const receipt = await tx.wait(); // Wait for the transaction to be mined
        
        // Add a check for the receipt status
        if (receipt.status === 1) {
            console.log(`  ✅ KYC Claim successfully submitted on-chain!`);
        } else {
            console.error(`  ❌ Transaction failed! Receipt:`, receipt);
        }
        
    } catch (error) {
        console.error("Error submitting claim:", error);
        throw error;
    }
}
/**
 * Registers an identity in the IdentityRegistry.
 * @param {string} address The user's wallet address.
 * @param {string} identityAddress The user's identity contract address.
 * @param {number} country The user's country code.
 */
// async function whitelistAddress(address, identityAddress, country) {
//     console.log(`Registering identity for address: ${address}`);
//     try {
//         const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
//         const adminWallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
//         const idRegistry = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_REGISTRY_ABI.abi, adminWallet);

//         const gasOverrides = await getGasOverrides(provider);
//         const tx = await idRegistry.registerIdentity(address, identityAddress, country, gasOverrides);

//         console.log(`Transaction sent. Hash: ${tx.hash}`);
//         await tx.wait();
//         console.log(`✅ Address ${address} successfully registered.`);
//         return true;
//     } catch (error) {
//         console.error("Error registering address:", error);
//         throw error;
//     }
// }

// async function whitelistUser(userIdentityAddress) {
//     console.log("\n--- Whitelisting User on Compliance Contract ---");
//     try {
//         checkEnvVariables(); // Assumes this function exists from your previous script

//         // 1. Define the minimal ABI for the compliance contract
//         const COMPLIANCE_ABI = [
//             "function addUser(address identity) external"
//         ];

//         // 2. Connect as the admin wallet, which has agent permissions
//         const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
//         const adminWallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
//         const complianceContract = new ethers.Contract(COMPLIANCE_ADDRESS, COMPLIANCE_ABI, adminWallet);

//         console.log(`  - Compliance Contract: ${COMPLIANCE_ADDRESS}`);
//         console.log(`  - User's Identity to Add: ${userIdentityAddress}`);
//         console.log(`  - Transaction sent by Admin: ${adminWallet.address}`);

//         // 3. Call the addUser function
//         const gasOverrides = await getGasOverrides(provider); // Assumes this function exists
//         const tx = await complianceContract.addUser(userIdentityAddress, gasOverrides);

//         console.log(`  - Transaction sent. Hash: ${tx.hash}`);
//         await tx.wait();

//         console.log("\n✅ Success! User is now whitelisted.");
//         console.log("   They can now send, receive, and hold the ERC-3643 token.");

//         return true;

//     } catch (error) {
//         console.error("❌ Error whitelisting user:", error);
//         throw error;
//     }
// }


async function addComplianceAgent(complianceAddress = "0x711ad193a98f0cef86da4ad5312092772f39a869", agentAddress = "0x0af700A3026adFddC10f7Aa8Ba2419e8503592f7") {
    console.log("\n--- Step 3: Adding Admin as Compliance Agent (One-Time Setup) ---");
    try {
        const COMPLIANCE_ABI = ["function addAgent(address agent) external"];
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        const adminWallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
        const complianceContract = new ethers.Contract(complianceAddress, COMPLIANCE_ABI, adminWallet);
        
        console.log(`  - Granting Agent Role to: ${agentAddress} on contract ${complianceAddress}`);
        const gasOverrides = await getGasOverrides(provider);
        const tx = await complianceContract.addAgent(agentAddress, gasOverrides);
        await tx.wait();

        console.log("  - ✅ Success! Admin is now a compliance agent.");
        return true;
    } catch (error) {
        if (error.message.includes("is already an agent")) {
            console.log("  - ℹ️  Admin is already a compliance agent. Skipping.");
            return true;
        }
        console.error("  - ❌ Error adding compliance agent:", error.reason || error.message);
        throw error;
    }
}

/**
 * [STEP 4] Whitelists a user's Identity on the token's compliance contract.
 * This is the final step to allow a user to interact with an ERC-3643 token.
 */
// async function whitelistUser(COMPLIANCE_ADDRESS, UNCOMPROMISED_IDENTITY_ADDRESS) {
//     console.log("\n--- Step 4: Whitelisting User on Compliance Contract ---");
//     try {
//         const COMPLIANCE_ABI = ["function addUser(address identity) external"];
//         const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
//         const adminWallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
//         const complianceContract = new ethers.Contract(COMPLIANCE_ADDRESS, COMPLIANCE_ABI, adminWallet);
        
//         console.log(`  - User's Identity to Add: ${UNCOMPROMISED_IDENTITY_ADDRESS}`);
//         const gasOverrides = await getGasOverrides(provider);
//         const tx = await complianceContract.addUser(UNCOMPROMISED_IDENTITY_ADDRESS, gasOverrides);
//         await tx.wait();
        
//         console.log("  - ✅ Success! User is now whitelisted and can interact with the token.");
//         return true;
//     } catch (error) {
//          if (error.message.includes("is already a user")) {
//             console.log("  - ℹ️  User is already whitelisted. Skipping.");
//             return true;
//         }
//         console.error("  - ❌ Error whitelisting user:", error.reason || error.message);
//         throw error;
//     }
// }



// --- Example Usage ---
// async function main() {
//     // This is an example flow. Uncomment the parts you want to run.
//     try {
//         const userAddress = '0x85EBD6dC97d56F62e371382b38EAe91f3bb4ecb2';
//         const salt = 'yash' + Math.random().toString(); // Use a unique salt each time

//         // 1. Admin creates an identity for the user
//         const identityAddress = await createIdentity(userAddress, salt);

//         // 2. Issuer generates a signature for a KYC claim
//         const claimDetails = await generateClaimSignature(identityAddress, 42);

//         // 3. User submits the claim to their own identity contract
//         // NOTE: In a real app, the user's private key would be handled by their wallet (e.g., MetaMask).
//         // For this script, we define it directly. Replace with a real user's private key.
//         const userPrivateKey = '0x714517a8df4fa9b571e6c8bb3bda4c402f1747dc3d4e9d7da7bfc882028849e3';
//         const userWallet = new ethers.Wallet(userPrivateKey);
//         await submitClaim(identityAddress, userWallet, claimDetails);

//         // 4. Admin registers the identity in the registry
//         await whitelistAddress(userAddress, identityAddress, 826); // 826 = UK country code example

//     } catch (e) {
//         console.error("Main execution failed:", e);
//     }
// }

// To run the main flow:
// main();

// To run individual functions for testing:


// createIdentity('0x5f9B5DDe7A0b7588692501Fa07C70FA56ee9c430', 'yash11').catch(console.error);
// generateClaimSignature('0x5f9B5DDe7A0b7588692501Fa07C70FA56ee9c430',UNCOMPROMISED_IDENTITY_ADDRESS);


// submitClaim(UNCOMPROMISED_IDENTITY_ADDRESS, new ethers.Wallet('fb9bbe44182c19ddfc3a8ad89dfc86b9e4e18c91d40256af949fc6ffbef78b8a'),  {
//   topic: 42,
//   scheme: 1,
//   issuer: '0xd75849340fa68E19610791c398880D8a4a089096',
//   signature: '0x9ee5bf3489d0381abd6a00676fdb4d5dae0267048450b7c9a3406b0beac02b1311ad8b00d0ff78b74dc65604a2eae7ce0e53a8ba26d971a2e4b71e856f6d72c21b',
//   data: '0x4b5943',
//   uri: ''
// }).catch(console.error);

// addToIdentityRegistry('0x0af700A3026adFddC10f7Aa8Ba2419e8503592f7', UNCOMPROMISED_IDENTITY_ADDRESS, 91).catch(console.error);


//used
async function addToIdentityRegistry(userAddress, identityAddress, countryCode) {

    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const adminWallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
    const idRegistry = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_REGISTRY_ABI.abi, adminWallet);

    try {
    const gasOverrides = await getGasOverrides(provider);
    const tx = await idRegistry.registerIdentity(userAddress, identityAddress, countryCode, gasOverrides);

    console.log(`Transaction sent. Hash: ${tx.hash}`);
    await tx.wait();
    console.log(`✅ Address ${userAddress} successfully registered.`);
    return true;
    } catch (error) {
        console.error("Error registering address:", error);
        throw error;
    }

}

async function getIdentityForUser(userAddress) {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const idFactory = new ethers.Contract(ID_FACTORY, ID_FACTORY_ABI.abi, provider);
    try {
        const identityAddress = await idFactory.getIdentity(userAddress);
        console.log(`Fetched identity for user ${userAddress}: ${identityAddress}`);
        return identityAddress;
    } catch (error) {
        console.error("Error fetching identity for user:", error);
        throw error;
    }  
}



module.exports = {
 
    generateClaimSignature,
    createIdentity,
    addToIdentityRegistry,
    getIdentityForUser
};