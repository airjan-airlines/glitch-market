import { useEffect, useRef } from "react";

/// What a sealed listing looks like before you pay for it.
///
/// This is not a blurred preview of the content — there is deliberately no such thing here, since
/// showing any of the real frame would leak which room the trick is in, and leaking is the exact
/// thing this market exists to prevent. What you see is the *ciphertext* rendered as scrambled
/// video: a deterministic texture derived from the listing's on-chain content hash. Same listing,
/// same pattern, every time; different listing, different pattern. It fabricates nothing.
export default function SealedPreview({ contentHash, cid, w = 208, h = 116, label = "SEALED", wide = false }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Seed a small PRNG from the content hash so the texture is stable per listing.
    const hex = (contentHash || "0x0").replace(/^0x/, "");
    let seed = 0;
    for (let i = 0; i < hex.length; i++) seed = (seed * 31 + parseInt(hex[i], 16) + 1) >>> 0;
    const rand = () => {
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >> 17;
      seed ^= seed << 5; seed >>>= 0;
      return seed / 4294967296;
    };

    ctx.fillStyle = "#0d0f13";
    ctx.fillRect(0, 0, w, h);

    const cols = 26;
    const rows = 14;
    const cw = w / cols;
    const ch = h / rows;

    // Per-row horizontal displacement reads as torn/corrupted scanlines.
    for (let r = 0; r < rows; r++) {
      const shift = (rand() - 0.5) * (rand() < 0.22 ? 16 : 3);
      const rowLift = rand() < 0.14;
      for (let c = 0; c < cols; c++) {
        const n = rand();
        let fill;
        if (n > 0.975) fill = "#00ff9c";
        else if (n > 0.93) fill = "#2f6b52";
        else if (n > 0.82) fill = "#2a313d";
        else if (n > 0.5) fill = "#1c2129";
        else fill = "#14181f";
        ctx.globalAlpha = rowLift ? 0.85 : 0.6 + n * 0.4;
        ctx.fillStyle = fill;
        ctx.fillRect(c * cw + shift, r * ch, cw + 0.6, ch + 0.6);
      }
    }
    ctx.globalAlpha = 1;

    // A couple of bright tear bands, the way a corrupted frame drops a line.
    for (let i = 0; i < 2; i++) {
      const y = Math.floor(rand() * rows) * ch;
      ctx.fillStyle = "rgba(0, 255, 156, 0.09)";
      ctx.fillRect(0, y, w, ch * 0.7);
    }

    // Scanlines over the top.
    ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  }, [contentHash, w, h]);

  const fingerprint = (contentHash || "").replace(/^0x/, "").slice(0, 10);

  return (
    <div className={`sealed ${wide ? "wide" : ""}`} style={{ width: w }}>
      <canvas ref={ref} style={{ width: w, height: h, display: "block" }} aria-label="Sealed, encrypted content" />
      <div className="sealed-tag">
        <span className="lock" aria-hidden="true">▦</span> {label}
      </div>
      <div className="sealed-foot">
        <span>AES-256-GCM</span>
        {fingerprint && <span className="fp">{fingerprint}…</span>}
      </div>
    </div>
  );
}
