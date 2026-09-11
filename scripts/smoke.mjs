import puppeteer from "puppeteer-core";

const URL = process.argv[2] || "https://airjan-airlines.github.io/glitch-market/";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 2 });

const errors = [], warnings = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
  if (m.type() === "warning") warnings.push(m.text());
});
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("requestfailed", (r) => errors.push(`REQFAIL ${r.url().slice(0, 90)} — ${r.failure()?.errorText}`));
page.on("response", (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url().slice(0, 110)}`); });

await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
// Give the chain reads time to land.
await new Promise((r) => setTimeout(r, 9000));

const info = await page.evaluate(() => ({
  title: document.title,
  rootChildren: document.getElementById("root")?.children.length ?? 0,
  rows: document.querySelectorAll(".row").length,
  prices: Array.from(document.querySelectorAll(".price-cell .amt")).map((e) => e.textContent).slice(0, 8),
  titles: Array.from(document.querySelectorAll(".row .title")).map((e) => e.textContent).slice(0, 8),
  tabs: Array.from(document.querySelectorAll("nav.tabs button")).map((e) => e.textContent),
  sealedBlocks: document.querySelectorAll(".sealed canvas").length,
  sealedTags: Array.from(document.querySelectorAll(".sealed-tag")).map((e) => e.textContent.trim()).slice(0, 3),
  sealedFeet: Array.from(document.querySelectorAll(".sealed-foot")).map((e) => e.textContent.trim()).slice(0, 3),
  bodyText: (document.body.innerText || "").slice(0, 260),
}));

console.log("title        :", info.title);
console.log("root mounted :", info.rootChildren > 0);
console.log("listing rows :", info.rows);
console.log("sealed       :", info.sealedBlocks, "canvases |", info.sealedTags.join(" ") , "|", info.sealedFeet.join(" / "));
console.log("tabs         :", info.tabs.join(" | "));
console.log("listings     :", info.titles.join(" / "));
console.log("prices       :", info.prices.join(" , "));

// Price must actually tick — that is the whole economic story.
const before = await page.evaluate(() => document.querySelector(".price-cell .amt")?.textContent);
await new Promise((r) => setTimeout(r, 32000));
const after = await page.evaluate(() => document.querySelector(".price-cell .amt")?.textContent);
console.log(`decay        : ${before} -> ${after} ${before !== after ? "TICKED" : "(no change in 32s)"}`);

await page.screenshot({ path: "/tmp/bbb-market.png", fullPage: true });

// Sell view renders without a wallet?
await page.goto(URL + "#/sell", { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 2500));
console.log("sell view    :", (await page.evaluate(() => document.body.innerText.slice(0, 90))).replace(/\n/g, " / "));

await page.goto(URL + "#/jury", { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 2500));
console.log("jury view    :", (await page.evaluate(() => document.body.innerText.slice(0, 90))).replace(/\n/g, " / "));

console.log("\nconsole errors:", errors.length);
errors.slice(0, 12).forEach((e) => console.log("  !", e.slice(0, 170)));
await browser.close();
process.exit(errors.length ? 1 : 0);
