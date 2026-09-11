// Seed one listing whose payload is a real binary image rather than text, so the media path is
// exercised on-chain: encrypted file -> envelope -> IPFS -> commitment -> decrypt -> <img> render.
//
// The PNG is synthesised here (no ffmpeg, no bundled asset, no copyrighted game footage). A seller
// demoing for real would upload their own clip through the sell form, which takes video/*.

import "dotenv/config";
import { deflateSync } from "node:zlib";
import { createPublicClient, createWalletClient, http, keccak256, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "node:fs";
import { encryptBlob, randomKey, toHex } from "../shared/crypto.js";
import { pack } from "../shared/envelope.js";
import { pinToIPFS } from "../shared/storage.js";

// --- minimal PNG writer -------------------------------------------------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(width, height, paint) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// A route diagram: the wall-clip path through a room, in the app's own palette.
const W = 640, H = 360;
const image = png(W, H, (x, y) => {
  const wall = x > 300 && x < 330 && y > 90;
  const floor = y > 300;
  const path = Math.abs(y - (330 - Math.min(x, 470) * 0.42)) < 3 && x < 520;
  const spark = Math.hypot(x - 315, y - 190) < 14;
  if (spark) return [0, 255, 156];
  if (path) return [255, 176, 32];
  if (wall) return [42, 49, 61];
  if (floor) return [23, 27, 34];
  const grid = x % 40 === 0 || y % 40 === 0;
  return grid ? [18, 21, 26] : [13, 15, 19];
});

const ABI = JSON.parse(readFileSync(new URL("../shared/abi.json", import.meta.url)));
const { address: ADDRESS } = JSON.parse(readFileSync(new URL("../deployments.json", import.meta.url)));
const RPC = process.env.BASE_SEPOLIA_RPC_URL;
const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`generated PNG: ${W}x${H}, ${(image.length / 1024).toFixed(1)} KB`);

const key = randomKey();
const payload = pack({ name: "wall-clip-route.png", type: "image/png", bytes: new Uint8Array(image) });
const ciphertext = await encryptBlob(payload, key);
const contentHash = keccak256(ciphertext);
const cid = await pinToIPFS(ciphertext, `route-${Date.now()}.bin`, process.env.PINATA_JWT);
console.log(`encrypted ${ciphertext.length} bytes -> ${cid}`);

const initialPrice = parseEther("0.0000035");
const minPrice = initialPrice / 10n;
const stake = await pub.readContract({ address: ADDRESS, abi: ABI, functionName: "requiredStake", args: [account.address, initialPrice] });

const { request } = await pub.simulateContract({
  address: ADDRESS, abi: ABI, functionName: "list", account,
  args: [
    "Hollow Knight", "Any%",
    "Annotated route diagram for the Crystal Peak wall clip. Shows the exact pogo pixel.",
    contentHash, cid, toHex(key), initialPrice, minPrice,
  ],
  value: stake,
});
const hash = await wallet.writeContract(request);
const r = await pub.waitForTransactionReceipt({ hash });
for (let i = 0; i < 40 && (await pub.getBlockNumber()) < r.blockNumber; i++) await sleep(500);

console.log(`listed — stake ${formatEther(stake)} ETH, tx ${hash}`);
console.log(`listings now: ${await pub.readContract({ address: ADDRESS, abi: ABI, functionName: "listingCount" })}`);
console.log(`balance ${formatEther(await pub.getBalance({ address: account.address }))} ETH`);
