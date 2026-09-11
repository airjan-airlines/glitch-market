import { useEffect, useRef, useState } from "react";

const BLOCK = "█";

/// The locked/unlocked moment — the one place in this app that animates.
///
/// Locked content renders as literal redaction bars. When the connected wallet has paid and the
/// plaintext arrives, the bars burn away left-to-right to expose it.
export default function Redacted({ text, revealed, lines = 5, width = 58 }) {
  const [cut, setCut] = useState(0);
  const [burning, setBurning] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    if (!revealed || !text) {
      setCut(0);
      setBurning(false);
      done.current = false;
      return;
    }
    if (done.current) {
      setCut(text.length);
      return;
    }
    setBurning(true);
    let i = 0;
    const stride = Math.max(2, Math.ceil(text.length / 90));
    const id = setInterval(() => {
      i += stride;
      if (i >= text.length) {
        i = text.length;
        clearInterval(id);
        setBurning(false);
        done.current = true;
      }
      setCut(i);
    }, 22);
    return () => clearInterval(id);
  }, [revealed, text]);

  if (!revealed || !text) {
    // Deterministic bar layout, so a listing looks the same on every render.
    const bars = Array.from({ length: lines }, (_, r) => {
      const len = width - ((r * 7 + 11) % 17);
      return BLOCK.repeat(Math.max(12, len));
    });
    return (
      <div className="redacted" aria-label="Locked content">
        {bars.map((b, i) => (
          <div key={i} className="bar">{b}</div>
        ))}
      </div>
    );
  }

  const shown = text.slice(0, cut);
  const remaining = Math.max(0, text.length - cut);

  return (
    <div className={`redacted ${burning ? "live" : ""}`}>
      <span className="plain">{shown}</span>
      {remaining > 0 && <span className="bar">{BLOCK.repeat(Math.min(remaining, 260))}</span>}
    </div>
  );
}
