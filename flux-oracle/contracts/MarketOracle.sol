pragma solidity >= 0.4.22;
pragma experimental ABIEncoderV2;

import "./YesNoMarket.sol";
import "./../libraries/augur/source/contracts/reporting/IMarket.sol";
import "./../libraries/augur/source/contracts/trading/IShareToken.sol";
import "./../libraries/augur/source/contracts/trading/CompleteSets.sol";
import "./../libraries/augur/source/contracts/trading/ICash.sol";
import "./../libraries/augur/source/contracts/reporting/Universe.sol";
import "./../libraries/augur/source/contracts/trading/ClaimTradingProceeds.sol";
import "./../libraries/augur/source/contracts/Augur.sol";
import "./FakeLink.sol";
import "./../libraries/openzeppelin-solidity/SafeMathLib.sol";
 
contract MarketOracle {
	using SafeMathLib for uint256;
	string url;
	string path; 
	string marketDescription;
	bytes32 marketTopic;
	bool disputed;
	bool resoluted;
	bool isInvalid;
	uint256 endTime;
	uint256 disputeTimeAdded;
	uint256 TEN_MINUTES = 60 * 10;
	uint256 ONE_DAY = 60 * 60 * 24;
	address creator;
	bytes32 chainLinkRequestId;
	bytes32 public answer;
	FakeLink chainLink;
	Universe universe;
	ICash cash;
	IMarket disputeMarket;
	bytes32 disputeAnswer;
	uint256[] payoutDistribution;
	CompleteSets completeSets;
	event marketDisputed(address market);
	event dataIsFulfilled(bytes32 id, bytes32 data);

	constructor(
		string _url, 
		string _path,
		address _chainLink,
		string _marketDescription,
		bytes32 _marketTopic,
		uint256 _endTime,
		address _universe,
		address _cash,
		address _augur,
		address _completeSets
	) 
	public {
		require (_endTime > now);

		creator = msg.sender;
		
		url = _url;
		path = _path;
		chainLink = FakeLink(_chainLink);

		endTime = _endTime;
		marketDescription = _marketDescription;
		marketTopic = _marketTopic;
		cash = ICash(_cash);
		universe = Universe(_universe);
		completeSets = CompleteSets(_completeSets);

		uint256 timeToEnd = endTime.sub(now);
		uint256 potentialAddedDisputeTime = timeToEnd.div(30);
		if (potentialAddedDisputeTime >= TEN_MINUTES && potentialAddedDisputeTime <= ONE_DAY) {
			disputeTimeAdded = potentialAddedDisputeTime;
		} else if (potentialAddedDisputeTime < TEN_MINUTES) {
			disputeTimeAdded = TEN_MINUTES;
		} else if (potentialAddedDisputeTime > ONE_DAY) {
			disputeTimeAdded = ONE_DAY;
		}

		cash.approve(_augur, uint256(-1));
	}

	function requestDataChainLink() 
	public 
	returns (bytes32)
	{
		// require(now >= endTime);
		chainLinkRequestId = chainLink.requestAPIData(url, path, this.dataFulfilled.selector);
		return chainLinkRequestId;
	}

	function dataFulfilled(bytes32 _requestId, bytes32 _data, bool _invalid)
	public
	returns (bytes32)
	{
		require(msg.sender == address(chainLink));
		require(_requestId == chainLinkRequestId);
		emit dataIsFulfilled(_requestId, _data);
		answer = _data;
		isInvalid = _invalid;
		return _data;
	}

	function startDispute(
		bytes32 _correctAnswer
	)
	public 
	payable	{
		// require(msg.value == creator.balance);
		// require(disputed == false);
		// require(now < endTime + disputeTimeAdded && now >= endTime);		
		// Need a crowdsourced amount of DAI/REP.
		uint256 marketCreationFee = universe.getOrCacheValidityBond();
		require(msg.value >= marketCreationFee);

		disputeAnswer = _correctAnswer;
		disputed = true;
		
		emit marketDisputed(disputeMarket);

		
		// Should transfer all open interest from Flux -> Augur
	}

	function finalizeDisputeMarket()
	public 
	returns (bool) {
		return disputeMarket.finalize();
	}

	function getAnswer()
	public 
	view 
	returns(bytes32) {
		return answer;
	}

	function answerToPayoutDistribution() public view {
		if (isInvalid) {
			payoutDistribution = [500, 500];
		}
		else if (answer == bytes32(2)) {
			payoutDistribution = [0, 1000];
		} 
		else {
			payoutDistribution = [1000, 0];
		}
	}

	function resolute()
	public
	view
	returns (bool) {
		require(now >= endTime + disputeTimeAdded);
		if (!disputed) {
			resoluted = true;
			answerToPayoutDistribution();
		} else {
			require(!disputeMarket.isFinalized());
			disputeMarket.finalize();
		}
	}
}