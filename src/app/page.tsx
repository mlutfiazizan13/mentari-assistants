"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import LogDisplay from "@/components/LogDisplay";
import QuestionPreview from "@/components/QuestionPreview";
import type {
  AutomationLog,
  AutomationResult,
  AIProvider,
  CourseQuizzes,
  QuizKind,
  QuizListResponse,
} from "@/types/mentari";
import type { FormDefaults } from "./api/defaults/route";

type Mode = "quiz" | "kuesioner";
type Step = "idle" | "previewing" | "automating" | "done";

interface PreviewData {
  kode_course: string;
  kode_section: string;
  judul: string;
  duration: number;
  time_left: number;
  token: string;
  quizId: string;
  questions: {
    id: string;
    sort: number;
    deskripsi: string;
    options: { id: string; text: string; sort: number }[];
    aiAnswer?: { questionId: string; selectedAnswerId: string; reasoning: string };
  }[];
}

interface KuesionerResult {
  success: boolean;
  total?: number;
  submitted?: number;
  rating?: number;
  ratingLabel?: string;
  error?: string;
  logs: AutomationLog[];
}

type ProviderColor = "blue" | "cyan" | "orange" | "purple";

// Written out in full so Tailwind's scanner sees every class literally.
const PROVIDER_STYLES: Record<ProviderColor, { card: string; badge: string }> = {
  blue: { card: "bg-blue-600/20 border-blue-500 text-white", badge: "text-blue-400" },
  cyan: { card: "bg-cyan-600/20 border-cyan-500 text-white", badge: "text-cyan-400" },
  orange: { card: "bg-orange-600/20 border-orange-500 text-white", badge: "text-orange-400" },
  purple: { card: "bg-purple-600/20 border-purple-500 text-white", badge: "text-purple-400" },
};

const PROVIDER_OPTIONS: { value: AIProvider; label: string; badge: string; color: ProviderColor }[] = [
  { value: "gemini", label: "Gemini 2.0 Flash", badge: "Free tier", color: "blue" },
  { value: "ollama-cloud", label: "Ollama gpt-oss:120b", badge: "Cloud", color: "cyan" },
  { value: "ollama", label: "Ollama qwen2.5:7b", badge: "Local", color: "orange" },
  { value: "anthropic", label: "Claude Haiku", badge: "Paid", color: "purple" },
];

const QUIZ_KIND_STYLES: Record<QuizKind, { label: string; className: string }> = {
  "pre-test": {
    label: "Pre Test",
    className: "bg-amber-600/15 text-amber-400 border-amber-600/30",
  },
  "post-test": {
    label: "Post Test",
    className: "bg-emerald-600/15 text-emerald-400 border-emerald-600/30",
  },
  quiz: {
    label: "Quiz",
    className: "bg-gray-700/50 text-gray-400 border-gray-600/40",
  },
};

type EnvField =
  | "username"
  | "password"
  | "captcha"
  | "quizId"
  | "kodeCourse"
  | "kodeSection"
  | "provider";

/** Marks a field whose value was prefilled from `.env` rather than typed. */
function EnvBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      title="Prefilled from .env"
      className="ml-1.5 align-middle rounded border border-emerald-600/30 bg-emerald-600/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-emerald-400"
    >
      .env
    </span>
  );
}

const RATING_OPTIONS = [
  { value: 1, label: "Ya", color: "teal" },
  { value: 0, label: "Tidak", color: "red" },
];

