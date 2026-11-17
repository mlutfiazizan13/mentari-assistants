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
  /** Endpoint the grade came from; absent when no grade was available. */
  gradeSource?: string;
  totalQuestions?: number;
  answeredQuestions?: number;
  /** Questions where the AI could not be parsed and option 1 was submitted. */
  fallbackAnswers?: number;
  logs: AutomationLog[];
  error?: string;
}

export type AIProvider = "gemini" | "anthropic" | "ollama" | "ollama-cloud" | "vllm";

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
  /** True when the model could not be parsed and option 1 was used instead. */
  fallback?: boolean;
  /** Last provider/parse error behind a `fallback` answer. */
  error?: string;
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

export interface DiscoveredSection {
  /** e.g. "PERTEMUAN_1" -- what /kuesioner/{kode_course}/{kode_section} wants. */
  kodeSection: string;
  namaSection: string;
  subSectionCount: number;
}

/**
 * A kuesioner as listed in the course tree (`tipe: "QUESIONER"`). Submitting
 * still goes through /kuesioner/{kode_course}/{kode_section}; the tree entry
 * is what says it exists and whether it is done.
 */
export interface DiscoveredKuesioner {
  id: string;
  kodeSection: string;
  completed: boolean;
}

// Forum diskusi
export interface DiscoveredForum {
  /** id_trx_course_sub_section -- what /forum/topic/{id} wants. */
  id: string;
  title: string;
  /** The forum's blurb, as plain text -- usually the pertemuan's theme. */
  theme?: string;
  sectionTitle?: string;
  kodeSection?: string;
  /** Mentari's own completion flag. */
  completed?: boolean;
}

/** One post in a thread: the lecturer's topic, or a reply to it. */
export interface ForumPost {
  id: string;
  id_trx_course_sub_section: string;
  id_parent: string | null;
  reply_level: number;
  id_dosen: string | null;
  nim: string | null;
  post_type: "TOPIC" | "REPLY" | string;
  judul: string;
  konten: string;
  files: string[];
  createdAt: string;
  mahasiswa?: { nim: string; nama_mahasiswa: string };
  dosen?: { id_dosen: string; nama_dosen: string; nama_gelar: string };
}

/** GET /forum/topic/{subSectionId} */
export interface ForumTopicsResponse {
  kode_course: string;
  kode_section: string;
  judul: string;
  konten: string;
  topics: ForumPost[];
  createdAt: string;
}

/** GET /forum/reply/{topicId}: the topic itself plus every reply in `data`. */
export interface ForumThreadResponse extends ForumPost {
  kode_course: string;
  template_type?: "timeline" | "extended";
  data: ForumPost[];
}

/** POST /forum/reply. `id_post` is the post replied to -- the topic id for a top-level reply. */
export interface ForumReplyRequest {
  id_topic: string;
  id_post: string;
  konten: string;
  judul: string;
}

/** "answer" replies to the topic; "question" asks the thread something about it. */
export type ForumReplyKind = "answer" | "question";

/** What the AI is asked to write. "followup" answers a lecturer's reply to you. */
export type ForumDraftKind = ForumReplyKind | "followup";

/**
 * A lecturer post replying to one of yours, carrying a question. Answered by
 * replying under your own post, the way Mentari's reply button does it.
 */
export interface ForumFollowUp {
  /** The lecturer's post. */
  id: string;
  /** Your post it hangs under; the reply goes here as `id_post`. */
  parentId: string;
  /** Your post's text, so the AI knows what it is following up on. */
  parentText: string;
  text: string;
  createdAt: string;
  /** You already posted under `parentId` after this follow-up. */
  answered: boolean;
  draft?: string;
  error?: string;
}

/** One reply in a thread, flattened for display. */
export interface ForumThreadPost {
  id: string;
  /** The topic id for a top-level reply, otherwise the post replied to. */
  parentId: string | null;
  author: string;
  role: "dosen" | "mahasiswa";
  isMine: boolean;
  /** Plain text; Mentari's HTML is stripped. */
  text: string;
  createdAt: string;
  attachments: number;
}

