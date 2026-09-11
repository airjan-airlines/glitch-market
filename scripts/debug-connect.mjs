// Diagnose the connect-wallet button by loading the page with a stubbed EIP-1193 provider.
import puppeteer from "puppeteer-core";

const URL = process.argv[2] || "https://airjan-airlines.github.io/glitch-market/";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();

const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push("PAGEERROR: " + e.message));

// Minimal MetaMask-ish injected provider, announced over EIP-6963 as well.
const NO_WALLET = process.argv.includes("--no-wallet");
if (!NO_WALLET) await page.evaluateOnNewDocument(() => {
  const ACC = "0x0f84B92D8b1B74fE5680Ac973a6C8BD75E5a407E";
  const listeners = {};
  const provider = {
    isMetaMask: true,
    request: async ({ method }) => {
      window.__calls = window.__calls || [];
      window.__calls.push(method);
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [ACC];
      if (method === "eth_chainId") return "0x14a34";
      if (method === "net_version") return "84532";
      return null;
    },
    on: (e, f) => { (listeners[e] = listeners[e] || []).push(f); },
    removeListener: () => {},
  };
  window.ethereum = provider;
  const info = { uuid: "stub-uuid", name: "Stub Wallet", icon: "data:image/svg+xml,<svg/>", rdns: "io.metamask" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
});

await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
await new Promise((r) => setTimeout(r, 5000));

const before = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("button")).map((b) => b.textContent.trim());
  return { buttons: btns, hasEthereum: !!window.ethereum };
});
console.log("window.ethereum present :", before.hasEthereum);
console.log("buttons                 :", before.buttons.join(" | "));

const target = await page.evaluateHandle(() =>
  Array.from(document.querySelectorAll("button")).find((b) => /connect wallet|no wallet found/i.test(b.textContent))
);
const el = target.asElement();
if (!el) {
  console.log("\n!! no 'connect wallet' button found");
} else {
  console.log("\nclicking connect…");
  await el.click();
  await new Promise((r) => setTimeout(r, 4000));
  const after = await page.evaluate(() => ({
    buttons: Array.from(document.querySelectorAll("button")).map((b) => b.textContent.trim()),
    calls: window.__calls || [],
    body: document.body.innerText.slice(0, 200).replace(/\n/g, " / "),
    errNote: document.querySelector(".note.err")?.textContent?.trim() || "",
    popover: document.querySelector(".wallet-pop")?.innerText?.trim().replace(/\n+/g, " / ") || "",
  }));
  console.log("rpc methods the wallet saw :", after.calls.join(", ") || "(none — connector never called the provider)");
  console.log("popover shown              :", after.popover || "(NONE — user sees no feedback)");
  console.log("buttons after              :", after.buttons.join(" | "));
  console.log("header text                :", after.body);
}

console.log("\nconsole output:");
logs.slice(0, 20).forEach((l) => console.log("  " + l.slice(0, 200)));
await browser.close();
