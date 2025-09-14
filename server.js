
require('dotenv').config();

const express = require('express');
const cors = require('cors'); // Import the cors package
// const { identityProxy, registerIdentity, identityStatus } = require('./context/deployIdentity');
// const { getIdentityForUser } = require('./context/readIdentity');
const {
    generateClaimSignature,
    createIdentity,
addToIdentityRegistry,
getIdentityForUser,
handleGetKYCSignature  } = require('./context/handleKyc');
const { randomBytes } = require('crypto');
const { mintTokens } = require('./context/invest');


const app = express();
const port = process.env.PORT || 3001;

app.use(cors());


app.use(express.json());

// --- API Endpoints ---

/**
 * @route POST /deploy
 * @desc Deploys an IdentityProxy contract for a given user address.
 * @body { "userAddress": "0x..." }
 * @returns { "address": "0x..." } or an error message.
 */
app.post('/deploy', async (req, res) => {
    const { userAddress } = req.body;
    if (!userAddress) {
        return res.status(400).json({ error: 'userAddress is required in the request body.' });
    }

    try {
        const deployedAddress = await createIdentity(userAddress, userAddress.slice(0,3) + randomBytes(4).toString());
        res.status(201).json({ address: deployedAddress });
    } catch (error) {
        res.status(500).json({ error: 'Failed to deploy identity proxy.', details: error.message });
    }
});

/**
 * @route POST /register
 * @desc Registers a deployed identity in the main registry.
 * @body { "userAddress": "0x...", "identityAddress": "0x...", "countryCode": "US" }
 * @returns { "transactionHash": "0x..." } or an error message.
 */
app.post('/signature', async (req, res) => {
    const { userAddress, identityAddress } = req.body;
    if (!userAddress || !identityAddress ) {
        return res.status(400).json({ error: 'userAddress, identityAddress, and countryCode are required.' });
    }

    try {
        console.log("Generating signature for:", userAddress, identityAddress);
        const signature = await generateClaimSignature(userAddress, identityAddress);
        res.status(200).json( signature );
    } catch (error) {
        console.error("Error generating signature:", error);
        res.status(500).json({ error: 'Failed to register identity.', details: error.message });
    }
});

app.post('/register', async (req, res) => {
    const { userAddress, identityAddress, countryCode } = req.body;
    if (!userAddress || !identityAddress || !countryCode) {
        return res.status(400).json({ error: 'userAddress, identityAddress, and countryCode are required.' });
    }
    try {
        const txHash = await addToIdentityRegistry(userAddress, identityAddress, countryCode);
        res.status(200).json({ transactionHash: txHash });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to register identity.', details: error.message });
    }
});

app.post('/invest', async (req, res) => {
    const { to, amount, tokenAddress } = req.body;
    if (!to || !amount || !tokenAddress) {
        return res.status(400).json({ error: 'to, amount, and tokenAddress are required.' });
    }
    try {
        const txHash = await mintTokens(to, amount, tokenAddress);
        console.log("Transaction hash in server:", txHash);
        res.status(200).json({ transactionHash: txHash });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to mint tokens.', details: error.message });
    }  
});

/**
 * @route GET /identity/:userAddress
 * @desc Fetches the registered identity address for a user.
 * @param {string} userAddress - The user's wallet address in the URL path.
 * @returns { "identityAddress": "0x..." } or an error message.
 */
app.get('/identity/:userAddress', async (req, res) => {
    const { userAddress } = req.params;
    if (!userAddress) {
        return res.status(400).json({ error: 'userAddress is required in the URL path.' });
    }

    try {
        const identityAddress = await getIdentityForUser(userAddress);
        res.status(200).json({ identityAddress });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get identity for user.', details: error.message });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`✅ Server is running on http://localhost:${port}`);
});
