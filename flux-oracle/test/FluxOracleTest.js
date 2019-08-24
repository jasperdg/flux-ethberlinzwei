const Web3 = require("web3");
const MarketOracleAbi = require("../build/contracts/MarketOracle").abi;
const YesNoMarketAbi = require("../build/contracts/YesNoMarket").abi;
const YesNoMarketBytecode = require("../build/contracts/YesNoMarket").bytecode;
const ERC20Abi = require("../build/contracts/ERC20").abi;
const FakeLinkAbi = require("../build/contracts/FakeLink").abi;
const FakeLinkBytecode = require("../build/contracts/FakeLink").bytecode;

// const feeWindowAbi = require("../build/contracts/FeeWindow").abi;
// const createAugurMarket = require("../utils/createAugurMarket");
const sendSignedTransaction = require("../utils/sendSignedTransaction")
const { fromWei, toWei,hexToNumberString ,toAscii,fromAscii ,hexToUtf8 ,toBN, asciiToHex } = require('web3-utils');
const {	PARITY_PORT, PARITY_PORT_WS, NUM_TICKS } = require("../constants");
const { COMPLETE_SETS, CASH, CLAIM_TRADING_PROCEEDS, AUGUR, UNIVERSE } = require("../constants")[0]
const {	PUB_KEY } = require("../.pvt");
const web3 = new Web3(`http://localhost:${PARITY_PORT}`);
const web3Ws = new Web3(`ws://localhost:${PARITY_PORT_WS}`);

const MarketOracleUtils = require('../utils/MarketOracleUtils');
const ChainLinkOperator = require("../utils/ChainLinkOperator");
const { getMarketCreationFee } = require("../utils/createAugurMarket");
const ReportingUtils = require("../utils/ReportingUtils");
const { getNoShowBondFee } = require("../utils/createAugurMarket");
const reportingUtils = new ReportingUtils(web3);

const oneEthInWei = toWei("1", "ether");
const inOneMinute = Math.round(new Date().getTime() + 60);

contract('MarketOracle', () => {
	let yesNoMarket;
	let marketOracle;
	let marketOracleWs;
	let chainLink;
	let chainLinkWs;
	let repToken;

	it('Reset augur timestamp to now', async () => {
		await reportingUtils.setTimestamp(toBN(Math.round(new Date().getTime() / 1000)));
	});

	it('is able to deploy the FakeLink contract', async () => {
		const nonce = await web3.eth.getTransactionCount(PUB_KEY);
		const data = new web3.eth.Contract(FakeLinkAbi).deploy({ data: FakeLinkBytecode, arguments: [] }).encodeABI();
		const { contractAddress } = await sendSignedTransaction(false, nonce, data, "0");
		assert(contractAddress);
		chainLink = new web3.eth.Contract(FakeLinkAbi, contractAddress);
		chainLinkWs = new web3Ws.eth.Contract(FakeLinkAbi, contractAddress);

	});
	
	it('is able to deploy a Market contract', async () => {
		const nonce = await web3.eth.getTransactionCount(PUB_KEY);
		const data = new web3.eth.Contract(YesNoMarketAbi).deploy({
			data: YesNoMarketBytecode,
			arguments: [
				"http://api.mathjs.org/v4/?expr=1%2B1",
				"",
				"Will 1 + 1 equal 2 by resolution?",
				asciiToHex("math"),
				inOneMinute,
				UNIVERSE,
				CASH,
				AUGUR,
				COMPLETE_SETS,
				chainLink.address
			]
		}).encodeABI();

		const { contractAddress } = await sendSignedTransaction(false, nonce, data, "0");
		yesNoMarket = new web3.eth.Contract(YesNoMarketAbi, contractAddress);
		const oracleAddress =  await yesNoMarket.methods.getOracle().call();
		marketOracle = new web3.eth.Contract(MarketOracleAbi, oracleAddress);
		marketOracleWs = new web3Ws.eth.Contract(MarketOracleAbi, oracleAddress);
	});

	it('Create ChainLink operator that listens for new data requests', async () => {
		const operator = new ChainLinkOperator(chainLinkWs, web3);
		operator.listenForRequests();
	});

	it('Fire new request from marketOracle', async () => {
		const nonce = await web3.eth.getTransactionCount(PUB_KEY);
		const data = marketOracle.methods.requestDataChainLink().encodeABI();
		await sendSignedTransaction(marketOracle.address, nonce, data, "0");
	});

	it('Waitfor the request to be fulfilled', async () => {
		const marketOracleUtils = new MarketOracleUtils(marketOracleWs, web3);
		await marketOracleUtils.waitMarketDataIsFulfilled();
	});

	it('Answer should be 2', async () => {
		const answer = await marketOracle.methods.getAnswer().call();
		assert.equal(hexToUtf8(answer), 1);
	});

	// it('Waits till market end', async () => {
	// 	await new Promise((resolve) => {
	// 		setTimeout(() => {
	// 			resolve();
	// 		}, 15000);
	// 	});
	// });

	it("Should be able to take positions in the markets", async () => {
		const nonce = await web3.eth.getTransactionCount(PUB_KEY);
		const data = yesNoMarket.methods.takePosition("0").encodeABI();
		await sendSignedTransaction(yesNoMarket.address, nonce, data, hexToNumberString(oneEthInWei));
		const nonceTwo = await web3.eth.getTransactionCount(PUB_KEY);
		const dataTwo = yesNoMarket.methods.takePosition("0").encodeABI();
		await sendSignedTransaction(yesNoMarket.address, nonceTwo, dataTwo, hexToNumberString(oneEthInWei));
	});

	it ("Should be able to create a contract instance of the current REP token", async () => {
		const repAddress = await marketOracle.methods.getRepToken().call();
		repToken = new web3.eth.Contract(ERC20Abi, repAddress);
	});

	it ("Should approve our marketOracle to transfer rep for us", async () => {
		const noShowBondFee = await getNoShowBondFee(0);
		const nonce = await web3.eth.getTransactionCount(PUB_KEY);
		const data = repToken.methods.approve(marketOracle.address, hexToNumberString(noShowBondFee)).encodeABI();
		await sendSignedTransaction(repToken.address, nonce, data, "0");
	});
	
	it("Should be able to dispute ChainLink's answer by creating an augur market and moving all open interest to said market", async () => {
		const data = yesNoMarket.methods.dispute(fromAscii("1")).encodeABI();
		const marketCreationFee = await getMarketCreationFee(0);
		const nonce = await web3.eth.getTransactionCount(PUB_KEY);
		const receipt = await sendSignedTransaction(yesNoMarket.address, nonce, data, hexToNumberString(marketCreationFee));
		assert.equal(receipt.status, true);
	});

	it('set timestamp to date and time where the market are going to be able to be finalized', async () => {
		const disputeEndTime = await marketOracle.methods.getDisputeEndTime().call();
		await reportingUtils.setTimestamp(toBN(disputeEndTime));
	});

	// it('finalizes the market', async () => {
	// 	const nonce = await web3.eth.getTransactionCount(PUB_KEY);
	// 	const data = yesNoMarket.methods.finalizeDispute().encodeABI();
	// 	await sendSignedTransaction(yesNoMarket.address, nonce, data, "0");
	// });

});
