# PRD: Speedrun Exploit Market

**Project for**: Blockchain at Berkeley (B@B) technical take-home interview
**Deadline**: 9/11, 2pm
**Build mode**: Autonomous overnight build by a Claude Code agent, unsupervised. This document is the single source of truth — if anything is ambiguous, the agent should make the most reasonable choice, document it in `NOTES.md`, and keep moving rather than stall.

---

## 0. Non-negotiable rule for the build agent

If you (the build agent) get blocked, decide to simplify something, or aren't sure whether a design choice matches intent — **do not silently guess and move on**. Write a short note to `NOTES.md` explaining what you did and why, then continue. The human reviewing this in the morning needs to be able to scan `NOTES.md` and understand every deviation from this PRD in under two minutes. Silence is the failure mode to avoid, not imperfection.

Prioritize, in order: (1) a working end-to-end happy path (Section 6) that can be demoed on video, (2) a deployed testnet contract with a block explorer link, (3) everything else in this doc, (4) polish.

---

## 1. Assignment context (do not lose sight of this)

The original spec requires:
- A marketplace where autonomous agents/users buy and sell information on-chain **that the buyer cannot inspect before paying**.
- A **specific vertical** with real participants, evidence, incentives, and failure modes — not a generic marketplace with themed labels.
- Deployment and interaction with a **public testnet**, on-chain.
- Our own design decisions on: delivery, seller credibility, buyer protection, payment, verification, disputes, reputation.
- Deliverables:
  1. Public GitHub repo with a README covering: chosen vertical, trust assumptions, biggest design decision, one important limitation.
  2. A ≤5 minute video showing the complete experience end to end.
  3. Ideally a publicly deployed, self-explanatory app with a URL.
  4. Testnet contract address + block explorer link.
- Grading criteria: product judgment, credibility of the mechanism, quality of the finished experience — **not** raw code volume or code quality for its own sake.

Everything below should be read as an implementation of these requirements. If a proposed feature doesn't clearly serve one of them, cut it.

---

## 2. Chosen vertical: Speedrun / Video-Game Exploit Market

**Participants**: Sellers are players who've found a glitch, skip, or sequence break in a specific game/category during practice. Buyers are competitive speedrunners chasing leaderboard times or preparing for an event, who want an edge before it becomes public knowledge.

**Why "pay before inspect" is real here, not just imposed**: describing a glitch in any specific way — even in a listing blurb — risks leaking it for free. The entire value of the good is that it is secret. This is a domain where the core mechanic of the assignment (pay-then-reveal) is the *actual, correct* way this market would work in reality, not a contrivance.

**Time-decay is a first-class economic force in this vertical**: a glitch's value erodes continuously — the longer it's listed and the more copies are sold, the more likely it leaks, gets discovered independently, or gets patched. Price should reflect this. This is the "biggest design decision" flourish of the project and should be visible and explainable in the demo.

**Verification is unusually tractable for this vertical**: unlike most "secret information" markets, a glitch either works or it doesn't — an empirically checkable, binary outcome. That gives the mechanism something firmer to build disputes around than most black-box-info markets would have (compare: scouting judgment, research quality, restaurant tips — all inherently subjective). Lean into this.

---

## 3. Core Mechanism (this is the mechanism to actually build)

### 3.1 Listing
- Seller creates a listing with: game title, category (e.g. "Any%", "100%"), a public teaser description (vague — must not leak the trick), an estimated time-save claim, an initial price, and a **content hash** committing to the full encrypted content (video/instructions) that will be delivered on purchase.
- Full content is encrypted client-side and uploaded to off-chain storage (see Section 4) *before* listing; only the hash + storage pointer go on-chain at listing time. This proves the seller can't swap in different (fake) content after a sale — what's revealed after payment must match what was committed to at listing.
- Seller posts a **stake/bond** when listing, sized larger for new/unproven sellers, smaller for sellers with strong reputation. Bond is slashable if a dispute resolves against them.

### 3.2 Purchase & Pricing
- Buyer pays the current price (computed live from the decay formula, Section 3.3) into contract escrow.
- On payment, the buyer is granted the ability to retrieve the decryption key/content (Section 4). The purchase is timestamped on-chain, and a per-listing running count of copies sold increments.
- Price for the *next* buyer immediately reflects the new copies-sold count (and elapsed time) — this is the "on-theme" decay mechanic and should be visibly reactive in the demo (buy once, watch the price for the next buyer change).

