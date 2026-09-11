// Mirror of GlitchMarket's on-chain pricing, so the UI and the contract never disagree.
// Every value here must match src/GlitchMarket.sol exactly. All math is integer/BigInt:
// no floating point, same as the contract.

export const BPS = 10_000n;
export const DECAY_STEP = 30n; // seconds per table entry
export const CHALLENGE_WINDOW = 180n; // 3 minutes
export const JURY_THRESHOLD_BPS = 6_000n;      // tier 1: prior buyers of this listing
export const OPEN_JURY_THRESHOLD_BPS = 1_000n; // tier 2: anyone
export const TIMEOUT_THRESHOLD_BPS = 200n;     // tier 3: default to seller
export const MIN_JURY_VOTES = 2;
export const ALPHA_BPS = 5_000n;
export const DISPUTE_BOND_BPS = 5_000n;

/// e^(-0.0851 * i) scaled by 1e4, i in [0, 80). Identical to the contract's packed table.
export const DECAY_TABLE = [
  10000, 9184, 8435, 7747, 7115, 6534, 6001, 5512, 5062, 4649, 4270, 3922, 3601, 3308, 3038, 2790,
  2562, 2353, 2161, 1985, 1823, 1674, 1537, 1412, 1296, 1191, 1094, 1004, 922, 847, 778, 714,
  656, 602, 553, 508, 466, 428, 393, 361, 332, 305, 280, 257, 236, 217, 199, 183,
  168, 154, 141, 130, 119, 110, 101, 92, 85, 78, 71, 66, 61, 56, 51, 47,
  43, 40, 36, 33, 31, 28, 26, 24, 22, 20, 18, 17, 16, 14, 13, 12,
];

export function decayFactor(stepIndex) {
  const i = stepIndex >= DECAY_TABLE.length ? DECAY_TABLE.length - 1 : Number(stepIndex);
  return BigInt(DECAY_TABLE[i < 0 ? 0 : i]);
}

/// Exact mirror of `currentPrice(uint256)`.
/// `now` and `createdAt` are BigInt unix seconds; pass CHAIN time, not the browser clock.
export function currentPrice({ initialPrice, minPrice, createdAt, copiesSold }, now) {
  const elapsed = now > createdAt ? now - createdAt : 0n;
  const factor = decayFactor(elapsed / DECAY_STEP);
  let p = (initialPrice * factor) / BPS;
  p = (p * BPS) / (BPS + ALPHA_BPS * copiesSold);
  return p < minPrice ? minPrice : p;
}

/// What to actually send with `purchase()`.
///
/// The displayed price ticks live off the browser clock, which can run ahead of chain time. Ahead
/// means the UI would compute a MORE decayed (lower) price than the contract will charge, and the
/// purchase would revert. So we send the price as of one decay step EARLIER — always >= what the
/// contract charges. The contract refunds the difference, so the buyer is never overcharged.
export function priceToSend(listing, now) {
  const safeNow = now > DECAY_STEP ? now - DECAY_STEP : 0n;
  const conservative = currentPrice(listing, safeNow);
  const live = currentPrice(listing, now);
  return conservative > live ? conservative : live;
}

function thresholdAt(createdAt, bps) {
  for (let i = 0; i < DECAY_TABLE.length; i++) {
    if (BigInt(DECAY_TABLE[i]) <= bps) return createdAt + BigInt(i) * DECAY_STEP;
  }
  return createdAt + BigInt(DECAY_TABLE.length) * DECAY_STEP;
}

/// When prior buyers of this listing may start judging. Mirrors `juryEligibleAt`.
export const juryEligibleAt = (createdAt) => thresholdAt(createdAt, JURY_THRESHOLD_BPS);

/// When the juror pool opens to everyone. Mirrors `openJuryAt`.
export const openJuryAt = (createdAt) => thresholdAt(createdAt, OPEN_JURY_THRESHOLD_BPS);

/// When an unjudged dispute can be defaulted to the seller. Mirrors `timeoutAt`.
export const timeoutAt = (createdAt) => thresholdAt(createdAt, TIMEOUT_THRESHOLD_BPS);

/// Who may judge right now: 0 nobody, 1 prior buyers, 2 anyone. Mirrors `juryTier`.
export function juryTier(createdAt, now) {
  const elapsed = now > createdAt ? now - createdAt : 0n;
  const d = decayFactor(elapsed / DECAY_STEP);
  if (d <= OPEN_JURY_THRESHOLD_BPS) return 2;
  if (d <= JURY_THRESHOLD_BPS) return 1;
  return 0;
}

export function disputeBondFor(pricePaid) {
  return (pricePaid * DISPUTE_BOND_BPS) / BPS;
}

export const PurchaseState = {
  0: "None",
  1: "Escrowed",
  2: "Claimed",
  3: "Disputed",
  4: "RefundedToBuyer",
  5: "AwardedToSeller",
};
