import { useEffect, useState, useMemo } from "react";
import { usePublicClient, useReadContract, useReadContracts, useAccount } from "wagmi";
import { CONTRACT } from "../config";

const POLL = 8000;

/// A clock anchored to CHAIN time, not the browser's.
///
/// This matters: prices are a function of `block.timestamp`. If we ticked off the local clock and
/// it ran fast, the UI would show a more-decayed (lower) price than the contract charges and
/// purchases would revert. We resync to the chain every 15s and interpolate in between.
export function useChainClock() {
  const client = usePublicClient();
  const [anchor, setAnchor] = useState(null);
  const [now, setNow] = useState(0n);

  useEffect(() => {
    if (!client) return;
    let alive = true;
    const sync = async () => {
      try {
        const b = await client.getBlock();
        if (alive) setAnchor({ ts: b.timestamp, at: Date.now() });
      } catch { /* transient RPC hiccup; the next tick retries */ }
    };
    sync();
    const id = setInterval(sync, 15000);
    return () => { alive = false; clearInterval(id); };
  }, [client]);

  useEffect(() => {
    if (!anchor) return;
    const tick = () =>
      setNow(anchor.ts + BigInt(Math.floor((Date.now() - anchor.at) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [anchor]);

  return now;
}

/// All listings, newest first. Enumerated via listingCount + listingView rather than event logs,
/// because free-tier RPCs cap eth_getLogs to a handful of blocks.
export function useListings() {
  const { data: count, refetch: refetchCount } = useReadContract({
    ...CONTRACT,
    functionName: "listingCount",
    query: { refetchInterval: POLL },
  });

  const n = count ? Number(count) : 0;
  const { data, isLoading, refetch } = useReadContracts({
    contracts: Array.from({ length: n }, (_, i) => ({
      ...CONTRACT,
      functionName: "listingView",
      args: [BigInt(i)],
    })),
    query: { enabled: n > 0, refetchInterval: POLL },
  });

  const listings = useMemo(() => {
    if (!data) return [];
    return data
      .map((r, i) => {
        if (r.status !== "success") return null;
        const [listing, price, reputation] = r.result;
        return { id: BigInt(i), ...listing, price, reputation };
      })
      .filter(Boolean)
      .reverse();
  }, [data]);

  return {
    listings,
    isLoading: isLoading && n > 0,
    refetch: () => { refetchCount(); refetch(); },
  };
}

export function useListing(id) {
  const { data, refetch, isLoading } = useReadContract({
    ...CONTRACT,
    functionName: "listingView",
    args: [id],
    query: { enabled: id !== undefined && id !== null, refetchInterval: POLL },
  });
  const listing = data ? { id, ...data[0], price: data[1], reputation: data[2] } : null;
  return { listing, refetch, isLoading };
}

/// Every purchase made by the connected wallet, with its listing attached.
export function useMyPurchases() {
  const { address } = useAccount();
  const { data: ids, refetch: refetchIds } = useReadContract({
    ...CONTRACT,
    functionName: "purchasesOfBuyer",
    args: [address],
    query: { enabled: !!address, refetchInterval: POLL },
  });

  const { data: purchases, refetch: refetchP } = useReadContracts({
    contracts: (ids ?? []).map((pid) => ({ ...CONTRACT, functionName: "getPurchase", args: [pid] })),
    query: { enabled: !!ids?.length, refetchInterval: POLL },
  });

  const { data: listings, refetch: refetchL } = useReadContracts({
    contracts: (purchases ?? [])
      .filter((r) => r.status === "success")
      .map((r) => ({ ...CONTRACT, functionName: "listingView", args: [r.result.listingId] })),
    query: { enabled: !!purchases?.length, refetchInterval: POLL },
  });

  const rows = useMemo(() => {
    if (!ids || !purchases) return [];
    const ok = purchases.map((r, i) => ({ r, pid: ids[i] })).filter((x) => x.r.status === "success");
    return ok
      .map(({ r, pid }, i) => {
        const lr = listings?.[i];
        if (!lr || lr.status !== "success") return null;
        const [listing, price, reputation] = lr.result;
        return { purchaseId: pid, ...r.result, listing: { id: r.result.listingId, ...listing, price, reputation } };
      })
      .filter(Boolean)
      .reverse();
  }, [ids, purchases, listings]);

  return { rows, refetch: () => { refetchIds(); refetchP(); refetchL(); } };
}

/// Purchases against one listing — the eligible juror pool, and the disputes needing judgment.
export function useListingPurchases(listingId) {
  const { data: ids, refetch: refetchIds } = useReadContract({
    ...CONTRACT,
    functionName: "purchasesOfListing",
    args: [listingId],
    query: { enabled: listingId !== undefined && listingId !== null, refetchInterval: POLL },
  });

  const { data, refetch } = useReadContracts({
    contracts: (ids ?? []).map((pid) => ({ ...CONTRACT, functionName: "getPurchase", args: [pid] })),
    query: { enabled: !!ids?.length, refetchInterval: POLL },
  });

  const rows = useMemo(() => {
    if (!ids || !data) return [];
    return data
      .map((r, i) => (r.status === "success" ? { purchaseId: ids[i], ...r.result } : null))
      .filter(Boolean);
  }, [ids, data]);

  return { rows, refetch: () => { refetchIds(); refetch(); } };
}

/// Minimal hash router — GitHub Pages serves no rewrites, so hashes are the reliable choice.
export function useRoute() {
  const parse = () => {
    const h = window.location.hash.replace(/^#\/?/, "");
    const [view, param] = h.split("/");
    return { view: view || "browse", param };
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [route, (view, param) => { window.location.hash = param != null ? `/${view}/${param}` : `/${view}`; }];
}
