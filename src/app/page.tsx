"use client";

import { useState } from "react";
import LogDisplay from "@/components/LogDisplay";
import QuestionPreview from "@/components/QuestionPreview";
import type { AutomationLog, AutomationResult, AIProvider } from "@/types/mentari";

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

const PROVIDER_OPTIONS: { value: AIProvider; label: string; badge: string; color: string }[] = [
  { value: "gemini", label: "Gemini 2.0 Flash", badge: "Free tier", color: "blue" },
  { value: "ollama", label: "Ollama qwen2.5:7b", badge: "Local", color: "orange" },
  { value: "anthropic", label: "Claude Haiku", badge: "Paid", color: "purple" },
];

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

  // Kuesioner state
  const [kode_course, setKodeCourse] = useState("");
  const [kode_section, setKodeSection] = useState("");
  const [rating, setRating] = useState(1);
  const [kuesionerStep, setKuesionerStep] = useState<"idle" | "loading" | "done">("idle");
  const [kuesionerResult, setKuesionerResult] = useState<KuesionerResult | null>(null);
  const [kuesionerLogs, setKuesionerLogs] = useState<AutomationLog[]>([]);

  // Shared error
  const [error, setError] = useState<string | null>(null);

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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">NIM / Username</label>
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
              <label className="block text-xs text-gray-500 mb-1.5">Password</label>
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
                </label>
                <input
                  type="text"
                  value={quizId}
                  onChange={(e) => setQuizId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  disabled={isQuizLoading}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 mb-1.5">AI Provider</label>
                <div className="flex gap-2">
                  {PROVIDER_OPTIONS.map((opt) => {
                    const isSelected = provider === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setProvider(opt.value)}
                        disabled={isQuizLoading}
                        className={`flex-1 flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          isSelected
                            ? opt.color === "blue"
                              ? "bg-blue-600/20 border-blue-500 text-white"
                              : opt.color === "orange"
                              ? "bg-orange-600/20 border-orange-500 text-white"
                              : "bg-purple-600/20 border-purple-500 text-white"
                            : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
                        }`}
                      >
                        <span className="text-xs font-semibold leading-tight">{opt.label}</span>
                        <span className={`text-[10px] mt-0.5 font-medium ${
                          isSelected
                            ? opt.color === "blue" ? "text-blue-400"
                              : opt.color === "orange" ? "text-orange-400"
                              : "text-purple-400"
                            : "text-gray-600"
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
                <label className="block text-xs text-gray-500 mb-1.5">Kode Course</label>
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
                <label className="block text-xs text-gray-500 mb-1.5">Kode Section</label>
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
