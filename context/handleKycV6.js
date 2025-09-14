// Load environment variables from a .env file
require('dotenv').config();
// Import the ethers v6 library
const { ethers } = require('ethers');

// NOTE: Ensure your ABIs are compatible and compiled with a recent Solidity version.
const ID_FACTORY_ABI = require('../out/IIdFactory.sol/IIdFactory.json');
const IDENTITY_ABI = require('../out/Identity.sol/Identity.json');
const IDENTITY_REGISTRY_ABI = require('../out/IdentityRegistry.sol/IdentityRegistry.json');

// Contract addresses (remain unchanged)
const ID_FACTORY = '0x39992CCEAEDB0fa8f4fd3f2FBC5134707635B371';
const IDENTITY_REGISTRY = '0x7Eb85534067f0E123c85e60aBD8AF00EF642c361';

// Helper function to ensure environment variables are loaded
function checkEnvVariables() {
    if (!process.env.ADMIN_PRIVATE_KEY || !process.env.RPC_URL) {
        throw new Error("Missing required environment variables (ADMIN_PRIVATE_KEY or RPC_URL).");
    }
}

/**
 * Fetches current gas prices and returns a robust EIP-1559 compliant overrides object.
 * @param {ethers.JsonRpcProvider} provider The Ethers provider to query for fee data.
 * @returns {Promise<object>} An object containing valid maxFeePerGas and maxPriorityFeePerGas as BigInts.
 */
async function getGasOverrides(provider) {
    console.log("Fetching current network fee data...");
    const feeData = await provider.getFeeData();

    if (!feeData.maxFeePerGas || !feeData.maxPriorityFeePerGas) {
        throw new Error("Failed to fetch complete fee data from the provider.");
    }

    // --- FIX: SET A MINIMUM FLOOR FOR THE PRIORITY FEE ---
    // Ethers v6 uses native BigInt. Use the 'n' suffix for BigInt literals.
    const amoyMinPriorityFee = ethers.parseUnits("32", "gwei"); // 32 Gwei as a safe minimum

    let priorityFee = feeData.maxPriorityFeePerGas;

    // v6 CHANGE: Use standard comparison operators (<, >, ===) with BigInts instead of .lt(), .gt()
    if (priorityFee < amoyMinPriorityFee) {
        console.log(`Provider's priority fee is too low. Using floor of 32 Gwei.`);
        priorityFee = amoyMinPriorityFee;
    }
    // --------------------------------------------------------

    // v6 CHANGE: Use standard arithmetic operators with BigInts.
    // Note: Ensure at least one value in the operation is a BigInt (using 'n').
    const bufferedPriorityFee = (priorityFee * 110n) / 100n;

    const estimatedBaseFee = feeData.maxFeePerGas - feeData.maxPriorityFeePerGas;
    const newMaxFeePerGas = estimatedBaseFee + bufferedPriorityFee;

    const gasOverrides = {
        maxFeePerGas: newMaxFeePerGas,
        maxPriorityFeePerGas: bufferedPriorityFee,
    };

    console.log(`Calculated Gas (Gwei):`);
    // v6 CHANGE: `formatUnits` is now a top-level export, not under `utils`.
    console.log(`  - Max Fee: ${ethers.formatUnits(gasOverrides.maxFeePerGas, "gwei")}`);
    console.log(`  - Priority Fee (Tip): ${ethers.formatUnits(gasOverrides.maxPriorityFeePerGas, "gwei")}`);

    return gasOverrides;
}


