// Seed the live marketplace with a few listings so the app has something to show.
// Each is genuinely encrypted and pinned — nothing here is faked for display.
import "dotenv/config";
import { createPublicClient, createWalletClient, http, keccak256, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "node:fs";
import { encryptBlob, randomKey, toHex } from "../shared/crypto.js";
import { pinToIPFS } from "../shared/storage.js";

const ABI = JSON.parse(readFileSync(new URL("../shared/abi.json", import.meta.url)));
const { address: ADDRESS } = JSON.parse(readFileSync(new URL("../deployments.json", import.meta.url)));
const RPC = process.env.BASE_SEPOLIA_RPC_URL;

const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LISTINGS = [
  {
    game: "Celeste", category: "Any%",
    teaser: "Chapter 5 dash-cancel that skips the mirror sequence. ~6s.",
    price: "0.000003",
    content: `CELESTE — ANY% — MIRROR TEMPLE DASH-CANCEL

Entering the mirror corridor, hold down+dash into the second pane on the frame
the reflection desyncs. The cancel keeps your dash charge through the transition,
so you can cross the gap without the key.

Timing: 3 frames after the reflection's idle loop restarts.
Saves ~6.1 seconds. Works on 1.4.0.0 and later.`,
  },
  {
    game: "Hollow Knight", category: "Any%",
    teaser: "Early Crystal Heart without Mantis Claw. Sub-1s setup, saves a full route leg.",
    price: "0.000004",
    content: `HOLLOW KNIGHT — ANY% — EARLY CRYSTAL HEART

Stand on the leftmost pixel of the ledge below the Crystal Peak bench. Pogo the
spike once, then immediately super-dash mid-recoil. The recoil cancel keeps you
airborne long enough to clear the wall that normally gates on Mantis Claw.

Setup: face right, one pogo, super-dash on the second frame of recoil.
Saves roughly 90 seconds of routing.`,
  },
  {
    game: "Super Metroid", category: "100%",
    teaser: "Gate clip in Norfair that reorders the Grapple pickup. ~11s.",
    price: "0.0000035",
    content: `SUPER METROID — 100% — NORFAIR GATE CLIP

At the green gate before the Grapple room, morph and lay a bomb flush with the
frame, then unmorph into the blast on the frame the gate begins its open cycle.
The push vector puts you on the far side without shooting the gate.

Frame window: 2 frames. Easier with the bomb laid one pixel left of centre.
Saves ~11 seconds and reorders the Grapple pickup earlier in the route.`,
  },
];

const before = await pub.getBalance({ address: account.address });
console.log(`seller  ${account.address}`);
console.log(`balance ${formatEther(before)} ETH\n`);

for (const spec of LISTINGS) {
  const key = randomKey();
  const ciphertext = await encryptBlob(new TextEncoder().encode(spec.content), key);
  const contentHash = keccak256(ciphertext);
  const cid = await pinToIPFS(ciphertext, `${spec.game.toLowerCase().replace(/\W+/g, "-")}-${Date.now()}.bin`, process.env.PINATA_JWT);

  const initialPrice = parseEther(spec.price);
  const minPrice = initialPrice / 10n;
  const stake = await pub.readContract({ address: ADDRESS, abi: ABI, functionName: "requiredStake", args: [account.address, initialPrice] });

  const { request } = await pub.simulateContract({
    address: ADDRESS, abi: ABI, functionName: "list", account,
    args: [spec.game, spec.category, spec.teaser, contentHash, cid, toHex(key), initialPrice, minPrice],
    value: stake,
  });
  const hash = await wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash });
  for (let i = 0; i < 40 && (await pub.getBlockNumber()) < r.blockNumber; i++) await sleep(500);

  console.log(`${spec.game} — ${spec.category}`);
  console.log(`  price ${spec.price} ETH · stake ${formatEther(stake)} ETH · cid ${cid}`);
  console.log(`  tx ${hash}\n`);
}

const after = await pub.getBalance({ address: account.address });
console.log(`listings now: ${await pub.readContract({ address: ADDRESS, abi: ABI, functionName: "listingCount" })}`);
console.log(`balance ${formatEther(after)} ETH  (spent ${formatEther(before - after)})`);
