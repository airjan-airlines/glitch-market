// Full end-to-end exercise of GlitchMarket against the live Base Sepolia deployment.
//
// Proves, on-chain and against real IPFS:
//   list (encrypted + pinned + hash committed) -> buy -> decrypt -> price decays ->
//   dispute freezes escrow -> decay gate opens -> two prior buyers converge -> funds move.
//
// Run: npm run e2e            (full dispute path, ~5 min of real waiting)
//      npm run e2e -- --happy (happy path only, ~4 min)

import "dotenv/config";
import { createPublicClient, createWalletClient, http, keccak256, formatEther, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "node:fs";

import { encryptBlob, decryptBlob, randomKey, toHex, fromHex } from "../shared/crypto.js";
import { pinToIPFS, fetchFromIPFS } from "../shared/storage.js";
import { currentPrice, priceToSend, juryEligibleAt, disputeBondFor, PurchaseState } from "../shared/pricing.js";

const ABI = JSON.parse(readFileSync(new URL("../shared/abi.json", import.meta.url)));
const DEPLOY = JSON.parse(readFileSync(new URL("../deployments.json", import.meta.url)));
const ADDRESS = DEPLOY.address;
const HAPPY_ONLY = process.argv.includes("--happy");

const RPC = process.env.BASE_SEPOLIA_RPC_URL;
const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });

const actor = (name, pkEnv) => {
  const account = privateKeyToAccount(process.env[pkEnv]);
  return {
    name,
    account,
    address: account.address,
    wallet: createWalletClient({ account, chain: baseSepolia, transport: http(RPC) }),
  };
};

const seller = actor("seller", "DEPLOYER_PRIVATE_KEY");
const alice = actor("alice", "BUYER_A_PRIVATE_KEY");
const bob = actor("bob", "BUYER_B_PRIVATE_KEY");
const carol = actor("carol", "BUYER_C_PRIVATE_KEY");

const log = (...a) => console.log(...a);
const step = (n, t) => log(`\n\x1b[1m[${n}] ${t}\x1b[0m`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const eth = (w) => `${formatEther(w)} ETH`;

async function send(who, fn, args, value = 0n) {
  const { request } = await pub.simulateContract({
    address: ADDRESS, abi: ABI, functionName: fn, args, value, account: who.account,
  });
  const hash = await who.wallet.writeContract(request);
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== "success") throw new Error(`${fn} reverted (${hash})`);
  // A receipt does not mean every RPC node behind the load balancer has applied the block yet.
  // Without this, the very next eth_call can read pre-transaction state.
  await waitForBlock(rcpt.blockNumber);
  log(`      ${who.name} ${fn}() -> ${hash.slice(0, 12)}...  gas ${rcpt.gasUsed}`);
  return rcpt;
}

async function waitForBlock(target) {
  for (let i = 0; i < 40; i++) {
    if ((await pub.getBlockNumber()) >= target) return;
    await sleep(500);
  }
}

/// Reads retry: a load-balanced RPC can briefly serve a node that lags the chain head.
async function read(fn, args = [], tries = 6) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await pub.readContract({ address: ADDRESS, abi: ABI, functionName: fn, args });
    } catch (e) {
      last = e;
      await sleep(750);
    }
  }
  throw last;
}
const chainNow = async () => (await pub.getBlock()).timestamp;

