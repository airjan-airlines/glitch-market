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

// Pinata credentials are deliberately NOT baked into the public build.
//
// This page is served from GitHub Pages, so anything compiled in is world-readable, and an upload
// JWT in the bundle would let anyone write to the account. Selling therefore asks for a JWT once
// and keeps it in this browser only. Local dev picks it up from the repo-root .env instead.
const BUILD_JWT = import.meta.env.VITE_PINATA_JWT || "";

export function getPinataJwt() {
  if (BUILD_JWT) return BUILD_JWT;
  try {
    return localStorage.getItem("bbb.pinata.jwt") || "";
  } catch {
    return "";
  }
}

export function setPinataJwt(v) {
  try {
    localStorage.setItem("bbb.pinata.jwt", v.trim());
  } catch { /* private window: the value just stays in memory for this session */ }
}

export const JWT_IS_BUILTIN = !!BUILD_JWT;

export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
export const txUrl = (h) => `${EXPLORER}/tx/${h}`;
export const addrUrl = (a) => `${EXPLORER}/address/${a}`;
