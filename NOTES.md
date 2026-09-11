# NOTES.md

Running log of deviations from `instructions/PRD.md`, judgment calls, and anything a reviewer
should know that the PRD does not already say. Newest entries at the bottom of each section.

---

## Environment / setup decisions

**Chain: Base Sepolia (84532), not Ethereum Sepolia.**
PRD §7 suggests Sepolia. Switched with the user's explicit approval because Sepolia faucets are
heavily rate-limited, while Base Sepolia funds freely via the Coinbase CDP faucet. The assignment
text only requires "a public testnet"; Basescan serves the block-explorer deliverable identically.

**Demo wallets are freshly generated and testnet-only.**
Four keys (deployer/seller + three buyers) live in `.env`, which is gitignored. Three buyers are
required, not two: jury resolution needs `MIN_JURY_VOTES = 2` agreeing prior buyers, and the
disputing buyer is barred from voting on their own dispute.

**Funding is far smaller than originally planned, and that is fine.**
Accounts hold 0.0001–0.0004 ETH, not the ~0.05 ETH first suggested. Base Sepolia gas is ~0.006 gwei,
making a full deploy ~0.000015 ETH. All demo economics were sized down to match: listing price
0.00001 ETH, dispute bond 50% of price, seller stake 2–5x price depending on reputation.

---

## Mechanism decisions

**Demo timing constants are deliberately short and unrealistic.**
`CHALLENGE_WINDOW = 3 minutes`, decay table stepped every 30s, jury threshold at 60% of initial
price (~3 minutes after listing). A real deployment would use hours-to-days. This is called out here
and in the README so short windows are not mistaken for a production timing judgment.

**PRD §7's Hardhat time-manipulation advice does not apply on a public testnet.**
You cannot warp `block.timestamp` on Base Sepolia. Local Foundry tests use `vm.warp`, but the live
demo depends on genuinely short real-time constants (above). This is the reason the windows are
minutes rather than hours — it is a demo-recording constraint, not an economic claim.

---

## Known limitations (also surfaced in README)

**On-chain "encrypted key" release is not real confidentiality.**
`revealKey()` gates on proof of purchase, but all contract storage is publicly readable, so a
determined observer can read the key directly from state without paying. PRD §4 explicitly permits a
simplified key-management scheme for this prototype; a production build needs threshold encryption,
Lit Protocol-style access control, or a decentralized secret-sharing scheme. The contract enforces
pay-before-reveal at the *application* layer, not cryptographically.

**A seller's stake can only be slashed once per listing.**
If a listing loses one dispute, its stake is consumed. A second disputed purchase against that same
listing has nothing left to slash. Mitigated in practice by deactivating the listing on a lost
dispute, but a seller with many simultaneous in-flight purchases is under-collateralized.

**RPC read-after-write lag is real on Base Sepolia.**
A transaction receipt does not guarantee that the next `eth_call` sees the new state — a
load-balanced endpoint can serve a node that has not applied the block yet. This showed up as
`getListing(0)` reverting out-of-bounds immediately after a successful `list()`. Both the E2E script
and the frontend wait for the block number to catch up and retry reads.

**Alchemy's free tier caps `eth_getLogs` to a 10-block range.**
That rules out event-log indexing for the UI. The frontend instead enumerates state directly:
`listingCount()` + `listingView(i)`, and `purchasesOfBuyer` / `purchasesOfListing` for the rest. The
contract was already written with these array-returning views, so no contract change was needed.

---

## Build outcome

**Everything in the PRD's must-demo path (section 6) works on the live deployment.**
`npm run e2e` drives all of it against Base Sepolia and real IPFS, and passes: list with encryption
and an on-chain commitment, locked before payment, buy and decrypt, price visibly moved for the next
buyer, dispute freezes without refunding, seller blocked from claiming while frozen, votes rejected
before the decay gate, disputer and seller both barred from judging, one juror insufficient, two
convergent jurors move the money and update reputation. The happy-path claim also executed on-chain
via `scripts/reclaim.mjs`.

**Deployed and verified:** `0x70B7B754A53f90810d371b25Aa1d316497C3a94F` on Base Sepolia.
Etherscan's V2 multichain API key verified it on Basescan without extra setup.

**App:** https://airjan-airlines.github.io/glitch-market/ — a GitHub *project* page, which is why
Vite's `base` is `/glitch-market/`. It does not collide with the existing user site at
airjan-airlines.github.io, which is served from its own repo.

---

## Two deviations worth knowing about

**The Pinata JWT is deliberately NOT compiled into the published app.**
The original plan was to bake it in so listing worked out of the box. That would have published a
live write credential on a public page, so the deployed build ships no secrets and the sell form
asks for a JWT once, keeping it in `localStorage`. Browsing, buying and judging need no credential
at all — only listing does, since listing is the only step that uploads. Local dev can still supply
one through the repo-root `.env` via `VITE_PINATA_JWT`, but that key was removed from `.env` so a
careless rebuild cannot leak it.

**Every public IPFS gateway rate-limited this build.**
gateway.pinata.cloud is unreachable on the free plan now, and ipfs.io, dweb.link and w3s.link all
returned 429. cloudflare-ipfs.com is discontinued. Retrieval uses the account's dedicated Pinata
gateway, with the public ones as fallback. The blobs are ciphertext, so a readable gateway leaks
nothing — but a grader cloning this repo will need their own gateway in `IPFS_GATEWAY`.

---

## State of the live market

Six listings exist. Three are live (Celeste, Hollow Knight, Super Metroid); three are earlier E2E
listings now closed or delisted, and they render dimmed as "delisted". That is real history, not
seed data.

