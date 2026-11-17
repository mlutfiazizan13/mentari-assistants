"use client";

import { useCallback, useEffect, useState } from "react";
import LogDisplay from "@/components/LogDisplay";
import type {
  AIProvider,
  AutomationLog,
  CourseContent,
  DiscoveredForum,
  ForumDraftKind,
  ForumDraftResponse,
  ForumFollowUp,
  ForumPostResponse,
  ForumPostResult,
  ForumPreviewResponse,
  ForumReplyKind,
  ForumThreadPost,
  ForumTopicDraft,
} from "@/types/mentari";

interface Selected {
  course: CourseContent;
  forum: DiscoveredForum;
}

interface ForumPanelProps {
  username: string;
  password: string;
  captcha: string;
  provider: AIProvider;
  /**
   * Embedded mode: show this one forum, no picker. Used by the pertemuan flow.
   * Without it the panel lists every forum from `courses` to pick from.
   */
  fixedForum?: Selected;
  courses?: CourseContent[] | null;
  scanLoading?: boolean;
  scanError?: string | null;
  onLoadCourses?: () => void;
  onBusyChange: (busy: boolean) => void;
  /** Called after at least one reply was posted, so done flags can be refreshed. */
  onPosted?: () => void;
}

type Step = "idle" | "opening" | "posting";

/**
 * One thing that can be drafted and posted: the topic itself (key = topic id)
 * or a lecturer follow-up to you inside it (key = "fu:" + follow-up id).
 */
interface Target {
  key: string;
  topic: ForumTopicDraft;
  followUp?: ForumFollowUp;
}

type Versions = { list: string[]; at: number };

const KIND_OPTIONS: { value: ForumReplyKind; label: string; hint: string }[] = [
  { value: "answer", label: "Answer", hint: "\"Izin menjawab.\" 60-120 words" },
  { value: "question", label: "Ask a question", hint: "\"Izin bertanya.\" 1-3 sentences" },
];

const INSTRUCTIONS_KEY = "mentari.forum.instructions";
/** Mirrors FORUM_INSTRUCTIONS_MAX on the server, which trims anything longer. */
const INSTRUCTIONS_MAX = 2000;
/** Mirrors FORUM_PROMPT_MAX on the server. */
const PROMPT_MAX = 1000;

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function targetsOf(preview: ForumPreviewResponse | null): Target[] {
  return (preview?.topics ?? []).flatMap((topic) => [
    { key: topic.topicId, topic },
    ...topic.followUps.map((followUp) => ({ key: `fu:${followUp.id}`, topic, followUp })),
  ]);
}

/** Still needs something from you: an unanswered topic, or an open follow-up. */
function isToDo(t: Target): boolean {
  return t.followUp ? !t.followUp.answered : !t.topic.myReply;
}

