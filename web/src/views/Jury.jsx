
import { useAccount, useReadContract } from "wagmi";
import { MIN_JURY_VOTES, juryEligibleAt, openJuryAt, timeoutAt } from "@shared/pricing.js";
import { useListingPurchases, useListing } from "../lib/hooks";
import { CONTRACT, short, fmtEth } from "../config";
import { bytes32ToCid } from "@shared/cid.js";
import { DEFAULT_GATEWAY } from "@shared/storage.js";
import Countdown from "../components/Countdown";
import TxButton from "../components/TxButton";

const TIER_LABEL = {
  0: "sealed — too valuable to show a jury yet",
  1: "open to prior buyers of this listing",
  2: "open to anyone",
};

function Case({ dispute, listingId, now, refetch }) {
  const { address } = useAccount();
  const { listing } = useListing(listingId);
  const poll = { refetchInterval: 8000 };

  const { data: tier } = useReadContract({ ...CONTRACT, functionName: "juryTier", args: [dispute.purchaseId], query: poll });
  const { data: mayVote } = useReadContract({
    ...CONTRACT, functionName: "canVote", args: [dispute.purchaseId, address],
    query: { ...poll, enabled: !!address },
  });
  const { data: timedOut } = useReadContract({ ...CONTRACT, functionName: "timeoutReady", args: [dispute.purchaseId], query: poll });
  const { data: iBought } = useReadContract({
    ...CONTRACT, functionName: "hasPurchased", args: [listingId, address], query: { enabled: !!address },
  });

  const evidenceCid = bytes32ToCid(dispute.evidenceHash);

  if (!listing) return null;

  const t = Number(tier ?? 0);
  const isDisputer = dispute.buyer?.toLowerCase() === address?.toLowerCase();
  const isSeller = listing.seller?.toLowerCase() === address?.toLowerCase();
  const forBuyer = Number(dispute.votesForBuyer);
  const forSeller = Number(dispute.votesForSeller);

  return (
    <div className="panel">
      <div className="title" style={{ fontWeight: 600, marginBottom: 4 }}>
        {listing.game} — {listing.category}
      </div>
      <div className="meta" style={{ marginBottom: 12 }}>
        <span>listing #{listingId.toString()}</span>
        <span>purchase #{dispute.purchaseId.toString()}</span>
        <span>disputed by {short(dispute.buyer)}</span>
        <span>{fmtEth(dispute.pricePaid)} ETH frozen</span>
        <span>bond {fmtEth(dispute.disputeBond)} ETH</span>
      </div>

      <dl className="kv">
        <dt>evidence</dt>
        <dd>
          {evidenceCid ? (
            <>
              <a href={DEFAULT_GATEWAY + evidenceCid} target="_blank" rel="noreferrer">{evidenceCid}</a>
              <div style={{ color: "var(--ash)", marginTop: 3 }}>
                the buyer's own attempt — watch it, then go try the trick yourself
              </div>
            </>
          ) : (
            <span style={{ color: "var(--ash)" }}>no retrievable file ({dispute.evidenceHash.slice(0, 18)}…)</span>
          )}
        </dd>
        <dt>bound nonce</dt><dd>{dispute.nonce}</dd>
      </dl>

      {/* The pool widens as the secret loses value. Showing all three stages makes the
          patience-as-trust argument legible instead of hiding it in the contract. */}
      <div className="tiers">
        <div className={`tier ${t >= 1 ? "on" : ""}`}>
          <b>prior buyers</b>
          <span>{t >= 1 ? "open" : <Countdown target={juryEligibleAt(listing.createdAt)} now={now} prefix="in " />}</span>
        </div>
        <div className={`tier ${t >= 2 ? "on" : ""}`}>
          <b>anyone</b>
          <span>{t >= 2 ? "open" : <Countdown target={openJuryAt(listing.createdAt)} now={now} prefix="in " />}</span>
        </div>
        <div className={`tier ${timedOut ? "on warn" : ""}`}>
          <b>default to seller</b>
          <span>{timedOut ? "available" : <Countdown target={timeoutAt(listing.createdAt)} now={now} prefix="in " />}</span>
        </div>
      </div>
      <p className="hint" style={{ margin: "8px 0 0" }}>Currently {TIER_LABEL[t]}.</p>

      <div style={{ marginTop: 16 }}>
        <div className="meta" style={{ marginBottom: 4 }}>
          <span>{forBuyer} of {MIN_JURY_VOTES} for the buyer</span>
          <span>{forSeller} of {MIN_JURY_VOTES} for the seller</span>
        </div>
        <div className="votebar">
          {Array.from({ length: MIN_JURY_VOTES }, (_, i) => (
            <i key={`b${i}`} className={i < forBuyer ? "on" : ""} />
          ))}
        </div>
        <p className="hint" style={{ margin: "6px 0 0" }}>
          {MIN_JURY_VOTES} independent jurors must agree before any money moves.
        </p>
      </div>

      <div style={{ marginTop: 16 }}>
        {!address ? <div className="note info">connect a wallet to judge.</div>
          : isDisputer ? <div className="note info">this is your dispute. you cannot judge your own claim.</div>
          : isSeller ? <div className="note info">you are the seller here. you cannot judge your own sale.</div>
          : t === 0 ? <div className="note info">not judgeable yet — the secret is still worth too much to show a jury.</div>
          : t === 1 && !iBought ? (
            <div className="note info">
              only people who bought this same glitch can judge it right now — bringing in outsiders
              while it is still valuable would leak the secret to someone who never paid. The pool
              opens to everyone once the price has decayed further.
            </div>
          ) : !mayVote ? <div className="note good">you have already voted on this case.</div>
          : null}

        {mayVote && (
          <div className="grid-2">
            <TxButton className="btn" fn="vote" args={[dispute.purchaseId, true]} onDone={refetch}
              confirm="You are voting that the glitch does NOT work, siding with the buyer.">
              The glitch does not work
            </TxButton>
            <TxButton className="btn ghost" fn="vote" args={[dispute.purchaseId, false]} onDone={refetch}
              confirm="You are voting that the glitch DOES work, siding with the seller.">
              It works — reject the dispute
            </TxButton>
          </div>
        )}

        {timedOut && (
          <div style={{ marginTop: 12 }}>
            <p className="hint" style={{ marginTop: 0 }}>
              No jury ever converged and the content is worthless now. Anyone can close this out:
              the seller is paid by default and the buyer's bond is returned, because nothing was
              proven either way.
            </p>
            <TxButton className="btn ghost" fn="forceResolve" args={[dispute.purchaseId]} onDone={refetch}
              confirm="This pays the seller and returns the buyer's bond. It records no fault against either side.">
              Close by default
            </TxButton>
          </div>
        )}
      </div>
    </div>
  );
}

