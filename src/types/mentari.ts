// Auth
export interface LoginRequest {
  username: string;
  password: string;
  captcha: string;
}

export interface LoginResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

// Course
export interface Course {
  kode_course: string;
  nama_course: string;
  nama_dosen?: string;
  status?: string;
}

export interface CourseSection {
  kode_section: string;
  judul: string;
  sub_sections?: SubSection[];
}

export interface SubSection {
  id: string;
  judul: string;
  jenis: string;
  kode_section?: string;
}

// Quiz
export interface QuizParticipant {
  nim: string;
  nama_mahasiswa: string;
  alamat_email: string;
  no_hp_mahasiswa: string;
  quiz: QuizSummary | null;
}

export interface QuizSummary {
  id: string;
  duration: number;
  start_at: string;
  end_at: string | null;
  end_in_second: number;
  grade: number;
  gradeComment: string | null;
  gradeAt: string | null;
  createdAt: string;
}

export interface QuizPesertaResponse {
  kode_course: string;
  kode_section: string;
  judul: string;
  konten: string;
  quiz: QuizSummary;
  data: QuizParticipant[];
  createdAt: string;
}

export interface QuizStartRequest {
  id_trx_course_sub_section: string;
  reset: boolean;
}

export interface QuizStartResponse {
  message: string;
}

export interface AnswerOption {
  id: string;
  jawaban: string;
  sort: number;
}

export interface QuizQuestion {
  id: string;
  id_trx_course_sub_section: string;
  jenis_soal: "MULTIPLE_CHOICE" | "ESSAY";
  page: number;
  sort: number;
  judul: string;
  deskripsi: string;
  id_jawaban: string | null;
  jawaban: string | null;
  grade_jawaban: number;
  feedback: string | null;
  feedback_at: string | null;
  list_jawaban: AnswerOption[];
}

export interface QuizSoalResponse {
  kode_course: string;
  kode_section: string;
  judul: string;
  konten: string;
  id_quiz_user: string;
  duration: number;
  start_at: string;
  end_at: string | null;
  time_left: number;
  data: QuizQuestion[];
  createdAt: string;
}

export interface JawabSoalRequest {
  id_trx_quiz_user_soal: string;
  id_jawaban: string;
}

export interface JawabSoalResponse {
  message: string;
}

export interface QuizEndRequest {
  id_trx_course_sub_section: string;
}

export interface QuizEndResponse {
  message: string;
}

// Automation
export interface AutomationLog {
  timestamp: string;
  level: "info" | "success" | "error" | "warning";
  message: string;
}

export interface AutomationResult {
  success: boolean;
  grade?: number;
  totalQuestions?: number;
  answeredQuestions?: number;
  logs: AutomationLog[];
  error?: string;
}

export type AIProvider = "gemini" | "anthropic" | "ollama";

export interface AutomationRequest {
  username: string;
  password: string;
  quizId: string;
  captcha?: string;
  provider?: AIProvider;
}

export interface AIAnswerResult {
  questionId: string;
  selectedAnswerId: string;
  reasoning: string;
}

// Kuesioner
export interface KuesionerItem {
  id: string;
  kuesioner: string;
  jawaban: number | null;
}

export interface KuesionerResponse {
  kode_course: string;
  kode_section: string;
  judul: string;
  konten: string;
  kuesioner: KuesionerItem[];
  createdAt: string;
}

export interface KuesionerSubmitItem {
  id_kuesioner: string;
  jawaban: number;
}

export interface KuesionerSubmitRequest {
  kode_course: string;
  kode_section: string;
  kuesioner: KuesionerSubmitItem[];
}

export interface KuesionerAutomateRequest {
  username: string;
  password: string;
  captcha?: string;
  kode_course: string;
  kode_section: string;
  /** Answer: 1 = Ya, 0 = Tidak. Default 1 (Ya) */
  rating?: number;
}
