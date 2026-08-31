/**
 * Standalone go/no-go check: can a patchright-driven Chrome get past the Cloudflare
 * Managed Challenge on mentari.unpam.ac.id and issue a real API call?
 *
 * Runs under plain `node` so Next's bundler is entirely out of the picture.
 *
 *   node scripts/smoke-browser.mjs
 *
 * PASS: /api/login answers 400 with content-type application/json --
 *       "Username atau password salah" straight from Mentari.
 * FAIL: 403 text/html with cf-mitigated: challenge.
 *
 * NOTE: the launch options below are deliberately minimal. Adding stealth args
 * such as --disable-blink-features=AutomationControlled, or ignoreDefaultArgs, or
 * headless: true, all make this FAIL. patchright handles the automation tells
 * internally and those flags are themselves a fingerprint.
 */
import { chromium } from "patchright";
import path from "node:path";
import os from "node:os";

const ORIGIN = process.env.MENTARI_BROWSER_ORIGIN ?? "https://mentari.unpam.ac.id";
const PROFILE =
  process.env.MENTARI_BROWSER_PROFILE_DIR ??
  path.join(os.homedir(), "AppData", "Local", "mentari-assistants", "chrome-profile");
const CHALLENGE_TITLE = /just a moment|tunggu sebentar|verifikasi keamanan/i;

console.log("profile:", PROFILE);

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: process.env.MENTARI_BROWSER_CHANNEL || "chrome",
  headless: process.env.MENTARI_BROWSER_HEADLESS === "true",
  viewport: null,
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

try {
  console.time("goto");
  await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  console.timeEnd("goto");

  let cleared = false;
  for (let i = 0; i < 60; i++) {
    const title = await page.title().catch(() => "");
    if (title && !CHALLENGE_TITLE.test(title)) {
      console.log(`challenge cleared at t+${i}s -> ${JSON.stringify(title)}`);
      cleared = true;
      break;
    }
    if (i % 5 === 0) console.log(`  t+${i}s ${JSON.stringify(title)}`);
    await page.waitForTimeout(1000);
  }
  if (!cleared) console.log("!! challenge never cleared");

  console.log("cookies:", (await ctx.cookies(ORIGIN)).map((c) => c.name).join(", ") || "(none)");

  const r = await page.evaluate(async (origin) => {
    try {
      const res = await fetch(`${origin}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "smoketest",
          password: "smoketest",
          captcha: "test",
        }),
        credentials: "include",
        signal: AbortSignal.timeout(30000),
      });
      return {
        status: res.status,
        contentType: res.headers.get("content-type"),
        cfMitigated: res.headers.get("cf-mitigated"),
        body: (await res.text()).slice(0, 300),
      };
    } catch (e) {
      return { error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
    }
  }, ORIGIN);

  console.log("\n--- POST /api/login ---");
  console.log(r);

  const passed = (r.contentType ?? "").includes("json") && r.cfMitigated !== "challenge";
  console.log(`\nRESULT: ${passed ? "PASS - reached the Mentari API" : "FAIL - still blocked"}`);
  process.exitCode = passed ? 0 : 1;
} finally {
  await ctx.close();
}
