/// Countdown to a chain timestamp, driven by the chain-anchored clock.
export default function Countdown({ target, now, prefix = "", done = "now" }) {
  if (!now || !target) return null;
  const left = Number(target - now);
  if (left <= 0) return <span className="mono">{done}</span>;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const t = h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
  return <span className="mono">{prefix}{t}</span>;
}
