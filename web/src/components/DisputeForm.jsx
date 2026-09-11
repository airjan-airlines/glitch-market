import { useState } from "react";
import { formatEther } from "viem";
import { disputeBondFor } from "@shared/pricing.js";
import { pinToIPFS } from "@shared/storage.js";
import { cidToBytes32 } from "@shared/cid.js";
import { getPinataJwt, setPinataJwt, JWT_IS_BUILTIN } from "../config";
import TxButton from "./TxButton";

/// Raising a dispute, with evidence that actually exists.
///
/// The buyer's file is pinned to IPFS and the CID's own digest goes on-chain as `evidenceHash`.
/// That single bytes32 is both a commitment to the file and a pointer to it, so a juror can fetch
/// and watch the exact bytes that were committed. Hashing a string nobody can resolve would prove
/// nothing to anyone.
///
/// The purchase nonce must appear on screen in the recording. That blocks recycled footage from an
/// unrelated attempt — it does NOT prove the footage is unedited, which stays an open weakness.
export default function DisputeForm({ purchase, onDone }) {
  const [file, setFile] = useState(null);
  const [jwt, setJwt] = useState(getPinataJwt());
  const [prep, setPrep] = useState({ status: "idle" });
  const [copied, setCopied] = useState(false);

  const bond = disputeBondFor(purchase.pricePaid);

  async function prepare() {
    setPrep({ status: "working" });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const cid = await pinToIPFS(bytes, `evidence-${purchase.purchaseId}-${Date.now()}`, getPinataJwt());
      const hash = cidToBytes32(cid);
      if (!hash) throw new Error(`Pinata returned a CID this contract cannot store: ${cid}`);
      setPrep({ status: "ready", cid, hash, size: bytes.length });
    } catch (e) {
      setPrep({ status: "error", error: e.message });
    }
  }

  const copyNonce = async () => {
    try {
      await navigator.clipboard.writeText(purchase.nonce);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked; the nonce is displayed anyway */ }
  };

  return (
    <div style={{ marginTop: 16 }}>
      <p style={{ fontSize: 13.5, color: "var(--ash-2)" }}>
        If the glitch does not work, dispute it. This costs a bond of{" "}
        <b className="mono">{formatEther(bond)} ETH</b> and freezes the seller's payment — it does
        not refund you on the spot, and you lose the bond if the jury sides with the seller.
      </p>

      <div className="note info">
        <b style={{ display: "block", marginBottom: 4 }}>Show this nonce on screen in your recording</b>
        <code style={{ wordBreak: "break-all", fontSize: 11 }}>{purchase.nonce}</code>
        <button className="btn ghost" style={{ padding: "5px 10px", fontSize: 11.5, marginTop: 8 }} onClick={copyNonce}>
          {copied ? "copied" : "copy nonce"}
        </button>
      </div>

      {!JWT_IS_BUILTIN && (
        <label>
          <span>pinata jwt — needed to pin your evidence</span>
          <input
            type="password"
            value={jwt}
            placeholder="paste a Pinata JWT"
            onChange={(e) => { setJwt(e.target.value); setPinataJwt(e.target.value); }}
          />
        </label>
      )}

      <label>
        <span>your attempt — video, or any file</span>
        <input
          type="file"
          accept="video/*,image/*,text/*,application/pdf"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPrep({ status: "idle" }); }}
        />
      </label>
      {file && <p className="hint">{file.name} · {(file.size / 1024).toFixed(1)} KB</p>}

      {prep.status === "idle" && (
        <button className="btn ghost" onClick={prepare} disabled={!file || !jwt}>
          Upload evidence
        </button>
      )}
      {prep.status === "working" && <div className="note info"><span className="spin" />pinning evidence to IPFS…</div>}
      {prep.status === "error" && (
        <>
          <div className="note err">upload failed: {prep.error}</div>
          <button className="btn ghost" onClick={prepare}>try again</button>
        </>
      )}

      {prep.status === "ready" && (
        <>
          <div className="note good">
            evidence pinned ({(prep.size / 1024).toFixed(1)} KB) — {prep.cid}
          </div>
          <TxButton
            className="btn danger"
            fn="dispute"
            args={[purchase.purchaseId, prep.hash]}
            value={bond}
            onDone={onDone}
            confirm={`This posts a ${formatEther(bond)} ETH bond and freezes the seller's payment. You forfeit the bond if the jury disagrees with you.`}
          >
            Dispute this sale
          </TxButton>
        </>
      )}
    </div>
  );
}
