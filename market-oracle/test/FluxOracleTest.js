const Web3 = require("web3");
const LinkTokenAbi = require("../build/contracts/Linktoken").abi;
const LinkTokenByteCode= require("../build/contracts/Linktoken").bytecode;
const OracleAbi = require("../build/contracts/Oracle").abi;
const OracleByteCode= require("../build/contracts/Oracle").bytecode;

const MarketOracleAbi = require("../build/contracts/MarketOracle").abi;
const YesNoMarketAbi = require("../build/contracts/YesNoMarket").abi;
const FeeWindowAbi = require("../build/contracts/FeeWindow").abi;
const YesNoMarketBytecode = require("../build/contracts/YesNoMarket").bytecode;
const ERC20Abi = require("../build/contracts/ERC20").abi;

const sendSignedTransaction = require("../utils/sendSignedTransaction")
const { toWei, hexToNumberString, fromAscii ,hexToUtf8 ,toBN, asciiToHex } = require('web3-utils');
const {	PARITY_PORT, PARITY_PORT_WS, NUM_TICKS } = require("../constants");
const { COMPLETE_SETS, CASH, CLAIM_TRADING_PROCEEDS, AUGUR, UNIVERSE } = require("../constants")[0]
const {	PUB_KEY } = require("../.pvt");
const web3 = new Web3(`http://localhost:${PARITY_PORT}`);
const web3Ws = new Web3(`ws://localhost:${PARITY_PORT_WS}`);

const MarketOracleUtils = require('../utils/MarketOracleUtils');
const ChainlinkOperator = require("../utils/ChainlinkOperator");
const { getMarketCreationFee } = require("../utils/createAugurMarket");
const ReportingUtils = require("../utils/ReportingUtils");
const { getNoShowBondFee } = require("../utils/createAugurMarket");
const reportingUtils = new ReportingUtils(web3);

const oneEthInWei = toWei("1", "ether");
const inOneMinute = Math.round(new Date().getTime() / 1000 + 30);

