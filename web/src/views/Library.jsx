import { useState } from "react";
import { formatEther } from "viem";
import { useAccount } from "wagmi";
import { CHALLENGE_WINDOW, juryEligibleAt } from "@shared/pricing.js";
import { useUnlockedContent } from "../lib/unlock";
import Redacted from "../components/Redacted";
import SealedPreview from "../components/SealedPreview";
import StateBadge from "../components/StateBadge";
import Countdown from "../components/Countdown";
import { short } from "../config";

function Entry({ row, now, go }) {
  const [open, setOpen] = useState(false);
  const unlocked = useUnlockedContent(row.listing, open);
  const ends = row.purchasedAt + CHALLENGE_WINDOW;
  const inWindow = now && now < ends && Number(row.state) === 1;

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="title" style={{ fontWeight: 600, marginBottom: 4 }}>
            {row.listing.game} — {row.listing.category}
          </div>
          <div className="meta">
            <span>#{row.listing.id.toString()}</span>
            <span>paid {formatEther(row.pricePaid)} ETH</span>
            <span>seller {short(row.listing.seller)}</span>
            <StateBadge state={row.state} />
          </div>
          <div className="meta" style={{ marginTop: 7 }}>
            {inWindow && <span>dispute window closes in <Countdown target={ends} now={now} /></span>}
            {Number(row.state) === 3 && (
              <span style={{ color: "var(--burn)" }}>
                frozen · judgment opens <Countdown target={juryEligibleAt(row.listing.createdAt)} now={now} prefix="in " done="now" />
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost" style={{ padding: "8px 14px", fontSize: 13 }} onClick={() => setOpen((v) => !v)}>
            {open ? "hide" : "reveal"}
          </button>
          <button className="btn ghost" style={{ padding: "8px 14px", fontSize: 13 }} onClick={() => go("listing", row.listing.id.toString())}>
            open
          </button>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 16 }}>
          {unlocked.status === "loading" && <div className="note info"><span className="spin" />{unlocked.stage}…</div>}
          {unlocked.status === "error" && <div className="note err">{unlocked.error}</div>}
          {unlocked.status === "ready" ? (
            <Redacted text={unlocked.text} revealed lines={6} />
          ) : (
            <SealedPreview
              wide
              contentHash={row.listing.contentHash}
              cid={row.listing.storagePointer}
              w={680}
              h={180}
              label="DECRYPTING"
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function Library({ rows, now, go }) {
  const { isConnected } = useAccount();

  return (
    <>
      <div className="page-head">
        <h1>My unlocks</h1>
        <p>Everything this wallet has paid for, and the state of each escrow.</p>
      </div>

      {!isConnected ? (
        <div className="empty"><p>Connect a wallet to see what you have unlocked.</p></div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <p>Nothing unlocked yet. Everything here stays sealed until you pay for it.</p>
          <button className="btn" onClick={() => go("browse")}>Browse the market</button>
        </div>
      ) : (
        rows.map((r) => <Entry key={r.purchaseId.toString()} row={r} now={now} go={go} />)
      )}
    </>
  );
}