export default function ForumPanel({
  username,
  password,
  captcha,
  provider,
  fixedForum,
  courses = null,
  scanLoading = false,
  scanError = null,
  onLoadCourses,
  onBusyChange,
  onPosted,
}: ForumPanelProps) {
  const [selected, setSelected] = useState<Selected | null>(fixedForum ?? null);
  const [openCourse, setOpenCourse] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [showInstructions, setShowInstructions] = useState(false);
  const [kind, setKind] = useState<ForumReplyKind>("answer");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<AutomationLog[]>([]);

  const [preview, setPreview] = useState<ForumPreviewResponse | null>(null);
  /**
   * Every draft made per target, oldest first, and which one is showing. Edits
   * change the version on screen, so flipping away and back keeps them.
   */
  const [versions, setVersions] = useState<Record<string, Versions>>({});
  /** Targets with a draft in flight, and the last draft error per target. */
  const [redrafting, setRedrafting] = useState<Record<string, boolean>>({});
  const [redraftErrors, setRedraftErrors] = useState<Record<string, string>>({});
  const [draftingAll, setDraftingAll] = useState(false);
  /** The prompt box under each draft, keyed like the drafts. */
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  /** Targets ticked for posting. */
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState(false);
  const [postResults, setPostResults] = useState<Record<string, ForumPostResult>>({});

  const targets = targetsOf(preview);
  const draftOf = (key: string) => {
    const v = versions[key];
    return v ? (v.list[v.at] ?? "") : "";
  };

  const editDraft = (key: string, text: string) =>
    setVersions((prev) => {
      const v = prev[key] ?? { list: [""], at: 0 };
      const list = [...v.list];
      list[v.at] = text;
      return { ...prev, [key]: { list, at: v.at } };
    });

  const showVersion = (key: string, at: number) =>
    setVersions((prev) => {
      const v = prev[key];
      if (!v || at < 0 || at >= v.list.length) return prev;
      return { ...prev, [key]: { ...v, at } };
    });

  // Remember the instructions between visits. Storage can be missing or
  // blocked, in which case the box simply starts empty.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(INSTRUCTIONS_KEY);
      if (saved) setInstructions(saved);
    } catch {
      // ignore
    }
  }, []);

  const updateInstructions = (value: string) => {
    setInstructions(value);
    try {
      window.localStorage.setItem(INSTRUCTIONS_KEY, value);
    } catch {
      // ignore
    }
  };

  const anyRedrafting = draftingAll || Object.values(redrafting).some(Boolean);
  const busy = step !== "idle";
  useEffect(() => onBusyChange(busy || anyRedrafting), [busy, anyRedrafting, onBusyChange]);

  const coursesWithForums = courses?.filter((c) => c.forums.length || c.error) ?? [];

  // Expand the only course there is, once a scan lands.
  useEffect(() => {
    if (!courses) return;
    const withForums = courses.filter((c) => c.forums.length);
    if (withForums.length === 1) setOpenCourse(withForums[0].kodeCourse);
  }, [courses]);

  /** Read the forum: every topic and reply, no AI. Drafts start empty. */
  const openForum = useCallback(
    async (sel: Selected) => {
      setStep("opening");
      setError(null);
      setPreview(null);
      setVersions({});
      setRedraftErrors({});
      setChosen({});
      setPostResults({});
      setConfirming(false);
      try {
        const res = await fetch("/api/forum/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            password,
            captcha,
            forumId: sel.forum.id,
            courseName: sel.course.namaCourse,
            sectionTitle: sel.forum.sectionTitle,
            readOnly: true,
          }),
        });
        const data = (await res.json()) as ForumPreviewResponse;
        setLogs(data.logs ?? []);
        if (!res.ok || data.error) {
          setError(data.error ?? "Could not open the forum");
          return;
        }
        setPreview(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setStep("idle");
      }
    },
    [username, password, captcha]
  );

  // Embedded: open the given forum straight away, and again if it changes.
  const fixedId = fixedForum?.forum.id;
  useEffect(() => {
    if (!fixedForum) return;
    setSelected(fixedForum);
    void openForum(fixedForum);
    // Only re-run when the forum itself changes, not on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedId]);

  const pick = (course: CourseContent, forum: DiscoveredForum) => {
    const sel = { course, forum };
    setSelected(sel);
    void openForum(sel);
  };

  const toPost = targets.filter(
    (t) => chosen[t.key] && draftOf(t.key).trim() && postResults[t.key]?.status !== "posted"
  );

  /** Draft one target; keeps earlier versions and ticks it on its first draft. */
  const draftTarget = async (target: Target) => {
    if (!selected) return;
    const { key, topic, followUp } = target;
    const draftKind: ForumDraftKind = followUp ? "followup" : kind;
    const prompt = (prompts[key] ?? "").trim();
    // With a prompt and a draft on screen, revise that draft; otherwise start fresh.
    const previousDraft = prompt ? draftOf(key).trim() || undefined : undefined;
    setRedrafting((prev) => ({ ...prev, [key]: true }));
    setRedraftErrors((prev) => ({ ...prev, [key]: "" }));
    try {
      const res = await fetch("/api/forum/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          kind: draftKind,
          topicTitle: topic.judul,
          topicText: topic.text,
          courseName: selected.course.namaCourse,
          sectionTitle: selected.forum.sectionTitle,
          forumTheme: preview?.forum?.theme,
          instructions: instructions.trim() || undefined,
          lecturerPosts: topic.lecturerPosts,
          classmateQuestions: topic.classmateQuestions,
          myPost: followUp?.parentText,
          followUpText: followUp?.text,
          prompt: prompt || undefined,
          previousDraft,
        }),
      });
      const data = (await res.json()) as ForumDraftResponse;
      if (!res.ok || !data.draft) {
        setRedraftErrors((prev) => ({ ...prev, [key]: data.error ?? "Drafting failed" }));
        return;
      }
      const draft = data.draft;
      // A revision request is spent once applied; a first-draft prompt is too.
      if (prompt) setPrompts((prev) => ({ ...prev, [key]: "" }));
      setVersions((prev) => {
        const list = [...(prev[key]?.list.filter((d) => d.trim()) ?? []), draft];
        return { ...prev, [key]: { list, at: list.length - 1 } };
      });
      // Drafting means you want to post it, so tick it -- unless you already
      // ticked or unticked it yourself. Posting is still behind the confirm.
      setChosen((prev) => (key in prev ? prev : { ...prev, [key]: true }));
    } catch (err) {
      setRedraftErrors((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : "Unknown error",
      }));
    } finally {
      setRedrafting((prev) => ({ ...prev, [key]: false }));
    }
  };

  /**
   * What "Draft all" covers. Answers: topics you have not replied to and open
   * lecturer follow-ups. Questions: every topic. Anything already drafted or
   * posted is left alone.
   */
  const draftAllTargets = targets.filter(
    (t) =>
      !versions[t.key] &&
      postResults[t.key]?.status !== "posted" &&
      (kind === "question" ? !t.followUp : isToDo(t))
  );

  const draftAll = async () => {
    setDraftingAll(true);
    try {
      // One at a time: a self-hosted model is happier, and drafts appear in order.
      for (const t of draftAllTargets) await draftTarget(t);
    } finally {
      setDraftingAll(false);
    }
  };

  const handlePost = async () => {
    setConfirming(false);
    setStep("posting");
    setError(null);
    try {
      const res = await fetch("/api/forum/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          captcha,
          replies: toPost.map((t) => ({
            key: t.key,
            topicId: t.topic.topicId,
            judul: t.topic.judul,
            konten: draftOf(t.key),
            parentId: t.followUp?.parentId,
            replyToId: t.followUp?.id,
            // A second top-level reply is deliberate only on a topic already
            // answered when it was opened and ticked anyway; anything else that
            // turns up answered by now is a double post and gets skipped.
            allowDuplicate: t.followUp ? false : !!t.topic.myReply,
          })),
        }),
      });
      const data = (await res.json()) as ForumPostResponse;
      setLogs((prev) => [...prev, ...(data.logs ?? [])]);
      setPostResults((prev) => ({
        ...prev,
        ...Object.fromEntries((data.results ?? []).map((r) => [r.key, r])),
      }));
      if (!res.ok || data.error) setError(data.error ?? "Posting failed");
      if ((data.results ?? []).some((r) => r.status === "posted")) onPosted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setStep("idle");
    }
  };

  /** Props shared by every draft box, for one target. */
  const editorProps = (target: Target) => ({
    versions: versions[target.key],
    draft: draftOf(target.key),
    chosen: !!chosen[target.key],
    result: postResults[target.key],
    redrafting: !!redrafting[target.key],
    redraftError: redraftErrors[target.key],
    busy: busy || draftingAll,
    onRedraft: () => draftTarget(target),
    prompt: prompts[target.key] ?? "",
    onPrompt: (text: string) => setPrompts((prev) => ({ ...prev, [target.key]: text })),
    onEdit: (text: string) => editDraft(target.key, text),
    onShow: (at: number) => showVersion(target.key, at),
    onChoose: (on: boolean) => setChosen((prev) => ({ ...prev, [target.key]: on })),
  });

  const postedCount = Object.values(postResults).filter((r) => r.status === "posted").length;

  return (
    <>
      {/* Forum picker -- standalone mode only */}
      {!fixedForum && (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Forum Diskusi
            </h2>
            <button
              onClick={onLoadCourses}
              disabled={scanLoading || busy || !username || !password}
              className="text-xs font-medium px-2.5 py-1 rounded-md border border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {scanLoading ? "Loading..." : courses ? "Refresh" : "Load forums"}
            </button>
          </div>

          {scanError && <p className="mb-2 text-xs text-red-400">{scanError}</p>}
          {!courses && !scanLoading && (
            <p className="text-xs text-gray-500">Load your courses, then pick a forum to open it.</p>
          )}

          {courses && (
            <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-800 bg-gray-950/60 divide-y divide-gray-800">
              {coursesWithForums.length === 0 && (
                <p className="px-3 py-3 text-xs text-gray-500">
                  No published forums in {courses.length} course
                  {courses.length === 1 ? "" : "s"}.
                </p>
              )}

              {coursesWithForums.map((course) => {
                const isOpen = openCourse === course.kodeCourse;
                return (
                  <div key={course.kodeCourse}>
                    <button
                      onClick={() => setOpenCourse(isOpen ? null : course.kodeCourse)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-800/40"
                    >
                      <span className="shrink-0 text-gray-600 text-[10px]">{isOpen ? "▼" : "▶"}</span>
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-200">
                        {course.namaCourse}
                      </span>
                      <span className="shrink-0 rounded bg-gray-800 px-1.5 py-px text-[10px] text-gray-400">
                        {course.forums.filter((f) => f.completed).length}/{course.forums.length} done
                      </span>
                    </button>

                    {course.error && (
                      <p className="px-3 pb-2 text-[11px] text-red-400">{course.error}</p>
                    )}

                    {isOpen && (
                      <div className="flex flex-col gap-1 px-3 pb-2">
                        {course.forums.map((forum) => {
                          const isSelected = selected?.forum.id === forum.id;
                          return (
                            <button
                              key={forum.id}
                              onClick={() => pick(course, forum)}
                              disabled={busy || anyRedrafting}
                              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                isSelected
                                  ? "border-indigo-500 bg-indigo-600/15"
                                  : "border-transparent hover:border-gray-700 hover:bg-gray-800/60"
                              }`}
                            >
                              <span className={`shrink-0 text-xs ${forum.completed ? "text-gray-500" : "text-gray-200"}`}>
                                {forum.sectionTitle ?? forum.title}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-[11px] text-gray-500">
                                {forum.theme}
                              </span>
                              {forum.completed && (
                                <span title="Already done on Mentari" className="shrink-0 text-[11px] font-bold text-emerald-500">
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
      )}

      {step === "opening" && (
        <p className="mb-4 text-xs text-gray-400">Opening the forum and reading every reply...</p>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4 text-red-400 text-sm">
          <span className="font-semibold">Error:</span> {error}
        </div>
      )}

      {preview && selected && (
        <div className={fixedForum ? "" : "mb-6"}>
          {/* Header: which forum, and the drafting controls */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 mb-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {!fixedForum && (
                  <p className="truncate text-[11px] text-gray-500">{selected.course.namaCourse}</p>
                )}
                <p className="text-sm font-semibold text-gray-100">
                  {selected.forum.sectionTitle ?? preview.forum?.judul}
                  {preview.forum?.theme && (
                    <span className="font-normal text-gray-400"> · {preview.forum.theme}</span>
                  )}
                </p>
              </div>
              <button
                onClick={() => openForum(selected)}
                disabled={busy || anyRedrafting}
                title="Read the forum again (clears drafts)"
                className="shrink-0 text-[11px] px-2 py-1 rounded-md border border-gray-700 text-gray-400 hover:border-gray-500 disabled:opacity-40"
              >
                ↻ Reload
              </button>
            </div>

            {/* Topic chips: jump to a topic and see what is left at a glance */}
            {preview.topics.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {preview.topics.map((topic, i) => {
                  const open = topic.followUps.filter((f) => !f.answered).length;
                  return (
                    <a
                      key={topic.topicId}
                      href={`#topic-${topic.topicId}`}
                      className="flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-[11px] text-gray-300 hover:border-gray-500"
                    >
                      <span className="text-gray-500">{i + 1}.</span>
                      <span className="max-w-48 truncate">{topic.judul}</span>
                      {topic.myReply ? (
                        <span className="text-emerald-500">✓</span>
                      ) : (
                        <span className="text-yellow-400">to do</span>
                      )}
                      {open > 0 && <span className="text-yellow-400">· {open} follow-up</span>}
                    </a>
                  );
                })}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-gray-700 p-0.5">
                {KIND_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setKind(opt.value)}
                    disabled={anyRedrafting}
                    title={opt.hint}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium disabled:opacity-50 ${
                      kind === opt.value ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setShowInstructions((s) => !s)}
                className={`text-[11px] px-2 py-1 rounded-md border ${
                  instructions.trim()
                    ? "border-indigo-600/60 text-indigo-300"
                    : "border-gray-700 text-gray-400 hover:border-gray-500"
                }`}
              >
                {instructions.trim() ? "✎ Instructions (on)" : "✎ Extra instructions"}
              </button>

              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={draftAll}
                  disabled={busy || anyRedrafting || draftAllTargets.length === 0}
                  title={
                    kind === "question"
                      ? "Draft a question for every topic"
                      : "Draft answers for topics you haven't replied to and open lecturer follow-ups"
                  }
                  className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-indigo-600/60 bg-indigo-600/15 text-indigo-200 hover:border-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {draftingAll
                    ? "Drafting..."
                    : `Draft all ${kind === "question" ? "questions" : "to-do"} (${draftAllTargets.length})`}
                </button>

                {confirming ? (
                  <>
                    <button
                      onClick={handlePost}
                      className="text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-3 py-1.5 rounded-lg"
                    >
                      Yes, post {toPost.length} as {username}
                    </button>
                    <button
                      onClick={() => setConfirming(false)}
                      className="text-[11px] border border-gray-700 text-gray-300 px-2.5 py-1.5 rounded-lg hover:border-gray-500"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirming(true)}
                    disabled={busy || anyRedrafting || toPost.length === 0}
                    className="text-[11px] bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-3 py-1.5 rounded-lg"
                  >
                    {step === "posting" ? "Posting..." : `Post ${toPost.length} selected`}
                  </button>
                )}
              </div>
            </div>

            {showInstructions && (
              <div className="mt-3">
                <textarea
                  value={instructions}
                  onChange={(e) => updateInstructions(e.target.value.slice(0, INSTRUCTIONS_MAX))}
                  rows={3}
                  placeholder={
                    "Applies to every draft, and wins over the default style. e.g.\n" +
                    "Jawab lebih panjang, 3 paragraf.\n" +
                    "Kasih contoh dari pengalaman kerja di toko online."
                  }
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 leading-relaxed focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
                <div className="mt-1 flex justify-between text-[10px] text-gray-600">
                  <span>Saved in this browser.</span>
                  <span>
                    {instructions.length}/{INSTRUCTIONS_MAX}
                    {instructions && (
                      <button onClick={() => updateInstructions("")} className="ml-2 text-gray-400 hover:text-gray-200">
                        Clear
                      </button>
                    )}
                  </span>
                </div>
              </div>
            )}

            {postedCount > 0 && step === "idle" && (
              <p className="mt-3 text-[11px] text-emerald-400">
                ✓ {postedCount} posted. Press ↻ Reload to see them in the discussion.
              </p>
            )}
          </div>

          {preview.topics.length === 0 && (
            <p className="text-sm text-gray-500">This forum has no topics yet.</p>
          )}

          <div className="flex flex-col gap-4">
            {preview.topics.map((topic, index) => {
              const topicTarget: Target = { key: topic.topicId, topic };
              return (
                <div
                  key={topic.topicId}
                  id={`topic-${topic.topicId}`}
                  className="scroll-mt-4 bg-gray-900 rounded-xl border border-gray-800 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-100">
                        {preview.topics.length > 1 && (
                          <span className="text-gray-500">Topic {index + 1} · </span>
                        )}
                        {topic.judul}
                      </p>
                      <p className="text-[11px] text-gray-500">
                        {topic.dosen ?? "Dosen"} · {topic.replyCount} repl
                        {topic.replyCount === 1 ? "y" : "ies"}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded border px-1.5 py-px text-[10px] font-semibold ${
                        topic.myReply
                          ? "border-emerald-600/40 bg-emerald-600/15 text-emerald-400"
                          : "border-yellow-600/40 bg-yellow-600/15 text-yellow-400"
                      }`}
                    >
                      {topic.myReply ? "✓ answered" : "to do"}
                    </span>
                  </div>

                  <p className="mt-3 whitespace-pre-wrap text-xs text-gray-400 border-l-2 border-gray-700 pl-3 max-h-60 overflow-y-auto">
                    {topic.text}
                  </p>

                  {topic.lecturerPosts.length > 0 && (
                    <div className="mt-3 rounded-lg border border-amber-600/30 bg-amber-600/5 p-3">
                      <p className="text-[11px] font-semibold text-amber-400">
                        Lecturer posted this inside the thread · included when drafting
                      </p>
                      {topic.lecturerPosts.map((text, i) => (
                        <p key={i} className="mt-2 whitespace-pre-wrap text-xs text-gray-300 max-h-48 overflow-y-auto">
                          {text}
                        </p>
                      ))}
                    </div>
                  )}

                  {topic.noQuestion && kind === "answer" && (
                    <p className="mt-3 text-[11px] text-yellow-500">
                      This topic doesn&apos;t ask anything. Classmates post their own questions
                      here, so &quot;Ask a question&quot; probably fits better.
                    </p>
                  )}

                  {topic.attachments > 0 && (
                    <p className="mt-2 text-[11px] text-gray-500">
                      📎 {topic.attachments} attachment{topic.attachments === 1 ? "" : "s"} on the
                      topic (open on Mentari to download)
                    </p>
                  )}

                  {topic.error && <p className="mt-3 text-xs text-red-400">{topic.error}</p>}

                  {topic.posts.length > 0 && (
                    <ThreadView
                      key={topic.topicId}
                      topicId={topic.topicId}
                      posts={topic.posts}
                      // Open while there is little else on the card.
                      defaultOpen={preview.topics.length === 1 && !versions[topic.topicId]}
                    />
                  )}

                  <DraftEditor
                    {...editorProps(topicTarget)}
                    emptyLabel={
                      kind === "question"
                        ? "Draft a question"
                        : topic.myReply
                          ? "Draft another answer"
                          : "Draft answer"
                    }
                    postLabel={kind === "question" ? "Post this question" : "Post this reply"}
                  />

                  {topic.followUps.length > 0 && (
                    <div className="mt-4 border-t border-gray-800 pt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                        Lecturer replied to you · {topic.followUps.length}
                      </p>
                      <div className="mt-2 flex flex-col gap-3">
                        {topic.followUps.map((followUp) => {
                          const target: Target = { key: `fu:${followUp.id}`, topic, followUp };
                          return (
                            <div key={followUp.id} className="rounded-lg border border-gray-800 bg-gray-950/50 p-3">
                              <div className="flex items-start justify-between gap-2">
                                <p className="whitespace-pre-wrap text-xs text-gray-300 max-h-40 overflow-y-auto">
                                  {followUp.text}
                                </p>
                                <span
                                  className={`shrink-0 rounded border px-1.5 py-px text-[10px] font-semibold ${
                                    followUp.answered
                                      ? "border-emerald-600/40 bg-emerald-600/15 text-emerald-400"
                                      : "border-yellow-600/40 bg-yellow-600/15 text-yellow-400"
                                  }`}
                                >
                                  {followUp.answered ? "✓ answered" : "needs answer"}
                                </span>
                              </div>
                              {followUp.parentText && (
                                <details className="mt-2">
                                  <summary className="cursor-pointer text-[10px] text-gray-500">
                                    Your post it replies to
                                  </summary>
                                  <p className="mt-1 whitespace-pre-wrap text-[11px] text-gray-500">
                                    {followUp.parentText}
                                  </p>
                                </details>
                              )}
                              <DraftEditor
                                {...editorProps(target)}
                                emptyLabel={followUp.answered ? "Draft another answer" : "Draft an answer"}
                                postLabel="Post under your reply"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {logs.length > 0 && (
        <details className="mb-6 mt-4">
          <summary className="cursor-pointer text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            Forum log
          </summary>
          <div className="mt-2">
            <LogDisplay logs={logs} />
          </div>
        </details>
      )}
    </>
  );
}

interface DraftEditorProps {
  versions?: Versions;
  draft: string;
  chosen: boolean;
  result?: ForumPostResult;
  redrafting: boolean;
  redraftError?: string;
  busy: boolean;
  /** Button text before anything has been drafted. */
  emptyLabel: string;
  postLabel: string;
  onRedraft: () => void;
  /** The prompt box for this draft. */
  prompt: string;
  onPrompt: (text: string) => void;
  onEdit: (text: string) => void;
  onShow: (at: number) => void;
  onChoose: (on: boolean) => void;
}

/**
 * Draft history, redraft button, editable text and the post tick-box for one
 * target. Lives outside ForumPanel so typing does not remount the textarea.
 */
function DraftEditor({
  versions: v,
  draft,
  chosen,
  result,
  redrafting,
  redraftError,
  busy,
  emptyLabel,
  postLabel,
  onRedraft,
  prompt,
  onPrompt,
  onEdit,
  onShow,
  onChoose,
}: DraftEditorProps) {
  const posted = result?.status === "posted";
  const revising = !!prompt.trim() && !!draft.trim();

  return (
    <>
      {result && (
        <p
          className={`mt-3 text-[11px] font-semibold ${
            posted
              ? "text-emerald-400"
              : result.status === "skipped"
                ? "text-yellow-400"
                : "text-red-400"
          }`}
        >
          {result.status.toUpperCase()} · {result.message}
        </p>
      )}

      {!posted && (
        <div className="mt-3">
          {/* Prompt box: steers a first draft, or revises the one on screen */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={prompt}
              onChange={(e) => onPrompt(e.target.value.slice(0, PROMPT_MAX))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy && !redrafting) {
                  e.preventDefault();
                  onRedraft();
                }
              }}
              disabled={busy || redrafting}
              placeholder={
                v
                  ? "Revise this draft, e.g. lebih singkat, tambah contoh, jangan pakai istilah asing"
                  : "Optional prompt, e.g. fokus ke contoh di dunia kerja"
              }
              className="min-w-0 flex-1 bg-gray-800 border border-gray-700 rounded-md px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
            />
            <button
              onClick={onRedraft}
              disabled={busy || redrafting}
              title={
                v && revising
                  ? "Rewrite the draft on screen with your prompt"
                  : v
                    ? "Write a fresh draft (earlier ones are kept)"
                    : undefined
              }
              className="shrink-0 text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-indigo-600/50 bg-indigo-600/10 text-indigo-300 hover:border-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {redrafting
                ? "Drafting..."
                : v
                  ? revising
                    ? "✎ Revise"
                    : "↻ Redraft"
                  : emptyLabel}
            </button>
          </div>

          {(redraftError || (v && v.list.length > 1)) && (
            <div className="mt-2 flex items-center justify-between gap-2">
              {v && v.list.length > 1 ? (
                <div className="flex items-center gap-1 text-[11px] text-gray-400">
                  <button
                    onClick={() => onShow(v.at - 1)}
                    disabled={busy || v.at === 0}
                    aria-label="Previous draft"
                    className="rounded border border-gray-700 px-1.5 py-px hover:border-gray-500 disabled:opacity-30"
                  >
                    ‹
                  </button>
                  <span>
                    Draft {v.at + 1} of {v.list.length}
                  </span>
                  <button
                    onClick={() => onShow(v.at + 1)}
                    disabled={busy || v.at === v.list.length - 1}
                    aria-label="Next draft"
                    className="rounded border border-gray-700 px-1.5 py-px hover:border-gray-500 disabled:opacity-30"
                  >
                    ›
                  </button>
                </div>
              ) : (
                <span />
              )}
              {redraftError && (
                <span className="text-[11px] text-red-400 truncate max-w-72" title={redraftError}>
                  {redraftError}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {v && (
        <div className="mt-2">
          <textarea
            value={draft}
            onChange={(e) => onEdit(e.target.value)}
            disabled={busy || posted || redrafting}
            rows={Math.min(14, Math.max(4, draft.split("\n").length + 2))}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white leading-relaxed focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-60"
          />
          <div className="mt-1.5 flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={chosen}
                onChange={(e) => onChoose(e.target.checked)}
                disabled={busy || posted || !draft.trim()}
                className="accent-indigo-500"
              />
              {postLabel}
            </label>
            <span className="text-[10px] text-gray-600">{wordCount(draft)} words</span>
          </div>
        </div>
      )}
    </>
  );
}

type ThreadFilter = "all" | "dosen" | "mine";

const THREAD_FILTERS: { value: ThreadFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "dosen", label: "Lecturer" },
  { value: "mine", label: "Mine" },
];

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The discussion under a topic, laid out like Mentari's own "extended" view:
 * replies to the topic, each with its replies indented beneath. Deeper
 * replies, if any, are folded under their top-level ancestor. A filter
 * narrows it to lecturer posts or your own, shown flat.
 */
function ThreadView({
  topicId,
  posts,
  defaultOpen,
}: {
  topicId: string;
  posts: ForumThreadPost[];
  defaultOpen: boolean;
}) {
  const [filter, setFilter] = useState<ThreadFilter>("all");

  const byId = new Map(posts.map((p) => [p.id, p]));
  const rootOf = (p: ForumThreadPost): string => {
    let current = p;
    // Walk up until the parent is the topic (or unknown); guard against cycles.
    for (let i = 0; i < 10; i++) {
      const parent = current.parentId ? byId.get(current.parentId) : undefined;
      if (!parent || current.parentId === topicId) break;
      current = parent;
    }
    return current.id;
  };

  const tops = posts.filter((p) => !p.parentId || p.parentId === topicId || !byId.has(p.parentId));
  const children = new Map<string, ForumThreadPost[]>();
  for (const p of posts) {
    if (tops.includes(p)) continue;
    const root = rootOf(p);
    children.set(root, [...(children.get(root) ?? []), p]);
  }

  const counts = {
    all: posts.length,
    dosen: posts.filter((p) => p.role === "dosen").length,
    mine: posts.filter((p) => p.isMine).length,
  };
  const flat = filter === "all" ? [] : posts.filter((p) => (filter === "dosen" ? p.role === "dosen" : p.isMine));

  return (
    <details open={defaultOpen} className="mt-3 rounded-lg border border-gray-800 bg-gray-950/40">
      <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold text-gray-300">
        💬 Discussion · {posts.length} repl{posts.length === 1 ? "y" : "ies"}
        {counts.mine > 0 && <span className="ml-2 font-normal text-emerald-500">· {counts.mine} yours</span>}
      </summary>

      <div className="flex gap-1 border-t border-gray-800 px-3 py-2">
        {THREAD_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${
              filter === f.value
                ? "border-indigo-500 bg-indigo-600/20 text-indigo-200"
                : "border-gray-700 text-gray-400 hover:border-gray-500"
            }`}
          >
            {f.label} {counts[f.value]}
          </button>
        ))}
      </div>

      <div className="max-h-[32rem] overflow-y-auto px-3 pb-3 flex flex-col gap-2">
        {filter === "all"
          ? tops.map((post) => (
              <div key={post.id} className="flex flex-col gap-1.5">
                <ThreadPostView post={post} />
                {(children.get(post.id) ?? []).length > 0 && (
                  <div className="ml-5 flex flex-col gap-1.5 border-l-2 border-gray-800 pl-3">
                    {(children.get(post.id) ?? []).map((child) => (
                      <ThreadPostView
                        key={child.id}
                        post={child}
                        replyTo={child.parentId ? byId.get(child.parentId) : undefined}
                        topicId={topicId}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))
          : flat.map((post) => (
              <ThreadPostView
                key={post.id}
                post={post}
                replyTo={post.parentId ? byId.get(post.parentId) : undefined}
                topicId={topicId}
              />
            ))}
        {filter !== "all" && flat.length === 0 && (
          <p className="py-2 text-[11px] text-gray-500">Nothing here.</p>
        )}
      </div>
    </details>
  );
}

function ThreadPostView({
  post,
  replyTo,
  topicId,
}: {
  post: ForumThreadPost;
  /** Shown as "↳ to <name>" when the post answers someone other than the topic. */
  replyTo?: ForumThreadPost;
  topicId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = post.text.length > 600;

  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        post.isMine
          ? "border-emerald-700/50 bg-emerald-900/10"
          : post.role === "dosen"
            ? "border-amber-700/40 bg-amber-900/10"
            : "border-gray-800 bg-gray-900/60"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
        <span className="font-semibold text-gray-200">{post.author}</span>
        {post.role === "dosen" && (
          <span className="rounded bg-amber-600/20 px-1 text-[9px] font-semibold uppercase text-amber-400">
            Dosen
          </span>
        )}
        {post.isMine && (
          <span className="rounded bg-emerald-600/20 px-1 text-[9px] font-semibold uppercase text-emerald-400">
            You
          </span>
        )}
        {replyTo && replyTo.id !== topicId && (
          <span className="text-gray-500">↳ to {replyTo.isMine ? "you" : replyTo.author}</span>
        )}
        <span className="text-gray-600">{formatWhen(post.createdAt)}</span>
        {post.attachments > 0 && <span className="text-gray-500">📎 {post.attachments}</span>}
      </div>
      <p
        className={`mt-1 whitespace-pre-wrap text-xs text-gray-300 ${
          long && !expanded ? "line-clamp-6" : ""
        }`}
      >
        {post.text}
      </p>
      {long && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-[10px] text-indigo-400 hover:text-indigo-300"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