// Deploys a new IdentityProxy contract for a user.
async function createIdentity(userAddress, salt) {
    try {
        checkEnvVariables();

        // v6 CHANGE: Classes like JsonRpcProvider are instantiated directly from 'ethers'.
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        const adminWallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);

        // v6 CHANGE: Contract instantiation is also direct.
        const idFactory = new ethers.Contract(ID_FACTORY, ID_FACTORY_ABI.abi, adminWallet);

        const gasOverrides = await getGasOverrides(provider);

        // --- Create the Identity with the user as the sole Management Key ---
        // v6 CHANGE: `keccak256` and `AbiCoder` are now top-level.
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

        // v6 CHANGE: Event parsing is different. You must use an Interface to parse raw logs.
        const idRegistryInterface = new ethers.Interface(IDENTITY_REGISTRY_ABI.abi);
        const walletLinkedLog = receipt.logs.find(log => {
            try {
                const parsedLog = idRegistryInterface.parseLog(log);
                return parsedLog && parsedLog.name === 'WalletLinked';
            } catch (e) {
                // Not the event we are looking for
                return false;
            }
        });

        if (!walletLinkedLog) {
            throw new Error("Could not find the WalletLinked event in the transaction receipt.");
        }

        const parsedEvent = idRegistryInterface.parseLog(walletLinkedLog);
        const identityAddress = parsedEvent.args.identity;
        console.log(`Identity contract for ${userAddress} deployed at: ${identityAddress}`);

        await configureAndTransferIdentity(identityAddress, userAddress);
        console.log(`Identity contract configured and ownership transferred to user.`);

        return identityAddress;

    } catch (error) {
        console.error("Error creating user identity:", error);
        throw error;
    }
}

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

        console.log(`Adding MANAGEMENT key for ${userAddress}...`);
        const gasOverrides = await getGasOverrides(provider);

        const tx1 = await identityProxy.addKey(
            userKey,
            KEY_PURPOSE_MANAGEMENT,
            KEY_TYPE_ECDSA,
            gasOverrides
        );
        await tx1.wait();
        console.log("User successfully added as a manager.");

        console.log(`Adding CLAIM_SIGNER key for ${userAddress}...`);
        // It's good practice to fetch fresh gas prices for each transaction
        const gasOverrides2 = await getGasOverrides(provider);
        const tx2 = await identityProxy.addKey(
            userKey,
            KEY_PURPOSE_CLAIM,
            KEY_TYPE_ECDSA,
            gasOverrides2
        );
        await tx2.wait();
        console.log("User successfully added as a claim signer.");

    } catch (error) {
        console.error("Error during identity configuration and transfer:", error);
        throw error;
    }
}

/**
 * Simulates the ISSUER'S off-chain action of signing a claim for a user.
 * @param {string} identityAddress The user's identity contract address.
 * @param {number} topic The claim topic number.
 * @param {string} claimDataString The data for the claim (e.g., "KYC").
 * @returns {Promise<object>} An object containing the signature and claim details.
 */
async function generateClaimSignature(identityAddress, topic = 42, claimDataString = "KYC") {
    console.log("\n--- Issuer Generating Claim Signature ---");
    const issuerWallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY);
    console.log(`  - Signing claim with issuer wallet: ${issuerWallet.address}`);

    try {
        const claimDataBytes = ethers.toUtf8Bytes(claimDataString);

        // Encode the claim data exactly as the smart contract expects for hashing
        const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "bytes"],
            [identityAddress, topic, claimDataBytes]
        );

        // Hash the encoded data to create the final digest to be signed
        const dataHash = ethers.keccak256(encoded);

        // `signMessage` correctly applies the "\x19Ethereum Signed Message:\n32" prefix
        // before signing, which is what `ecrecover` expects.
        const signature = await issuerWallet.signMessage(ethers.getBytes(dataHash));

        console.log(`  - Issuer (${issuerWallet.address}) signed claim for identity ${identityAddress}`);
        console.log(`  - Signature: ${signature}`);

        return {
            topic: topic,
            scheme: 1, // 1 = ECDSA
            issuer: issuerWallet.address,
            signature: signature, // The complete, joined signature string
            data: ethers.hexlify(claimDataBytes),
            uri: ""
        };
    } catch (error) {
        console.error("Error generating claim signature:", error);
        throw error;
    }
}

