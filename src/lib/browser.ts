import "server-only";
import path from "node:path";
import os from "node:os";
import type { BrowserContext, Page } from "patchright";

/**
 * Owns the single long-lived Chrome instance that all Mentari traffic flows through.
 *
 * mentari.unpam.ac.id sits behind a Cloudflare Managed Challenge (interactive
 * Turnstile). Plain `fetch` from Node gets a 403 interstitial, so every request is
 * issued as a same-origin `fetch()` inside a real Chrome page instead.
 *
 * The working configuration was established empirically -- see the notes on
 * `launch()` before changing any of it.
 */

export class BrowserUnavailableError extends Error {
  override name = "BrowserUnavailableError";
}

export class CloudflareChallengeError extends Error {
  override name = "CloudflareChallengeError";
}

// -- config -------------------------------------------------------------
// Read inside functions, never at module scope: Next can inline top-level
// process.env reads at build time.

const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const origin = (): string =>
  process.env.MENTARI_BROWSER_ORIGIN ?? "https://mentari.unpam.ac.id";

/** Headless does NOT clear the Turnstile challenge. Default visible. */
const headless = (): boolean => process.env.MENTARI_BROWSER_HEADLESS === "true";

const channel = (): string | undefined =>
  process.env.MENTARI_BROWSER_CHANNEL === ""
    ? undefined
    : (process.env.MENTARI_BROWSER_CHANNEL ?? "chrome");

/**
 * Deliberately outside the repo: a Chrome profile churns thousands of files and
 * the Next dev watcher would recompile constantly if it lived in the project.
 */
const profileDir = (): string =>
  process.env.MENTARI_BROWSER_PROFILE_DIR ??
  path.join(os.homedir(), "AppData", "Local", "mentari-assistants", "chrome-profile");

const idleMs = (): number => num(process.env.MENTARI_BROWSER_IDLE_MS, 600_000);
const navTimeoutMs = (): number => num(process.env.MENTARI_BROWSER_NAV_TIMEOUT_MS, 45_000);
export const challengeTimeoutMs = (): number =>
  num(process.env.MENTARI_CHALLENGE_TIMEOUT_MS, 60_000);
export const requestTimeoutMs = (): number =>
  num(process.env.MENTARI_REQUEST_TIMEOUT_MS, 30_000);
export const debugEnabled = (): boolean => process.env.MENTARI_BROWSER_DEBUG === "1";

export function debug(...args: unknown[]): void {
  if (debugEnabled()) console.log("[browser]", ...args);
}

// -- shared state -------------------------------------------------------
// Pinned to globalThis so the HMR module re-evaluation in Next dev does not
// orphan a Chrome process on every file save.

interface BrowserState {
  ctx: BrowserContext | null;
  page: Page | null;
  starting: Promise<{ ctx: BrowserContext; page: Page }> | null;
  lock: Promise<unknown>;
  inFlight: number;
  idleTimer: NodeJS.Timeout | null;
  hooksInstalled: boolean;
}

declare global {
  var __mentariBrowser: BrowserState | undefined;
}

const state: BrowserState = (globalThis.__mentariBrowser ??= {
  ctx: null,
  page: null,
  starting: null,
  lock: Promise.resolve(),
  inFlight: 0,
  idleTimer: null,
  hooksInstalled: false,
});

// -- challenge detection ------------------------------------------------

/** The interstitial is localised, so match Indonesian as well as English. */
const CHALLENGE_TITLE = /just a moment|tunggu sebentar|verifikasi keamanan/i;

export const CHALLENGE_MARKERS = [
  "Enable JavaScript and cookies to continue",
  "Just a moment",
  "Melakukan verifikasi keamanan",
  "cf-browser-verification",
  "challenges.cloudflare.com",
  "__cf_chl",
  "cf_chl_opt",
];

/**
 * A Cloudflare interstitial, as opposed to a legitimate 403/400 from the Mentari
 * API. The HTML content-type gate matters: Mentari answers an expired token with
 * a JSON 403, and mistaking that for a challenge would burn a full re-warm.
 */
export function isChallengeResponse(
  status: number,
  headers: Record<string, string>,
  body: string
): boolean {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;

  if (lower["cf-mitigated"] === "challenge") return true;
  if (status !== 403 && status !== 503 && status !== 429) return false;
  if (!(lower["content-type"] ?? "").toLowerCase().includes("text/html")) return false;
  return CHALLENGE_MARKERS.some((m) => body.includes(m));
}

// -- launch -------------------------------------------------------------

