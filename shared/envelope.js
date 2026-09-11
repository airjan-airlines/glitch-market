// Wraps the seller's content with its filename and media type before encryption, so a buyer who
// unlocks a video gets back a playable video rather than an anonymous pile of bytes.
//
// Layout: "BBB1" | uint16 headerLength | JSON header | raw file bytes
//
// Anything that does not start with the magic is treated as plain UTF-8 text, which keeps listings
// created before this existed readable.

const MAGIC = [0x42, 0x42, 0x42, 0x31]; // "BBB1"

export function pack({ name, type, bytes }) {
  const header = new TextEncoder().encode(JSON.stringify({ name: name || "content", type: type || "text/plain" }));
  if (header.length > 0xffff) throw new Error("envelope header too large");
  const out = new Uint8Array(4 + 2 + header.length + bytes.length);
  out.set(MAGIC, 0);
  out[4] = (header.length >> 8) & 0xff;
  out[5] = header.length & 0xff;
  out.set(header, 6);
  out.set(bytes, 6 + header.length);
  return out;
}

export function unpack(blob) {
  const isWrapped = blob.length > 6 && MAGIC.every((b, i) => blob[i] === b);
  if (!isWrapped) {
    // Pre-envelope listing: the whole payload is the text.
    return { name: "instructions.txt", type: "text/plain", bytes: blob, text: decodeText(blob) };
  }
  const headerLen = (blob[4] << 8) | blob[5];
  let meta = {};
  try {
    meta = JSON.parse(new TextDecoder().decode(blob.slice(6, 6 + headerLen)));
  } catch { /* fall through to defaults */ }
  const bytes = blob.slice(6 + headerLen);
  const type = meta.type || "application/octet-stream";
  return {
    name: meta.name || "content",
    type,
    bytes,
    text: type.startsWith("text/") || type === "application/json" ? decodeText(bytes) : null,
  };
}

function decodeText(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

export function kindOf(type = "") {
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("text/") || type === "application/json") return "text";
  return "file";
}
