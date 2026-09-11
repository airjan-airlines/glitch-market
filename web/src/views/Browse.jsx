
import PriceTicker from "../components/PriceTicker";
import SealedPreview from "../components/SealedPreview";
import { short, fmtEth } from "../config";

function Row({ listing, now, unlocked, go }) {
  const dead = !listing.active;
  return (
    <button
      className={`row ${unlocked ? "unlocked" : ""} ${dead ? "dead" : ""}`}
      onClick={() => go("listing", listing.id.toString())}
    >
      <SealedPreview
        contentHash={listing.contentHash}
        cid={listing.storagePointer}
        w={190}
        h={104}
        label={unlocked ? "UNLOCKED" : "SEALED"}
      />
      <div>
        <div className="title">
          {listing.game} — {listing.category}
        </div>
        <div className="teaser">{listing.teaser}</div>
        <div className="meta">
          <span>#{listing.id.toString()}</span>
          <span>{listing.copiesSold.toString()} sold</span>
          <span>seller {short(listing.seller)}</span>
          <span>rep {listing.reputation.toString()}</span>
          <span>stake {fmtEth(listing.stake)}</span>
          {unlocked && <span style={{ color: "var(--signal)" }}>unlocked</span>}
          {dead && <span style={{ color: "var(--burn)" }}>delisted</span>}
        </div>
      </div>
      <div className="price-cell">
        <PriceTicker listing={listing} now={now} />
      </div>
    </button>
  );
}

export default function Browse({ listings, isLoading, now, unlockedIds, go }) {
  return (
    <>
      <div className="page-head">
        <h1>Glitches for sale</h1>
        <p>
          Every listing is sealed. You pay before you look — that is the point, because a skip that
          anyone can read for free is worth nothing. Prices fall as a secret ages and as more copies
          go out the door.
        </p>
      </div>

      {isLoading && <div className="note info"><span className="spin" />reading the chain…</div>}

      {!isLoading && listings.length === 0 ? (
        <div className="empty">
          <p>No glitches listed yet — be the first to sell one.</p>
          <button className="btn" onClick={() => go("sell")}>Sell a glitch</button>
        </div>
      ) : (
        <div className="rows">
          {listings.map((l) => (
            <Row
              key={l.id.toString()}
              listing={l}
              now={now}
              unlocked={unlockedIds.has(l.id.toString())}
              go={go}
            />
          ))}
        </div>
      )}
    </>
  );
}
