import { NextResponse } from "next/server";
import { ensureReady, origin } from "@/lib/browser";
import { browserFetch } from "@/lib/browser-fetch";

// Drives a real Chrome via patchright, so this can never run on the edge runtime.
export const runtime = "nodejs";

/**
 * Smoke test for the browser transport, isolated from any Mentari or AI logic.
 *
 * GET http://localhost:3000/api/health/browser
 *
 * Healthy: `ok: true` with `loginStatus: 400` and a JSON content-type, meaning a
 * real answer came back from Mentari rather than a Cloudflare interstitial.
 */
export async function GET() {
  const started = Date.now();

  try {
    const page = await ensureReady();
    const title = await page.title();

    // Deliberately bad credentials: proves the request reached the Mentari API.
    const res = await browserFetch(`${origin()}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "healthcheck",
        password: "healthcheck",
        captcha: "test",
      }),
    });

    const contentType = res.headers.get("content-type") ?? "";
    const body = (await res.text()).slice(0, 300);

    return NextResponse.json({
      ok: contentType.includes("json"),
      title,
      loginStatus: res.status,
      contentType,
      body,
      elapsedMs: Date.now() - started,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : "Error",
        elapsedMs: Date.now() - started,
      },
      { status: 500 }
    );
  }
}