contract('MarketOracle', () => {
	let marketOracle;
	let marketOracleWs;
	let linkToken;
	let oracle;
	let oracleWs;
	let repToken;

	it('Resets augur timestamp to current date/time', async () => {
		await reportingUtils.setTimestamp(toBN(Math.round(new Date().getTime() / 1000)));
	});

	it('Deploy Chainlink Token', async () => {
		const nonce = await web3.eth.getTransactionCount(PUB_KEY);
		const data = new web3.eth.Contract(LinkTokenAbi).deploy({ data: LinkTokenByteCode, arguments: [] }).encodeABI();
		const { contractAddress } = await sendSignedTransaction(false, nonce, data, "0");
		assert(contractAddress);
		linkToken = new web3.eth.Contract(LinkTokenAbi, contractAddress);
	});

	it('Deploy Chainlink Oracle', async () => {
		const nonce = await web3.eth.getTransactionCount(PUB_KEY);
		const data = new web3.eth.Contract(OracleAbi).deploy({ data: OracleByteCode, arguments: [
			linkToken.address
		] }).encodeABI();
		const { contractAddress } = await sendSignedTransaction(false, nonce, data, "0");
		assert(contractAddress);
		oracle = new web3.eth.Contract(OracleAbi, contractAddress);
		oracleWs = new web3Ws.eth.Contract(OracleAbi, contractAddress);
	});
	
	
	it('Deploys YesNoMarket contract to local node', async () => {
		const nonce = await web3.eth.getTransactionCount(PUB_KEY);
		const data = new web3.eth.Contract(YesNoMarketAbi).deploy({
			data: YesNoMarketBytecode,
			arguments: [
				"http://api.mathjs.org/v4/?expr=1%2B1",
				"",
				"Will 1 + 1 equal 2 by resolution?",
				asciiToHex("math"),
				inOneMinute,
				linkToken.address,
				fromAscii("96bf1a27492142b095a8ada21631ebd0"),
				oracle.address
			]
		}).encodeABI();

		const { contractAddress } = await sendSignedTransaction(false, nonce, data, "0");
		yesNoMarket = new web3.eth.Contract(YesNoMarketAbi, contractAddress);
		const oracleAddress =  await yesNoMarket.methods.getOracle().call();
		marketOracle = new web3.eth.Contract(MarketOracleAbi, oracleAddress);
		marketOracleWs = new web3Ws.eth.Contract(MarketOracleAbi, oracleAddress);
	});

	it('Initialize new Chainlink operator that listens for query events', async () => {
		const operator = new ChainlinkOperator(oracleWs, web3);
		operator.listenForRequests();
	});

	it("Should be able to take positions in the markets", async () => {
		const nonce = await web3.eth.getTransactionCount(PUB_KEY);
		const data = yesNoMarket.methods.takePosition("0").encodeABI();
		await sendSignedTransaction(yesNoMarket.address, nonce, data, hexToNumberString(oneEthInWei));
		const nonceTwo = await web3.eth.getTransactionCount(PUB_KEY);
		const dataTwo = yesNoMarket.methods.takePosition("1").encodeABI();
		await sendSignedTransaction(yesNoMarket.address, nonceTwo, dataTwo, hexToNumberString(oneEthInWei));
	});

	it('Fire a new Chainlink query event through the Flux oracle bridge', async () => {
		const nonce = await web3.eth.getTransactionCount(PUB_KEY);
		const data = marketOracle.methods.requestChainlinkUrl().encodeABI();
		await sendSignedTransaction(marketOracle.address, nonce, data, "0");
	});

	it('Wait for the Chainlink to pickup the request and provide a (false) answer', async () => {
		const marketOracleUtils = new MarketOracleUtils(marketOracleWs, web3);
		await marketOracleUtils.waitMarketDataIsFulfilled();
	});

	it('Answer the Chainlink node provided was false', async () => {
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

	it('Set the Augur timestamp to a date/time where the dispute market has just ended', async () => {
		const disputeEndTime = await marketOracle.methods.getDisputeEndTime().call();
		await reportingUtils.setTimestamp(toBN(disputeEndTime).add(toBN(1)));
	});
	
	it('Commits initial report', async () => {
		const nonce = await web3.eth.getTransactionCount(PUB_KEY);
		const data = marketOracle.methods.submitInitialReport([NUM_TICKS, 0]).encodeABI();
		await sendSignedTransaction(marketOracle.address, nonce, data, "0");
	});

	it('changes timestamp to after reporting phase', async () => {
		const feeWindow = await marketOracle.methods.getFeeWindow().call();
		const feeWindowContract = new web3.eth.Contract(FeeWindowAbi, feeWindow);
		const feeWindowEndTime = await feeWindowContract.methods.getEndTime().call();
		await reportingUtils.setTimestamp(feeWindowEndTime.add(1));
	});
	
	it('finalizes the market', async () => {
		const nonce = await web3.eth.getTransactionCount(PUB_KEY);
		const data = marketOracle.methods.finalize().encodeABI();
		await sendSignedTransaction(marketOracle.address, nonce, data, "0");
	});

	it('sets timestamp three days and one second from when the market was finalized so that proceeds can be claimed', async () => {
		const threeDaysAndOneSecond = 60 * 60 * 24 * 3 + 1;
		const reportingEndTime = await marketOracle.methods.getDisputeMarketFinalizationTime.call();
		const setTime = await reportingUtils.setTimestamp(reportingEndTime.add(threeDaysAndOneSecond));
		assert.equal(setTime.status, true);
	});

	it('The oracle claims all proceeds from Augur and transfers them back to the market address', async () => {
		const nonce = await web3.eth.getTransactionCount(PUB_KEY);
		const data  = marketOracle.methods.claimDisputeTradingProceeds().encodeABI();
		await sendSignedTransaction(marketOracle.address, nonce, data, "0");
		const marketOracleBalance = await web3.eth.getBalance(marketOracle.address);
		const yesnoMarketBalance = await web3.eth.getBalance(yesNoMarket.address);
		assert.equal(marketOracleBalance, "0");
		assert.equal(yesnoMarketBalance, "1980000000000000000");
	});

	it('is able to claim earnings', async () => {
		const balanceBefore = await web3.eth.getBalance(PUB_KEY);
		const nonce = await web3.eth.getTransactionCount(PUB_KEY);
		const data = await yesNoMarket.methods.payout().encodeABI();
		await sendSignedTransaction(yesNoMarket.address, nonce, data, "0");
		const balanceAfter = await web3.eth.getBalance(PUB_KEY);
		
		assert.equal(toBN(balanceAfter).sub(toBN(balanceBefore)).toString(), "1980000000000000000");
	});


});
