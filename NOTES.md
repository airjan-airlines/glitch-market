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
