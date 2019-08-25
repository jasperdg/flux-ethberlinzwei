pragma solidity >= 0.4.24;
pragma experimental ABIEncoderV2;

import "./YesNoMarket.sol";
import "./../libraries/augur/source/contracts/reporting/IMarket.sol";
import "./../libraries/augur/source/contracts/reporting/Market.sol";
import "./../libraries/augur/source/contracts/trading/IShareToken.sol";
import "./../libraries/augur/source/contracts/trading/CompleteSets.sol";
import "./../libraries/augur/source/contracts/trading/ICash.sol";
import "./../libraries/augur/source/contracts/libraries/token/ERC20.sol";
import "./../libraries/augur/source/contracts/reporting/Universe.sol";
import "./../libraries/augur/source/contracts/trading/ClaimTradingProceeds.sol";
import "./../libraries/augur/source/contracts/Augur.sol";
import "./../libraries/openzeppelin-solidity/SafeMathLib.sol";
import "chainlink/contracts/ChainlinkClient.sol";

contract MarketOracle is ChainlinkClient {
	address creator;
	
	string url;
	string path; 
	bytes32 jobId;
	address oracle; 

	bool disputed;
	bool finalized;
	bool isInvalid;
	bool disputeIsInvalid;
	uint256 endTime;
	uint256 disputeTimeAdded;
	bytes32 public answer;
	bytes32 disputeAnswer;
	IMarket disputeMarket;
	bytes32 public payoutDistributionHash;

	string marketDescription;
	bytes32 marketTopic;
	
	Augur constant augur = Augur({ENTER_ADDRESS_FROM_CORE});
	ICash constant cash = ICash({ENTER_ADDRESS_FROM_CORE});
	Universe constant universe = Universe({ENTER_ADDRESS_FROM_CORE});
	CompleteSets constant completeSets = CompleteSets({ENTER_ADDRESS_FROM_CORE});
	ClaimTradingProceeds constant claimTradingProceeds = ClaimTradingProceeds({ENTER_ADDRESS_FROM_CORE});

	uint256 constant NUM_TICKS = 10000;
	uint256 constant TEN_MINUTES = 60 * 10;
	uint256 constant ONE_DAY = 60 * 60 * 24;

	uint256[][] payoutNumerators = [[NUM_TICKS.div(2), NUM_TICKS.div(2)],[NUM_TICKS, 0],[0,NUM_TICKS]] ;

	event marketDisputed(address market);
	event dataIsFulfilled(bytes32 id, bytes32 data);

	constructor(
		string _url, 
		string _path,
		string _marketDescription,
		bytes32 _marketTopic,
		uint256 _endTime,
		address _link,
		bytes32 _jobId,
		address _oracle
	) 
	public {
		require (_endTime > now);
		creator = msg.sender;
		
		url = _url;
		path = _path;
		endTime = _endTime;
		marketDescription = _marketDescription;
		marketTopic = _marketTopic;
		oracle = _oracle;

		jobId = _jobId;
		uint256 timeToEnd = endTime.sub(now);
		uint256 potentialAddedDisputeTime = timeToEnd.div(30);
		if (potentialAddedDisputeTime >= TEN_MINUTES && potentialAddedDisputeTime <= ONE_DAY) {
			disputeTimeAdded = potentialAddedDisputeTime;
		} else if (potentialAddedDisputeTime < TEN_MINUTES) {
			disputeTimeAdded = TEN_MINUTES;
		} else if (potentialAddedDisputeTime > ONE_DAY) {
			disputeTimeAdded = ONE_DAY;
		}
      	
		setChainlinkToken(_link);
		cash.approve(address(augur), uint256(-1));
	}

	function () public payable {}

	function requestChainlinkUrl() public returns (bytes32 requestId) {
		Chainlink.Request memory req = buildChainlinkRequest(jobId, this, this.dataFulfilled.selector);
		req.add("get", url);
		req.add("path", path);
		sendChainlinkRequestTo(oracle, req, 0);
	}

	function dataFulfilled(bytes32 _requestId, bytes32 _answer)
	public recordChainlinkFulfillment(_requestId)
	{
		answer = _answer;
		emit dataIsFulfilled(_requestId, _answer);
	}

	function startDispute(
		bytes32 _correctAnswer,
		bool _invalid,
		address _disputer
	)
	public 
	payable	{
		require(msg.sender == address(creator));
		require(disputed == false);
		// require(now < endTime + disputeTimeAdded && now >= endTime);		

		// get noShowBond
		uint256 noShowBondFee = universe.getOrCacheDesignatedReportNoShowBond();
		ERC20 rep = ERC20(universe.getReputationToken());
		rep.transferFrom(_disputer, address(this), noShowBondFee);

		// check if marketCreationFee is added
		uint256 marketCreationFee = universe.getOrCacheValidityBond();
		require(msg.value >= marketCreationFee);

		// Create disputemarket
		disputeMarket = universe.createYesNoMarket.value(marketCreationFee)(
			endTime + disputeTimeAdded + 120,
			0,
			cash,
			address(this),
			marketTopic,
			marketDescription,
			""
		);

		uint256 setsToBuy = msg.value.sub(marketCreationFee).div(NUM_TICKS);
		require(setsToBuy > NUM_TICKS);
		completeSets.publicBuyCompleteSets.value(setsToBuy.mul(NUM_TICKS))(disputeMarket, setsToBuy);
		
		disputeAnswer = _correctAnswer;
		disputeIsInvalid = _invalid;
		disputed = true;
		emit marketDisputed(disputeMarket);
	}
	
	function calculateFees(uint256 proceeds) 
	public 
	returns(uint256) 
	{
		uint256 flatFee = disputeMarket.deriveMarketCreatorFeeAmount(proceeds);
		uint256 reportingFeeDevisor = universe.getOrCacheReportingFeeDivisor();
		flatFee = flatFee.add(proceeds.div(reportingFeeDevisor));
		return flatFee;
	}

	function submitInitialReport(uint256[] payoutNumerators) 
	public {
		require(answerToPayoutDistributionHash(disputeAnswer, disputeIsInvalid) == keccak256(payoutNumerators));
		Market(address(disputeMarket)).doInitialReport(payoutNumerators, disputeIsInvalid);
	}

	function answerToPayoutDistributionHash(bytes32 _answer, bool _invalid) 
	internal 
	returns(bytes32) {
		if (_invalid) {
			return keccak256([NUM_TICKS.div(2), NUM_TICKS.div(2)]);
		}
		else if (_answer == bytes32(2)) {
			return keccak256([0, NUM_TICKS]);
		} 
		else {
			return keccak256([NUM_TICKS, 0]);
		}
	}

	function finalize()
	public
	returns (bool) {
		require(now >= endTime);
		// If not testing the line below here should be uncommented
		// require(now >= endTime + disputeTimeAdded);
		if (!disputed) {
			finalized = true;
			payoutDistributionHash = answerToPayoutDistributionHash(answer, isInvalid);
		} else {
			finalized = true;
			require(!disputeMarket.isFinalized());
			disputeMarket.finalize();
		}
	}

	function getPayoutNumeratorByOutcome(uint256 _outcome)
	public
	view
	returns (uint256) {
		require(finalized == true);
		if (disputed) {
			return disputeMarket.getWinningPayoutNumerator(_outcome);
		} else {
			for (uint256 i = 0; i < payoutNumerators.length; i++) {
				if (keccak256(payoutNumerators[i]) == payoutDistributionHash) {
					return payoutNumerators[i][_outcome];
				}
			}
		}
	}

	function claimDisputeTradingProceeds()
	public {
		uint256 balanceBefore = address(this).balance;
		claimTradingProceeds.claimTradingProceeds(disputeMarket, address(this));
		uint256 balanceAfter = address(this).balance;
		creator.transfer(balanceAfter.sub(balanceBefore));
	}

	function isFinalized()
	public
	view 
	returns(bool) {
		return finalized;
	}

	function getDisputeMarketFinalizationTime()
	public
	view
	returns (uint256) {
		require(disputed == true);
		return disputeMarket.getFinalizationTime();
	}


	function getAnswer()
	public 
	view 
	returns(bytes32) {
		return answer;
	}

	function getRepToken()
	public 
	view
	returns (address) {
		return universe.getReputationToken();
	}

	function getDisputeEndTime()
	public
	view 
	returns (uint256) {
		require(disputed == true);
		return Market(address(disputeMarket)).getDesignatedReportingEndTime() + 1;
	}
	
	function getFeeWindow()
	public 
	view 
	returns(address) {
		require(disputed == true);
		return address(Market(address(disputeMarket)).getFeeWindow());
	}
}