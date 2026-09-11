import { useState } from "react";
import { parseEther, formatEther, keccak256 } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { CONTRACT, getPinataJwt, setPinataJwt, JWT_IS_BUILTIN } from "../config";
import { encryptBlob, randomKey, toHex } from "@shared/crypto.js";
import { pinToIPFS } from "@shared/storage.js";
import TxButton from "../components/TxButton";

const SAMPLE = `CELESTE — ANY% — CORNER-BOOST SKIP (Chapter 3)

On the second screen, dash diagonally into the corner on the exact frame the
spinner resets, then neutral-jump. The hitbox lets you clip the wall and skip
the whole B-side room.

Timing: frame 14 after the spinner's second rotation.
Saves roughly 4.2 seconds.`;

export default function Sell({ go }) {
  const { address, isConnected } = useAccount();
  const [form, setForm] = useState({
    game: "Celeste",
    category: "Any%",
    teaser: "Chapter 3 wall clip that skips the B-side room. ~4s.",
    price: "0.00001",
    floor: "0.000001",
    content: SAMPLE,
  });
  const [prep, setPrep] = useState({ status: "idle" });
  const [jwt, setJwt] = useState(getPinataJwt());
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  let initialPrice = 0n, minPrice = 0n, priceOk = false;
  try {
    initialPrice = parseEther(form.price || "0");
    minPrice = parseEther(form.floor || "0");
    priceOk = initialPrice > 0n && minPrice <= initialPrice;
  } catch { priceOk = false; }

  const { data: stake } = useReadContract({
    ...CONTRACT, functionName: "requiredStake", args: [address, initialPrice],
    query: { enabled: !!address && priceOk },
  });
  const { data: rep } = useReadContract({
    ...CONTRACT, functionName: "reputation", args: [address], query: { enabled: !!address },
  });

  async function prepare() {
    setPrep({ status: "working", stage: "encrypting in your browser" });
    try {
      const key = randomKey();
      const plaintext = new TextEncoder().encode(form.content);
      const ciphertext = await encryptBlob(plaintext, key);
      const contentHash = keccak256(ciphertext);
      setPrep({ status: "working", stage: "uploading the encrypted file to IPFS" });
      const cid = await pinToIPFS(ciphertext, `glitch-${Date.now()}.bin`, getPinataJwt());
      setPrep({ status: "ready", key: toHex(key), contentHash, cid, size: ciphertext.length });
    } catch (e) {
      setPrep({ status: "error", error: e.message });
    }
  }

  if (!isConnected) {
    return (
      <>
        <div className="page-head"><h1>Sell a glitch</h1></div>
        <div className="empty"><p>Connect a wallet to list something.</p></div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Sell a glitch</h1>
        <p>
          Your content is encrypted in this browser before it goes anywhere. Only the hash and the
          IPFS pointer land on-chain, which is what stops you swapping the file after someone pays —
          and stops anyone reading it before they do.
        </p>
      </div>

      <div className="panel">
        <h2>the glitch</h2>
        <div className="grid-2">
          <label><span>game</span><input value={form.game} onChange={set("game")} /></label>
          <label><span>category</span><input value={form.category} onChange={set("category")} /></label>
        </div>
        <label>
          <span>teaser — public, keep it vague</span>
          <textarea value={form.teaser} onChange={set("teaser")} />
        </label>
        <p className="hint">This is the only thing buyers see before paying. Say what it is worth, not how it works.</p>
        <label>
          <span>the actual trick — encrypted, never sent in the clear</span>
          <textarea value={form.content} onChange={set("content")} style={{ minHeight: 150, fontFamily: "var(--mono)", fontSize: 12.5 }} />
        </label>
      </div>

      <div className="panel">
        <h2>price and stake</h2>
        <div className="grid-2">
          <label><span>opening price (ETH)</span><input className="mono" value={form.price} onChange={set("price")} /></label>
          <label><span>floor price (ETH)</span><input className="mono" value={form.floor} onChange={set("floor")} /></label>
        </div>
        {!priceOk && <div className="note err">opening price must be above zero, and the floor cannot exceed it.</div>}
        <dl className="kv">
          <dt>your reputation</dt><dd>{rep?.toString() ?? "0"}</dd>
          <dt>required stake</dt><dd>{stake != null ? `${formatEther(stake)} ETH` : "—"}</dd>
        </dl>
        <p className="hint">
          Unproven sellers post 5× the opening price. That drops toward 2× as you close clean sales.
          You lose the stake if a jury rules the glitch does not work.
        </p>
      </div>

      <div className="panel">
        <h2>commit</h2>
        {!JWT_IS_BUILTIN && (
          <>
            <label>
              <span>pinata jwt — needed to pin the encrypted file to IPFS</span>
              <input
                type="password"
                value={jwt}
                placeholder="paste a Pinata JWT"
                onChange={(e) => { setJwt(e.target.value); setPinataJwt(e.target.value); }}
              />
            </label>
            <p className="hint">
              Kept in this browser only, never compiled into the page and never sent anywhere but
              Pinata. Buying and judging need none of this — only listing does, because listing is
              the step that uploads a file. Free key at pinata.cloud.
            </p>
          </>
        )}
        {prep.status === "idle" && (
          <button className="btn big" onClick={prepare} disabled={!priceOk || !form.content.trim() || !jwt}>
            Encrypt and upload
          </button>
        )}
        {prep.status === "working" && <div className="note info"><span className="spin" />{prep.stage}…</div>}
        {prep.status === "error" && (
          <>
            <div className="note err">upload failed: {prep.error}</div>
            <button className="btn ghost" onClick={prepare}>try again</button>
          </>
        )}
        {prep.status === "ready" && (
          <>
            <div className="note good">encrypted ({prep.size} bytes) and pinned.</div>
            <dl className="kv">
              <dt>content hash</dt><dd>{prep.contentHash}</dd>
              <dt>ipfs cid</dt><dd>{prep.cid}</dd>
            </dl>
            <div style={{ marginTop: 16 }}>
              <TxButton
                className="btn big"
                fn="list"
                args={[form.game, form.category, form.teaser, prep.contentHash, prep.cid, prep.key, initialPrice, minPrice]}
                value={stake}
                onDone={() => go("browse")}
                confirm={`This posts ${stake ? formatEther(stake) : "?"} ETH of your own money as a stake. You forfeit it if a jury rules against you.`}
              >
                List it — stake {stake ? formatEther(stake) : "?"} ETH
              </TxButton>
            </div>
          </>
        )}
      </div>
    </>
  );
}
