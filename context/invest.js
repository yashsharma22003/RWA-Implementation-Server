require('dotenv').config();
const { ethers } = require('ethers');
const IToken = require('../abi/token/IToken.sol/IToken.json');


function checkEnvVariables() {
    if (!process.env.ADMIN_PRIVATE_KEY || !process.env.RPC_URL) {
        throw new Error("Missing required environment variables (ADMIN_PRIVATE_KEY or RPC_URL).");
    }
}

async function mintTokens(to, amount, tokenAddress) {
    try{
        checkEnvVariables();
    console.log("Minting", amount, "tokens to", to, "on contract", tokenAddress = "0x3eaC25f463ed170fC79EfD629A0BD93f9336A016");
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
    console.log("rpc", process.env.RPC_URL);
    console.log("wallet", wallet.address);
    const tokenContract = new ethers.Contract(tokenAddress, IToken.abi, wallet);
    const tx = await tokenContract.mint(to, amount);
    await tx.wait();
    console.log("Minted tokens, transaction hash:", tx.hash);
    return tx.hash;
    } catch (error) {
        console.error("Error minting tokens:", error);
        throw error;
    }
    return tx.hash;

}

module.exports = { mintTokens };