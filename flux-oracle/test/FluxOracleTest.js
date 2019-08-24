const Web3 = require("web3");
const MarketOracleAbi = require("../build/contracts/MarketOracle").abi;
const YesNoMarketAbi = require("../build/contracts/YesNoMarket").abi;
const FeeWindowAbi = require("../build/contracts/FeeWindow").abi;
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
const inOneMinute = Math.round(new Date().getTime() / 1000 + 30);

contract('MarketOracle', () => {
	let yesNoMarket;
	let marketOracle;
	let marketOracleWs;
	let chainLink;
	let chainLinkWs;
	let repToken;

	it('Resets augur timestamp to current date/time', async () => {
		await reportingUtils.setTimestamp(toBN(Math.round(new Date().getTime() / 1000)));
	});

	it('Deploys ChainLink contracts to local node', async () => {
		const nonce = await web3.eth.getTransactionCount(PUB_KEY);
		const data = new web3.eth.Contract(FakeLinkAbi).deploy({ data: FakeLinkBytecode, arguments: [] }).encodeABI();
		const { contractAddress } = await sendSignedTransaction(false, nonce, data, "0");
		assert(contractAddress);
		chainLink = new web3.eth.Contract(FakeLinkAbi, contractAddress);
		chainLinkWs = new web3Ws.eth.Contract(FakeLinkAbi, contractAddress);

	});
	
	it('Deploys YesNoMarket contract ti local node', async () => {
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

	it('Initialize new ChainLink operator that listens for query events', async () => {
		const operator = new ChainLinkOperator(chainLinkWs, web3);
		operator.listenForRequests();
	});

	it("Should be able to take positions in the markets", async () => {
		const nonce = await web3.eth.getTransactionCount(PUB_KEY);
		const data = yesNoMarket.methods.takePosition("0").encodeABI();
		await sendSignedTransaction(yesNoMarket.address, nonce, data, hexToNumberString(oneEthInWei));
		const nonceTwo = await web3.eth.getTransactionCount(PUB_KEY);
		const dataTwo = yesNoMarket.methods.takePosition("0").encodeABI();
		await sendSignedTransaction(yesNoMarket.address, nonceTwo, dataTwo, hexToNumberString(oneEthInWei));
	});

	it('Fire a new ChainLink query event through the Flux oracle bridge', async () => {
		const nonce = await web3.eth.getTransactionCount(PUB_KEY);
		const data = marketOracle.methods.requestDataChainLink().encodeABI();
		await sendSignedTransaction(marketOracle.address, nonce, data, "0");
	});

	it('Wait for the ChainLink to pickup the request and provide a (false) answer', async () => {
		const marketOracleUtils = new MarketOracleUtils(marketOracleWs, web3);
		await marketOracleUtils.waitMarketDataIsFulfilled();
	});

	it('Answer the ChainLink node provided was false', async () => {
		const answer = await marketOracle.methods.getAnswer().call();
		assert.equal(hexToUtf8(answer), 1);
	});

	it ("Should be able to create a contract instance of the current REP token in preperation of a dispute", async () => {
		const repAddress = await marketOracle.methods.getRepToken().call();
		repToken = new web3.eth.Contract(ERC20Abi, repAddress);
	});

	it ("Should approve our the Flux oracle bridge to transfer Rep for our address", async () => {
		const noShowBondFee = await getNoShowBondFee(0);
		const nonce = await web3.eth.getTransactionCount(PUB_KEY);
		const data = repToken.methods.approve(marketOracle.address, hexToNumberString(noShowBondFee)).encodeABI();
		await sendSignedTransaction(repToken.address, nonce, data, "0");
	});
	
	it("Starts a dispute that creates an Augur market and transfers all open interest into this Augur market", async () => {
		const data = yesNoMarket.methods.dispute(fromAscii("2"), false).encodeABI();
		const marketCreationFee = await getMarketCreationFee(0);
		const nonce = await web3.eth.getTransactionCount(PUB_KEY);
		await sendSignedTransaction(yesNoMarket.address, nonce, data, hexToNumberString(marketCreationFee));
	});

	it('Set the Augur timestamp to a stamp where the dispute market has just ended', async () => {
		const disputeEndTime = await marketOracle.methods.getDisputeEndTime().call();
		await reportingUtils.setTimestamp(toBN(disputeEndTime).add(toBN(1)));
	});

	
	it('Commits initial report', async () => {
		const nonce = await web3.eth.getTransactionCount(PUB_KEY);
		const data = marketOracle.methods.submitInitialReport([NUM_TICKS, 0]).encodeABI();
		await sendSignedTransaction(marketOracle.address, nonce, data, "0");
	});

	it('changes timestamp to after reporting phase', async () => {
		const feeWindow = await marketOracle.methods.getFeeWindow();
		const feeWindowContract = new web3.eth.Contract(FeeWindowAbi, feeWindow);
		const feeWindowEndTime = await feeWindowContract.methods.getEndTime.call();
		// await reportingUtils.setTimestamp(feeWindowEndTime.add(1));
	});
	
	// it('finalizes the market', async () => {
	// 	const nonce = await web3.eth.getTransactionCount(PUB_KEY);
	// 	const data = yesNoMarket.methods.finalize().encodeABI();
	// 	await sendSignedTransaction(yesNoMarket.address, nonce, data, "0");
	// });

});
