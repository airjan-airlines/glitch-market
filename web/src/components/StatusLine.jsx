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
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { data: bal } = useBalance({ address, query: { enabled: !!address } });

  const wrongChain = isConnected && chainId !== CHAIN.id;
  const injector = connectors.find((c) => c.id === "injected") ?? connectors[0];

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
          {bal && <span className="chip"><s>{Number(bal.formatted).toFixed(5)}</s> ETH</span>}
          <button className="btn ghost" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => disconnect()}>
            {short(address)}
          </button>
        </>
      ) : (
        <button className="btn" style={{ padding: "6px 13px", fontSize: 12 }} disabled={isPending} onClick={() => connect({ connector: injector })}>
          {isPending ? "connecting…" : "connect wallet"}
        </button>
      )}
    </header>
  );
}
