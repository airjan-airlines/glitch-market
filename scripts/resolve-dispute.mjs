// Bring a frozen dispute to judgment using the demo buyer accounts.
//
// Jurors must be prior buyers of the same listing, so if BUYER_B / BUYER_C have not bought it yet
// this buys on their behalf first — that purchase is exactly what earns them standing to judge.
//
//   node scripts/resolve-dispute.mjs --purchase 4 --verdict buyer
//   node scripts/resolve-dispute.mjs --purchase 4 --verdict seller
//   node scripts/resolve-dispute.mjs --purchase 4 --verdict split

import "dotenv/config";
import { createPublicClient, createWalletClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "node:fs";
import { priceToSend } from "../shared/pricing.js";

const ABI = JSON.parse(readFileSync(new URL("../shared/abi.json", import.meta.url)));
const { address: ADDRESS } = JSON.parse(readFileSync(new URL("../deployments.json", import.meta.url)));
const RPC = process.env.BASE_SEPOLIA_RPC_URL;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const purchaseId = BigInt(arg("purchase", "4"));
const verdict = arg("verdict", "buyer");

const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (fn, args = []) => pub.readContract({ address: ADDRESS, abi: ABI, functionName: fn, args });
const STATE = ["None", "Escrowed", "Claimed", "Disputed", "RefundedToBuyer", "AwardedToSeller"];

const actor = (name, env) => {
  const account = privateKeyToAccount(process.env[env]);
  return { name, account, address: account.address, wallet: createWalletClient({ account, chain: baseSepolia, transport: http(RPC) }) };
};
const jurors = [actor("BUYER_B", "BUYER_B_PRIVATE_KEY"), actor("BUYER_C", "BUYER_C_PRIVATE_KEY")];

async function send(who, fn, args, value = 0n) {
  const { request } = await pub.simulateContract({ address: ADDRESS, abi: ABI, functionName: fn, args, value, account: who.account });
  const hash = await who.wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${fn} reverted`);
  for (let i = 0; i < 40 && (await pub.getBlockNumber()) < r.blockNumber; i++) await sleep(500);
  console.log(`    ${who.name} ${fn}() -> ${hash.slice(0, 14)}…`);
  return r;
}

const p0 = await read("getPurchase", [purchaseId]);
if (STATE[Number(p0.state)] !== "Disputed") {
  console.log(`purchase #${purchaseId} is ${STATE[Number(p0.state)]}, not Disputed — nothing to resolve.`);
  process.exit(0);
}
const listingId = p0.listingId;
const l0 = await read("getListing", [listingId]);

console.log(`dispute on purchase #${purchaseId} (listing #${listingId} — ${l0.game} ${l0.category})`);
console.log(`  disputer ${p0.buyer}`);
console.log(`  frozen   ${formatEther(p0.pricePaid)} ETH + bond ${formatEther(p0.disputeBond)} ETH`);
console.log(`  stake    ${formatEther(l0.stake)} ETH slashable`);
console.log(`  verdict  ${verdict}\n`);

if (!(await read("juryEligible", [purchaseId]))) {
  const at = await read("juryEligibleAt", [listingId]);
  const now = (await pub.getBlock()).timestamp;
  console.log(`not judgeable yet — the decay gate opens in ${Number(at - now)}s. Re-run then.`);
  process.exit(1);
}

// Standing first: a juror who has not bought this listing cannot vote on it.
console.log("establishing juror standing");
for (const j of jurors) {
  if (await read("hasPurchased", [listingId, j.address])) {
    console.log(`    ${j.name} already bought listing #${listingId}`);
    continue;
  }
  const l = await read("getListing", [listingId]);
  const now = (await pub.getBlock()).timestamp;
  const value = priceToSend({ initialPrice: l.initialPrice, minPrice: l.minPrice, createdAt: l.createdAt, copiesSold: l.copiesSold }, now);
  console.log(`    ${j.name} buying listing #${listingId} for ${formatEther(value)} ETH to become eligible`);
  await send(j, "purchase", [listingId], value);
}

const votes = verdict === "split" ? [true, false] : [verdict === "buyer", verdict === "buyer"];
console.log("\ncasting votes");
for (let i = 0; i < jurors.length; i++) {
  const j = jurors[i];
  if (await read("hasVoted", [purchaseId, j.address])) {
    console.log(`    ${j.name} already voted`);
    continue;
  }
  await send(j, "vote", [purchaseId, votes[i]]);
  const mid = await read("getPurchase", [purchaseId]);
  console.log(`      tally ${mid.votesForBuyer} buyer / ${mid.votesForSeller} seller — ${STATE[Number(mid.state)]}`);
}

const p1 = await read("getPurchase", [purchaseId]);
const l1 = await read("getListing", [listingId]);
console.log(`\nresult: ${STATE[Number(p1.state)]}`);
console.log(`  seller stake  ${formatEther(l0.stake)} -> ${formatEther(l1.stake)} ETH`);
console.log(`  listing live  ${l0.active} -> ${l1.active}`);
console.log(`  reputation    seller ${await read("reputation", [l1.seller])}, disputer ${await read("reputation", [p1.buyer])}`);
for (const j of jurors) console.log(`                ${j.name} ${await read("reputation", [j.address])}`);
console.log(`\ndisputer balance now ${formatEther(await pub.getBalance({ address: p1.buyer }))} ETH`);
