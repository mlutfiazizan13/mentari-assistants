import type {
  DiscoveredQuiz,
  QuizKind,
  DiscoveredSection,
} from "@/types/mentari";

/**
 * Pulls quiz sub-sections out of a `/user-course/{kode_course}` payload.
 *
 * The real shape, confirmed against Mentari:
 *
 *   { kode_course, coursename, data: [
 *       { kode_section: "PERTEMUAN_1", nama_section: "Pertemuan 1", sort,
 *         sub_section: [
 *           { id: "<uuid>|null", tipe: "QUIZ", judul: "Pretest",
 *             kode_template: "PRE_TEST", sort } ] } ] }
 *
 * `id` is the quizId (`id_trx_course_sub_section`) and is null for anything the
 * lecturer has not published, so those rows are skipped. Every judul is just
 * "Pretest" / "Posttest" -- the pertemuan is what tells them apart, which is why
 * `sectionTitle` matters more than the title here.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LOOKS_LIKE_QUIZ = /\b(quiz|kuis|ujian|pre[\s_-]*test|post[\s_-]*test|test)\b/i;

type Json = Record<string, unknown>;

function str(node: Json, ...keys: string[]): string {
  for (const key of keys) {
    const value = node[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function num(node: Json, key: string): number {
  const value = node[key];
  return typeof value === "number" ? value : Number.MAX_SAFE_INTEGER;
}

function classify(...text: string[]): QuizKind {
  const haystack = text.join(" ").toLowerCase();
  if (/pre[\s_-]*test/.test(haystack)) return "pre-test";
  if (/post[\s_-]*test/.test(haystack)) return "post-test";
  return "quiz";
}

/** The human name of the course, e.g. "[3] ARSITEKTUR ... (Sabtu) [E-2]". */
export function extractCourseName(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  return str(
    payload as Json,
    "coursename",
    "nama_mata_kuliah",
    "nama_course",
    "shortname"
  );
}

/**
 * The pertemuan of a course, which is what a kuesioner is addressed to
 * (`/kuesioner/{kode_course}/{kode_section}`). Kuesioner are not part of the
 * course tree at all -- only the sections they hang off are -- so every section
 * is listed and the submit call decides whether one exists.
 */
export function extractSections(payload: unknown): DiscoveredSection[] {
  if (!payload || typeof payload !== "object") return [];

  const sections = (payload as { data?: unknown }).data;
  if (!Array.isArray(sections)) return [];

  const rows: { sort: number; section: DiscoveredSection }[] = [];

  sections.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const section = raw as Json;

    const kodeSection = str(section, "kode_section");
    if (!kodeSection) return;

    const subSections = section.sub_section ?? section.sub_sections;
    const sort = num(section, "sort");

    rows.push({
      sort: sort === Number.MAX_SAFE_INTEGER ? index : sort,
      section: {
        kodeSection,
        namaSection: str(section, "nama_section", "judul", "nama") || kodeSection,
        subSectionCount: Array.isArray(subSections) ? subSections.length : 0,
      },
    });
  });

  return rows.sort((a, b) => a.sort - b.sort).map((row) => row.section);
}

/** The documented layout: sections in `data`, quizzes in `sub_section`. */
function parseSections(payload: unknown): DiscoveredQuiz[] {
  if (!payload || typeof payload !== "object") return [];

  const sections = (payload as { data?: unknown }).data;
  if (!Array.isArray(sections)) return [];

  const quizzes: { sort: number; quiz: DiscoveredQuiz }[] = [];

  sections.forEach((rawSection, sectionIndex) => {
    if (!rawSection || typeof rawSection !== "object") return;
    const section = rawSection as Json;

    const subSections = section.sub_section ?? section.sub_sections;
    if (!Array.isArray(subSections)) return;

    const sectionTitle = str(section, "nama_section", "judul", "nama");
    const kodeSection = str(section, "kode_section");
    const sectionSort = num(section, "sort") === Number.MAX_SAFE_INTEGER
      ? sectionIndex
      : num(section, "sort");

    subSections.forEach((rawSub, subIndex) => {
      if (!rawSub || typeof rawSub !== "object") return;
      const sub = rawSub as Json;

      const tipe = str(sub, "tipe", "jenis", "type");
      const template = str(sub, "kode_template");
      const title = str(sub, "judul", "nama", "title");
      const id = str(sub, "id_trx_course_sub_section", "id");

      // Unpublished entries carry a null id and cannot be opened.
      if (!UUID.test(id)) return;
      if (tipe.toUpperCase() !== "QUIZ" && !LOOKS_LIKE_QUIZ.test(`${template} ${title}`))
        return;

      const subSort = num(sub, "sort") === Number.MAX_SAFE_INTEGER ? subIndex : num(sub, "sort");

      quizzes.push({
        sort: sectionSort * 1000 + subSort,
        quiz: {
          id,
          title: title || "Quiz",
          kind: classify(template, title),
          completed: sub.completion === true,
          jenis: tipe || undefined,
          sectionTitle: sectionTitle || undefined,
          kodeSection: kodeSection || undefined,
        },
      });
    });
  });

  return quizzes.sort((a, b) => a.sort - b.sort).map((entry) => entry.quiz);
}

/**
 * Last resort for a course laid out some other way: walk the whole tree and
 * take any node with a UUID id and a quiz-ish title.
 */
function walkAnyShape(payload: unknown): DiscoveredQuiz[] {
  const found = new Map<string, DiscoveredQuiz>();

  const walk = (node: unknown, sectionTitle: string, kodeSection: string) => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, sectionTitle, kodeSection);
      return;
    }
    if (!node || typeof node !== "object") return;

    const current = node as Json;
    const title = str(current, "judul", "nama", "nama_sub_section", "title");
    const jenis = str(current, "tipe", "jenis", "type");
    const template = str(current, "kode_template");
    const id = str(current, "id_trx_course_sub_section", "id");

    const isQuiz =
      UUID.test(id) &&
      !!title &&
      LOOKS_LIKE_QUIZ.test(`${jenis} ${template} ${title}`);

    if (isQuiz && !found.has(id)) {
      found.set(id, {
        id,
        title,
        kind: classify(template, title, jenis),
        completed: current.completion === true,
        jenis: jenis || undefined,
        sectionTitle: sectionTitle || undefined,
        kodeSection: str(current, "kode_section") || kodeSection || undefined,
      });
    }

    const nextSection =
      !isQuiz ? str(current, "nama_section", "judul", "nama") || sectionTitle : sectionTitle;
    const nextKode = str(current, "kode_section") || kodeSection;

    for (const value of Object.values(current)) {
      if (value && typeof value === "object") walk(value, nextSection, nextKode);
    }
  };

  walk(payload, "", "");
  return [...found.values()];
}

export function discoverQuizzes(payload: unknown): DiscoveredQuiz[] {
  const quizzes = parseSections(payload);
  return quizzes.length ? quizzes : walkAnyShape(payload);
}
