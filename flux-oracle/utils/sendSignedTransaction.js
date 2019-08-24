const Tx = require("ethereumjs-tx");
const Web3 = require('web3');
const transactionMinedAsync = require('./transactionMinedAsync');
const { 
	toHex,
} = require("web3-utils");


const {	PARITY_PORT } = require("../constants.js");
const { PVT_KEY } = require("../.pvt");

const web3 = new Web3(`http://localhost:${PARITY_PORT}`);

const sendSignedTransaction = (to, nonce, data, value) => new Promise( async (resolve, reject) => {
	const privateKey = Buffer.from(PVT_KEY, "hex");
	const gasPrice = toHex("1");
	const gasLimit = toHex("7500000");
	
	let rawTx = {
		nonce: toHex(nonce),
		gasPrice,
		gasLimit,
		value: toHex(value),
		data
	}

	if (to) rawTx.to = to;

	const tx = new Tx(rawTx);
	tx.sign(privateKey);

	const serializedTx = tx.serialize();

	web3.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'))
	.on('transactionHash', async (hash) => {	
		const receipt = await transactionMinedAsync(hash);
		resolve(receipt);
	})
});

module.exports = sendSignedTransaction;