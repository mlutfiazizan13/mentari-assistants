import { NextResponse } from "next/server";
import type { AIProvider } from "@/types/mentari";

// Reads process.env per request; never prerender this.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface FormDefaults {
  username: string;
  password: string;
  captcha: string;
  quizId: string;
  kodeCourse: string;
  kodeSection: string;
  provider: AIProvider | "";
}

const PROVIDERS: AIProvider[] = ["gemini", "anthropic", "ollama", "ollama-cloud"];

/**
 * Prefill values for the form, straight from `.env.local`.
 *
 * GET http://localhost:3000/api/defaults
 *
 * This hands the Mentari password to the browser, which is only acceptable
 * because the whole app is local-only by design (see README) — the same machine
 * that holds `.env.local` is the one rendering the page. Do not deploy it.
 */
export async function GET() {
  const provider = process.env.MENTARI_AI_PROVIDER ?? "";

  const defaults: FormDefaults = {
    username: process.env.MENTARI_USERNAME ?? "",
    password: process.env.MENTARI_PASSWORD ?? "",
    // Empty means "unset" for every field, so the form keeps its own default
    // (captcha falls back to "test" there) and shows no ".env" badge.
    captcha: process.env.MENTARI_CAPTCHA ?? "",
    quizId: process.env.MENTARI_QUIZ_ID ?? "",
    kodeCourse: process.env.MENTARI_KODE_COURSE ?? "",
    kodeSection: process.env.MENTARI_KODE_SECTION ?? "",
    provider: PROVIDERS.includes(provider as AIProvider)
      ? (provider as AIProvider)
      : "",
  };

  return NextResponse.json(defaults, {
    headers: { "Cache-Control": "no-store" },
  });
}
