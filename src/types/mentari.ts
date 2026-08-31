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
// As returned by GET /user-course: rows carry `coursename` ("[2] MANAJEMEN
// PROYEK INFORMATIKA # 07TPLE013 (Sabtu) [E-2]") and the bare
// `nama_mata_kuliah`. `nama_course` is not one of them -- kept optional for
// older call sites.
export interface Course {
  kode_course: string;
  coursename?: string;
  nama_mata_kuliah?: string;
  shortname?: string;
  nama_dosen?: string;
  nama_hari?: string;
  nama_course?: string;
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

export type AIProvider = "gemini" | "anthropic" | "ollama" | "ollama-cloud";

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

// Quiz discovery -- browsing courses instead of pasting a quiz id
export type QuizKind = "pre-test" | "post-test" | "quiz";

export interface DiscoveredQuiz {
  /** id_trx_course_sub_section -- what the quiz endpoints call quizId. */
  id: string;
  title: string;
  kind: QuizKind;
  jenis?: string;
  sectionTitle?: string;
  kodeSection?: string;
  /** Mentari's own completion flag -- the green tick in its UI. */
  completed?: boolean;
}

export interface CourseQuizzes {
  kodeCourse: string;
  /** Matakuliah name, e.g. "MANAJEMEN PROYEK INFORMATIKA". */
  namaCourse: string;
  /** Full label with class and day, when the API gives one. */
  courseLabel?: string;
  quizzes: DiscoveredQuiz[];
  /** Set when this one course failed; the rest of the list still comes back. */
  error?: string;
}

export interface QuizListRequest {
  username: string;
  password: string;
  captcha?: string;
  /** Limit the scan to a single course instead of every enrolled one. */
  kodeCourse?: string;
  /** Return the first course's raw JSON, for diagnosing an unknown layout. */
  debug?: boolean;
}

export interface QuizListResponse {
  courses: CourseQuizzes[];
  error?: string;
  /** Only present when the request asked for debug. */
  sample?: { courseList?: unknown; courseDetail?: unknown };
}
