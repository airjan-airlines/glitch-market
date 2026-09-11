import { useEffect, useState } from "react";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { CONTRACT, txUrl } from "../config";

/// Wraps a contract write with the states a testnet demo actually needs to show:
/// signing, waiting for the block, and the resulting error or hash.
export default function TxButton({ fn, args, value, children, className = "btn", disabled, onDone, confirm }) {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: mining, isSuccess } = useWaitForTransactionReceipt({ hash });
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    if (isSuccess && hash) {
      onDone?.(hash);
      const t = setTimeout(reset, 6000);
      return () => clearTimeout(t);
    }
  }, [isSuccess, hash]);

  const fire = () => {
    if (confirm && !asked) return setAsked(true);
    setAsked(false);
    writeContract({ ...CONTRACT, functionName: fn, args, value });
  };

  const busy = isPending || mining;

  return (
    <>
      {asked && (
        <div className="note info">
          {confirm}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn" style={{ padding: "7px 14px", fontSize: 13 }} onClick={fire}>confirm</button>
            <button className="btn ghost" style={{ padding: "7px 14px", fontSize: 13 }} onClick={() => setAsked(false)}>cancel</button>
          </div>
        </div>
      )}
      <button className={className} disabled={disabled || busy} onClick={fire}>
        {busy && <span className="spin" />}
        {isPending ? "check your wallet…" : mining ? "waiting for block…" : children}
      </button>
      {error && (
        <div className="note err" style={{ marginTop: 10 }}>
          {(error.shortMessage || error.message || "transaction failed").split("\n")[0]}
        </div>
      )}
      {isSuccess && hash && (
        <div className="note good" style={{ marginTop: 10 }}>
          confirmed · <a href={txUrl(hash)} target="_blank" rel="noreferrer">view on Basescan</a>
        </div>
      )}
    </>
  );
}
