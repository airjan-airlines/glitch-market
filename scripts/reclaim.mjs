// Recover the seller's capital from finished listings: claim any escrow whose challenge window has
// closed, then close the listing and withdraw the stake. Also exercises the happy-path claim.
import "dotenv/config";
import { createPublicClient, createWalletClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "node:fs";

const ABI = JSON.parse(readFileSync(new URL("../shared/abi.json", import.meta.url)));
const { address: ADDRESS } = JSON.parse(readFileSync(new URL("../deployments.json", import.meta.url)));
const RPC = process.env.BASE_SEPOLIA_RPC_URL;

const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (fn, args = []) => pub.readContract({ address: ADDRESS, abi: ABI, functionName: fn, args });

async function send(fn, args) {
  try {
    const { request } = await pub.simulateContract({ address: ADDRESS, abi: ABI, functionName: fn, args, account });
    const hash = await wallet.writeContract(request);
    const r = await pub.waitForTransactionReceipt({ hash });
    for (let i = 0; i < 40 && (await pub.getBlockNumber()) < r.blockNumber; i++) await sleep(500);
    console.log(`    ${fn}(${args}) ok`);
    return true;
  } catch (e) {
    console.log(`    ${fn}(${args}) skipped — ${(e.shortMessage || e.message).split("\n")[0]}`);
    return false;
  }
}

const before = await pub.getBalance({ address: account.address });
console.log(`seller ${account.address}\nbalance ${formatEther(before)} ETH\n`);

const n = Number(await read("listingCount"));
const CHALLENGE = await read("CHALLENGE_WINDOW");

for (let i = 0; i < n; i++) {
  const l = await read("getListing", [BigInt(i)]);
  if (l.seller.toLowerCase() !== account.address.toLowerCase()) continue;
  console.log(`listing #${i} — stake ${formatEther(l.stake)} ETH, active ${l.active}`);
  if (l.stake === 0n && !l.active) { console.log("    nothing to recover"); continue; }

  const pids = await read("purchasesOfListing", [BigInt(i)]);
  const now = (await pub.getBlock()).timestamp;
  for (const pid of pids) {
    const p = await read("getPurchase", [pid]);
    if (Number(p.state) === 1 && now >= p.purchasedAt + CHALLENGE) {
      console.log(`    claiming purchase #${pid} (${formatEther(p.pricePaid)} ETH)`);
      await send("claim", [pid]);
    }
  }
  if (l.active) await send("closeListing", [BigInt(i)]);
  if (l.stake > 0n) await send("withdrawStake", [BigInt(i)]);
}

const after = await pub.getBalance({ address: account.address });
console.log(`\nbalance ${formatEther(after)} ETH  (net ${formatEther(after - before)})`);
