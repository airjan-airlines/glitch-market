import { formatEther } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { MIN_JURY_VOTES, juryEligibleAt } from "@shared/pricing.js";
import { useListingPurchases, useListing } from "../lib/hooks";
import { CONTRACT, short } from "../config";
import Countdown from "../components/Countdown";
import TxButton from "../components/TxButton";

function Case({ dispute, listingId, now, refetch }) {
  const { address } = useAccount();
  const { listing } = useListing(listingId);
  const { data: iBought } = useReadContract({
    ...CONTRACT, functionName: "hasPurchased", args: [listingId, address],
    query: { enabled: !!address },
  });
  const { data: iVoted } = useReadContract({
    ...CONTRACT, functionName: "hasVoted", args: [dispute.purchaseId, address],
    query: { enabled: !!address },
  });
  const { data: eligible } = useReadContract({
    ...CONTRACT, functionName: "juryEligible", args: [dispute.purchaseId],
    query: { refetchInterval: 8000 },
  });

  if (!listing) return null;

  const isDisputer = dispute.buyer?.toLowerCase() === address?.toLowerCase();
  const isSeller = listing.seller?.toLowerCase() === address?.toLowerCase();
  const canJudge = iBought && !isDisputer && !isSeller && !iVoted && eligible;
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
        <span>{formatEther(dispute.pricePaid)} ETH frozen</span>
        <span>bond {formatEther(dispute.disputeBond)} ETH</span>
      </div>

      <dl className="kv">
        <dt>evidence hash</dt><dd>{dispute.evidenceHash}</dd>
        <dt>bound nonce</dt><dd>{dispute.nonce}</dd>
        <dt>judgment opens</dt>
        <dd>{eligible ? "now — the secret has decayed" : <Countdown target={juryEligibleAt(listing.createdAt)} now={now} prefix="in " done="now" />}</dd>
      </dl>

      <div style={{ marginTop: 14 }}>
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
          {MIN_JURY_VOTES} independent prior buyers must agree before any money moves.
        </p>
      </div>

      <div style={{ marginTop: 16 }}>
        {!address ? <div className="note info">connect a wallet to judge.</div>
          : !iBought ? <div className="note info">only people who bought this same glitch can judge it — bringing in outsiders would leak the secret to someone who never paid.</div>
          : isDisputer ? <div className="note info">this is your dispute. you cannot judge your own claim.</div>
          : isSeller ? <div className="note info">you are the seller here. you cannot judge your own sale.</div>
          : iVoted ? <div className="note good">you have already voted on this case.</div>
          : !eligible ? <div className="note info">not judgeable yet — the secret is still worth too much to show a jury.</div>
          : null}

        {canJudge && (
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
          Disputes are judged only by people who already bought the same glitch. Anyone else would
          have to be shown the secret to rule on it — which would be a leak, and would hand a
          stranger a working trick for free.
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
