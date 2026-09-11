# Frontend Spec: The Black Box Bazaar

Companion to `PRD.md`. This document covers the frontend only — mechanism, contract, and storage details live in the main PRD and should not be re-derived here. Read the PRD first; this assumes it.

This is scoped as a **real, slightly more built-out app**, not just a wallet-connect + button test harness — since it's overnight and agentic, there's room to make it look and feel like a product, not just prove the contract works. Still: functional and clear beats visually impressive. Do not spend build time on decoration that doesn't help someone understand what's happening.

---

## 1. Design direction

Ground the visual identity in the actual subject matter: this is a black market for secrets, built for speedrunners — not a generic DeFi dashboard and not a generic SaaS marketplace. Avoid both of those templated looks.

**Suggested tone**: something between a leak/tip marketplace and a competitive-gaming leaderboard — a little illicit, a little terminal/CRT/data-console, built for people who care about frame-perfect timing. Lean into concepts like: redacted/blurred text, countdown timers, monospace numerics for prices and timers, a sense of "locked" vs "unlocked" state.

**Before building, produce a short design plan** (per the frontend-design skill, if available in the build environment): 4–6 named hex colors, 1–2 typefaces and their roles, a one-paragraph layout concept, and a sentence on what the one "memorable" design element will be (e.g., the locked/unlocked content reveal moment, or the live-decaying price ticker). Avoid the generic AI-design tells: no warm-cream-background-plus-terracotta, no all-caps tracked-out eyebrow labels, no generic SaaS rounded card grid with identical soft shadows on everything, no `→` on every button. Pick a palette and type pairing that feels like it belongs to *this* subject specifically.

**Copy tone**: plain, active-voice, written for a speedrunner audience — not corporate marketplace copy. A button that unlocks content says "Unlock" or "Reveal," not "Submit." A dispute button says "Dispute this sale," not "File a claim." Empty states should read like an invitation ("No glitches listed yet — be the first to sell one") not a generic "No data" message.

---

## 2. Information architecture / pages

Keep this to a small number of clear views rather than a sprawling multi-page app:

1. **Marketplace / browse view** (home)
2. **Listing detail view** (single glitch, pre-purchase)
3. **My purchases / unlocked content view** (post-purchase, buyer's own library)
4. **Sell / create listing view**
5. **Dispute / jury view** (for eligible jurors on a specific disputed listing)
6. A persistent **wallet connect** affordance, visible from every view

A single-page app with these as routes/views (no full page reloads) is fine and probably fastest to build well.

---

## 3. View-by-view detail

### 3.1 Marketplace / Browse
- A list/grid of active listings. Each card shows:
  - Game + category (e.g., "Celeste — Any%")
  - Teaser text (the vague, non-leaking description)
  - **Current live price**, computed from the decay formula — this should visibly be a "live" number, not a static one. If feasible, recompute and re-render it client-side on an interval (e.g., every few seconds) so a viewer watching the page can see it tick down, even if the actual on-chain value only changes discretely at lookup-table steps.
  - Seller reputation (a simple score/badge is enough — doesn't need stars or elaborate iconography)
  - Copies sold so far (this is part of the decay story — showing "3 sold" next to a dropping price tells the whole economic mechanism at a glance)
  - A clear visual cue that content is locked (e.g., a redacted/blurred placeholder area) until purchased
- Sorting/filtering by game is a nice-to-have, not required for MVP.
- Empty state: an inviting message plus a prominent "Sell a glitch" call to action.

### 3.2 Listing Detail
- Everything from the card, expanded, plus:
  - Full public listing metadata (whatever was committed at listing time)
  - The committed content hash, shown plainly (even as a truncated hex string) — this is worth surfacing, not hiding, since "the seller can't swap the file after the fact" is a real trust story worth making visible in the UI, not just in the contract.
  - A prominent **"Buy for [current price]"** button.
  - After purchase (if the connected wallet is the buyer): the view transitions to show the unlock flow — decrypting and displaying/linking to the actual content. This transition (locked → unlocked) is a good candidate for the "one memorable design moment" the design plan should call out.
  - A visible **challenge window countdown** once purchased ("Seller can claim in 4h 12m" or "Dispute window open — X time left").
  - A **"Dispute this purchase"** button, visible only to the buyer during the challenge window, which prompts for the required bond amount before submitting.

### 3.3 My Purchases / Unlocked Content
- A simple personal library: everything the connected wallet has purchased, each showing its current status (challenge window open / claimed by seller / disputed / resolved) and, if unlocked, the actual revealed content (video/instructions).
- This view is where the "pay before inspect, then actually get to inspect" payoff should feel satisfying — don't bury it.

### 3.4 Sell / Create Listing
- A form: game, category, teaser text, initial price, file upload (gets encrypted client-side and pushed to off-chain storage per the PRD), stake amount (auto-suggested based on the seller's existing reputation if any).
- Clear confirmation step before the listing transaction is submitted — this involves the seller's money (stake) and should not feel like an accidental click.
- After listing: show the committed hash and confirm the listing is live.

### 3.5 Dispute / Jury View
- Only relevant/visible to wallets that qualify as jurors for a given listing (i.e., prior buyers of that same listing, per the PRD's restricted-juror-pool rule).
- Shows: the disputed listing, the dispute's current status relative to the decay threshold (i.e., "not yet eligible for judgment" vs. "eligible now"), the evidence submitted (buyer's video/nonce, if applicable), and a vote action (uphold / reject) once eligible.
- Show the convergence requirement plainly (e.g., "2 of 2 votes needed to resolve" with a live count) so it's clear this isn't a single person's call.

---

## 4. State/status the UI must always make legible

At a glance, for any listing or purchase, someone should be able to tell:
- Is this content **locked** or **unlocked** (for the connected wallet)?
- What is the **current price**, and is it visibly decaying?
- Is this purchase in its **challenge window**, **claimed**, **disputed-but-not-yet-eligible**, or **eligible/resolved**?
- What is the **seller's reputation**?
- If disputed: how many juror votes exist, how many are needed, and has it resolved?

These five pieces of state are the actual product — prioritize making them unmistakable in the UI over any other visual flourish.

---

## 5. Technical notes

- Suggested stack (matches PRD): React + `wagmi`/`viem` (or `ethers.js`) for wallet connection and contract calls, deployed to Vercel or similar.
- Client-side encryption/decryption of content (matches PRD's simple symmetric-key approach) happens in the browser — the raw file should never pass through a server unencrypted.
- Recomputing the "live" decaying price client-side (Section 3.1) should mirror the same lookup-table logic the contract uses, so the displayed number and the actual on-chain price never visibly disagree when a purchase is submitted. If the agent building this can't guarantee exact parity, prefer *slightly conservative* client-side estimates (i.e., never show a price lower than what the contract will actually charge) over the reverse.
- If testnet transaction confirmation times make the demo feel slow, add clear "pending confirmation" states (spinners, "waiting for block confirmation" text) rather than leaving the UI looking frozen or broken.
- Wallet connect should support at least one common testnet-friendly wallet (e.g., MetaMask) and clearly prompt the user to switch networks if they're not on the correct testnet.

---

## 6. Explicitly out of scope for the frontend

- Mobile-responsive design (nice if it falls out naturally, not worth dedicated time)
- Multi-wallet support beyond one standard option
- Account systems, profiles, or notifications beyond what's described above
- Animation beyond the one deliberate "reveal" moment called out in Section 3.2 — no scattered hover effects or entrance animations on every card
- Elaborate onboarding/tutorial flows — the app should be self-explanatory per the assignment's own bar, not walk someone through a tour