export interface ForumTopicDraft {
  topicId: string;
  judul: string;
  /** The lecturer's prompt, as plain text. */
  text: string;
  dosen?: string;
  replyCount: number;
  /**
   * Lecturer posts placed directly under the topic. Some lecturers put the
   * actual soal there and leave only instructions in the topic itself.
   */
  lecturerPosts: string[];
  /** Questions classmates already asked, so a drafted question does not repeat them. */
  classmateQuestions: string[];
  /** Neither the topic nor a lecturer post asks anything ("silahkan diskusikan"). */
  noQuestion: boolean;
  /** Lecturer replies to your posts that ask you something. */
  followUps: ForumFollowUp[];
  /** Every reply in the thread, oldest first, for reading it in the app. */
  posts: ForumThreadPost[];
  /** Topic attachments (Mentari file ids). */
  attachments: number;
  /** Your own top-level reply, when you have already answered. */
  myReply?: string;
  /** AI draft, plain text. Absent when already answered or when the AI failed. */
  draft?: string;
  error?: string;
}

export interface ForumPreviewRequest {
  username: string;
  password: string;
  captcha?: string;
  forumId: string;
  provider?: AIProvider;
  courseName?: string;
  sectionTitle?: string;
  /** Also draft replies for topics you have already answered. */
  includeAnswered?: boolean;
  /** Extra drafting instructions, applied to every topic in this run. */
  instructions?: string;
  /** Default "answer". A question is drafted for answered topics too. */
  kind?: ForumReplyKind;
  /** Only read the forum: no AI calls, no drafts. */
  readOnly?: boolean;
}

export interface ForumPreviewResponse {
  forum?: { judul: string; theme: string; kode_course: string; kode_section: string };
  topics: ForumTopicDraft[];
  logs: AutomationLog[];
  error?: string;
}

/** POST /api/forum/draft: one fresh draft for one topic or follow-up, AI only. */
export interface ForumDraftRequest {
  topicTitle: string;
  topicText: string;
  provider?: AIProvider;
  courseName?: string;
  sectionTitle?: string;
  forumTheme?: string;
  instructions?: string;
  kind?: ForumDraftKind;
  lecturerPosts?: string[];
  classmateQuestions?: string[];
  /** For "followup": your post and the lecturer's reply to it. */
  myPost?: string;
  followUpText?: string;
  /** A prompt for this one draft. */
  prompt?: string;
  /** The draft on screen; with `prompt`, it is revised rather than replaced. */
  previousDraft?: string;
}

export interface ForumDraftResponse {
  draft?: string;
  error?: string;
}

export interface ForumPostItem {
  /** Echoed back in the result, so the page can match it to its draft box. */
  key: string;
  topicId: string;
  judul: string;
  konten: string;
  /** Post under this post of yours instead of at the top of the thread. */
  parentId?: string;
  /** The lecturer follow-up being answered, for the double-post check. */
  replyToId?: string;
  allowDuplicate?: boolean;
}

export interface ForumPostRequest {
  username: string;
  password: string;
  captcha?: string;
  replies: ForumPostItem[];
  /** Post even where a reply of yours already exists. Per-item flag wins. */
  allowDuplicate?: boolean;
}

export interface ForumPostResult {
  key: string;
  topicId: string;
  status: "posted" | "skipped" | "failed";
  message: string;
}

export interface ForumPostResponse {
  success: boolean;
  results: ForumPostResult[];
  logs: AutomationLog[];
  error?: string;
}

export interface CourseContent {
  kodeCourse: string;
  /** Matakuliah name, e.g. "MANAJEMEN PROYEK INFORMATIKA". */
  namaCourse: string;
  /** Full label with class and day, when the API gives one. */
  courseLabel?: string;
  quizzes: DiscoveredQuiz[];
  /** Every pertemuan of the course, for addressing a kuesioner. */
  sections: DiscoveredSection[];
  /** Published forum diskusi, one per pertemuan. */
  forums: DiscoveredForum[];
  /** Kuesioner entries in the course tree, with Mentari's done flag. */
  kuesioners: DiscoveredKuesioner[];
  /** Set when this one course failed; the rest of the list still comes back. */
  error?: string;
}

export interface CourseScanRequest {
  username: string;
  password: string;
  captcha?: string;
  /** Limit the scan to a single course instead of every enrolled one. */
  kodeCourse?: string;
  /** Return the first course's raw JSON, for diagnosing an unknown layout. */
  debug?: boolean;
}

export interface CourseScanResponse {
  courses: CourseContent[];
  error?: string;
  /** Only present when the request asked for debug. */
  sample?: { courseList?: unknown; courseDetail?: unknown };
}
