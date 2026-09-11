import { createConfig, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import abi from "@shared/abi.json";
import deployment from "@deployments";

export const CONTRACT = { address: deployment.address, abi };
export const CHAIN = baseSepolia;
export const EXPLORER = "https://sepolia.basescan.org";
export const DEPLOYMENT = deployment;

// The public Base Sepolia RPC, deliberately: a keyed endpoint would have to ship its key inside
// this bundle. Reads here are light and the app never needs eth_getLogs.
export const wagmiConfig = createConfig({
  chains: [baseSepolia],
  connectors: [injected()],
  transports: { [baseSepolia.id]: http("https://sepolia.base.org") },
});

export const PINATA_JWT = import.meta.env.VITE_PINATA_JWT;

export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
export const txUrl = (h) => `${EXPLORER}/tx/${h}`;
export const addrUrl = (a) => `${EXPLORER}/address/${a}`;
