import type {
  AutomationLog,
  ForumFollowUp,
  ForumPost,
  ForumThreadPost,
  ForumThreadResponse,
} from "@/types/mentari";
import { htmlToText } from "./html";

/**
 * Posts in a thread written by this student. Replies carry the author's NIM in
 * `nim` (and again in `mahasiswa.nim`), which is the login username.
 */
export function ownPosts(thread: ForumThreadResponse, nim: string): ForumPost[] {
  const posts = Array.isArray(thread.data) ? thread.data : [];
  return posts.filter((p) => p.nim === nim || p.mahasiswa?.nim === nim);
}

/** Prefer a reply straight to the topic over one nested under a classmate. */
export function ownTopLevelReply(
  thread: ForumThreadResponse,
  nim: string
): ForumPost | undefined {
  const mine = ownPosts(thread, nim);
  return mine.find((p) => p.id_parent === thread.id) ?? mine[0];
}

export function isLecturerPost(p: ForumPost): boolean {
  return !!(p.id_dosen || p.dosen);
}

const time = (iso: string) => new Date(iso).getTime() || 0;

/** "silahkan diskusikan disini" has no question; a topic ending in "?" does. */
const ASKS = /\?|\b(jelaskan|sebutkan|analisis|analisislah|evaluasilah|tentukan|buatlah|hitung|bandingkan|uraikan|diskusikan bagaimana)\b/i;

/** Keep prompts bounded on threads with 150+ replies. */
const LECTURER_POST_MAX = 3000;
const CLASSMATE_QUESTIONS_MAX = 20;

export interface ThreadAnalysis {
  /** Lecturer posts directly under the topic -- often the actual soal. */
  lecturerPosts: string[];
  classmateQuestions: string[];
  noQuestion: boolean;
  followUps: ForumFollowUp[];
}

/**
 * Everything in a thread beyond the topic post that matters for drafting.
 *
 * Surveyed across real courses, the question is not always in the topic:
 *  - some lecturers post the soal as their own reply under an instructions-only
 *    topic ("JANGAN REPLAY PADA SOAL ... buat create baru");
 *  - some topics are just "diskusikan" and students post questions themselves;
 *  - most lecturers reply under individual answers with a follow-up question.
 */
export function analyzeThread(
  thread: ForumThreadResponse,
  topicText: string,
  nim: string
): ThreadAnalysis {
  const posts = Array.isArray(thread.data) ? thread.data : [];
  const byId = new Map(posts.map((p) => [p.id, p]));
  const mine = ownPosts(thread, nim);
  const mineIds = new Set(mine.map((p) => p.id));

  const lecturerPosts = posts
    .filter((p) => isLecturerPost(p) && p.id_parent === thread.id)
    .sort((a, b) => time(a.createdAt) - time(b.createdAt))
    .map((p) => htmlToText(p.konten).slice(0, LECTURER_POST_MAX))
    .filter(Boolean);

  const classmateQuestions = posts
    .filter((p) => !isLecturerPost(p) && !mineIds.has(p.id) && p.id_parent === thread.id)
    .map((p) => htmlToText(p.konten))
    // A question post is short; long ones are answers that happen to contain "?".
    .filter((t) => t.length <= 400 && (/izin\s+bertanya/i.test(t) || t.includes("?")))
    .slice(0, CLASSMATE_QUESTIONS_MAX)
    .map((t) => t.slice(0, 250));

  const followUps: ForumFollowUp[] = posts
    .filter(
      (p) =>
        isLecturerPost(p) &&
        !!p.id_parent &&
        mineIds.has(p.id_parent) &&
        htmlToText(p.konten).includes("?")
    )
    .sort((a, b) => time(a.createdAt) - time(b.createdAt))
    .map((p) => {
      const parent = byId.get(p.id_parent as string);
      return {
        id: p.id,
        parentId: p.id_parent as string,
        parentText: parent ? htmlToText(parent.konten) : "",
        text: htmlToText(p.konten),
        createdAt: p.createdAt,
        answered: mine.some(
          (m) => m.id_parent === p.id_parent && time(m.createdAt) > time(p.createdAt)
        ),
      };
    });

  return {
    lecturerPosts,
    classmateQuestions,
    noQuestion: !ASKS.test(topicText) && !lecturerPosts.some((t) => ASKS.test(t)),
    followUps,
  };
}

/** The thread's replies as the page shows them, oldest first. */
export function threadPosts(thread: ForumThreadResponse, nim: string): ForumThreadPost[] {
  const posts = Array.isArray(thread.data) ? thread.data : [];
  return [...posts]
    .sort((a, b) => time(a.createdAt) - time(b.createdAt))
    .map((p) => {
      const lecturer = isLecturerPost(p);
      return {
        id: p.id,
        parentId: p.id_parent,
        author: lecturer
          ? (p.dosen?.nama_gelar ?? p.dosen?.nama_dosen ?? "Dosen")
          : (p.mahasiswa?.nama_mahasiswa ?? p.nim ?? "Mahasiswa"),
        role: lecturer ? "dosen" : "mahasiswa",
        isMine: p.nim === nim || p.mahasiswa?.nim === nim,
        text: htmlToText(p.konten),
        createdAt: p.createdAt,
        attachments: Array.isArray(p.files) ? p.files.length : 0,
      };
    });
}

export function log(
  logs: AutomationLog[],
  level: AutomationLog["level"],
  message: string
): void {
  logs.push({ timestamp: new Date().toISOString(), level, message });
  console.log(`[forum] [${level.toUpperCase()}] ${message}`);
}