### 3.3 Decay Pricing Formula
Conceptual model (do not implement live floating-point math on-chain — see implementation note):

```
remaining_secrecy(t, n) = decay_by_time(t) / (1 + α · n)
price(t, n) = initial_price × remaining_secrecy(t, n), floored at some minimum price
```
Where `t` = time since listing, `n` = number of copies already sold, `α` = a tunable constant controlling how much each additional buyer erodes value.

**Implementation instruction**: `decay_by_time(t)` should be implemented as a **precomputed lookup table** of fixed-point integers (e.g., scaled ×10,000) representing an exponential-decay-like curve (`e^(−λt)` sampled at fixed time steps such as every hour), stored as a constant array in the contract. Combine with the `n` term via plain integer division. Do **not** attempt live fixed-point exponentiation (e.g. via PRBMath) unless it is trivial to get working correctly and fully tested — the lookup-table approach achieves the same economic story with far less implementation risk and is the required default. If time allows and the lookup-table version works cleanly, a stretch goal is a smoother interpolation between table entries; this is optional and should not block anything else.

### 3.4 Optimistic Settlement + Dispute Window
This project uses an **optimistic pattern** (cite this term explicitly in the README — it's a known primitive from projects like UMA's Optimistic Oracle):

1. After purchase, a short **challenge window** opens (e.g., 6–24 hours — pick something demoable, doesn't need to be realistic-length for the video).
2. If no dispute is raised before the window closes, the seller can claim the escrowed payment — simple, fast, cheap path for the honest, common case.
3. If a buyer disputes within the window:
   - The disputing buyer must post a **small bond** to raise the dispute. This is a hard requirement, not optional — without a cost to disputing, any buyer could dispute every purchase for free and permanently freeze honest sellers' funds (a griefing vector). The bond is forfeited if the dispute resolves against the buyer.
   - Disputing **freezes** the escrowed funds. It does **not** immediately refund the buyer. This distinction is important and should be explicit in the contract logic and the README — an immediate refund-on-dispute is exploitable.
4. Frozen/disputed funds remain frozen until the listing's decay (Section 3.3) crosses a defined threshold (e.g., price has decayed below X% of initial, or a minimum time has elapsed) — reasoning: by the time secrecy value is mostly gone, showing the content to a small jury (Section 3.5) costs the ecosystem very little, since the trick is nearly public anyway. This is a deliberate design choice to prefer patience over speed as the trust primitive — call this out as the project's single biggest design decision in the README.
5. Once the decay threshold is crossed, the dispute becomes eligible for jury resolution.

### 3.5 Jury / Dispute Resolution
- **Eligible jurors are restricted to prior buyers of the same specific listing.** This is a deliberate and important choice: pulling in outside arbiters who haven't already paid would itself constitute a new leak of the secret content, and would let a stranger simply use the glitch instead of judging it fairly. Restricting the juror pool to people who already legitimately purchased access means judging a dispute never expands who has seen the secret.
- Require **convergent agreement** among jurors (e.g., a minimum of 2 independent prior buyers agreeing) before slashing a seller's stake or awarding a buyer's refund — do not resolve on a single buyer's word alone, including the disputing buyer's own claim.
- Jurors should ideally submit evidence alongside their vote (e.g., their own attempt result). Buyer-submitted video evidence is a legitimate fallback but is **weak evidence on its own** — hashing a video only proves it hasn't been swapped after submission, not that it's genuine, unedited footage of a real attempt. If time allows, add a simple mitigation: require the disputing buyer's evidence to include a contract-emitted nonce visibly captured on-screen/in-file, to at least prevent reuse of old/unrelated footage. This does not solve editing, and that residual weakness should be named plainly in the README as a limitation.
- Outcome: funds (original payment + forfeited bonds as applicable) are distributed to the winning side; the losing side's stake/bond is slashed; reputation scores update for seller, disputing buyer, and participating jurors.

### 3.6 Reputation
- Sellers accumulate a reputation score that increases with each successful (non-disputed, or dispute-won) sale, and drops sharply on a lost dispute.
- New/low-reputation sellers require larger stakes; established sellers' required stake can shrink over time.
- Reputation should be visible in the UI on each listing (even a simple number/score is sufficient — this doesn't need a fancy weighting formula for the MVP).

---

## 4. Storage Architecture — what's on-chain vs. off-chain

**Never put media files on-chain.** On-chain storage costs roughly tens of thousands of gas per 32 bytes; a video-sized payload would be prohibitively expensive and likely exceed per-transaction gas limits outright. This must not be attempted even as a "quick and dirty" shortcut.

**On-chain (the contract) stores**:
- Listing metadata (game, category, teaser text, price parameters, timestamps)
- Content hash (commitment to the encrypted file, made at listing time)
- Storage pointer/URI for the off-chain encrypted file
- Escrow balances, stake/bond amounts, dispute status, reputation scores
- The decryption key (or a mechanism to derive/release it) — released only upon confirmed payment, so "pay before reveal" is enforced by the contract itself rather than by a trusted third party or off-chain server

**Off-chain stores**:
- The actual encrypted video/instructions file — use IPFS (via a pinning service such as Pinata or web3.storage for reliability during the demo period) or Arweave. Either is acceptable; pick whichever the agent can get working fastest and reliably within a testnet/demo timeframe.

**Encryption**: a simple symmetric encryption scheme (e.g., AES with a key generated at listing time) is sufficient. Do not attempt production-grade threshold encryption, timelock encryption, or anything requiring novel cryptographic infrastructure — note in the README that key management is simplified for this prototype and name what a production version would need instead (e.g., proper key-escrow or a decentralized secret-sharing scheme).

This on-chain/off-chain split is also the direct answer to "does this actually need a blockchain, or is it just using ETH as a data store" — the chain's actual job is trustless escrow, tamper-proof commitments, and enforced pay-before-reveal logic, not file hosting. State this explicitly in the README's trust-assumptions section.

---

## 5. Explicitly Out of Scope (do not attempt overnight)

These were deliberately considered and cut during design discussion. Do not implement them; instead mention them briefly in the README as future work, framed as "the ideal solution, understood but out of scope for this build":

- **TAS/input-log replay verification.** The strongest possible verification mechanism (replay a buyer's submitted raw input sequence deterministically against the actual game/emulator to get an objective, automated yes/no on whether the glitch works) requires possessing and running licensed game/emulator infrastructure and is a real copyright and engineering undertaking. Name it in the README as understood-but-deferred; do not attempt a partial implementation.
- **External oracles / patch-note monitoring** (e.g., using a game's official patch notes as evidence a glitch was real) — deliberately excluded to keep verification endogenous to buyer/seller/juror behavior rather than dependent on an external trusted data feed. Name this tradeoff explicitly in the README.
- **Zero-knowledge proof-of-glitch-validity** or any other cryptographic proof that content is genuine without revealing it — real research-level difficulty, not buildable in this timeframe. Mention as long-term future work only.
- Production-grade key management / threshold cryptography (see Section 4).
- Polished, highly-designed UI. Functional, clear, and self-explanatory is the bar — not visually impressive.
- Broad test coverage / audit-grade testing. A handful of tests covering the core happy path and the core dispute path is sufficient (see Section 6).
- Gas optimization beyond basic sanity (e.g., avoiding obviously wasteful loops). This is a demo, not a production deployment.
- Mobile responsiveness, multi-chain support, or any account/auth system beyond wallet connection.

---

## 6. Must-Demo Happy Path (non-negotiable — this is what goes in the video)

The following flow must work end-to-end, on the deployed testnet contract, driven from the actual frontend (not just a script or console):

1. **List a glitch**: seller connects wallet, creates a listing (game, category, teaser, price, stake posted, content encrypted and uploaded off-chain, hash committed on-chain).
2. **View the marketplace**: a buyer views the listing — sees teaser, current (decayed) price, seller reputation — but cannot see the actual content.
3. **Buy**: buyer pays the current price; funds go into escrow; buyer receives access to the encrypted content and can decrypt/view it.
4. **Show decay in action**: after this purchase, show that the price for a hypothetical next buyer has moved (either via a second real purchase in the demo, or by clearly displaying the updated computed price).
5. **Happy path — no dispute**: after the challenge window passes (use a short window for demo purposes, or a manual "advance time"/testnet trick if needed), seller claims the escrowed payment successfully.
6. **Unhappy path — dispute**: in a second run-through (or a second listing), a buyer disputes within the window, posting the required bond; show the funds freeze rather than instantly refund.
7. **Dispute resolution**: show the dispute reaching jury eligibility (either by waiting for the decay threshold in real-time if short enough for a demo, or by using a testnet mechanism to simulate elapsed time/decay), a prior buyer/juror voting, and funds + reputation updating accordingly.
8. **Reputation visible**: show the seller's (and/or juror's) reputation score having changed as a result of the above.

If time runs short, steps 1–5 (list → buy → decay visible → happy-path claim) are the absolute floor — the dispute/jury flow (6–8) is the differentiator but the happy path must work regardless.

---

## 7. Suggested Tech Stack

Agent has discretion here, but a low-risk, well-documented default:

- **Smart contract**: Solidity, using Hardhat or Foundry (whichever the agent is more fluent/faster with) for development, testing, and deployment.
- **Testnet**: Sepolia (Ethereum) — most widely documented, easiest to get testnet ETH for via public faucets, good block explorer support (Sepolia Etherscan).
- **Off-chain storage**: IPFS via Pinata or web3.storage (pick whichever has the smoothest API/SDK to integrate quickly).
- **Frontend**: a simple React app using `wagmi`/`viem` or `ethers.js` for wallet connection and contract interaction. Deployment to Vercel or similar for the "publicly deployed URL" deliverable.
- **Local time simulation for demo purposes**: use Hardhat's time-manipulation helpers (or equivalent) if a real-time challenge window/decay period would be too slow to demo live; note in README/video if artificial time acceleration was used for demo purposes so it's not mistaken for a production timing choice.

---

## 8. Deliverables Checklist (map directly to the assignment)

- [ ] Public GitHub repo
- [ ] README.md containing, at minimum:
  - Chosen vertical and why it fits the pay-before-inspect model (Section 2)
  - Trust assumptions (Section 4's on-chain/off-chain split; Section 5's excluded oracle/verification mechanisms)
  - Biggest design decision: the decay-gated optimistic dispute + prior-buyer-only jury model (Sections 3.3–3.5), explicitly naming the "patience over speed" framing
  - One important limitation, clearly stated (recommend: the video-evidence-is-weak-without-input-replay issue from Section 3.5, and/or the TAS-replay-verification-deferred point from Section 5)
  - Brief mention of what full-fidelity TAS/input-replay verification would look like, explicitly framed as future work (Section 5)
- [ ] ≤5 minute video walking through the Section 6 happy path (and dispute path if time allows)
- [ ] Publicly deployed, self-explanatory app URL
- [ ] Testnet contract address + block explorer (Sepolia Etherscan) link

---

## 9. Summary of Key Design Decisions (for quick reference)

| Decision point | Choice made | Why |
|---|---|---|
| Verification model | Binary, empirically checkable (glitch works or doesn't) | Vertical-specific strength vs. generic "black box info" markets |
| Dispute trigger | Optimistic default (seller can claim if undisputed); disputing requires a bond and freezes (not refunds) funds | Prevents free griefing of sellers |
| Jury composition | Restricted to prior buyers of the same listing only | Judging a dispute must never expand who has seen the secret |
| Dispute resolution timing | Gated on decay threshold, not fixed time | Turns "patience" into the core trust primitive — secrecy is nearly gone by the time judgment happens, so review costs little |
| Pricing | Combined time-decay × copies-sold decay, precomputed lookup table (no live floating point on-chain) | Captures real vertical economics while minimizing implementation risk |
| Storage | Hash + escrow on-chain; encrypted file off-chain (IPFS/Arweave) | Chain's job is trustless escrow/commitment, not file hosting |
| Excluded: TAS/input replay | Named as ideal future work, not implemented | Requires licensed game/emulator infra; real but out of scope |
| Excluded: patch-note oracle | Deliberately dropped | Avoids reintroducing a trusted external data dependency |
