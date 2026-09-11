// CIDv0 <-> bytes32, so an IPFS pointer can live in the contract's `evidenceHash` field.
//
// A CIDv0 is base58(0x12 0x20 || sha2-256 digest) — the digest is exactly 32 bytes, so it fits a
// bytes32 with the two-byte multihash prefix implied. Storing the digest therefore gives us both
// things at once: a real commitment to the evidence file, and a pointer jurors can actually fetch.
// Without this the dispute would commit to a hash nobody could ever resolve to a file.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(str) {
  const bytes = [0];
  for (const ch of str) {
    let carry = ALPHABET.indexOf(ch);
    if (carry < 0) throw new Error(`invalid base58 character: ${ch}`);
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of str) {
    if (ch !== ALPHABET[0]) break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

export function base58Encode(bytes) {
  const digits = [0];
  for (const b of bytes) {
    let carry = b;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (const b of bytes) {
    if (b) break;
    out += ALPHABET[0];
  }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

/// "Qm…" -> "0x…" (32 bytes). Returns null for anything that is not a CIDv0.
export function cidToBytes32(cid) {
  try {
    const raw = base58Decode(cid);
    if (raw.length !== 34 || raw[0] !== 0x12 || raw[1] !== 0x20) return null;
    return "0x" + Array.from(raw.slice(2), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/// "0x…" (32 bytes) -> "Qm…". Returns null for the zero hash or anything malformed.
export function bytes32ToCid(hash) {
  if (!hash) return null;
  const hex = hash.replace(/^0x/, "");
  if (hex.length !== 64 || /^0+$/.test(hex)) return null;
  const digest = new Uint8Array(32);
  for (let i = 0; i < 32; i++) digest[i] = parseInt(hex.substr(i * 2, 2), 16);
  return base58Encode(new Uint8Array([0x12, 0x20, ...digest]));
}
