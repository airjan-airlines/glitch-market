import { currentPrice } from "@shared/pricing.js";
import { fmtEth } from "../config";

/// The live decaying price. Recomputed every second off the chain-anchored clock using the exact
/// integer math the contract uses, so what a buyer sees is what they are charged.
export default function PriceTicker({ listing, now, settled }) {
  if (!now) return <div className="amt mono">—</div>;
  const price = currentPrice(listing, now);
  const atFloor = price <= listing.minPrice;
  return (
    <>
      <div className={`amt mono ${settled ? "settled" : ""}`}>{fmtEth(price)}</div>
      <div className={`sub ${!settled && !atFloor ? "falling" : ""}`}>
        {settled ? "ETH paid" : atFloor ? "ETH · at floor" : "ETH · decaying"}
      </div>
    </>
  );
}
