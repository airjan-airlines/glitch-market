import { formatEther } from "viem";
import { useAccount } from "wagmi";
import { priceToSend, currentPrice, disputeBondFor, CHALLENGE_WINDOW, juryEligibleAt } from "@shared/pricing.js";
import { useListing, useListingPurchases } from "../lib/hooks";
import { useUnlockedContent } from "../lib/unlock";
import PriceTicker from "../components/PriceTicker";
import UnlockedContent from "../components/UnlockedContent";
import SealedPreview from "../components/SealedPreview";
import DisputeForm from "../components/DisputeForm";
import Countdown from "../components/Countdown";
import StateBadge from "../components/StateBadge";
import TxButton from "../components/TxButton";
import { short, addrUrl, DEPLOYMENT } from "../config";

export default function Detail({ id, now, go }) {
  const { address } = useAccount();
  const { listing, refetch } = useListing(id);
  const { rows, refetch: refetchP } = useListingPurchases(id);
  const mine = rows.find((r) => r.buyer?.toLowerCase() === address?.toLowerCase());
  const unlocked = useUnlockedContent(listing, !!mine);

  if (!listing) return <div className="note info"><span className="spin" />loading listing…</div>;

  const isSeller = listing.seller?.toLowerCase() === address?.toLowerCase();
  const price = now ? currentPrice(listing, now) : listing.price;
  const windowEnds = mine ? mine.purchasedAt + CHALLENGE_WINDOW : null;
  const inWindow = windowEnds && now && now < windowEnds;
  const after = () => { refetch(); refetchP(); };

  return (
    <>
      <button className="back" onClick={() => go("browse")}>← back to the market</button>

      <div className="page-head">
        <h1>{listing.game} — {listing.category}</h1>
        <p>{listing.teaser}</p>
      </div>

      <div className="panel">
        <h2>{mine ? "unlocked content" : "sealed content"}</h2>
        {!mine && (
          <p style={{ color: "var(--ash-2)", fontSize: 13.5, marginTop: 0 }}>
            Locked until you pay. What you are buying is committed to on-chain by the hash below —
            the seller cannot swap the file after you buy.
          </p>
        )}
        {unlocked.status === "loading" && (
          <div className="note info"><span className="spin" />{unlocked.stage}…</div>
        )}
        {unlocked.status === "error" && <div className="note err">could not unlock: {unlocked.error}</div>}
        {unlocked.status === "ready" && !unlocked.hashOk && (
          <div className="note err">
            warning: the file fetched from IPFS does not match the hash committed at listing time.
          </div>
        )}
        {unlocked.status === "ready" ? (
          <UnlockedContent unlocked={unlocked} />
        ) : (
          <SealedPreview
            wide
            contentHash={listing.contentHash}
            cid={listing.storagePointer}
            w={680}
            h={220}
            label={mine ? "DECRYPTING" : "SEALED"}
          />
        )}
        {unlocked.status === "ready" && unlocked.hashOk && (
          <div className="note good" style={{ marginTop: 12 }}>
            file matches the on-chain commitment {listing.contentHash.slice(0, 18)}…
          </div>
        )}
      </div>

      <div className="panel">
        <h2>the deal</h2>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 20, flexWrap: "wrap" }}>
          <dl className="kv" style={{ flex: 1, minWidth: 280 }}>
            <dt>listed</dt><dd>{new Date(Number(listing.createdAt) * 1000).toLocaleString()}</dd>
            <dt>copies sold</dt><dd>{listing.copiesSold.toString()}</dd>
            <dt>seller</dt><dd><a href={addrUrl(listing.seller)} target="_blank" rel="noreferrer">{short(listing.seller)}</a></dd>
            <dt>seller reputation</dt><dd>{listing.reputation.toString()}</dd>
            <dt>seller stake</dt><dd>{formatEther(listing.stake)} ETH at risk</dd>
            <dt>opening price</dt><dd>{formatEther(listing.initialPrice)} ETH</dd>
            <dt>floor</dt><dd>{formatEther(listing.minPrice)} ETH</dd>
            <dt>content hash</dt><dd>{listing.contentHash}</dd>
            <dt>ipfs</dt><dd>{listing.storagePointer}</dd>
          </dl>
          <div className="price-cell" style={{ minWidth: 168 }}>
            <PriceTicker listing={listing} now={now} settled={!!mine} />
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          {!address ? (
            <div className="note info">connect a wallet to buy.</div>
          ) : isSeller ? (
            <div className="note info">this is your listing — you cannot buy your own glitch.</div>
          ) : mine ? (
            <div className="note good">you own this. it is in your unlocks.</div>
          ) : !listing.active ? (
            <div className="note err">this listing was delisted after losing a dispute.</div>
          ) : (
            <TxButton
              className="btn big"
              fn="purchase"
              args={[listing.id]}
              value={now ? priceToSend(listing, now) : listing.price}
              onDone={after}
            >
              Unlock for {formatEther(price)} ETH
            </TxButton>
          )}
        </div>
      </div>

      {mine && (
        <div className="panel">
          <h2>your purchase</h2>
          <dl className="kv">
            <dt>status</dt><dd><StateBadge state={mine.state} /></dd>
            <dt>paid</dt><dd>{formatEther(mine.pricePaid)} ETH</dd>
            <dt>challenge window</dt>
            <dd>
              {Number(mine.state) !== 1 ? "closed" : inWindow
                ? <>open — <Countdown target={windowEnds} now={now} done="closing" /> left to dispute</>
                : "closed — the seller can claim"}
            </dd>
            <dt>evidence nonce</dt><dd>{mine.nonce}</dd>
          </dl>

          {Number(mine.state) === 1 && inWindow && (
            <DisputeForm purchase={mine} onDone={after} />
          )}

          {Number(mine.state) === 3 && (
            <div className="note info" style={{ marginTop: 14 }}>
              frozen. judgment opens{" "}
              <Countdown target={juryEligibleAt(listing.createdAt)} now={now} prefix="in " done="now" />
              {" "}— once the secret has decayed enough that showing it to a jury costs little.{" "}
              <a href="#/jury" onClick={() => go("jury")}>track it in jury duty</a>.
            </div>
          )}
        </div>
      )}

      {isSeller && (
        <div className="panel">
          <h2>seller controls</h2>
          {rows.filter((r) => Number(r.state) === 1).length === 0 && (
            <p style={{ color: "var(--ash-2)", fontSize: 13.5, marginTop: 0 }}>Nothing to claim right now.</p>
          )}
          {rows.filter((r) => Number(r.state) === 1).map((r) => {
            const ends = r.purchasedAt + CHALLENGE_WINDOW;
            const ready = now && now >= ends;
            return (
              <div key={r.purchaseId.toString()} style={{ marginBottom: 14 }}>
                <div className="meta" style={{ marginBottom: 7 }}>
                  purchase #{r.purchaseId.toString()} · {short(r.buyer)} · {formatEther(r.pricePaid)} ETH ·{" "}
                  {ready ? "claimable" : <>claimable in <Countdown target={ends} now={now} /></>}
                </div>
                <TxButton className="btn" fn="claim" args={[r.purchaseId]} disabled={!ready} onDone={after}>
                  Claim {formatEther(r.pricePaid)} ETH
                </TxButton>
              </div>
            );
          })}
          <p className="hint" style={{ marginTop: 12 }}>
            contract {DEPLOYMENT.address} on {DEPLOYMENT.chainName}
          </p>
        </div>
      )}
    </>
  );
}
