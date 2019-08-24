class MarketOracleUtils {
	constructor(marketOracleInstance, web3Instance) {
		this.marketOracle = marketOracleInstance;
		this.web3 = web3Instance;
	}

	waitMarketDataIsFulfilled () {
		return new Promise(async (resolve, reject) => {
			const fromBlock = await this.web3.eth.getBlockNumber() - 10;
			this.marketOracle.events.dataIsFulfilled({
				fromBlock
			}).once('data', (data) => {
				resolve(data);
			});
		});
	} 
}

module.exports = MarketOracleUtils;