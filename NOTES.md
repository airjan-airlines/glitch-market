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
