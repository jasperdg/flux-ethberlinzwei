pragma solidity >= 0.4.22;
pragma experimental ABIEncoderV2;

import "./../libraries/openzeppelin-solidity/SafeMathLib.sol";
 
contract FakeLink {
	using SafeMathLib for uint256;
	
	uint public nonce = 0;
	
	event newRequest(bytes32 id, string url, string path);
	
	struct Request {
		address requestContract;
		bytes4 callbackFunctionSelector;
		string url;
		string path;
	}

	mapping(bytes32 => Request) requests;

	function requestAPIData(string _url, string _path, bytes4 _callbackFunctionSelector) 
	public
	returns (bytes32) {
		bytes32 requestId = keccak256(_url, _path, nonce);
		requests[requestId] = Request(msg.sender, _callbackFunctionSelector, _url, _path);
		nonce++;
		emit newRequest(requestId, _url, _path);
		return requestId;
	}

	function answerAPIData(bytes32 _requestId, bytes32 _answer, bool _invalid)
	public
	returns (bool) {
		Request request = requests[_requestId];
		return request.requestContract.call(request.callbackFunctionSelector, _requestId, _answer, _invalid);
	}
}