// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title DemoUSDT
/// @notice Minimal 6-decimal USDT-style token for test/demo use.
contract DemoUSDT is ERC20, Ownable {
    constructor(address initialOwner, address initialRecipient, uint256 initialAmount)
        ERC20("Demo USDT", "USDT")
        Ownable(initialOwner)
    {
        require(initialRecipient != address(0), "recipient=0");
        _mint(initialRecipient, initialAmount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "to=0");
        _mint(to, amount);
    }
}