async function main() {
  log(`\x1b[1mGlitchMarket E2E — Base Sepolia\x1b[0m`);
  log(`contract ${ADDRESS}`);
  log(`mode     ${HAPPY_ONLY ? "happy path only" : "full dispute path"}`);
  for (const a of [seller, alice, bob, carol]) {
    log(`  ${a.name.padEnd(7)} ${a.address}  ${eth(await pub.getBalance({ address: a.address }))}`);
  }

  // ---------------------------------------------------------------- list
  step(1, "Seller encrypts the glitch, pins it to IPFS, commits the hash on-chain");
  const secret = new TextEncoder().encode(
    `CELESTE — ANY% — CORNER-BOOST SKIP (Chapter 3)\n\n` +
      `On the second screen, dash diagonally into the corner on the exact frame the\n` +
      `spinner resets, then neutral-jump. The hitbox lets you clip the wall and skip\n` +
      `the whole B-side room. Saves roughly 4.2 seconds.\n\n` +
      `Timing: frame 14 after the spinner's second rotation.\n` +
      `Run ID: ${Date.now()}\n`
  );
  const key = randomKey();
  const ciphertext = await encryptBlob(secret, key);
  const contentHash = keccak256(ciphertext);
  log(`      plaintext  ${secret.length} bytes`);
  log(`      ciphertext ${ciphertext.length} bytes (AES-256-GCM)`);
  log(`      contentHash ${contentHash}`);

  const cid = await pinToIPFS(ciphertext, `glitch-${Date.now()}.bin`, process.env.PINATA_JWT);
  log(`      pinned to IPFS: ${cid}`);

  const initialPrice = parseEther("0.000002");
  const minPrice = parseEther("0.0000002");
  const stake = await read("requiredStake", [seller.address, initialPrice]);
  log(`      required stake ${eth(stake)} (seller reputation ${await read("reputation", [seller.address])})`);

  const before = await read("listingCount");
  await send(seller, "list",
    ["Celeste", "Any%", "Chapter 3 wall clip that skips the B-side room. ~4s.",
     contentHash, cid, toHex(key), initialPrice, minPrice], stake);
  const listingId = before;
  log(`      listing #${listingId} is live`);

  const listing = await read("getListing", [listingId]);
  log(`      on-chain hash matches local: ${listing.contentHash === contentHash}`);

  // ---------------------------------------------------------------- locked
  step(2, "Before paying, the content is locked");
  try {
    await pub.readContract({ address: ADDRESS, abi: ABI, functionName: "revealKey",
      args: [listingId], account: alice.account });
    log(`      \x1b[31mFAIL: key was readable without paying\x1b[0m`);
    process.exitCode = 1;
  } catch {
    log(`      alice cannot call revealKey() — reverts NotBuyer as expected`);
  }

  // ---------------------------------------------------------------- buy
  step(3, "Alice pays the live price and unlocks the content");
  const snap = async () => {
    const l = await read("getListing", [listingId]);
    return { initialPrice: l.initialPrice, minPrice: l.minPrice, createdAt: l.createdAt, copiesSold: l.copiesSold };
  };
  let s = await snap();
  let now = await chainNow();
  log(`      chain price  ${eth(await read("currentPrice", [listingId]))}`);
  log(`      local mirror ${eth(currentPrice(s, now))}  (must match exactly)`);
  if ((await read("currentPrice", [listingId])) !== currentPrice(s, now)) {
    log(`      \x1b[31mFAIL: client/contract price disagree\x1b[0m`);
    process.exitCode = 1;
  }

  const aliceBefore = await pub.getBalance({ address: alice.address });
  await send(alice, "purchase", [listingId], priceToSend(s, now));
  const alicePid = (await read("purchaseCount")) - 1n;
  const aliceP = await read("getPurchase", [alicePid]);
  log(`      purchase #${alicePid}, paid ${eth(aliceP.pricePaid)}, state ${PurchaseState[aliceP.state]}`);
  log(`      evidence nonce ${aliceP.nonce.slice(0, 18)}...`);

  const keyHex = await pub.readContract({ address: ADDRESS, abi: ABI, functionName: "revealKey",
    args: [listingId], account: alice.account });
  const blob = await fetchFromIPFS(cid);
  log(`      fetched ${blob.length} bytes from IPFS`);
  log(`      hash of fetched blob matches commitment: ${keccak256(blob) === contentHash}`);
  const plain = new TextDecoder().decode(await decryptBlob(blob, fromHex(keyHex)));
  const ok = plain === new TextDecoder().decode(secret);
  log(`      decrypted, round-trip intact: ${ok}`);
  log(`      \x1b[2m${plain.split("\n")[0]}\x1b[0m`);
  if (!ok) process.exitCode = 1;

  // ---------------------------------------------------------------- decay
  step(4, "The price moved for the next buyer");
  s = await snap();
  log(`      copies sold now ${s.copiesSold}`);
  log(`      next buyer pays ${eth(await read("currentPrice", [listingId]))} (was ${eth(initialPrice)} at listing)`);

  step(5, "Bob and Carol buy too — they become the eligible jury pool");
  for (const who of [bob, carol]) {
    s = await snap(); now = await chainNow();
    await send(who, "purchase", [listingId], priceToSend(s, now));
    log(`      ${who.name} paid ${eth((await read("getPurchase", [(await read("purchaseCount")) - 1n])).pricePaid)}`);
  }
  s = await snap();
  log(`      ${s.copiesSold} copies sold; price now ${eth(await read("currentPrice", [listingId]))}`);

  if (HAPPY_ONLY) {
    // ------------------------------------------------------------- claim
    step(6, "No dispute — seller claims escrow once the challenge window closes");
    const p = await read("getPurchase", [alicePid]);
    const opensAt = p.purchasedAt + 180n;
    let wait = Number(opensAt - (await chainNow())) + 5;
    log(`      waiting ${wait}s for the 3-minute challenge window to close...`);
    while (wait > 0) { await sleep(15_000); wait -= 15; if (wait > 0) log(`        ${wait}s left`); }
    const sellerBefore = await pub.getBalance({ address: seller.address });
    await send(seller, "claim", [alicePid]);
    log(`      seller balance +${eth((await pub.getBalance({ address: seller.address })) - sellerBefore)} (net of gas)`);
    log(`      purchase state ${PurchaseState[(await read("getPurchase", [alicePid])).state]}`);
    log(`      seller reputation ${await read("reputation", [seller.address])}`);
  } else {
    // ------------------------------------------------------------- dispute
    step(6, "Alice disputes — escrow freezes, and it is NOT refunded");
    const bond = disputeBondFor(aliceP.pricePaid);
    const evidence = keccak256(
      new TextEncoder().encode(`attempt-footage||nonce=${aliceP.nonce}||does not work`)
    );
    log(`      bond ${eth(bond)}; evidence hash binds the contract nonce ${aliceP.nonce.slice(0, 14)}...`);
    const balBefore = await pub.getBalance({ address: alice.address });
    await send(alice, "dispute", [alicePid, evidence], bond);
    const after = await read("getPurchase", [alicePid]);
    log(`      state ${PurchaseState[after.state]}`);
    log(`      alice balance change ${eth((await pub.getBalance({ address: alice.address })) - balBefore)} — she paid a bond, got no refund`);

    step(7, "Seller cannot claim while frozen");
    try {
      await pub.simulateContract({ address: ADDRESS, abi: ABI, functionName: "claim",
        args: [alicePid], account: seller.account });
      log(`      \x1b[31mFAIL: claim succeeded during dispute\x1b[0m`);
      process.exitCode = 1;
    } catch {
      log(`      claim() reverts WrongState as expected`);
    }

    step(8, "Dispute is not judgeable until the secret has decayed");
    log(`      juryEligible now: ${await read("juryEligible", [alicePid])}`);
    try {
      await pub.simulateContract({ address: ADDRESS, abi: ABI, functionName: "vote",
        args: [alicePid, true], account: bob.account });
      log(`      \x1b[31mFAIL: vote accepted too early\x1b[0m`);
      process.exitCode = 1;
    } catch {
      log(`      bob's early vote reverts NotYetJudgeable as expected`);
    }

    const eligibleAt = await read("juryEligibleAt", [listingId]);
    let wait = Number(eligibleAt - (await chainNow())) + 10;
    log(`      waiting ${wait}s for the decay gate to open...`);
    while (wait > 0) { await sleep(15_000); wait -= 15; if (wait > 0) log(`        ${wait}s left`); }
    log(`      juryEligible now: ${await read("juryEligible", [alicePid])}`);

    step(9, "Only prior buyers may judge, and never the disputer");
    for (const [who, why] of [[alice, "the disputer judging her own claim"], [seller, "the seller"]]) {
      try {
        await pub.simulateContract({ address: ADDRESS, abi: ABI, functionName: "vote",
          args: [alicePid, true], account: who.account });
        log(`      \x1b[31mFAIL: ${why} was allowed to vote\x1b[0m`);
        process.exitCode = 1;
      } catch {
        log(`      rejected: ${why}`);
      }
    }

    step(10, "Two independent prior buyers converge — funds and reputation move");
    await send(bob, "vote", [alicePid, true]);
    let mid = await read("getPurchase", [alicePid]);
    log(`      after 1 vote: state ${PurchaseState[mid.state]} (still frozen — one voice is not enough)`);

    const aliceBal = await pub.getBalance({ address: alice.address });
    const stakeBefore = (await read("getListing", [listingId])).stake;
    await send(carol, "vote", [alicePid, true]);

    const final = await read("getPurchase", [alicePid]);
    const listingAfter = await read("getListing", [listingId]);
    log(`      state ${PurchaseState[final.state]}`);
    log(`      alice recovered ${eth((await pub.getBalance({ address: alice.address })) - aliceBal)} (payment + bond + slashed stake, net of gas)`);
    log(`      seller stake ${eth(stakeBefore)} -> ${eth(listingAfter.stake)}`);
    log(`      listing active: ${listingAfter.active}`);
    log(`      reputation — seller ${await read("reputation", [seller.address])}, alice ${await read("reputation", [alice.address])}, bob ${await read("reputation", [bob.address])}, carol ${await read("reputation", [carol.address])}`);
  }

  log(`\n\x1b[1m${process.exitCode ? "E2E FAILED" : "E2E PASSED"}\x1b[0m`);
  log(`listing #${listingId} — ${DEPLOY.explorer}`);
  log(`total spent from buyers this run stays under 0.00005 ETH each.`);
}

main().catch((e) => { console.error("\x1b[31m", e, "\x1b[0m"); process.exit(1); });
