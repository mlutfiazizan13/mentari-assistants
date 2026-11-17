"use client";

import { useEffect, useState } from "react";
import LogDisplay from "@/components/LogDisplay";
import type { AutomationLog } from "@/types/mentari";
import type { Credentials } from "@/components/QuizStep";

interface KuesionerStepProps {
  kodeCourse: string;
  kodeSection: string;
  completed: boolean;
  credentials: Credentials;
  onBusyChange: (busy: boolean) => void;
  onDone: () => void;
}

interface KuesionerResult {
  success: boolean;
  total?: number;
  submitted?: number;
  ratingLabel?: string;
  error?: string;
  logs: AutomationLog[];
}

const RATINGS = [
  { value: 1, label: "Ya" },
  { value: 0, label: "Tidak" },
];

/** The pertemuan's kuesioner: one answer applied to every question. */
export default function KuesionerStep({
  kodeCourse,
  kodeSection,
  completed,
  credentials,
  onBusyChange,
  onDone,
}: KuesionerStepProps) {
  const [rating, setRating] = useState(1);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<KuesionerResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onBusyChange(running), [running, onBusyChange]);

  const submit = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/kuesioner/automate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...credentials,
          kode_course: kodeCourse,
          kode_section: kodeSection,
          rating,
        }),
      });
      const data = (await res.json()) as KuesionerResult;
      setResult(data);
      if (data.success) onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {completed && !result && (
        <p className="text-xs text-emerald-400">
          ✓ Already filled in on Mentari. Submitting again only fills questions still blank.
        </p>
      )}

      <div className="flex gap-2">
        {RATINGS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setRating(opt.value)}
            disabled={running}
            className={`flex-1 py-2 rounded-lg border text-sm font-bold transition-colors disabled:opacity-50 ${
              rating === opt.value
                ? opt.value === 1
                  ? "bg-teal-600/20 border-teal-500 text-teal-300"
                  : "bg-red-600/20 border-red-500 text-red-300"
                : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <button
        onClick={submit}
        disabled={running || !credentials.username || !credentials.password}
        className={`w-full disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-4 rounded-lg text-sm transition-colors ${
          rating === 1 ? "bg-teal-600 hover:bg-teal-500" : "bg-red-700 hover:bg-red-600"
        }`}
      >
        {running ? "Submitting..." : `Submit kuesioner (all "${rating === 1 ? "Ya" : "Tidak"}")`}
      </button>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {result && (
        <div
          className={`rounded-lg border px-4 py-3 ${
            result.success ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"
          }`}
        >
          <p className={`text-sm font-semibold ${result.success ? "text-green-400" : "text-red-400"}`}>
            {result.success
              ? result.submitted
                ? `Submitted ${result.submitted} of ${result.total} answers`
                : "Nothing left to fill in"
              : "Submission failed"}
          </p>
          {result.error && <p className="text-xs text-red-300 mt-0.5">{result.error}</p>}
          {result.logs?.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-gray-400">Show log</summary>
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
