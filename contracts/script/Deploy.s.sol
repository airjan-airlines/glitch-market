// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { GlitchMarket } from "../src/GlitchMarket.sol";

contract Deploy is Script {
    function run() external returns (GlitchMarket market) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        market = new GlitchMarket();
        vm.stopBroadcast();

        console.log("GlitchMarket deployed to:", address(market));
        console.log("chain id:", block.chainid);
        console.log("challenge window (s):", market.CHALLENGE_WINDOW());
        console.log("decay step (s):", market.DECAY_STEP());
    }
}
