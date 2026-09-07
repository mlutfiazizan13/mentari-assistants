import type {
  LoginRequest,
  LoginResponse,
  QuizPesertaResponse,
  QuizSoalResponse,
  QuizStartResponse,
  JawabSoalRequest,
  JawabSoalResponse,
  QuizEndResponse,
  Course,
  KuesionerResponse,
  KuesionerSubmitRequest,
} from "@/types/mentari";
import { browserFetch } from "./browser-fetch";

const BASE_URL = "https://mentari.unpam.ac.id/api";

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await browserFetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

export async function login(data: LoginRequest): Promise<LoginResponse> {
  const res = await browserFetch(`${BASE_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Login failed HTTP ${res.status}: ${body}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const json = await res.json();

  // Log raw response for debugging
  console.log("[login] raw response keys:", Object.keys(json));

  // Response shape: { access: [{ role, token }] }
  const token: string =
    json.access?.[0]?.token ??
    json.access_token ??
    json.token ??
    json.data?.access_token ??
    json.data?.token;

  if (!token) {
    throw new Error(
      `Login succeeded but no token found. Response: ${JSON.stringify(json)}`
    );
  }

  return { access_token: token };
}

/**
 * Enrolled courses. The web app calls this paginated and cache-busted, and the
 * body has been seen both as a bare array and wrapped in `data` / `rows`, so
 * normalise here rather than at every call site.
 */
export async function getCourseListRaw(
  token: string,
  limit = 100
): Promise<unknown> {
  return request<unknown>(
    `/user-course?page=1&limit=${limit}&t=${Date.now()}`,
    {},
    token
  );
}

export function normalizeCourses(json: unknown): Course[] {
  const rows = Array.isArray(json)
    ? json
    : ((json as { data?: unknown; rows?: unknown })?.data ??
        (json as { rows?: unknown })?.rows ??
        []);

  const list = Array.isArray(rows)
    ? rows
    : ((rows as { data?: unknown })?.data ?? []);

  return (Array.isArray(list) ? list : []).filter(
    (item): item is Course =>
      !!item &&
      typeof item === "object" &&
      typeof (item as Course).kode_course === "string"
  );
}

export async function getCourseList(
  token: string,
  limit = 100
): Promise<Course[]> {
  return normalizeCourses(await getCourseListRaw(token, limit));
}

/** Full course tree: sections, sub-sections and the quizzes hanging off them. */
export async function getCourseDetail(
  token: string,
  kodeCourse: string
): Promise<unknown> {
  return request<unknown>(
    `/user-course/${encodeURIComponent(kodeCourse)}?t=${Date.now()}`,
    {},
    token
  );
}

export async function getQuizPeserta(
  token: string,
  quizId: string
): Promise<QuizPesertaResponse> {
  return request<QuizPesertaResponse>(`/quiz/peserta/${quizId}`, {}, token);
}

export async function startQuiz(
  token: string,
  quizId: string
): Promise<QuizStartResponse> {
  return request<QuizStartResponse>(
    `/quiz/start/${quizId}`,
    {
      method: "PUT",
      body: JSON.stringify({
        id_trx_course_sub_section: quizId,
        reset: true,
      }),
    },
    token
  );
}

export async function getQuizSoal(
  token: string,
  quizId: string
): Promise<QuizSoalResponse> {
  return request<QuizSoalResponse>(`/quiz/soal/${quizId}`, {}, token);
}

export async function jawabSoal(
  token: string,
  data: JawabSoalRequest
): Promise<JawabSoalResponse> {
  return request<JawabSoalResponse>(
    "/quiz/jawab",
    {
      method: "PUT",
      body: JSON.stringify(data),
    },
    token
  );
}

export async function endQuiz(
  token: string,
  quizId: string
): Promise<QuizEndResponse> {
  return request<QuizEndResponse>(
    "/quiz/end",
    {
      method: "PUT",
      body: JSON.stringify({ id_trx_course_sub_section: quizId }),
    },
    token
  );
}

/** Grades arrive as numbers or numeric strings depending on the endpoint. */
function toGrade(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * A grade carried directly by a response body. `/quiz/end` is typed as just a
 * message, but has been seen returning the score alongside it, so look before
 * paying for another round trip.
 */
export function readGrade(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;

  const obj = payload as Record<string, unknown>;
  const keys = ["grade", "nilai", "score", "total_grade"];

  for (const key of keys) {
    const direct = toGrade(obj[key]);
    if (direct !== null) return direct;
  }
  for (const nested of ["data", "quiz", "result"]) {
    const child = obj[nested];
    if (child && typeof child === "object") {
      for (const key of keys) {
        const value = toGrade((child as Record<string, unknown>)[key]);
        if (value !== null) return value;
      }
    }
  }
  return null;
}

export interface QuizGrade {
  grade: number;
  /** Which endpoint the number came from, so the log can say. */
  source: string;
}

/**
 * The score for the attempt that just ended.
 *
 * `/quiz/peserta` is the authoritative view but is a roster: pick our own row by
 * NIM (the login username) rather than trusting row order. Mentari also needs a
 * moment to score an attempt, so a missing grade is retried -- a grade of 0 is a
 * real result and is returned immediately.
 */
export async function getQuizGrade(
  token: string,
  quizId: string,
  nim?: string,
  attempts = 3
): Promise<QuizGrade | null> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const peserta = await getQuizPeserta(token, quizId);
      const rows = Array.isArray(peserta.data) ? peserta.data : [];
      const own = nim ? rows.find((p) => p.nim === nim) : undefined;
      const graded = rows.filter((p) => p.quiz);

      const candidates: [string, unknown][] = [
        ["quiz/peserta (your row)", own?.quiz?.grade],
        ["quiz/peserta", peserta.quiz?.grade],
        // Only trust an unmatched row when there is exactly one attempt on file.
        ["quiz/peserta (only attempt)", graded.length === 1 ? graded[0].quiz?.grade : undefined],
      ];

      for (const [source, value] of candidates) {
        const grade = toGrade(value);
        if (grade !== null) return { grade, source };
      }
    } catch (err) {
      console.warn(
        `[grade] /quiz/peserta attempt ${attempt} failed:`,
        err instanceof Error ? err.message : err
      );
    }

    if (attempt < attempts) await new Promise((r) => setTimeout(r, 1500));
  }

  // Last resort: the per-question scores on the answered paper.
  try {
    const soal = await getQuizSoal(token, quizId);
    const questions = Array.isArray(soal.data) ? soal.data : [];
    const scored = questions.filter((q) => toGrade(q.grade_jawaban) !== null);
    if (scored.length > 0) {
      const total = scored.reduce((sum, q) => sum + (toGrade(q.grade_jawaban) ?? 0), 0);
      return { grade: total, source: "quiz/soal (sum of per-question grades)" };
    }
  } catch (err) {
    console.warn(
      "[grade] /quiz/soal fallback failed:",
      err instanceof Error ? err.message : err
    );
  }

  return null;
}

export async function getKuesioner(
  token: string,
  kode_course: string,
  kode_section: string
): Promise<KuesionerResponse> {
  return request<KuesionerResponse>(
    `/kuesioner/${kode_course}/${kode_section}`,
    {},
    token
  );
}

export async function submitKuesioner(
  token: string,
  data: KuesionerSubmitRequest
): Promise<{ message: string }> {
  return request<{ message: string }>(
    "/kuesioner/submit",
    {
      method: "POST",
      body: JSON.stringify(data),
    },
    token
  );
}
