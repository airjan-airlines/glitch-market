import { useMemo } from "react";
import { useRoute, useChainClock, useListings, useMyPurchases } from "./lib/hooks";
import StatusLine from "./components/StatusLine";
import Browse from "./views/Browse";
import Detail from "./views/Detail";
import Library from "./views/Library";
import Sell from "./views/Sell";
import Jury from "./views/Jury";
import { DEPLOYMENT, EXPLORER } from "./config";

export default function App() {
  const [route, go] = useRoute();
  const now = useChainClock();
  const { listings, isLoading } = useListings();
  const { rows } = useMyPurchases();

  const unlockedIds = useMemo(
    () => new Set(rows.map((r) => r.listingId.toString())),
    [rows]
  );

  return (
    <>
      <StatusLine route={route} go={go} />
      <main>
        {route.view === "listing" && route.param != null ? (
          <Detail id={BigInt(route.param)} now={now} go={go} />
        ) : route.view === "library" ? (
          <Library rows={rows} now={now} go={go} />
        ) : route.view === "sell" ? (
          <Sell go={go} />
        ) : route.view === "jury" ? (
          <Jury listings={listings} now={now} />
        ) : (
          <Browse listings={listings} isLoading={isLoading} now={now} unlockedIds={unlockedIds} go={go} />
        )}

        <footer style={{ marginTop: 48, paddingTop: 18, borderTop: "1px solid var(--line)", fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--ash)" }}>
          <div>
            {DEPLOYMENT.chainName} · <a href={`${EXPLORER}/address/${DEPLOYMENT.address}`} target="_blank" rel="noreferrer">{DEPLOYMENT.address}</a>
          </div>
          <div style={{ marginTop: 5 }}>
            Demo timings are compressed: a 3-minute challenge window and a decay curve stepped every
            30 seconds. A real market would run these over days.
          </div>
        </footer>
      </main>
    </>
  );
}
