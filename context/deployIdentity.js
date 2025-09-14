
const { ethers } = require('ethers');
const IdentityProxyABI = require('../abi/@onchain-id/solidity/contracts/proxy/IdentityProxy.sol/IdentityProxy.json');
const IdentityRegistry = require('../abi/registry/IdentityRegistry.sol/IdentityRegistry.json');

const IMPLEMENTATION_AUTHORITY = '0x22b1394F0b70513423747964B0A3352B1703Fffc';
const IDENTITY_REGISTRY = '0x7Eb85534067f0E123c85e60aBD8AF00EF642c361';

// Helper function to ensure environment variables are loaded
function checkEnvVariables() {
    if (!process.env.ADMIN_PRIVATE_KEY || !process.env.RPC_URL) {
        throw new Error("Missing required environment variables (ADMIN_PRIVATE_KEY or RPC_URL).");
    }
}

// Deploys a new IdentityProxy contract for a user.
async function deployIdentityProxy(userAddress) {
    console.log("Deploying Identity Proxy...");
    checkEnvVariables();
    
    try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
        const adminWallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);

        // --- AGGRESSIVE GAS FIX START ---
        // Fetch the legacy gas price, which is often more reliable on testnets.
        const gasPrice = await provider.getGasPrice();
        console.log(`[GAS] Fetched legacy gas price: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`);

        // Add a 50% buffer to the gas price to ensure it's high enough.
        const bufferedGasPrice = gasPrice.mul(150).div(100);
        console.log(`[GAS] Buffered gas price: ${ethers.utils.formatUnits(bufferedGasPrice, "gwei")} gwei`);

        // Create an overrides object. Forcing both maxFee and maxPriorityFee to the same
        // high value makes the transaction very likely to be included.
        const overrides = {
            maxFeePerGas: bufferedGasPrice,
            maxPriorityFeePerGas: bufferedGasPrice,
        };
        // --- AGGRESSIVE GAS FIX END ---
        
        const factory = new ethers.ContractFactory(
            IdentityProxyABI.abi,
            IdentityProxyABI.bytecode,
            adminWallet
        );

        // Pass the overrides object to the deploy function
        const identity = await factory.deploy(IMPLEMENTATION_AUTHORITY, userAddress, overrides);
        await identity.deployed();
        console.log(`Identity Proxy deployed at: ${identity.address}`);
        return identity; // Return the full contract object

    } catch (error) {
        console.error("🔴 [ERROR] An error occurred during Identity Proxy deployment:", error);
        throw error;
    }
}

// A wrapper function that calls deployIdentityProxy and returns the address.
async function identityProxy(userAddress) {
    console.log("Deploying Identity for user:", userAddress);
    try {
        const identityContract = await deployIdentityProxy(userAddress);
        console.log("✅ Identity Proxy deployed successfully.");
        return identityContract.address;

    } catch (error) {
        console.error(`🔴 [ERROR] Failed to complete the identityProxy process for user ${userAddress}:`, error);
        throw error;
    }
}

// Registers the newly created identity in the main registry.
async function registerIdentity(identityAddress, userAddress, countryCode) {
    console.log(`Registering identity at ${identityAddress} for user: ${userAddress}`);
    checkEnvVariables();

    try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
        const adminWallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
        const identityRegistry = new ethers.Contract(IDENTITY_REGISTRY, IdentityRegistry.abi, adminWallet);

        // --- AGGRESSIVE GAS FIX START ---
        const gasPrice = await provider.getGasPrice();
        console.log(`[GAS] Fetched legacy gas price for registration: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`);
        const bufferedGasPrice = gasPrice.mul(150).div(100);
         console.log(`[GAS] Buffered gas price for registration: ${ethers.utils.formatUnits(bufferedGasPrice, "gwei")} gwei`);

        const overrides = {
            maxFeePerGas: bufferedGasPrice,
            maxPriorityFeePerGas: bufferedGasPrice,
        };
        // --- AGGRESSIVE GAS FIX END ---

        // Pass the overrides object to the contract call
        const txResponse = await identityRegistry.registerIdentity(
            userAddress,
            identityAddress,
            countryCode,
            overrides
        );

        const txReceipt = await txResponse.wait();
        console.log(`✅ User identity registered with transaction: ${txReceipt.transactionHash}`);
        return txReceipt.transactionHash;

    } catch (error) {
        console.error(`🔴 [ERROR] Failed to register identity for ${userAddress}:`, error);
        throw error;
    }
}

// Checks if a user is verified in the identity registry.
async function identityStatus(userAddress) {
    console.log(`Checking identity status for ${userAddress}...`);
    checkEnvVariables();
    try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
        const identityRegistry = new ethers.Contract(IDENTITY_REGISTRY, IdentityRegistry.abi, provider);
        const isVerified = await identityRegistry.isVerified(userAddress);
        
        console.log(`Identity status for ${userAddress}: ${isVerified}`);
        return isVerified;

    } catch (error) {
        console.error(`🔴 [ERROR] Failed to retrieve identity status for ${userAddress}:`, error);
        throw error;
    }
}

module.exports = {
    identityProxy,
    registerIdentity,
    identityStatus
};
