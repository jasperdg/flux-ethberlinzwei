pragma solidity ^0.4.22;

import './Controlled.sol';
import './libraries/Initializable.sol';
import './libraries/ITyped.sol';


contract ITime is Controlled, ITyped {
    function getTimestamp() external view returns (uint256);
}