/**
 * Simulates the USER'S on-chain action of submitting their signed claim.
 * @param {string} identityAddress The user's ONCHAINID contract address.
 * @param {ethers.Wallet} userWallet The user's wallet.
 * @param {object} claimDetails The claim data object from generateClaimSignature.
 */
async function submitClaim(identityAddress, userWallet, claimDetails) {
    checkEnvVariables();
    // Connect the user's wallet to a provider
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const userWalletWithProvider = userWallet.connect(provider);
    const identityContract = new ethers.Contract(identityAddress, IDENTITY_ABI.abi, userWalletWithProvider);

    try {
        // ... [Permission check logic remains largely the same]
    } catch (error) {
        console.error("  ❌ Error during permission check/grant step:", error);
        return;
    }

    console.log("\n--- User Submitting Claim ---");
    try {
        console.log("  - Verifying signature with on-chain view call before sending transaction...");

        // Recreate the exact same hash that was signed.
        const dataHash = ethers.solidityPackedKeccak256(
            ['address', 'uint256', 'bytes'],
            [identityAddress, claimDetails.topic, claimDetails.data]
        );

        // Ask the contract to recover the address from the signature and hash.
        const recoveredAddress = await identityContract.getRecoveredAddress(
            claimDetails.signature,
            dataHash,
        );

        console.log(`    - Expected Issuer:    ${claimDetails.issuer}`);
        console.log(`    - On-chain Recovered: ${recoveredAddress}`);

        if (recoveredAddress.toLowerCase() !== claimDetails.issuer.toLowerCase()) {
            throw new Error("Signature verification failed! Recovered address does not match issuer.");
        }
        console.log("    ✅ Signature is valid.");

    } catch (e) {
        console.error("  - Error during pre-flight signature verification check:", e);
        return; // Stop if verification fails
    }

    try {
        console.log(`  - User (${userWallet.address}) calling addClaim() on their Identity contract...`);
        const gasOverrides = await getGasOverrides(provider);
        const tx = await identityContract.addClaim(
            claimDetails.topic,
            claimDetails.scheme,
            claimDetails.issuer,
            claimDetails.signature,
            claimDetails.data,
            claimDetails.uri,
            gasOverrides
        );
        console.log(`  - Transaction sent. Hash: ${tx.hash}`);
        await tx.wait();
        console.log(`  ✅ KYC Claim successfully submitted on-chain.`);
    } catch (error) {
        console.error("Error submitting claim:", error);
        throw error;
    }
}

async function whitelistAddress(address, identityAddress, country) {
    console.log(`Whitelisting address: ${address}`);
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
    const gasOverrides = await getGasOverrides(provider);

    try {
        const idRegistry = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_REGISTRY_ABI.abi, wallet);
        // FIX: Added await to the contract call
        const tx = await idRegistry.registerIdentity(address, identityAddress, country, gasOverrides);
        console.log(`Transaction sent. Hash: ${tx.hash}`);
        await tx.wait();
        console.log("Whitelisting successful.");
    } catch (error) {
        console.error("Error whitelisting address:", error);
        throw error;
    }
    return true;
}

// Example test call using the new v6 syntax
console.log("rpc url", process.env.RPC_URL);
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const userWallet = new ethers.Wallet('714517a8df4fa9b571e6c8bb3bda4c402f1747dc3d4e9d7da7bfc882028849e3', provider);

submitClaim("0xDe9Fda56D152aBe11Aa64aeb5eAbC1eA8049A2eb", userWallet, {
    "topic": 42,
    "scheme": 1,
    "issuer": "0x0af700A3026adFddC10f7Aa8Ba2419e8503592f7",
    "signature": "0xc85e792695b1022bf40d839d42e0e83ccf17eff7564872503e6a86e2a41933d65f24c6adb249435535c139829fb8e4891d63be81b8eb5a48184b84c2ed2286671b",
    "data": "0x", // Assuming empty data for this claim
    "uri": ""
}).catch(console.error);


module.exports = {
    getGasOverrides,
    whitelistAddress,
    submitClaim,
    generateClaimSignature,
    createIdentity
};