async function launch(): Promise<{ ctx: BrowserContext; page: Page }> {
  const { chromium } = await import("patchright");

  const cdpUrl = process.env.MENTARI_BROWSER_CDP_URL;
  if (cdpUrl) {
    debug("connecting over CDP:", cdpUrl);
    const browser = await chromium.connectOverCDP(cdpUrl);
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    ctx.setDefaultTimeout(navTimeoutMs());
    return { ctx, page: ctx.pages()[0] ?? (await ctx.newPage()) };
  }

  const dir = profileDir();
  debug("launching persistent context at", dir);

  // Keep these options minimal and do not add launch args.
  //
  // Verified against the live site: this exact config clears the Turnstile
  // challenge in ~4s. Adding --disable-blink-features=AutomationControlled,
  // ignoreDefaultArgs, or a viewport override makes it FAIL -- patchright
  // neutralises the automation tells internally, and those flags are themselves
  // a fingerprint. headless: true also fails.
  try {
    const ctx = await chromium.launchPersistentContext(dir, {
      channel: channel(),
      headless: headless(),
      viewport: null,
    });
    ctx.setDefaultTimeout(navTimeoutMs());
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    return { ctx, page };
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new BrowserUnavailableError(
      `Browser launch failed: ${cause}. Check that Google Chrome is installed, or set ` +
        `MENTARI_BROWSER_CHANNEL="" to use bundled Chromium. If a previous run was ` +
        `force-killed, a stale lock may remain -- delete the profile directory: ${dir}`
    );
  }
}

// -- warm-up / challenge clearing ---------------------------------------

/** True while the page is still showing the Cloudflare interstitial. */
async function pageIsChallenged(page: Page): Promise<boolean> {
  const snapshot = await page
    .evaluate(() => ({
      title: document.title,
      html: document.documentElement.outerHTML.slice(0, 4000),
    }))
    // Mid-navigation context destruction is expected here, not an error.
    .catch(() => null);

  if (!snapshot) return true;
  if (CHALLENGE_TITLE.test(snapshot.title)) return true;
  return CHALLENGE_MARKERS.some((m) => snapshot.html.includes(m));
}

/**
 * Navigate to the origin and block until Cloudflare lets us through, so that the
 * page we later run `fetch` from holds a valid clearance cookie.
 */
export async function warm(page: Page): Promise<void> {
  const budget = challengeTimeoutMs();
  const target = `${origin()}/`;
  debug("warming", target);

  await page.goto(target, { waitUntil: "domcontentloaded", timeout: budget });

  const deadline = Date.now() + budget;
  for (;;) {
    if (!(await pageIsChallenged(page))) {
      debug("challenge cleared");
      return;
    }
    if (Date.now() > deadline) {
      throw new CloudflareChallengeError(
        `Cloudflare challenge did not clear within ${budget}ms for ${origin()}. ` +
          `This site uses an interactive Turnstile checkbox: it only passes with a ` +
          `visible browser window (MENTARI_BROWSER_HEADLESS must not be "true"). ` +
          `If a window is open, solve the checkbox by hand -- the persisted profile ` +
          `will reuse the clearance next time.`
      );
    }
    await page.waitForTimeout(1000);
  }
}

// -- lifecycle ----------------------------------------------------------

function installHooks(): void {
  if (state.hooksInstalled) return;
  state.hooksInstalled = true;
  const bye = (): void => void shutdown();
  process.once("beforeExit", bye);
  process.once("SIGINT", bye);
  process.once("SIGTERM", bye);
}

function armIdleTimer(): void {
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = null;

  const ms = idleMs();
  // Never close mid-run: a quiz can spend minutes between calls waiting on the LLM.
  if (ms <= 0 || state.inFlight > 0) return;

  state.idleTimer = setTimeout(() => void shutdown(), ms);
  // Must not hold the event loop open, or Ctrl+C feels stuck.
  state.idleTimer.unref();
}

export async function shutdown(): Promise<void> {
  const ctx = state.ctx;
  state.ctx = null;
  state.page = null;
  state.starting = null;
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }
  if (ctx) {
    debug("closing browser");
    try {
      await ctx.close();
    } catch {
      // already gone
    }
  }
}

/** Launch + warm on first use; subsequent calls reuse the live page. */
export async function ensureReady(): Promise<Page> {
  installHooks();

  if (state.page && state.ctx) return state.page;

  state.starting ??= (async () => {
    const { ctx, page } = await launch();
    try {
      await warm(page);
    } catch (err) {
      await ctx.close().catch(() => {});
      throw err;
    }
    state.ctx = ctx;
    state.page = page;
    return { ctx, page };
  })().finally(() => {
    state.starting = null;
  });

  const { page } = await state.starting;
  return page;
}

/** Re-navigate and clear a challenge that appeared mid-session. */
export async function reWarm(): Promise<Page> {
  const page = state.page;
  if (!page) return ensureReady();
  await warm(page);
  return page;
}

/**
 * Serialise everything through one queue. A single shared page means concurrent
 * `page.evaluate` calls would interleave with challenge recovery, which navigates
 * that page out from under them. The workload is sequential anyway.
 */
export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const enter = (): Promise<T> => {
    state.inFlight++;
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = null;
    }
    return fn().finally(() => {
      state.inFlight--;
      armIdleTimer();
    });
  };

  // .then(enter, enter): run regardless of whether the predecessor settled or threw.
  const run = state.lock.then(enter, enter);

  // Never let a rejection poison the chain for later callers.
  state.lock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
