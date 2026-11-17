"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForumPanel from "@/components/ForumPanel";
import KuesionerStep from "@/components/KuesionerStep";
import QuizStep, { type Credentials } from "@/components/QuizStep";
import {
  buildPertemuan,
  nextPertemuan,
  nextStep,
  STEP_LABELS,
  STEP_ORDER,
  type Pertemuan,
  type StepKind,
} from "@/lib/pertemuan";
import type { AIProvider, CourseContent } from "@/types/mentari";

interface PertemuanFlowProps {
  credentials: Credentials;
  provider: AIProvider;
  courses: CourseContent[] | null;
  scanLoading: boolean;
  scanError: string | null;
  onLoadCourses: () => void;
  /** Re-read one course so done flags catch up after a step. */
  onRefreshCourse: (kodeCourse: string) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}

const COURSE_KEY = "mentari.flow.course";

function courseProgress(course: CourseContent) {
  const list = buildPertemuan(course);
  return {
    done: list.reduce((n, p) => n + p.done, 0),
    total: list.reduce((n, p) => n + p.total, 0),
  };
}

/**
 * The guided way through a course: pick a course, pick a pertemuan, and work
 * its steps in Mentari's order -- pre-test, forum diskusi, post-test,
 * kuesioner -- with each step's done flag read from Mentari itself.
 */
