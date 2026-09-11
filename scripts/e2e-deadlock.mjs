// Prove, on-chain, that a dispute raised by the ONLY buyer of a listing still resolves.
//
// This is the case the first deployment could not escape: the sole buyer disputes, and since the
// disputer may not rule on their own claim, the eligible juror pool is empty forever. Here the pool
// widens with the decay curve, and a timeout backstops it if nobody ever rules.
//
// Takes ~24 minutes, almost all of it waiting for real decay. Run: node scripts/e2e-deadlock.mjs

import "dotenv/config";
import { createPublicClient, createWalletClient, http, keccak256, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "node:fs";
import { encryptBlob, randomKey, toHex } from "../shared/crypto.js";
import { pinToIPFS } from "../shared/storage.js";
import { priceToSend, disputeBondFor } from "../shared/pricing.js";

const ABI = JSON.parse(readFileSync(new URL("../shared/abi.json", import.meta.url)));
const { address: ADDRESS, explorer } = JSON.parse(readFileSync(new URL("../deployments.json", import.meta.url)));
const RPC = process.env.BASE_SEPOLIA_RPC_URL;

const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STATE = ["None", "Escrowed", "Claimed", "Disputed", "RefundedToBuyer", "AwardedToSeller"];

const actor = (name, env) => {
  const account = privateKeyToAccount(process.env[env]);
  return { name, account, address: account.address, wallet: createWalletClient({ account, chain: baseSepolia, transport: http(RPC) }) };
};
const seller = actor("seller", "DEPLOYER_PRIVATE_KEY");
const alice = actor("alice", "BUYER_A_PRIVATE_KEY");
const stranger = actor("stranger", "BUYER_C_PRIVATE_KEY"); // never buys this listing

async function read(fn, args = [], tries = 6) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await pub.readContract({ address: ADDRESS, abi: ABI, functionName: fn, args }); }
    catch (e) { last = e; await sleep(700); }
  }
  throw last;
}
async function send(who, fn, args, value = 0n) {
  const { request } = await pub.simulateContract({ address: ADDRESS, abi: ABI, functionName: fn, args, value, account: who.account });
  const hash = await who.wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${fn} reverted`);
  for (let i = 0; i < 40 && (await pub.getBlockNumber()) < r.blockNumber; i++) await sleep(500);
  console.log(`      ${who.name} ${fn}() -> ${hash.slice(0, 12)}…`);
  return r;
}
const now = async () => (await pub.getBlock()).timestamp;
async function waitUntil(ts, what) {
  let left = Number(ts - (await now())) + 8;
  console.log(`      waiting ${left}s for ${what}…`);
  while (left > 0) { await sleep(20_000); left -= 20; if (left > 0) console.log(`        ${left}s`); }
}

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`      ${ok ? "OK  " : "FAIL"} ${label}: ${actual} (expected ${expected})`);
};

const step = (n, t) => console.log(`\n\x1b[1m[${n}] ${t}\x1b[0m`);

console.log("\x1b[1mDeadlock regression — Base Sepolia\x1b[0m");
console.log(`contract ${ADDRESS}\n`);

step(1, "Seller lists a glitch");
const key = randomKey();
const secret = new TextEncoder().encode(`SOLE-BUYER DEADLOCK REGRESSION\nrun ${Date.now()}\n`);
const ciphertext = await encryptBlob(secret, key);
const contentHash = keccak256(ciphertext);
const cid = await pinToIPFS(ciphertext, `deadlock-${Date.now()}.bin`, process.env.PINATA_JWT);
const initialPrice = parseEther("0.000002");
const minPrice = parseEther("0.0000002");
const stake = await read("requiredStake", [seller.address, initialPrice]);
const listingId = await read("listingCount");
await send(seller, "list", ["Celeste", "Any%", "Deadlock regression listing.", contentHash, cid, toHex(key), initialPrice, minPrice], stake);
console.log(`      listing #${listingId}, stake ${formatEther(stake)} ETH`);

step(2, "Alice buys — and is the ONLY buyer");
const l = await read("getListing", [listingId]);
await send(alice, "purchase", [listingId], priceToSend(
  { initialPrice: l.initialPrice, minPrice: l.minPrice, createdAt: l.createdAt, copiesSold: l.copiesSold }, await now()));
const pid = (await read("purchaseCount")) - 1n;
const p = await read("getPurchase", [pid]);
check("copies sold", (await read("getListing", [listingId])).copiesSold, 1n);

step(3, "Alice disputes — this is the configuration that used to freeze forever");
await send(alice, "dispute", [pid, keccak256(new TextEncoder().encode(`evidence||${p.nonce}`))], disputeBondFor(p.pricePaid));
check("state", STATE[Number((await read("getPurchase", [pid])).state)], "Disputed");
check("jury tier", await read("juryTier", [pid]), 0);
check("alice may vote on her own claim", await read("canVote", [pid, alice.address]), false);
check("a stranger may vote", await read("canVote", [pid, stranger.address]), false);

step(4, "Stage 1 — prior buyers only. The pool is EMPTY, which is the deadlock");
await waitUntil(await read("juryEligibleAt", [listingId]), "stage 1");
check("jury tier", await read("juryTier", [pid]), 1);
check("alice (sole buyer, disputer) may vote", await read("canVote", [pid, alice.address]), false);
check("stranger may vote at stage 1", await read("canVote", [pid, stranger.address]), false);
console.log("      -> nobody on earth can judge this dispute right now. The old contract stopped here.");

step(5, "Stage 2 — the pool opens to anyone, and the deadlock breaks");
await waitUntil(await read("openJuryAt", [listingId]), "stage 2");
check("jury tier", await read("juryTier", [pid]), 2);
check("stranger may now vote", await read("canVote", [pid, stranger.address]), true);
check("disputer still barred", await read("canVote", [pid, alice.address]), false);
check("seller still barred", await read("canVote", [pid, seller.address]), false);

step(6, "Stage 3 — nobody ruled, so the escrow defaults to the seller");
check("timeout ready yet", await read("timeoutReady", [pid]), false);
await waitUntil(await read("timeoutAt", [listingId]), "stage 3");
check("timeout ready", await read("timeoutReady", [pid]), true);

const aliceBefore = await pub.getBalance({ address: alice.address });
const sellerBefore = await pub.getBalance({ address: seller.address });
const sellerRepBefore = await read("reputation", [seller.address]);
const aliceRepBefore = await read("reputation", [alice.address]);
const bond = (await read("getPurchase", [pid])).disputeBond;
// Triggered by a third party, to show neither side can hold the escrow hostage.
await send(stranger, "forceResolve", [pid]);

const final = await read("getPurchase", [pid]);
check("state", STATE[Number(final.state)], "AwardedToSeller");
check("buyer bond returned", (await pub.getBalance({ address: alice.address })) - aliceBefore, bond);
check("seller paid", (await pub.getBalance({ address: seller.address })) - sellerBefore, final.pricePaid);
// A timeout is an absence of judgment, not a finding — neither side's reputation may move.
check("seller reputation unchanged", await read("reputation", [seller.address]), sellerRepBefore);
check("buyer reputation unchanged", await read("reputation", [alice.address]), aliceRepBefore);

step(7, "Seller's capital is no longer trapped");
await send(seller, "closeListing", [listingId]);
await send(seller, "withdrawStake", [listingId]);
check("stake released", (await read("getListing", [listingId])).stake, 0n);

console.log(`\n\x1b[1m${failures ? `${failures} CHECKS FAILED` : "DEADLOCK REGRESSION PASSED"}\x1b[0m`);
console.log(`listing #${listingId} — ${explorer}`);
process.exit(failures ? 1 : 0);
