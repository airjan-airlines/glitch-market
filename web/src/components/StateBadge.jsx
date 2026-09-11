const MAP = {
  1: ["locked", "escrowed"],
  2: ["cold", "claimed by seller"],
  3: ["hot", "disputed — frozen"],
  4: ["open", "refunded to buyer"],
  5: ["cold", "awarded to seller"],
};

export default function StateBadge({ state }) {
  const [cls, label] = MAP[Number(state)] ?? ["cold", "unknown"];
  return <span className={`badge ${cls}`}>{label}</span>;
}
