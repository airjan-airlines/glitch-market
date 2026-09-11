# Black Box Bazaar

A marketplace where speedrunners sell glitches they have found — skips, clips, sequence breaks —
to other runners **who cannot see what they are buying until they have paid for it**.

| | |
|---|---|
| **Live app** | https://airjan-airlines.github.io/glitch-market/ |
| **Contract** | [`0x70B7B754A53f90810d371b25Aa1d316497C3a94F`](https://sepolia.basescan.org/address/0x70B7B754A53f90810d371b25Aa1d316497C3a94F) (verified) |
| **Chain** | Base Sepolia (84532) |
| **Explorer** | https://sepolia.basescan.org/address/0x70B7B754A53f90810d371b25Aa1d316497C3a94F |

---

## The vertical, and why pay-before-inspect is the honest design here

Sellers are players who found a glitch in practice. Buyers are competitive runners chasing a
leaderboard time or preparing for an event, who want the trick before it becomes common knowledge.

Most "sell information on-chain" markets have to impose the pay-before-you-look rule, because the
natural thing would be to let buyers evaluate the goods first. Here it is the other way round: the
rule is forced by the product. **Describing a glitch in any useful detail is the same thing as
giving it away.** A listing that explained the trick well enough to evaluate would have nothing left
to sell. Sealed delivery is not a constraint bolted onto this market; it is the only shape this
market can take.

Two properties of this vertical do real work in the mechanism:

**Value decays, visibly and fast.** A glitch is worth something because few people have it. Every
day it sits listed it is more likely to be found independently, leaked, or patched out — and every
copy sold is one more person who might post it publicly. Price here is a function of both.

**Verification is binary.** Unlike scouting reports, research quality, or governance analysis, a
glitch either works or it does not. Another runner can go try it. That gives disputes something
firm to resolve against, which most black-box-information markets simply do not have.

---

## How it works

**Listing.** The seller's browser encrypts the content (AES-256-GCM), pins the ciphertext to IPFS,
and puts only the hash and the CID on-chain. The hash is a commitment: what gets revealed after
payment must be the file that was committed at listing time, so a seller cannot take the money and
swap in something else. The seller also posts a stake — 5× the asking price while unproven, easing
toward 2× as they accumulate clean sales.

**Pricing.** `price = initial × decay(t) / (1 + α·n)`, where `t` is time since listing and `n` is
copies already sold. `decay(t)` is a precomputed exponential curve stored as a packed table of
fixed-point integers; there is no floating-point or fixed-point exponentiation on-chain. Buy one
copy and watch the next buyer's price move — the economics are visible in the UI, not buried.

**Settlement is optimistic.** No dispute means the seller claims the escrow once a short challenge
window closes. Fast and cheap for the honest case, which is most cases. (The pattern is borrowed
from optimistic oracles like UMA's.)

**Disputing costs something, and freezes rather than refunds.** A buyer who says the glitch does not
work posts a bond and the escrow freezes. It is deliberately *not* an instant refund: if disputing
were free and immediate, any buyer could take the content, dispute, get their money back, and leave
honest sellers permanently griefable. The bond is forfeited if the jury disagrees with them.

**Juries are prior buyers of the same listing, only.** More on this below.

**Reputation** rises on clean sales and falls sharply on a lost dispute, and it sets the stake a
seller has to post next time.

---

## The biggest design decision: patience as the trust primitive

**A frozen dispute cannot be judged until the listing's price has decayed past a threshold.**

The obvious design is to resolve disputes quickly. This does the opposite on purpose.

Judging "does this glitch work?" requires showing the glitch to whoever is judging. Do that while
the secret is still valuable and the resolution process becomes a leak — you have handed the trick
to a jury for free, and a dishonest buyer could dispute purely to force that disclosure. Wait until
the decay curve has eaten most of the value, and showing it to a few people costs the ecosystem
almost nothing, because it is nearly public anyway.

So the mechanism trades speed for containment. Money stays frozen — not refunded, not claimable —
until the thing being argued about is no longer worth much. Time is doing the work that an escrow
agent or an arbitration service would do in a conventional market.

One detail worth flagging: the gate reads **time decay only**, deliberately ignoring the
copies-sold term that also feeds the price. Otherwise a seller could pull a dispute forward into
judgment by manufacturing self-dealt purchases. Elapsed time is the one input no participant can
accelerate.

**The jury is restricted to prior buyers of that same listing.** This follows from the same logic.
Recruiting neutral outside arbiters would mean showing the secret to people who never paid for it —
expanding the leak, and handing a stranger a working glitch in exchange for jury duty. Everyone in
the juror pool has already legitimately seen the content, so judging a dispute never widens the
circle. Two independent prior buyers must converge before any money moves; the disputing buyer
cannot vote on their own claim, and neither can the seller.

---

## Trust assumptions

**What the chain is actually for.** Escrow, tamper-proof commitment, and enforcing pay-before-reveal
— not file hosting. Media never goes on-chain (a video-sized payload would cost a fortune in gas and
likely exceed block limits outright). The chain holds listing metadata, the content hash, the IPFS
pointer, escrow balances, stakes, bonds, dispute state, and reputation. IPFS holds the ciphertext.

**Content availability depends on pinning.** If the pin lapses, the ciphertext becomes unretrievable
even though the on-chain commitment survives. Arweave or paid redundant pinning would fix this.

**Verification is endogenous.** There is no oracle and no patch-note feed. Every input to a dispute
comes from buyers, sellers, and jurors. This is a deliberate choice — an external data feed would
reintroduce exactly the trusted third party the rest of the design removes — but it does mean the
system knows nothing the participants do not tell it.

**Key custody is simplified, and this is the sharpest trust assumption.** The decryption key is held
in contract storage and `revealKey()` gates on proof of purchase. That gating is application-level,
not cryptographic: **contract storage is world-readable, so a determined observer can read the key
straight out of state without paying.** Pay-before-reveal is enforced against ordinary users of the
app, not against someone willing to read raw storage. A production version needs threshold
encryption, a decentralized secret-sharing scheme, or something like Lit Protocol's access control,
where no single on-chain location ever holds the plaintext key. Nothing else in the mechanism —
escrow, commitments, decay, disputes, juries — depends on this shortcut.

---

## One important limitation: the evidence is weak

A disputing buyer submits a hash of their evidence, and the contract binds a nonce it emitted at
purchase time, which the buyer is expected to capture on screen. That stops one attack: old or
unrelated footage cannot be recycled, because it will not contain the right nonce.

**It does nothing about editing.** Hashing a video proves only that it was not swapped after
submission — not that it is a genuine, unedited recording of a real attempt. A buyer who is willing
to doctor footage can produce evidence this system cannot distinguish from the real thing. Jurors
are prior buyers who can go attempt the trick themselves, which is the actual defence, but the
recorded evidence on its own should be read as a weak signal.

The real fix is input-log replay, below.

### What full-fidelity verification would look like (understood, not built)

The strongest possible mechanism is **TAS-style input replay**: the buyer submits their raw input
sequence, and it is replayed deterministically against the actual game binary in an emulator. That
produces an objective, automated yes-or-no on whether the glitch works, with no jury and no
subjective judgment at all — and it is precisely the kind of verification this vertical uniquely
admits. It is out of scope here because it requires possessing and running licensed game and
emulator infrastructure, which is a genuine copyright and engineering undertaking rather than a
weekend feature.

Also deliberately excluded: **patch-note oracles** (a patch is good evidence a glitch was real, but
consuming an official feed reintroduces a trusted external dependency) and **zero-knowledge proofs
of glitch validity** (research-grade difficulty).

---

## Demo timings are compressed

The challenge window is **3 minutes** and the decay curve steps every **30 seconds**, so a dispute
becomes judgeable about 3.5 minutes after listing. A real market would run these over hours or days.
They are short so the entire lifecycle fits in a video.

This matters more than it might seem: you cannot fast-forward `block.timestamp` on a public testnet
the way you can locally, so the live demo depends on constants that are genuinely short in real
time rather than on any time-travel trick.

---

## Before recording the demo

Decay is compressed for video, which means a listing reaches its floor price in roughly twenty
minutes. **Seed fresh listings immediately before filming** or the market will look flat:

```bash
node scripts/seed.mjs      # three fresh listings, ~0.0001 ETH of stake total
```

Then record within about ten minutes, while prices are still visibly falling. `scripts/reclaim.mjs`
closes finished listings and returns the seller's stake afterwards.

## Running it

```bash
# contracts
cd contracts && forge test            # 34 tests
forge test --match-test Jury -vvv     # one group, verbose

# full lifecycle against the deployed contract and real IPFS (~5 min, mostly waiting)
npm install
npm run e2e                           # list -> buy -> decay -> dispute -> freeze -> jury -> payout
node scripts/e2e.mjs --happy          # list -> buy -> decay -> seller claims

# frontend
cd web && npm run dev
```

`.env` needs `BASE_SEPOLIA_RPC_URL`, `ETHERSCAN_API_KEY`, `PINATA_JWT`, and the four demo keys.
Listing from the deployed app asks for a Pinata JWT in the browser — it is stored locally and never
compiled into the published page, so the public build ships no credentials. Browsing, buying and
judging need nothing.

## Layout

```
contracts/src/GlitchMarket.sol   mechanism: pricing, escrow, disputes, jury, reputation
contracts/test/                  34 tests across pricing, both settlement paths, juror rules
shared/pricing.js                client mirror of the contract's integer price math
shared/crypto.js                 AES-256-GCM, shared by browser and scripts
web/                             React + wagmi/viem frontend
scripts/e2e.mjs                  end-to-end exercise against the live deployment
NOTES.md                         every deviation and judgment call made during the build
```

`NOTES.md` is worth reading alongside this — it records the decisions, the things that went wrong,
and why the timings and economics are sized the way they are.