export default function PertemuanFlow({
  credentials,
  provider,
  courses,
  scanLoading,
  scanError,
  onLoadCourses,
  onRefreshCourse,
  onBusyChange,
}: PertemuanFlowProps) {
  const [courseCode, setCourseCode] = useState<string | null>(null);
  const [sectionCode, setSectionCode] = useState<string | null>(null);
  const [openSteps, setOpenSteps] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);

  // Busy flags per step, behind stable callbacks so child effects stay quiet.
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});
  const busyHandlers = useRef(new Map<string, (busy: boolean) => void>());
  const busyFor = useCallback((key: string) => {
    let handler = busyHandlers.current.get(key);
    if (!handler) {
      handler = (busy: boolean) =>
        setBusyMap((prev) => (!!prev[key] === busy ? prev : { ...prev, [key]: busy }));
      busyHandlers.current.set(key, handler);
    }
    return handler;
  }, []);
  const busy = refreshing || Object.values(busyMap).some(Boolean);
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  // Restore the last course, once courses are in.
  useEffect(() => {
    if (!courses?.length || courseCode) return;
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(COURSE_KEY);
    } catch {
      // ignore
    }
    const pick =
      courses.find((c) => c.kodeCourse === saved) ??
      courses.find((c) => {
        const p = courseProgress(c);
        return p.done < p.total;
      }) ??
      courses[0];
    setCourseCode(pick.kodeCourse);
  }, [courses, courseCode]);

  const course = courses?.find((c) => c.kodeCourse === courseCode) ?? null;
  const pertemuan = useMemo(() => (course ? buildPertemuan(course) : []), [course]);
  const current: Pertemuan | undefined =
    pertemuan.find((p) => p.kodeSection === sectionCode) ?? undefined;

  // Land on the first pertemuan with work left whenever the course changes.
  useEffect(() => {
    if (!course) return;
    const next = nextPertemuan(pertemuan);
    setSectionCode(next?.kodeSection ?? null);
    const step = next && next.done < next.total ? nextStep(next) : undefined;
    setOpenSteps(step ? { [step]: true } : {});
    // Only on course change; refreshes must not yank you to another pertemuan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.kodeCourse]);

  const chooseCourse = (code: string) => {
    setCourseCode(code);
    try {
      window.localStorage.setItem(COURSE_KEY, code);
    } catch {
      // ignore
    }
  };

  const choosePertemuan = (p: Pertemuan) => {
    setSectionCode(p.kodeSection);
    // A finished pertemuan opens folded: nothing to do, and an open quiz step
    // there is one click from a retake.
    const next = p.done < p.total ? nextStep(p) : undefined;
    setOpenSteps(next ? { [next]: true } : {});
  };

  /** After a step finishes: re-read the course, then open the next open step. */
  const stepDone = async (kind: StepKind) => {
    if (!course || !current) return;
    setRefreshing(true);
    try {
      await onRefreshCourse(course.kodeCourse);
    } finally {
      setRefreshing(false);
    }
    // Move on regardless of whether Mentari's flag has caught up yet.
    const order = current.steps.map((s) => s.kind);
    const after = order.slice(order.indexOf(kind) + 1);
    const following = current.steps.find((s) => after.includes(s.kind) && !s.completed);
    if (following) setOpenSteps((prev) => ({ ...prev, [following.kind]: true }));
  };

  if (!courses) {
    return (
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 mb-6 text-center">
        <p className="text-sm text-gray-300">
          Load your courses to see every pertemuan and what is left in each.
        </p>
        <button
          onClick={onLoadCourses}
          disabled={scanLoading || !credentials.username || !credentials.password}
          className="mt-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-6 rounded-lg text-sm"
        >
          {scanLoading ? "Loading courses..." : "Load my courses"}
        </button>
        {scanError && <p className="mt-3 text-xs text-red-400">{scanError}</p>}
      </div>
    );
  }

  return (
    <div className="mb-6 flex flex-col gap-4">
      {/* 1. Course */}
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Course</h2>
          <button
            onClick={onLoadCourses}
            disabled={scanLoading || busy}
            className="text-[11px] px-2 py-1 rounded-md border border-gray-700 text-gray-400 hover:border-gray-500 disabled:opacity-40"
          >
            {scanLoading ? "Loading..." : "↻ Refresh all"}
          </button>
        </div>
        {scanError && <p className="mb-2 text-xs text-red-400">{scanError}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {courses.map((c) => {
            const p = courseProgress(c);
            const isSelected = c.kodeCourse === courseCode;
            const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
            return (
              <button
                key={c.kodeCourse}
                onClick={() => chooseCourse(c.kodeCourse)}
                disabled={busy}
                className={`rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                  isSelected
                    ? "border-blue-500 bg-blue-600/15"
                    : "border-gray-800 bg-gray-950/50 hover:border-gray-600"
                }`}
              >
                <span className="block truncate text-xs font-semibold text-gray-200">{c.namaCourse}</span>
                <span className="mt-1.5 flex items-center gap-2">
                  <span className="h-1 flex-1 overflow-hidden rounded bg-gray-800">
                    <span
                      className={`block h-full ${p.done === p.total && p.total ? "bg-emerald-500" : "bg-blue-500"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="shrink-0 text-[10px] text-gray-500">
                    {c.error ? "error" : `${p.done}/${p.total}`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Pertemuan */}
      {course && (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Pertemuan</h2>
          {course.error && <p className="mb-2 text-xs text-red-400">{course.error}</p>}
          {pertemuan.length === 0 ? (
            <p className="text-xs text-gray-500">Nothing published in this course yet.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {pertemuan.map((p) => {
                const isSelected = p.kodeSection === sectionCode;
                const complete = p.done === p.total;
                return (
                  <button
                    key={p.kodeSection}
                    onClick={() => choosePertemuan(p)}
                    disabled={busy}
                    className={`rounded-lg border px-2 py-1.5 text-left transition-colors disabled:opacity-50 ${
                      isSelected
                        ? "border-blue-500 bg-blue-600/15"
                        : "border-gray-800 bg-gray-950/50 hover:border-gray-600"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-1">
                      <span className={`truncate text-xs font-medium ${complete ? "text-gray-500" : "text-gray-200"}`}>
                        {p.namaSection}
                      </span>
                      {complete && <span className="text-[11px] font-bold text-emerald-500">✓</span>}
                    </span>
                    <span className="mt-1 flex gap-1">
                      {STEP_ORDER.map((kind) => {
                        const s = p.steps.find((x) => x.kind === kind);
                        return (
                          <span
                            key={kind}
                            title={`${STEP_LABELS[kind]}: ${!s ? "not published" : s.completed ? "done" : "to do"}`}
                            className={`h-1.5 flex-1 rounded-full ${
                              !s ? "bg-gray-800" : s.completed ? "bg-emerald-500" : "bg-yellow-500"
                            }`}
                          />
                        );
                      })}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="mt-2 text-[10px] text-gray-600">
            Bars: pre-test · forum · post-test · kuesioner. Green done, yellow to do, grey not
            published.
          </p>
        </div>
      )}

      {/* 3. Steps */}
      {course && current && (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-100">
              {current.namaSection}
              <span className="ml-2 text-xs font-normal text-gray-500">
                {current.done}/{current.total} done
              </span>
            </h2>
            {refreshing && <span className="text-[11px] text-gray-500">Checking Mentari...</span>}
          </div>

          <ol className="flex flex-col gap-2">
            {STEP_ORDER.map((kind, index) => {
              const step = current.steps.find((s) => s.kind === kind);
              const open = !!openSteps[kind] && !!step;
              const stepKey = `${course.kodeCourse}:${current.kodeSection}:${kind}`;
              return (
                <li
                  key={kind}
                  className={`rounded-xl border ${
                    open ? "border-gray-700 bg-gray-950/40" : "border-gray-800"
                  }`}
                >
                  <button
                    onClick={() => step && setOpenSteps((prev) => ({ ...prev, [kind]: !prev[kind] }))}
                    disabled={!step}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left disabled:cursor-default"
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                        !step
                          ? "bg-gray-800 text-gray-600"
                          : step.completed
                            ? "bg-emerald-600 text-white"
                            : "bg-yellow-500 text-gray-950"
                      }`}
                    >
                      {step?.completed ? "✓" : index + 1}
                    </span>
                    <span className={`flex-1 text-sm font-medium ${step ? "text-gray-100" : "text-gray-600"}`}>
                      {STEP_LABELS[kind]}
                      {step?.kind === "forum" && step.forum.theme && (
                        <span className="ml-2 text-xs font-normal text-gray-500">{step.forum.theme}</span>
                      )}
                    </span>
                    <span
                      className={`text-[11px] ${
                        !step ? "text-gray-600" : step.completed ? "text-emerald-400" : "text-yellow-400"
                      }`}
                    >
                      {!step ? "not published" : step.completed ? "done" : "to do"}
                    </span>
                    {step && <span className="text-[10px] text-gray-600">{open ? "▲" : "▼"}</span>}
                  </button>

                  {open && step && (
                    <div className="border-t border-gray-800 px-3 py-3">
                      {(step.kind === "pre-test" || step.kind === "post-test") && (
                        <QuizStep
                          key={stepKey}
                          quizId={step.quiz.id}
                          label={STEP_LABELS[step.kind]}
                          completed={step.completed}
                          credentials={credentials}
                          provider={provider}
                          onBusyChange={busyFor(stepKey)}
                          onDone={() => stepDone(step.kind)}
                        />
                      )}
                      {step.kind === "forum" && (
                        <ForumPanel
                          key={stepKey}
                          {...credentials}
                          provider={provider}
                          fixedForum={{ course, forum: step.forum }}
                          onBusyChange={busyFor(stepKey)}
                          onPosted={() => stepDone("forum")}
                        />
                      )}
                      {step.kind === "kuesioner" && (
                        <KuesionerStep
                          key={stepKey}
                          kodeCourse={course.kodeCourse}
                          kodeSection={current.kodeSection}
                          completed={step.completed}
                          credentials={credentials}
                          onBusyChange={busyFor(stepKey)}
                          onDone={() => stepDone("kuesioner")}
                        />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-[10px] text-gray-600">
            Done flags come from Mentari. A quiz can take a moment to show as done after
            submitting.
          </p>
        </div>
      )}
    </div>
  );
}
