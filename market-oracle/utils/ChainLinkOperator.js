const { fromAscii } = require('web3-utils');
const fetch = require('node-fetch');
const sendSignedTransaction = require('../utils/sendSignedTransaction');
const { PUB_KEY } = require('../.pvt');

class ChainlinkOperator {
	constructor(oracleInstance, web3Instance) {
		this.oracle = oracleInstance;
		this.web3 = web3Instance;
	}

	async listenForRequests() {
		const fromBlock = await this.web3.eth.getBlockNumber() - 10;
		this.oracle.events.OracleRequest({
			fromBlock
		}).on('data', async (event) => {
			const nonce = await web3.eth.getTransactionCount(PUB_KEY);
			const { payment, requestId, callbackAddr, callbackFunctionId, cancelExpiration, data } = event.returnValues;

			const returnData = fromAscii("1");
			const callData = this.oracle.methods.fulfillOracleRequest(
				requestId, 
				payment, 
				callbackAddr, 
				callbackFunctionId, 
				cancelExpiration, 
				returnData
			).encodeABI();
			await sendSignedTransaction(this.oracle.address, nonce, callData, "0");
		})
	}
}

module.exports = ChainlinkOperator;