export default function Home() {
  const [mode, setMode] = useState<Mode>("quiz");

  // Shared credentials
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [captcha, setCaptcha] = useState("test");

  // Quiz state
  const [quizId, setQuizId] = useState("");
  const [provider, setProvider] = useState<AIProvider>("gemini");
  const [step, setStep] = useState<Step>("idle");
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [result, setResult] = useState<AutomationResult | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);

  // Quiz picker (pre-test / post-test browser)
  const [courseQuizzes, setCourseQuizzes] = useState<CourseQuizzes[] | null>(null);
  const [quizListLoading, setQuizListLoading] = useState(false);
  const [quizListError, setQuizListError] = useState<string | null>(null);
  const [openCourse, setOpenCourse] = useState<string | null>(null);

  // Kuesioner state
  const [kode_course, setKodeCourse] = useState("");
  const [kode_section, setKodeSection] = useState("");
  const [rating, setRating] = useState(1);
  const [kuesionerStep, setKuesionerStep] = useState<"idle" | "loading" | "done">("idle");
  const [kuesionerResult, setKuesionerResult] = useState<KuesionerResult | null>(null);
  const [kuesionerLogs, setKuesionerLogs] = useState<AutomationLog[]>([]);

  // Shared error
  const [error, setError] = useState<string | null>(null);

  // What .env offered, kept so the badges can show which boxes still hold it.
  const [envDefaults, setEnvDefaults] = useState<FormDefaults | null>(null);
  const [defaultsLoaded, setDefaultsLoaded] = useState(false);

  // Prefill from .env. Each field is only filled if still untouched, so a value
  // typed before the response lands is never clobbered.
  useEffect(() => {
    let cancelled = false;

    fetch("/api/defaults")
      .then((res) => (res.ok ? (res.json() as Promise<FormDefaults>) : null))
      .then((d) => {
        if (cancelled) return;
        setDefaultsLoaded(true);
        if (!d) return;
        setEnvDefaults(d);

        const fill = (
          value: string,
          setter: Dispatch<SetStateAction<string>>,
          isUntouched: (current: string) => boolean = (current) => !current
        ) => {
          if (value) setter((current) => (isUntouched(current) ? value : current));
        };

        fill(d.username, setUsername);
        fill(d.password, setPassword);
        // The captcha box starts at "test", so that -- not "" -- is untouched.
        fill(d.captcha, setCaptcha, (current) => current === "test");
        fill(d.quizId, setQuizId);
        fill(d.kodeCourse, setKodeCourse);
        fill(d.kodeSection, setKodeSection);
        if (d.provider) setProvider(d.provider);
      })
      .catch(() => {
        // Prefill is a convenience; a failure just leaves the form empty.
        if (!cancelled) setDefaultsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /** A box wears the badge only while it still holds what .env supplied. */
  const isFromEnv = (field: EnvField, current: string) => {
    const value = envDefaults?.[field];
    return !!value && value === current;
  };

  const hasEnvDefaults =
    !!envDefaults && Object.values(envDefaults).some(Boolean);

  /** The loaded quiz whose id is in the box, so the form can name it. */
  const selectedQuiz = courseQuizzes
    ?.flatMap((course) => course.quizzes.map((quiz) => ({ course, quiz })))
    .find((entry) => entry.quiz.id === quizId);

  const isQuizLoading = step === "previewing" || step === "automating";
  const isKuesionerLoading = kuesionerStep === "loading";
  const isLoading = isQuizLoading || isKuesionerLoading;

  // ── Quiz handlers ──────────────────────────────────────────────
  const handlePreview = async () => {
    setStep("previewing");
    setError(null);
    setPreviewData(null);
    setResult(null);
    setLogs([]);
    try {
      const res = await fetch("/api/quiz/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, quizId, captcha, provider }),
      });
      const data = (await res.json()) as PreviewData & { error?: string };
      if (!res.ok || data.error) { setError(data.error ?? "Preview failed"); setStep("idle"); return; }
      setPreviewData(data);
      setStep("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStep("idle");
    }
  };

  const handleLoadQuizzes = async () => {
    setQuizListLoading(true);
    setQuizListError(null);
    try {
      const res = await fetch("/api/quiz/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, captcha }),
      });
      const data = (await res.json()) as QuizListResponse;
      if (!res.ok || data.error) {
        setQuizListError(data.error ?? "Failed to load quizzes");
        setCourseQuizzes(data.courses?.length ? data.courses : null);
        return;
      }
      setCourseQuizzes(data.courses);
      // Expand the course holding the current quiz, or the only one there is.
      const withQuizzes = data.courses.filter((c) => c.quizzes.length);
      setOpenCourse(
        withQuizzes.find((c) => c.quizzes.some((q) => q.id === quizId))
          ?.kodeCourse ??
          (withQuizzes.length === 1 ? withQuizzes[0].kodeCourse : null)
      );
    } catch (err) {
      setQuizListError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setQuizListLoading(false);
    }
  };

  const handleAutomate = async () => {
    setStep("automating");
    setError(null);
    setResult(null);
    setLogs([]);
    try {
      const res = await fetch("/api/quiz/automate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, quizId, captcha, provider }),
      });
      const data = (await res.json()) as AutomationResult & { error?: string };
      setLogs(data.logs ?? []);
      setResult(data);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStep("idle");
    }
  };

  // ── Kuesioner handler ──────────────────────────────────────────
  const handleKuesioner = async () => {
    setKuesionerStep("loading");
    setError(null);
    setKuesionerResult(null);
    setKuesionerLogs([]);
    try {
      const res = await fetch("/api/kuesioner/automate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, captcha, kode_course, kode_section, rating }),
      });
      const data = (await res.json()) as KuesionerResult;
      setKuesionerLogs(data.logs ?? []);
      setKuesionerResult(data);
      setKuesionerStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setKuesionerStep("idle");
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-3xl mx-auto px-4 py-12">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Mentari Assistant</h1>
          <p className="mt-2 text-gray-400 text-sm">
            Quiz &amp; Kuesioner automation for Mentari UNPAM
          </p>
        </div>

        {/* Mode Tabs */}
        <div className="flex gap-1 bg-gray-900 rounded-xl p-1 border border-gray-800 mb-6">
          {(["quiz", "kuesioner"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              disabled={isLoading}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors capitalize disabled:opacity-50 ${
                mode === m
                  ? "bg-gray-700 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {m === "quiz" ? "Quiz Automation" : "Kuesioner"}
            </button>
          ))}
        </div>

        {/* Shared Credentials */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 mb-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Credentials
          </h2>
          {defaultsLoaded && !hasEnvDefaults && (
            <p className="-mt-3 mb-4 text-[11px] text-gray-600">
              Tip: set{" "}
              <code className="text-gray-500">MENTARI_USERNAME</code> and{" "}
              <code className="text-gray-500">MENTARI_PASSWORD</code> in{" "}
              <code className="text-gray-500">.env</code> to prefill this form.
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">
                NIM / Username
                <EnvBadge show={isFromEnv("username", username)} />
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="231011403096"
                disabled={isLoading}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">
                Password
                <EnvBadge show={isFromEnv("password", password)} />
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
                disabled={isLoading}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">
                Captcha <span className="text-gray-600">(leave &quot;test&quot; if disabled)</span>
                <EnvBadge show={isFromEnv("captcha", captcha)} />
              </label>
              <input
                type="text"
                value={captcha}
                onChange={(e) => setCaptcha(e.target.value)}
                placeholder="test"
                disabled={isLoading}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        {/* ── QUIZ TAB ── */}
        {mode === "quiz" && (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 mb-6">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Quiz Settings
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 mb-1.5">
                  Quiz ID <span className="text-gray-600">(id_trx_course_sub_section)</span>
                  <EnvBadge show={isFromEnv("quizId", quizId)} />
                </label>
                <input
                  type="text"
                  value={quizId}
                  onChange={(e) => setQuizId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  disabled={isQuizLoading}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                />
                {selectedQuiz && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-gray-400">
                    <span
                      className={`shrink-0 rounded border px-1 py-px text-[9px] font-semibold uppercase tracking-wide ${
                        QUIZ_KIND_STYLES[selectedQuiz.quiz.kind].className
                      }`}
                    >
                      {QUIZ_KIND_STYLES[selectedQuiz.quiz.kind].label}
                    </span>
                    <span className="truncate">{selectedQuiz.course.namaCourse}</span>
                    <span className="text-gray-600">·</span>
                    <span className="shrink-0">
                      {selectedQuiz.quiz.sectionTitle ?? selectedQuiz.quiz.title}
                    </span>
                    {selectedQuiz.quiz.completed && (
                      <span className="shrink-0 font-semibold text-emerald-500">
                        ✓ already done
                      </span>
                    )}
                  </p>
                )}
              </div>
              {/* Pre-test / post-test picker -- fills Quiz ID for you */}
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500">
                    Or pick from your courses
                  </span>
                  <button
                    onClick={handleLoadQuizzes}
                    disabled={quizListLoading || isQuizLoading || !username || !password}
                    className="text-xs font-medium px-2.5 py-1 rounded-md border border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {quizListLoading ? (
                      <Spinner label="Loading..." />
                    ) : courseQuizzes ? (
                      "Refresh"
                    ) : (
                      "Load quizzes"
                    )}
                  </button>
                </div>

                {quizListError && (
                  <p className="mb-2 text-xs text-red-400">{quizListError}</p>
                )}

                {courseQuizzes && (
                  <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-800 bg-gray-950/60 divide-y divide-gray-800">
                    {courseQuizzes.every((c) => c.quizzes.length === 0) && (
                      <p className="px-3 py-3 text-xs text-gray-500">
                        No quizzes found in {courseQuizzes.length} course
                        {courseQuizzes.length === 1 ? "" : "s"}.
                      </p>
                    )}

                    {courseQuizzes.map((course) => {
                      if (!course.quizzes.length && !course.error) return null;
                      const isOpen = openCourse === course.kodeCourse;
                      return (
                        <div key={course.kodeCourse}>
                          <button
                            onClick={() =>
                              setOpenCourse(isOpen ? null : course.kodeCourse)
                            }
                            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-800/40"
                          >
                            <span className="shrink-0 text-gray-600 text-[10px]">
                              {isOpen ? "▼" : "▶"}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-semibold text-gray-200">
                                {course.namaCourse}
                              </span>
                              <span className="block truncate text-[10px] text-gray-600">
                                {course.kodeCourse}
                              </span>
                            </span>
                            <span className="shrink-0 rounded bg-gray-800 px-1.5 py-px text-[10px] text-gray-400">
                              {course.quizzes.filter((q) => q.completed).length}/
                              {course.quizzes.length} done
                            </span>
                          </button>

                          {course.error && (
                            <p className="px-3 pb-2 text-[11px] text-red-400">
                              {course.error}
                            </p>
                          )}

                          {isOpen && (
                            <div className="flex flex-col gap-1 px-3 pb-2">
                              {course.quizzes.map((quiz) => {
                                const kind = QUIZ_KIND_STYLES[quiz.kind];
                                const isSelected = quizId === quiz.id;
                                return (
                                  <button
                                    key={quiz.id}
                                    onClick={() => setQuizId(quiz.id)}
                                    disabled={isQuizLoading}
                                    title={quiz.id}
                                    className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                      isSelected
                                        ? "border-blue-500 bg-blue-600/15"
                                        : "border-transparent hover:border-gray-700 hover:bg-gray-800/60"
                                    }`}
                                  >
                                    <span
                                      className={`shrink-0 rounded border px-1 py-px text-[9px] font-semibold uppercase tracking-wide ${kind.className}`}
                                    >
                                      {kind.label}
                                    </span>
                                    <span
                                      className={`min-w-0 flex-1 truncate text-xs ${
                                        quiz.completed ? "text-gray-500" : "text-gray-200"
                                      }`}
                                    >
                                      {quiz.sectionTitle ?? quiz.title}
                                    </span>
                                    {quiz.sectionTitle && (
                                      <span className="shrink-0 text-[10px] text-gray-600">
                                        {quiz.title}
                                      </span>
                                    )}
                                    {quiz.completed && (
                                      <span
                                        title="Already done on Mentari"
                                        className="shrink-0 text-[11px] font-bold text-emerald-500"
                                      >
                                        ✓
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 mb-1.5">
                  AI Provider
                  <EnvBadge show={isFromEnv("provider", provider)} />
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {PROVIDER_OPTIONS.map((opt) => {
                    const isSelected = provider === opt.value;
                    const style = PROVIDER_STYLES[opt.color];
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setProvider(opt.value)}
                        disabled={isQuizLoading}
                        className={`flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          isSelected
                            ? style.card
                            : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
                        }`}
                      >
                        <span className="text-xs font-semibold leading-tight">{opt.label}</span>
                        <span className={`text-[10px] mt-0.5 font-medium ${
                          isSelected ? style.badge : "text-gray-600"
                        }`}>
                          {opt.badge}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={handlePreview}
                disabled={isQuizLoading || !username || !password || !quizId}
                className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-lg text-sm transition-colors"
              >
                {step === "previewing" ? <Spinner label="Previewing..." /> : "Preview Questions"}
              </button>
              <button
                onClick={handleAutomate}
                disabled={isQuizLoading || !username || !password || !quizId}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-4 rounded-lg text-sm transition-colors"
              >
                {step === "automating" ? <Spinner label="Automating..." /> : "Run Automation"}
              </button>
            </div>
          </div>
        )}

        {/* ── KUESIONER TAB ── */}
        {mode === "kuesioner" && (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 mb-6">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Kuesioner Settings
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">
                  Kode Course
                  <EnvBadge show={isFromEnv("kodeCourse", kode_course)} />
                </label>
                <input
                  type="text"
                  value={kode_course}
                  onChange={(e) => setKodeCourse(e.target.value)}
                  placeholder="20252-06TPLE013-22TIF0332"
                  disabled={isKuesionerLoading}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">
                  Kode Section
                  <EnvBadge show={isFromEnv("kodeSection", kode_section)} />
                </label>
                <input
                  type="text"
                  value={kode_section}
                  onChange={(e) => setKodeSection(e.target.value)}
                  placeholder="PERTEMUAN_1"
                  disabled={isKuesionerLoading}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 mb-1.5">
                  Answer <span className="text-gray-600">(applied to all questions)</span>
                </label>
                <div className="flex gap-2">
                  {RATING_OPTIONS.map((opt) => {
                    const isSelected = rating === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setRating(opt.value)}
                        disabled={isKuesionerLoading}
                        className={`flex-1 py-3 rounded-lg border text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          isSelected
                            ? opt.color === "teal"
                              ? "bg-teal-600/20 border-teal-500 text-teal-300"
                              : "bg-red-600/20 border-red-500 text-red-300"
                            : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <button
              onClick={handleKuesioner}
              disabled={isKuesionerLoading || !username || !password || !kode_course || !kode_section}
              className={`w-full mt-5 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-4 rounded-lg text-sm transition-colors ${
                rating === 1 ? "bg-teal-600 hover:bg-teal-500" : "bg-red-700 hover:bg-red-600"
              }`}
            >
              {isKuesionerLoading ? <Spinner label="Submitting..." /> : "Submit Kuesioner"}
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-6 text-red-400 text-sm">
            <span className="font-semibold">Error:</span> {error}
          </div>
        )}

        {/* ── Quiz results ── */}
        {mode === "quiz" && (
          <>
            {result && (
              <div className={`rounded-xl border px-5 py-4 mb-6 ${result.success ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{result.success ? "✅" : "❌"}</span>
                  <div>
                    <p className={`font-semibold ${result.success ? "text-green-400" : "text-red-400"}`}>
                      {result.success ? "Quiz automation complete!" : "Automation failed"}
                    </p>
                    {result.success && result.totalQuestions !== undefined && (
                      <p className="text-sm text-gray-400 mt-0.5">
                        Answered {result.answeredQuestions} of {result.totalQuestions} questions
                      </p>
                    )}
                    {result.error && <p className="text-sm text-red-300 mt-0.5">{result.error}</p>}
                  </div>
                </div>
              </div>
            )}

            {logs.length > 0 && (
              <div className="mb-6">
                <h2 className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">
                  Automation Logs
                </h2>
                <LogDisplay logs={logs} />
              </div>
            )}

            {previewData && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Preview ({previewData.questions.length} questions)
                  </h2>
                  <button
                    onClick={handleAutomate}
                    disabled={isQuizLoading}
                    className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-medium px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Submit These Answers
                  </button>
                </div>
                <QuestionPreview
                  questions={previewData.questions}
                  kode_course={previewData.kode_course}
                  kode_section={previewData.kode_section}
                  judul={previewData.judul}
                  duration={previewData.duration}
                  time_left={previewData.time_left}
                />
              </div>
            )}
          </>
        )}

        {/* ── Kuesioner results ── */}
        {mode === "kuesioner" && (
          <>
            {kuesionerResult && (
              <div className={`rounded-xl border px-5 py-4 mb-6 ${kuesionerResult.success ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{kuesionerResult.success ? "✅" : "❌"}</span>
                  <div>
                    <p className={`font-semibold ${kuesionerResult.success ? "text-green-400" : "text-red-400"}`}>
                      {kuesionerResult.success ? "Kuesioner submitted!" : "Submission failed"}
                    </p>
                    {kuesionerResult.success && (
                      <p className="text-sm text-gray-400 mt-0.5">
                        {kuesionerResult.submitted} of {kuesionerResult.total} answers submitted
                        {kuesionerResult.ratingLabel && ` — rating: ${kuesionerResult.ratingLabel}`}
                      </p>
                    )}
                    {kuesionerResult.error && (
                      <p className="text-sm text-red-300 mt-0.5">{kuesionerResult.error}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {kuesionerLogs.length > 0 && (
              <div className="mb-6">
                <h2 className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">
                  Submission Logs
                </h2>
                <LogDisplay logs={kuesionerLogs} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <span className="flex items-center justify-center gap-2">
      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      {label}
    </span>
  );
}
