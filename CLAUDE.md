# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

Greenfield. As of this writing the repo contains only `instructions/` and has no commits — no contracts, frontend, or build tooling exist yet. Everything below describes what is to be built and the constraints it must satisfy. **Update the Commands section here as soon as tooling is scaffolded.**

## Source-of-truth documents and their precedence

Four docs in `instructions/`, with an explicit resolution order defined in `agent_instructions.md`:

- `given_instructions.md` — the original take-home assignment from Blockchain at Berkeley. **Wins when the PRD underscopes something** (especially crypto/on-chain features).
- `PRD.md` — the full mechanism spec, written by another agent. **Wins when it scopes something down** (i.e. its "out of scope" cuts are binding).
- `frontend-spec.md` — frontend only; assumes `PRD.md` and deliberately does not restate mechanism details.
- `agent_instructions.md` — the precedence rule itself, plus git workflow expectations.

Deadline-driven build: prioritize (1) working end-to-end happy path, (2) deployed testnet contract with explorer link, (3) the rest of the PRD, (4) polish.

## Working conventions

- **`NOTES.md` is mandatory.** Any deviation from the PRD, simplification, or ambiguous judgment call gets a short entry explaining what and why. A human must be able to scan every deviation in under two minutes. Silent guessing is the explicit failure mode; imperfection is acceptable.
- Commit at logical checkpoints and push to `origin` (`github.com/airjan-airlines/glitch-market`). Branch and merge as needed rather than accumulating one giant commit.
- Grading is on product judgment, mechanism credibility, and finished experience — not code volume or code quality. Don't gold-plate.

## Domain: what is actually being sold

A marketplace for **speedrun glitches** — sellers commit an encrypted video/instructions for a game skip or sequence break; buyers pay before they can inspect it. The vertical is chosen because secrecy *is* the good: describing the glitch even vaguely leaks value, so pay-before-reveal is the economically correct mechanic rather than an imposed constraint. Two properties of this vertical drive the whole design and should not be flattened into a generic escrow marketplace:

- **Value decays continuously** with elapsed time and with each copy sold (leak risk, independent discovery, patches).
- **Verification is binary and empirical** — a glitch either works or it doesn't — which is firmer ground for disputes than most secret-information markets.

## Mechanism architecture (spans contract + frontend + storage)

The pieces below interlock; changing one in isolation usually breaks the trust story.

**Commit-then-sell.** Content is encrypted client-side and uploaded to IPFS *before* listing. Only the content hash + storage pointer go on-chain at listing time, which is what prevents a seller swapping in fake content after a sale. The hash should be surfaced in the UI, not hidden — it's a visible trust claim.

**Decay pricing.** `price(t, n) = initial_price × decay_by_time(t) / (1 + α·n)`, floored at a minimum. `decay_by_time` must be a **precomputed fixed-point lookup table** (scaled ×10,000, sampled hourly) stored as a constant array, combined via integer division. Do not implement live fixed-point exponentiation on-chain — the lookup table is the required default, not a fallback. The frontend must mirror this exact lookup-table logic client-side; where exact parity isn't guaranteed, the displayed estimate must be **conservative** (never lower than what the contract will charge).

**Optimistic settlement.** Undisputed purchases let the seller claim escrow after a short challenge window — the fast, cheap, common path. Disputing requires a buyer bond (without a cost, free disputes let any buyer freeze honest sellers' funds indefinitely) and **freezes** escrow rather than refunding. Immediate refund-on-dispute is exploitable; keep the distinction explicit in both contract logic and README.

**Decay-gated dispute resolution.** Frozen funds stay frozen until the listing's decay crosses a threshold. Rationale, and the project's designated "biggest design decision": once secrecy value is mostly gone, showing the content to a jury costs the ecosystem almost nothing. Patience, not speed, is the trust primitive.

**Prior-buyer-only jury.** Only prior buyers of *that same listing* may judge a dispute — recruiting outside arbiters would itself leak the secret and would hand a stranger a free usable glitch. Resolution requires convergent agreement (min. 2 independent prior buyers); never resolve on the disputing buyer's word alone.

**Reputation** rises on clean/dispute-won sales, drops sharply on lost disputes, and sets the required seller stake (larger for unproven sellers). A plain numeric score is sufficient.

## On-chain / off-chain split

On-chain: listing metadata, content hash, storage pointer, escrow, stakes/bonds, dispute state, reputation, and the decryption-key release mechanism — so pay-before-reveal is enforced by the contract, not a trusted server. Off-chain (IPFS via Pinata or web3.storage): the encrypted media only. **Never put media on-chain, not even as a shortcut.** Symmetric AES with a key generated at listing time is sufficient; do not attempt threshold or timelock encryption.

## Do not build (deliberately cut — mention as future work only)

TAS/input-log replay verification; external oracles or patch-note monitoring; ZK proof-of-glitch-validity; production key management; broad test coverage (happy path + dispute path only); gas optimization beyond avoiding obvious waste; mobile responsiveness; multi-chain; any auth beyond wallet connect.

## Frontend

Five views plus persistent wallet connect: marketplace browse, listing detail, my purchases/unlocked library, sell/create listing, dispute/jury. SPA routing, no full reloads.

Five states must be unmistakable at a glance anywhere they apply — this legibility *is* the product: locked vs. unlocked for the connected wallet; current price and that it's visibly decaying; purchase status (challenge window / claimed / disputed-not-yet-eligible / eligible / resolved); seller reputation; juror vote count vs. count needed.

Visual direction: a black market for secrets built for speedrunners — leak-market meets competitive-gaming leaderboard, terminal/CRT, redaction, monospace numerics, countdowns. Explicitly not a DeFi dashboard or SaaS marketplace template. Copy is plain and active ("Unlock", "Dispute this sale"). Animation is limited to the one deliberate locked→unlocked reveal moment; no scattered hover or entrance effects. Produce the short design plan (4–6 hex colors, 1–2 typefaces, layout concept, the one memorable element) before building.

## Intended stack

Solidity + Hardhat or Foundry; Sepolia testnet; IPFS via Pinata/web3.storage; React + wagmi/viem (or ethers.js); deploy to Vercel. Hardhat time-manipulation helpers are acceptable for demoing the challenge window and decay threshold — if artificial time acceleration is used, say so in the README and video so it isn't mistaken for a production timing choice.

## Commands

None yet — no build tooling is committed. Add build, test, single-test, lint, deploy, and dev-server commands here when scaffolding lands.

## Deliverables

Public repo; README covering vertical, trust assumptions, the decay-gated optimistic dispute + prior-buyer jury decision, and one named limitation (recommended: video evidence is weak without input-replay verification); ≤5 min demo video; deployed app URL; Sepolia contract address + Etherscan link.
