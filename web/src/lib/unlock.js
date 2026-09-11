import { useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { keccak256 } from "viem";
import { CONTRACT } from "../config";
import { fetchFromIPFS } from "@shared/storage.js";
import { decryptBlob, fromHex } from "@shared/crypto.js";

/// Pull the key from the contract (gated on proof of purchase), fetch the ciphertext from IPFS,
/// check it against the commitment made at listing time, then decrypt in the browser.
export function useUnlockedContent(listing, enabled) {
  const { address } = useAccount();
  const client = usePublicClient();
  const [state, setState] = useState({ status: "idle" });

  useEffect(() => {
    if (!enabled || !listing || !address || !client) {
      setState({ status: "idle" });
      return;
    }
    let alive = true;
    (async () => {
      setState({ status: "loading", stage: "reading key from contract" });
      try {
        const keyHex = await client.readContract({
          ...CONTRACT,
          functionName: "revealKey",
          args: [listing.id],
          account: address,
        });
        if (!alive) return;
        setState({ status: "loading", stage: "fetching encrypted file from IPFS" });
        const blob = await fetchFromIPFS(listing.storagePointer);
        if (!alive) return;

        // The commitment check: this is what stops a seller swapping the file after the sale.
        const hashOk = keccak256(blob) === listing.contentHash;
        setState({ status: "loading", stage: "decrypting" });
        const plain = new TextDecoder().decode(await decryptBlob(blob, fromHex(keyHex)));
        if (alive) setState({ status: "ready", text: plain, hashOk });
      } catch (e) {
        if (alive) setState({ status: "error", error: e.shortMessage || e.message });
      }
    })();
    return () => { alive = false; };
  }, [enabled, listing?.id, listing?.storagePointer, address, client]);

  return state;
}