function ListingCases({ listingId, now }) {
  const { rows, refetch } = useListingPurchases(listingId);
  const disputes = rows.filter((r) => Number(r.state) === 3);
  if (!disputes.length) return null;
  return disputes.map((d) => (
    <Case key={d.purchaseId.toString()} dispute={d} listingId={listingId} now={now} refetch={refetch} />
  ));
}

export default function Jury({ listings, now }) {
  return (
    <>
      <div className="page-head">
        <h1>Jury duty</h1>
        <p>
          Disputes are judged by people who already bought the same glitch, so ruling on one never
          shows the secret to anyone new. As the price decays the content stops being worth
          protecting, and the pool widens — first to those buyers, then to anyone. If nobody ever
          rules, the escrow defaults to the seller rather than freezing forever.
        </p>
      </div>
      {listings.length === 0 ? (
        <div className="empty"><p>No listings yet, so nothing to judge.</p></div>
      ) : (
        <>
          {listings.map((l) => <ListingCases key={l.id.toString()} listingId={l.id} now={now} />)}
          <div className="empty" style={{ marginTop: 14 }}>
            <p style={{ margin: 0, fontSize: 13 }}>
              Open disputes appear here automatically. If you see nothing, no purchase is currently frozen.
            </p>
          </div>
        </>
      )}
    </>
  );
}
