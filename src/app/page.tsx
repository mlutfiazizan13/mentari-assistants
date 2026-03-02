"use client";

import { useState } from "react";
import LogDisplay from "@/components/LogDisplay";
import QuestionPreview from "@/components/QuestionPreview";
import type { AutomationLog, AutomationResult, AIProvider } from "@/types/mentari";

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
    aiAnswer?: {
      questionId: string;
      selectedAnswerId: string;
      reasoning: string;
    };
  }[];
}

const PROVIDER_OPTIONS: { value: AIProvider; label: string; badge: string; color: string }[] = [
  { value: "gemini", label: "Gemini 2.0 Flash", badge: "Free tier", color: "blue" },
  { value: "ollama", label: "Ollama qwen2.5:7b", badge: "Local", color: "orange" },
  { value: "anthropic", label: "Claude Haiku", badge: "Paid", color: "purple" },
];

export default function Home() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [quizId, setQuizId] = useState("");
  const [captcha, setCaptcha] = useState("test");
  const [provider, setProvider] = useState<AIProvider>("gemini");

  const [step, setStep] = useState<Step>("idle");
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [result, setResult] = useState<AutomationResult | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isLoading = step === "previewing" || step === "automating";

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

      if (!res.ok || data.error) {
        setError(data.error ?? "Preview failed");
        setStep("idle");
        return;
      }

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

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-3xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-white tracking-tight">
            Mentari Quiz Automator
          </h1>
          <p className="mt-2 text-gray-400 text-sm">
            Automatically answers Mentari UNPAM quizzes using AI
          </p>
        </div>

        {/* Credentials Form */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
            Credentials
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">
                NIM / Username
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
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-500 mb-1.5">
                Quiz ID{" "}
                <span className="text-gray-600">(id_trx_course_sub_section)</span>
              </label>
              <input
                type="text"
                value={quizId}
                onChange={(e) => setQuizId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                disabled={isLoading}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">
                Captcha{" "}
                <span className="text-gray-600">
                  (leave &quot;test&quot; if disabled)
                </span>
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

            {/* AI Provider Selector */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">
                AI Provider
              </label>
              <div className="flex gap-2">
                {PROVIDER_OPTIONS.map((opt) => {
                  const isSelected = provider === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setProvider(opt.value)}
                      disabled={isLoading}
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
                      <span className="text-xs font-semibold leading-tight">
                        {opt.label}
                      </span>
                      <span
                        className={`text-[10px] mt-0.5 font-medium ${
                          isSelected
                            ? opt.color === "blue"
                              ? "text-blue-400"
                              : opt.color === "orange"
                              ? "text-orange-400"
                              : "text-purple-400"
                            : "text-gray-600"
                        }`}
                      >
                        {opt.badge}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 mt-5">
            <button
              onClick={handlePreview}
              disabled={isLoading || !username || !password || !quizId}
              className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-lg text-sm transition-colors"
            >
              {step === "previewing" ? (
                <span className="flex items-center justify-center gap-2">
                  <Spinner /> Previewing...
                </span>
              ) : (
                "Preview Questions"
              )}
            </button>
            <button
              onClick={handleAutomate}
              disabled={isLoading || !username || !password || !quizId}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-4 rounded-lg text-sm transition-colors"
            >
              {step === "automating" ? (
                <span className="flex items-center justify-center gap-2">
                  <Spinner /> Automating...
                </span>
              ) : (
                "Run Automation"
              )}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-6 text-red-400 text-sm">
            <span className="font-semibold">Error:</span> {error}
          </div>
        )}

        {/* Result Banner */}
        {result && (
          <div
            className={`rounded-xl border px-5 py-4 mb-6 ${
              result.success
                ? "bg-green-500/10 border-green-500/30"
                : "bg-red-500/10 border-red-500/30"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{result.success ? "✅" : "❌"}</span>
              <div>
                <p
                  className={`font-semibold ${
                    result.success ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {result.success
                    ? "Quiz automation complete!"
                    : "Automation failed"}
                </p>
                {result.success && result.totalQuestions !== undefined && (
                  <p className="text-sm text-gray-400 mt-0.5">
                    Answered {result.answeredQuestions} of {result.totalQuestions}{" "}
                    questions
                  </p>
                )}
                {result.error && (
                  <p className="text-sm text-red-300 mt-0.5">{result.error}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Logs */}
        {logs.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">
              Automation Logs
            </h2>
            <LogDisplay logs={logs} />
          </div>
        )}

        {/* Question Preview */}
        {previewData && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                Questions Preview ({previewData.questions.length} total)
              </h2>
              <button
                onClick={handleAutomate}
                disabled={isLoading}
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

        {/* How it works */}
        {step === "idle" && !previewData && !result && (
          <div className="bg-gray-900/50 rounded-2xl border border-gray-800 p-6 mt-2">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              How it works
            </h3>
            <div className="space-y-3">
              {[
                ["1", "Login", "Authenticates with your Mentari credentials"],
                ["2", "Start Quiz", "Initializes your quiz session on the server"],
                ["3", "Fetch Questions", "Retrieves all quiz questions from the API"],
                ["4", "AI Analysis", "The selected AI analyzes each question and picks the best answer"],
                ["5", "Submit Answers", "Sends each answer back to the Mentari API"],
                ["6", "End Quiz", "Finalizes and submits the quiz for grading"],
              ].map(([num, title, desc]) => (
                <div key={num} className="flex gap-3 items-start">
                  <span className="bg-blue-600/20 text-blue-400 text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0">
                    {num}
                  </span>
                  <div>
                    <span className="text-sm font-medium text-gray-300">{title}</span>
                    <span className="text-sm text-gray-500"> — {desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
