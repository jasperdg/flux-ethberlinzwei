pragma solidity >= 0.4.22;
pragma experimental ABIEncoderV2;

import "./../libraries/openzeppelin-solidity/SafeMathLib.sol";
import "./../libraries/augur/source/contracts/reporting/Universe.sol";
import "./MarketOracle.sol";

contract YesNoMarket {
	using SafeMathLib for uint256;
	uint256 endTime;
	bool disputed;
	Universe universe;
	MarketOracle oracle;
	uint256[] payoutNumerators;
	uint256 constant NUM_TICKS = 10000;
	mapping (address => mapping(int24 => uint256)) balances;

	constructor(
		string _url, 
		string _path,
		string _marketDescription,
		bytes32 _marketTopic,
		uint256 _endTime,
		address _universe,
		address _cash,
		address _augur,
		address _completeSets,
		address _claimTradingProceeds,
		address _chainLink
	) public {
		endTime = _endTime;
		universe = Universe(_universe);
		oracle = new MarketOracle(
			_url, 
			_path, 
			_chainLink,
			_marketDescription, 
			_marketTopic, 
			_endTime, 
			_universe, 
			_cash, 
			_augur,
			_completeSets,
			_claimTradingProceeds
		);
	}

	function () public payable {}

	function takePosition(int24 _position) 
	public
	payable {
		require (msg.value > NUM_TICKS);
		// require (now < endTime);
		balances[msg.sender][_position] = balances[msg.sender][_position].add(msg.value.div(NUM_TICKS));
	}

	function dispute(bytes32 _correctAnswer, bool _invalid)
	public
	payable {
		require(!disputed);
		uint256 marketCreationFee = universe.getOrCacheValidityBond();
		require(msg.value >= marketCreationFee);
		oracle.startDispute.value(address(this).balance)(_correctAnswer, _invalid,msg.sender);
		disputed = true;
	}

	function finalize()
	public
	view {
		require(disputed);
		oracle.finalize();
	}

	function getOracle()
	public 
	view 
	returns (address) {
		return oracle;
	}

	
}