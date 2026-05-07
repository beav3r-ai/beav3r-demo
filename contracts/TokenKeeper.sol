// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title TokenKeeper (demo)
/// @notice Holds tokens and allows approved executors to trigger transfers.
/// @dev Intended for demo environments only.
contract TokenKeeper {
    error NotOwner();
    error NotExecutor();
    error ZeroAddress();
    error TransferFailed();

    address public owner;
    mapping(address => bool) public isExecutor;

    event OwnerUpdated(address indexed previousOwner, address indexed newOwner);
    event ExecutorUpdated(address indexed executor, bool allowed);
    event KeeperTransfer(address indexed token, address indexed to, uint256 amount, address indexed executor);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyExecutor() {
        if (!isExecutor[msg.sender]) revert NotExecutor();
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
        emit OwnerUpdated(address(0), initialOwner);
    }

    function setOwner(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address previous = owner;
        owner = newOwner;
        emit OwnerUpdated(previous, newOwner);
    }

    function setExecutor(address executor, bool allowed) external onlyOwner {
        if (executor == address(0)) revert ZeroAddress();
        isExecutor[executor] = allowed;
        emit ExecutorUpdated(executor, allowed);
    }

    /// @notice Called by authorized executor to move tokens held by this contract.
    function transferToken(address token, address to, uint256 amount) external onlyExecutor {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        bool ok = IERC20(token).transfer(to, amount);
        if (!ok) revert TransferFailed();
        emit KeeperTransfer(token, to, amount, msg.sender);
    }
}

