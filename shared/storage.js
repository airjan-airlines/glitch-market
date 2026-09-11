// IPFS pinning via Pinata. Only ever handed ciphertext — plaintext never leaves the client.

const PIN_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";

// Pinata's shared public gateway is no longer reachable on the free plan, and every open community
// gateway (ipfs.io, dweb.link, w3s.link) rate-limits hard enough to break a demo. The account's
// dedicated gateway is the only dependable read path, so it is the default and the fallbacks are
// only a safety net. The blobs behind it are ciphertext, so a readable gateway leaks nothing.
export const DEFAULT_GATEWAY =
  (typeof process !== "undefined" && process.env?.IPFS_GATEWAY) ||
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_IPFS_GATEWAY) ||
  "https://tan-binding-tarantula-502.mypinata.cloud/ipfs/";

export async function pinToIPFS(bytes, name, jwt) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/octet-stream" }), name);
  form.append("pinataMetadata", JSON.stringify({ name }));
  const res = await fetch(PIN_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Pinata upload failed (${res.status}): ${await res.text()}`);
  return (await res.json()).IpfsHash;
}

export async function fetchFromIPFS(cid, gateway = DEFAULT_GATEWAY) {
  const gateways = [gateway, "https://w3s.link/ipfs/", "https://ipfs.io/ipfs/", "https://dweb.link/ipfs/"];
  let lastErr;
  // A pin can take a few seconds to become retrievable, so sweep the list more than once.
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const g of gateways) {
      try {
        const res = await fetch(g + cid, { redirect: "follow" });
        if (res.ok) return new Uint8Array(await res.arrayBuffer());
        lastErr = new Error(`${g} returned ${res.status}`);
      } catch (e) {
        lastErr = e;
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`could not fetch ${cid} from any gateway: ${lastErr?.message}`);
}
