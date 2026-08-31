import "server-only";
import {
  CloudflareChallengeError,
  debug,
  ensureReady,
  isChallengeResponse,
  origin,
  requestTimeoutMs,
  reWarm,
  withLock,
} from "./browser";

/**
 * A `fetch`-shaped adapter that issues the request from inside the real Chrome
 * page instead of from Node.
 *
 * Returning a genuine `Response` is what keeps `src/lib/mentari.ts` a two-line
 * change: `res.ok`, `res.text()`, `res.json()` and the existing error strings all
 * keep working untouched.
 */

interface EvalArg {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  timeoutMs: number;
}

type EvalResult =
  | {
      ok: true;
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body: string;
    }
  | { ok: false; error: string };

/** `new Response(body, { status })` throws for these. */
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

/** The body already crossed the boundary decoded, so these headers would lie. */
const STRIPPED_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding"]);

function toResponse(r: Extract<EvalResult, { ok: true }>): Response {
  const headers = new Headers();
  for (const [k, v] of Object.entries(r.headers)) {
    if (STRIPPED_HEADERS.has(k.toLowerCase())) continue;
    try {
      headers.set(k, v);
    } catch {
      // skip header names/values the Headers ctor rejects
    }
  }

  return new Response(NULL_BODY_STATUS.has(r.status) ? null : r.body, {
    status: r.status,
    // statusText must be ASCII or the ctor throws; HTTP/2 yields "" anyway.
    statusText: /^[\t\x20-\x7e]*$/.test(r.statusText) ? r.statusText : "",
    headers,
  });
}

function normalizeHeaders(init: RequestInit): Record<string, string> {
  const h = new Headers(init.headers ?? {});
  return Object.fromEntries(h.entries());
}

function normalizeBody(init: RequestInit): string | null {
  if (init.body == null) return null;
  if (typeof init.body === "string") return init.body;
  throw new TypeError(
    `browserFetch only supports string bodies, received ${init.body.constructor.name}. ` +
      `Serialize with JSON.stringify before calling.`
  );
}

/** Run one fetch inside the page and bring the result back across the boundary. */
async function evaluateFetch(arg: EvalArg): Promise<EvalResult> {
  const page = await ensureReady();

  const inPage = page.evaluate(async (a: EvalArg): Promise<EvalResult> => {
    try {
      const res = await fetch(a.url, {
        method: a.method,
        headers: a.headers,
        body: a.body,
        credentials: "include",
        redirect: "follow",
        // page.evaluate has no timeout of its own; without this an in-page
        // fetch can hang the route handler forever.
        signal: AbortSignal.timeout(a.timeoutMs),
      });
      return {
        ok: true,
        status: res.status,
        statusText: res.statusText,
        headers: Object.fromEntries(res.headers.entries()),
        body: await res.text(),
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
    }
  }, arg);

  // Belt and braces for the case where the page itself becomes unresponsive.
  let guard: NodeJS.Timeout | undefined;
  const outer = new Promise<never>((_, reject) => {
    guard = setTimeout(
      () => reject(new Error(`browserFetch timed out after ${arg.timeoutMs + 5000}ms`)),
      arg.timeoutMs + 5000
    );
    guard.unref();
  });

  try {
    return await Promise.race([inPage, outer]);
  } finally {
    if (guard) clearTimeout(guard);
  }
}

/**
 * Drop-in replacement for `fetch` against the Mentari origin.
 *
 * On a Cloudflare interstitial it re-warms the page and retries exactly once.
 * It does not loop: if a full re-warm did not help, the address is challenged or
 * blocked and hammering it only makes the reputation score worse.
 */
export async function browserFetch(url: string, init: RequestInit = {}): Promise<Response> {
  // One-flag rollback to the original (currently 403-ing) transport.
  if (process.env.MENTARI_BROWSER_DISABLED === "1") {
    return fetch(url, init);
  }

  const arg: EvalArg = {
    url,
    method: (init.method ?? "GET").toUpperCase(),
    headers: normalizeHeaders(init),
    body: normalizeBody(init),
    timeoutMs: requestTimeoutMs(),
  };

  return withLock(async () => {
    const started = Date.now();
    let result = await evaluateFetch(arg);

    if (result.ok && isChallengeResponse(result.status, result.headers, result.body)) {
      debug("cloudflare challenge on", arg.method, url, "- re-warming");
      await reWarm();
      result = await evaluateFetch(arg);

      if (result.ok && isChallengeResponse(result.status, result.headers, result.body)) {
        // Do not let a 30KB HTML interstitial reach `HTTP ${status}: ${body}` and
        // destroy the log panel.
        throw new CloudflareChallengeError(
          `Cloudflare is challenging ${arg.method} ${url} and it did not clear after a ` +
            `retry. Make sure the Chrome window opened by the app is visible and solve ` +
            `the "Verifikasi bahwa Anda adalah manusia" checkbox, then try again.`
        );
      }
    }

    if (!result.ok) {
      throw new Error(
        `Browser request failed (no HTTP response) for ${arg.method} ${url}: ${result.error}`
      );
    }

    debug(arg.method, url.replace(origin(), ""), result.status, `${Date.now() - started}ms`);
    return toResponse(result);
  });
}
