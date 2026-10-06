// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract QmsCounter {
    uint256 public count;
    event Incremented(address indexed caller, uint256 count);

    function increment() external {
        count += 1;
        emit Incremented(msg.sender, count);
    }
}
