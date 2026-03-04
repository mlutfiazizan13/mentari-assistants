import { NextRequest, NextResponse } from "next/server";
import { login, getKuesioner, submitKuesioner } from "@/lib/mentari";
import type { AutomationLog, KuesionerAutomateRequest } from "@/types/mentari";

function log(
  logs: AutomationLog[],
  level: AutomationLog["level"],
  message: string
): void {
  logs.push({ timestamp: new Date().toISOString(), level, message });
  console.log(`[${level.toUpperCase()}] ${message}`);
}

const RATING_LABELS: Record<number, string> = {
  1: "Ya",
  0: "Tidak",
};

export async function POST(req: NextRequest) {
  const logs: AutomationLog[] = [];

  try {
    const body = (await req.json()) as KuesionerAutomateRequest;
    const {
      username,
      password,
      captcha = "test",
      kode_course,
      kode_section,
      rating = 1,
    } = body;

    if (!username || !password || !kode_course || !kode_section) {
      return NextResponse.json(
        {
          success: false,
          error: "username, password, kode_course, and kode_section are required",
          logs,
        },
        { status: 400 }
      );
    }

    if (rating !== 0 && rating !== 1) {
      return NextResponse.json(
        { success: false, error: "rating must be 0 (Tidak) or 1 (Ya)", logs },
        { status: 400 }
      );
    }

    // Step 1: Login
    log(logs, "info", `Logging in as ${username}...`);
    const authData = await login({ username, password, captcha });
    const token = authData.access_token;
    log(logs, "success", "Login successful.");

    // Step 2: Fetch kuesioner
    log(logs, "info", `Fetching kuesioner for ${kode_course} / ${kode_section}...`);
    const data = await getKuesioner(token, kode_course, kode_section);
    const items = data.kuesioner;
    log(logs, "success", `Fetched "${data.judul}" — ${items.length} questions.`);

    if (items.length === 0) {
      log(logs, "warning", "No kuesioner questions found.");
      return NextResponse.json({ success: true, total: 0, logs });
    }

    // Step 3: Check already answered
    const unanswered = items.filter((k) => k.jawaban === null);
    if (unanswered.length === 0) {
      log(logs, "warning", "All questions already answered — skipping submit.");
      return NextResponse.json({ success: true, total: items.length, submitted: 0, logs });
    }

    log(
      logs,
      "info",
      `Submitting ${unanswered.length} answers with rating ${rating} (${RATING_LABELS[rating]})...`
    );

    // Step 4: Submit all answers
    const payload = {
      kode_course,
      kode_section,
      kuesioner: items.map((k) => ({
        id_kuesioner: k.id,
        jawaban: rating,
      })),
    };

    const result = await submitKuesioner(token, payload);
    log(logs, "success", `Submitted: ${result.message}`);

    return NextResponse.json({
      success: true,
      total: items.length,
      submitted: unanswered.length,
      rating,
      ratingLabel: RATING_LABELS[rating],
      logs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(logs, "error", `Failed: ${message}`);
    return NextResponse.json(
      { success: false, error: message, logs },
      { status: 500 }
    );
  }
}
