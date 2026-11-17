"use client";

import { useEffect, useState } from "react";
import LogDisplay from "@/components/LogDisplay";
import type { AIProvider, AutomationResult } from "@/types/mentari";

export interface Credentials {
  username: string;
  password: string;
  captcha: string;
}

interface QuizStepProps {
  quizId: string;
  label: string;
  completed: boolean;
  credentials: Credentials;
  provider: AIProvider;
  onBusyChange: (busy: boolean) => void;
  /** Called after a successful run, so the caller can refresh done flags. */
  onDone: () => void;
}

function formatGrade(grade: number): string {
  return Number.isInteger(grade) ? String(grade) : grade.toFixed(2).replace(/\.?0+$/, "");
}

function gradeColor(grade: number): string {
  if (grade >= 75) return "text-green-400";
  if (grade >= 60) return "text-yellow-400";
  return "text-red-400";
}

/**
 * One pre-test or post-test: start it, let the AI answer every question,
 * submit, and show the grade.
 *
 * There is deliberately no "preview first" here. Mentari's /quiz/start is
 * called with `reset: true`, so even a preview starts the timer and wipes any
 * earlier attempt -- and the submitted answers would be asked of the AI again
 * anyway. For a quiz that is already done, running it is a retake that
 * replaces the grade, so it sits behind an explicit confirm.
 */
export default function QuizStep({
  quizId,
  label,
  completed,
  credentials,
  provider,
  onBusyChange,
  onDone,
}: QuizStepProps) {
  const [running, setRunning] = useState(false);
  const [confirmRetake, setConfirmRetake] = useState(false);
  const [result, setResult] = useState<AutomationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onBusyChange(running), [running, onBusyChange]);

  const run = async () => {
    setConfirmRetake(false);
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/quiz/automate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...credentials, quizId, provider }),
      });
      const data = (await res.json()) as AutomationResult;
      setResult(data);
      if (data.success) onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRunning(false);
    }
  };

  const canRun = !!credentials.username && !!credentials.password && !running;

  return (
    <div className="flex flex-col gap-3">
      {completed && !result && (
        <p className="text-xs text-emerald-400">
          ✓ Already done on Mentari. Running it again is a retake: it resets your attempt and
          replaces the grade.
        </p>
      )}

      {confirmRetake ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-yellow-600/40 bg-yellow-600/10 px-3 py-2">
          <span className="text-xs text-yellow-300">
            Retake {label}? Your current attempt and grade will be replaced.
          </span>
          <button
            onClick={run}
            className="text-xs bg-yellow-600 hover:bg-yellow-500 text-white font-semibold px-3 py-1.5 rounded-lg"
          >
            Yes, retake
          </button>
          <button
            onClick={() => setConfirmRetake(false)}
            className="text-xs border border-gray-700 text-gray-300 px-3 py-1.5 rounded-lg hover:border-gray-500"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => (completed || result?.success ? setConfirmRetake(true) : run())}
          disabled={!canRun}
          className={`w-full disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-4 rounded-lg text-sm transition-colors ${
            completed || result?.success
              ? "bg-gray-700 hover:bg-gray-600"
              : "bg-blue-600 hover:bg-blue-500"
          }`}
        >
          {running
            ? "Answering with AI and submitting..."
            : completed || result?.success
              ? `Retake ${label}`
              : `Answer ${label} with AI & submit`}
        </button>
      )}

      {running && (
        <p className="text-[11px] text-gray-500">
          Logging in, starting the quiz, asking the AI each question, then submitting. This
          takes a minute or two.
        </p>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {result && (
        <div
          className={`rounded-lg border px-4 py-3 ${
            result.success ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-semibold ${result.success ? "text-green-400" : "text-red-400"}`}>
                {result.success ? `${label} submitted` : `${label} failed`}
              </p>
              {result.success && result.totalQuestions !== undefined && (
                <p className="text-xs text-gray-400 mt-0.5">
                  Answered {result.answeredQuestions} of {result.totalQuestions}
                  {result.fallbackAnswers ? (
                    <span className="text-yellow-500">
                      {" "}
                      · {result.fallbackAnswers} defaulted to option 1
                    </span>
                  ) : null}
                </p>
              )}
              {result.success && result.grade === undefined && (
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Grade not reported yet. Mentari may still be scoring it.
                </p>
              )}
              {result.error && <p className="text-xs text-red-300 mt-0.5">{result.error}</p>}
            </div>
            {result.success && result.grade !== undefined && (
              <div className="shrink-0 text-right" title={result.gradeSource}>
                <p className="text-[10px] uppercase tracking-wider text-gray-500">Grade</p>
                <p className={`text-3xl font-bold leading-none ${gradeColor(result.grade)}`}>
                  {formatGrade(result.grade)}
                </p>
              </div>
            )}
          </div>
          {result.logs?.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] text-gray-400">
                Show each question and the AI&apos;s reasoning
              </summary>
              <div className="mt-2">
                <LogDisplay logs={result.logs} />
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
