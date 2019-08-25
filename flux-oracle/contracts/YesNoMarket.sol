pragma solidity >= 0.4.24;
pragma experimental ABIEncoderV2;

import "./../libraries/openzeppelin-solidity/SafeMathLib.sol";
import "./../libraries/augur/source/contracts/reporting/Universe.sol";
import "./MarketOracle.sol";

contract YesNoMarket {
	using SafeMathLib for uint256;
	uint256 endTime;
	bool disputed;
	MarketOracle oracle;
	uint256[] payoutNumerators;
	uint256 constant NUM_TICKS = 10000;
	mapping (address => mapping(uint256 => uint256)) balances;
	uint256 outcomes = 2; //cuz binary
	uint256 valueBeforeDispute;

	constructor(
		string _url, 
		string _path,
		string _marketDescription,
		bytes32 _marketTopic,
		uint256 _endTime,
		address _linkToken,
		bytes32 _jobId,
		address _oracle
	) public {
		endTime = _endTime;
		oracle = new MarketOracle(
			_url, 
			_path, 
			_marketDescription, 
			_marketTopic, 
			_endTime, 
			_linkToken,
			_jobId,
			_oracle
		);
	}

	function () public payable {}

	function takePosition(uint256 _outcome) 
	public
	payable {
		require (msg.value > NUM_TICKS);
		// require (now < endTime);
		balances[msg.sender][_outcome] = balances[msg.sender][_outcome].add(msg.value.div(NUM_TICKS));
	}

	function dispute(bytes32 _correctAnswer, bool _invalid)
	public
	payable {
		require(!disputed);
		oracle.startDispute.value(address(this).balance)(_correctAnswer, _invalid,msg.sender);
		disputed = true;
	}

	function getBalanceForOutcome(address _owner, uint256 _outcome)
	public 
	view 
	returns (uint256) {
		return balances[_owner][_outcome];
	}

	function finalize()
	public {
		oracle.finalize();
	}

	function getPayoutByOutcome(uint256 _outcome) 
	public 
	returns(uint256)
	{
		uint256 payoutMultiplier = oracle.getPayoutNumeratorByOutcome(_outcome);
		uint256 balanceInAttoWei = getBalanceForOutcome(msg.sender, _outcome);
		uint256 balance = balanceInAttoWei.mul(payoutMultiplier);
		return balance;
	}

	function getOracle()
	public 
	view 
	returns (address) {
		return oracle;
	}

	
}