const { fromAscii } = require('web3-utils');
const fetch = require('node-fetch');
const sendSignedTransaction = require('../utils/sendSignedTransaction');
const { PUB_KEY } = require('../.pvt');

class ChainLinkOperator {
	constructor(chainLinkInstance, web3Instance) {
		this.chainLink = chainLinkInstance;
		this.web3 = web3Instance;
	}
	
	async listenForRequests() {
		const fromBlock = await this.web3.eth.getBlockNumber() - 10;
		this.chainLink.events.newRequest({
			fromBlock
		}).on('data', async (event) => {
			const nonce = await web3.eth.getTransactionCount(PUB_KEY);
			const { id, url, path } = event.returnValues;
			// const result = await fetch(url);
			// const json = await result.json();
			const data = this.chainLink.methods.answerAPIData(id, fromAscii("1"), false).encodeABI();
			const { receipt } = await sendSignedTransaction(this.chainLink.address, nonce, data, "0");
		})
	}
}

module.exports = ChainLinkOperator;