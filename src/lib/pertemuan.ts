import type {
  CourseContent,
  DiscoveredForum,
  DiscoveredKuesioner,
  DiscoveredQuiz,
} from "@/types/mentari";

/** The order a pertemuan is meant to be worked through on Mentari. */
export type StepKind = "pre-test" | "forum" | "post-test" | "kuesioner";

export const STEP_ORDER: StepKind[] = ["pre-test", "forum", "post-test", "kuesioner"];

export const STEP_LABELS: Record<StepKind, string> = {
  "pre-test": "Pre-test",
  forum: "Forum Diskusi",
  "post-test": "Post-test",
  kuesioner: "Kuesioner",
};

export type PertemuanStep =
  | { kind: "pre-test" | "post-test"; completed: boolean; quiz: DiscoveredQuiz }
  | { kind: "forum"; completed: boolean; forum: DiscoveredForum }
  | { kind: "kuesioner"; completed: boolean; kuesioner: DiscoveredKuesioner };

export interface Pertemuan {
  kodeSection: string;
  namaSection: string;
  /** Only the steps this pertemuan actually has published, in STEP_ORDER. */
  steps: PertemuanStep[];
  done: number;
  total: number;
}

/**
 * Group a scanned course into its pertemuan, each with the steps it holds.
 * Sections with nothing actionable (GENERAL, UTS, unpublished weeks) drop out.
 */
export function buildPertemuan(course: CourseContent): Pertemuan[] {
  return course.sections
    .map((section) => {
      const code = section.kodeSection;
      const steps: PertemuanStep[] = [];

      const pre = course.quizzes.find((q) => q.kodeSection === code && q.kind === "pre-test");
      if (pre) steps.push({ kind: "pre-test", completed: !!pre.completed, quiz: pre });

      const forum = course.forums.find((f) => f.kodeSection === code);
      if (forum) steps.push({ kind: "forum", completed: !!forum.completed, forum });

      const post = course.quizzes.find((q) => q.kodeSection === code && q.kind === "post-test");
      if (post) steps.push({ kind: "post-test", completed: !!post.completed, quiz: post });

      const kuesioner = (course.kuesioners ?? []).find((k) => k.kodeSection === code);
      if (kuesioner) steps.push({ kind: "kuesioner", completed: kuesioner.completed, kuesioner });

      return {
        kodeSection: code,
        namaSection: section.namaSection,
        steps,
        done: steps.filter((s) => s.completed).length,
        total: steps.length,
      };
    })
    .filter((p) => p.total > 0);
}

/** The first pertemuan with something left to do, else the last one. */
export function nextPertemuan(list: Pertemuan[]): Pertemuan | undefined {
  return list.find((p) => p.done < p.total) ?? list[list.length - 1];
}

/** The first step not done yet, else the first step. */
export function nextStep(p: Pertemuan): StepKind | undefined {
  return (p.steps.find((s) => !s.completed) ?? p.steps[0])?.kind;
}
