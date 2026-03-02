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
} from "@/types/mentari";

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

  const res = await fetch(`${BASE_URL}${path}`, {
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
  const res = await fetch(`${BASE_URL}/login`, {
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

export async function getCourseList(token: string): Promise<Course[]> {
  return request<Course[]>("/user-course", {}, token);
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
