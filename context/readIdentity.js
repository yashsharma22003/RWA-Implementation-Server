
const { ethers } = require('ethers');
// Make sure the path to your IdentityRegistry ABI is correct
const IdentityRegistryABI = require('../../../abi/registry/IdentityRegistry.sol/IdentityRegistry.json');
const dotenv = require('dotenv');
dotenv.config(); // Load environment variables from .env file

// --- Configuration ---
const RPC_URL = process.env.RPC_URL;
const IDENTITY_REGISTRY_ADDRESS = '0x7Eb85534067f0E123c85e60aBD8AF00EF642c361';

console.log(`Using RPC URL: ${RPC_URL}`);

if (!RPC_URL) {
  throw new Error("Missing required environment variable: RPC_URL.");
}

// --- Helper Function to create a read-only contract instance ---
function getIdentityRegistryContract() {
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  return new ethers.Contract(IDENTITY_REGISTRY_ADDRESS, IdentityRegistryABI.abi, provider);
}

/**
 * Checks if a user is verified according to the registry's logic.
 * @param {string} userAddress The address of the user to check.
 * @returns {Promise<boolean>} A promise that resolves to a boolean indicating the verification status.
 */
async function isUserVerified(userAddress) {
  console.log(`Checking verification status for user: ${userAddress}`);
  try {
    const contract = getIdentityRegistryContract();
    const status = await contract.isVerified(userAddress);
    console.log(`✅ Verification status for ${userAddress}: ${status}`);
    return status;
  } catch (error) {
    console.error(`🔴 [ERROR] Failed to check verification status for ${userAddress}:`, error);
    throw error;
  }
}

/**
 * Fetches the registered country code for a given user.
 * @param {string} userAddress The address of the user.
 * @returns {Promise<number>} A promise that resolves to the user's country code (uint16).
 */
async function getInvestorCountry(userAddress) {
  console.log(`Fetching country for user: ${userAddress}`);
  try {
    const contract = getIdentityRegistryContract();
    const countryCode = await contract.investorCountry(userAddress);
    console.log(`✅ Country for ${userAddress}: ${countryCode}`);
    return countryCode;
  } catch (error) {
    console.error(`🔴 [ERROR] Failed to get country for ${userAddress}:`, error);
    throw error;
  }
}

/**
 * Checks if a user address has an identity registered.
 * @param {string} userAddress The address to check.
 * @returns {Promise<boolean>} A promise that resolves to a boolean.
 */
async function isUserInRegistry(userAddress) {
  console.log(`Checking if user is in registry: ${userAddress}`);
  try {
    const contract = getIdentityRegistryContract();
    const result = await contract.contains(userAddress);
    console.log(`✅ User ${userAddress} in registry: ${result}`);
    return result;
  } catch (error) {
    console.error(`🔴 [ERROR] Failed to check if user ${userAddress} is in registry:`, error);
    throw error;
  }
}

/**
 * Fetches the registered Identity contract address for a given user.
 * @param {string} userAddress The address of the user to check.
 * @returns {Promise<string>} A promise that resolves to the address of the user's Identity contract.
 */
async function getIdentityForUser(userAddress) {
  console.log(`Fetching identity for user: ${userAddress}`);
  try {
    const contract = getIdentityRegistryContract();
    const identityAddress = await contract.identity(userAddress);
    console.log(`✅ Identity for ${userAddress}: ${identityAddress}`);
    return identityAddress;
  } catch (error) {
    console.error(`🔴 [ERROR] Failed to get identity for ${userAddress}:`, error);
    throw error;
  }
}

/**
 * Fetches the address of the associated ClaimIssuersRegistry contract.
 * @returns {Promise<string>} A promise that resolves to the address of the issuers registry.
 */
async function getIssuersRegistryAddress() {
  console.log(`Fetching Issuers Registry address...`);
  try {
    const contract = getIdentityRegistryContract();
    const address = await contract.issuersRegistry();
    console.log(`✅ Issuers Registry address: ${address}`);
    return address;
  } catch (error) {
    console.error(`🔴 [ERROR] Failed to get Issuers Registry address:`, error);
    throw error;
  }
}

/**
 * Fetches the address of the associated ClaimTopicsRegistry contract.
 * @returns {Promise<string>} A promise that resolves to the address of the topics registry.
 */
async function getTopicsRegistryAddress() {
  console.log(`Fetching Topics Registry address...`);
  try {
    const contract = getIdentityRegistryContract();
    const address = await contract.topicsRegistry();
    console.log(`✅ Topics Registry address: ${address}`);
    return address;
  } catch (error) {
    console.error(`🔴 [ERROR] Failed to get Topics Registry address:`, error);
    throw error;
  }
}

/**
 * Fetches the address of the associated IdentityRegistryStorage contract.
 * @returns {Promise<string>} A promise that resolves to the address of the identity storage contract.
 */
async function getIdentityStorageAddress() {
  console.log(`Fetching Identity Storage address...`);
  try {
    const contract = getIdentityRegistryContract();
    const address = await contract.identityStorage();
    console.log(`✅ Identity Storage address: ${address}`);
    return address;
  } catch (error) {
    console.error(`🔴 [ERROR] Failed to get Identity Storage address:`, error);
    throw error;
  }
}

module.exports = {
  isUserVerified,
  getInvestorCountry,
  isUserInRegistry,
  getIdentityForUser,
  getIssuersRegistryAddress,
  getTopicsRegistryAddress,
  getIdentityStorageAddress,
};
