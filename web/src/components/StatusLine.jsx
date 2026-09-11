import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain, useBalance } from "wagmi";
import { CHAIN, short } from "../config";

const TABS = [
  ["browse", "market"],
  ["library", "my unlocks"],
  ["sell", "sell a glitch"],
  ["jury", "jury duty"],
];

export default function StatusLine({ route, go }) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { data: bal } = useBalance({ address, query: { enabled: !!address } });
  const [open, setOpen] = useState(false);

  // A browser with no wallet extension still reports a configured `injected` connector, so
  // clicking it just fails. Detect the real thing and say so, instead of dying silently.
  const [hasProvider, setHasProvider] = useState(true);
  useEffect(() => {
    const check = () => setHasProvider(typeof window !== "undefined" && !!window.ethereum);
    check();
    // MetaMask can inject slightly after first paint.
    const t = setTimeout(check, 1200);
    return () => clearTimeout(t);
  }, []);

  // EIP-6963 discovery adds one connector per installed wallet; offer a choice when there is one.
  const discovered = connectors.filter((c) => c.id !== "injected");
  const wallets = discovered.length > 0 ? discovered : connectors;
  const walletAvailable = hasProvider || discovered.length > 0;
  const wrongChain = isConnected && chainId !== CHAIN.id;

  const start = (connector) => {
    reset();
    setOpen(false);
    connect({ connector });
  };

  const onConnectClick = () => {
    if (!walletAvailable) return setOpen((v) => !v);
    if (wallets.length > 1) return setOpen((v) => !v);
    start(wallets[0]);
  };

  return (
    <header className="statusline">
      <span className="brand">
        BLACK BOX <b>BAZAAR</b>
      </span>

      <nav className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} aria-current={route.view === id} onClick={() => go(id)}>
            {label}
          </button>
        ))}
      </nav>

      <span className="spacer" />

      {wrongChain ? (
        <button className="btn danger" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => switchChain({ chainId: CHAIN.id })}>
          <span className="dot bad" />switch to Base Sepolia
        </button>
      ) : (
        <span className="chip">
          <span className={`dot ${isConnected ? "ok" : "bad"}`} />
          {CHAIN.name}
        </span>
      )}

      {isConnected ? (
        <>
          {Number.isFinite(Number(bal?.formatted)) && (
            <span className="chip"><s>{Number(bal.formatted).toFixed(5)}</s> ETH</span>
          )}
          <button className="btn ghost" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => disconnect()}>
            {short(address)}
          </button>
        </>
      ) : (
        <span className="wallet">
          <button
            className={walletAvailable ? "btn" : "btn ghost"}
            style={{ padding: "6px 13px", fontSize: 12 }}
            disabled={isPending}
            onClick={onConnectClick}
          >
            {isPending ? "check your wallet…" : walletAvailable ? "connect wallet" : "no wallet found"}
          </button>

          {(open || error) && (
            <div className="wallet-pop">
              {!walletAvailable && (
                <>
                  <b>No browser wallet detected.</b>
                  <p>
                    This page needs an injected wallet such as MetaMask, in a normal (non-incognito)
                    window with the extension enabled for this site.
                  </p>
                  <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                    Install MetaMask →
                  </a>
                  <p className="dim">
                    Then set the network to Base Sepolia. You can browse and read every listing
                    without a wallet — only buying, listing and voting need one.
                  </p>
                </>
              )}

              {walletAvailable && wallets.length > 1 && !error && (
                <>
                  <b>Choose a wallet</b>
                  {wallets.map((c) => (
                    <button key={c.uid} className="btn ghost" style={{ width: "100%", marginTop: 6, padding: "7px 10px", fontSize: 12 }} onClick={() => start(c)}>
                      {c.name}
                    </button>
                  ))}
                </>
              )}

              {error && (
                <>
                  <b className="bad">Could not connect</b>
                  <p>{(error.shortMessage || error.message || "unknown error").split("\n")[0]}</p>
                  <p className="dim">
                    If your wallet did not open, check that its extension is enabled for this site
                    and that no pending request is waiting in it.
                  </p>
                  <button className="btn ghost" style={{ padding: "6px 11px", fontSize: 12 }} onClick={() => { reset(); setOpen(false); }}>
                    dismiss
                  </button>
                </>
              )}
            </div>
          )}
        </span>
      )}
    </header>
  );
}