The seller account's reputation is **-4**: it lost the E2E dispute (-5) and won one clean claim (+1).
It is honest state and shows the reputation system working, but it does mean the demo seller looks
untrustworthy and posts the maximum 5x stake. Listing from a fresh address would show a cleaner
number.

A UI smoke test (`node scripts/smoke.mjs`) renders the deployed page in headless Chrome and asserts
the market loads, all views mount, and the price actually ticks down — it caught a live decay of
0.000004269 to 0.0000036006 over 32 seconds.

---

## Redeploy: staged jury pool and a timeout default

`0x05db183415DdcFca9F973279d1d6Cab6C1A02590` supersedes
`0x70B7B754A53f90810d371b25Aa1d316497C3a94F`. Both are verified on Basescan; the old one is left
deployed and referenced in `deployments.json` so the history is inspectable.

**What was wrong.** The first contract restricted jurors to prior buyers of the same listing, with no
alternative path and no timeout. A listing bought by exactly one person, who then disputes, has an
empty eligible juror pool — the disputer cannot rule on their own claim — so the escrow could never
resolve. Payment, bond and the seller's stake would freeze permanently, and `withdrawStake` also
refuses while any purchase is disputed, so the seller's capital was trapped too. This was found by
the user hitting it directly: they disputed a listing they were the only buyer of.

**Two further problems the same restriction caused.** The README claimed judgment waits until
"secrecy value is mostly gone", but the threshold was 60% of initial price — losing 40% is not
mostly gone, and the argument did not match the parameter. Separately, prior buyers are not
disinterested jurors: a lost dispute delists the listing, which stops further copies being sold and
preserves the edge of everyone who already bought, biasing them toward slashing the seller.

**The fix.** The pool now widens in stages against the decay curve: prior buyers at 60%, anyone at
10%, and a seller-default timeout at 2%. The timeout returns the buyer's bond and moves no
reputation, because a timeout is an absence of judgment rather than a finding. Anyone may trigger
it, so neither party can hold the escrow hostage by refusing to act. Thresholds are now calibrated
to who is being shown the content rather than picked once.

Nine tests were added for this (43 total), including the exact deadlock case:
`test_SoleBuyerDisputeCanStillBeJudgedOnceJuryOpens`.

**Demo timings:** stage 1 at 3.5 min after listing, stage 2 at 14 min, stage 3 at 23 min.

**Cost note.** Demo prices were reduced when redeploying — seeded listings now open at
0.000003–0.000004 ETH instead of 0.000005–0.000008, and the E2E listing at 0.000002 — because stake
is 5x price and the deployer account was running low. Nothing about the mechanism changed, only the
denominations.

**The deadlock fix is verified on-chain, not just in unit tests.**
`scripts/e2e-deadlock.mjs` reproduces the exact configuration that used to freeze forever — a sole
buyer disputes their own purchase — and walks all three stages against the live contract in real
time (~24 min). It asserts that at stage 1 the eligible juror pool is genuinely empty (the disputer
is barred from her own claim, a stranger is not yet eligible), that stage 2 opens the pool and
breaks the deadlock while still barring both parties, and that stage 3 lets an uninvolved third
party close the escrow: seller paid, bond returned, no reputation moved, seller's stake withdrawable
again. Passed on listing #4.

One self-inflicted note: the first version of that script "checked" reputation by comparing a fresh
read to another fresh read, which passes unconditionally. Replaced with a real before/after capture.

---

## Media and evidence were faked in the first build — now they are real

Two things the PRD and frontend spec asked for were not actually implemented, and the user caught
both.

**Sellers could not upload anything.** PRD §3.1 describes the good as "video/instructions" and
frontend spec §3.4 asks for a file upload encrypted client-side. The sell form was a textarea only,
so every listing was text pretending to be a video market. It now takes `video/*`, `image/*`,
`audio/*`, text and PDF, encrypts the real bytes in the browser, and pins those. Buyers get a
`<video>` player, an image, or the text burn-in depending on what they bought. Content is wrapped in
a small envelope (`shared/envelope.js`) carrying filename and media type, so an unlocked file is
playable rather than anonymous bytes; payloads without the envelope magic still decode as text, so
listings made before this change keep working.

**Dispute evidence was hashed from a string, not a file.** The dispute button committed
`keccak256("attempt-evidence||nonce=…")` — no file was ever uploaded or hashed, which made the whole
nonce-binding story decorative. Worse, even a real hash would have been useless to jurors, since
`dispute()` takes only a `bytes32` and there was nowhere to put a pointer.

Fixed without a redeploy by noticing that a CIDv0 is `base58(0x12 0x20 || sha2-256 digest)` — the
digest is exactly 32 bytes. The buyer's file is pinned, and the CID's digest is stored as
`evidenceHash`, so that single field is simultaneously a commitment and a retrievable pointer. The
jury view reconstructs the CID and links to the file. Verified against a real pin: hash is 32 bytes,
the CID round-trips exactly, and the fetched bytes match what was uploaded.

**Seeded proof.** `scripts/seed-media.mjs` lists a real binary payload (a PNG route diagram
synthesised at runtime — no ffmpeg dependency and no copyrighted game footage). Verified end to end
on-chain: 3,969 bytes of ciphertext on IPFS, keccak matches the on-chain commitment, decrypts to a
valid PNG with its signature and filename intact.

**Still not done:** jurors cannot attach evidence to their own vote. PRD §3.5 says they "ideally"
should; `vote(purchaseId, forBuyer)` takes a bool only. Only the disputing buyer submits evidence.
