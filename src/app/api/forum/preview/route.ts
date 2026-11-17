import { NextRequest, NextResponse } from "next/server";
import { login, getForumTopics, getForumThread } from "@/lib/mentari";
import { generateForumReply } from "@/lib/ai";
import { htmlToText, stripHtml } from "@/lib/html";
import { analyzeThread, log, ownTopLevelReply, threadPosts } from "@/lib/forum";
import type {
  AutomationLog,
  ForumPreviewRequest,
  ForumPreviewResponse,
  ForumTopicDraft,
} from "@/types/mentari";

// Drives a real Chrome via patchright, so this can never run on the edge runtime.
export const runtime = "nodejs";

/**
 * Read a forum, every reply included, and draft AI replies. Nothing is posted
 * here -- the drafts go back to the page for review and editing, and
 * /api/forum/post sends whichever ones the student keeps.
 *
 * POST { username, password, captcha?, forumId, provider?, courseName?,
 *        sectionTitle?, includeAnswered?, instructions?, kind? }
 *
 * The whole thread is read, not just the topic post: lecturers sometimes put
 * the soal in their own reply, and often follow up under a student's answer
 * with a question. In "answer" mode those follow-ups to you get a draft too.
 */
export async function POST(req: NextRequest) {
  const logs: AutomationLog[] = [];

  try {
    const body = (await req.json()) as ForumPreviewRequest;
    const {
      username,
      password,
      captcha = "test",
      forumId,
      provider = "gemini",
      courseName,
      sectionTitle,
      includeAnswered = false,
      instructions,
      kind = "answer",
      readOnly = false,
    } = body;

    if (!username || !password || !forumId) {
      const payload: ForumPreviewResponse = {
        topics: [],
        logs,
        error: "username, password and forumId are required",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const extra = typeof instructions === "string" ? instructions : undefined;
    if (extra?.trim()) {
      log(logs, "info", `Using your extra instructions (${extra.trim().length} chars).`);
    }

    log(logs, "info", `Logging in as ${username}...`);
    const { access_token: token } = await login({ username, password, captcha });
    log(logs, "success", "Login successful.");

    const forum = await getForumTopics(token, forumId);
    const theme = stripHtml(forum.konten ?? "");
    const topics = Array.isArray(forum.topics) ? forum.topics : [];
    log(
      logs,
      "success",
      `Forum "${forum.judul}" (${forum.kode_section}) -- ${topics.length} topic${topics.length === 1 ? "" : "s"}.`
    );

    const base = { courseName, sectionTitle, forumTheme: theme, instructions: extra };
    const drafts: ForumTopicDraft[] = [];

    for (const topic of topics) {
      const text = htmlToText(topic.konten ?? "");
      const row: ForumTopicDraft = {
        topicId: topic.id,
        judul: topic.judul,
        text,
        replyCount: 0,
        lecturerPosts: [],
        classmateQuestions: [],
        noQuestion: false,
        followUps: [],
        posts: [],
        attachments: Array.isArray(topic.files) ? topic.files.length : 0,
      };

      try {
        const thread = await getForumThread(token, topic.id);
        row.dosen = thread.dosen?.nama_gelar ?? thread.dosen?.nama_dosen;
        row.replyCount = Array.isArray(thread.data) ? thread.data.length : 0;

        const analysis = analyzeThread(thread, text, username);
        Object.assign(row, analysis);
        row.posts = threadPosts(thread, username);

        const notes = [
          analysis.lecturerPosts.length &&
            `${analysis.lecturerPosts.length} lecturer post(s) under the topic`,
          analysis.followUps.length &&
            `${analysis.followUps.length} lecturer follow-up(s) to you, ${
              analysis.followUps.filter((f) => !f.answered).length
            } unanswered`,
          analysis.noQuestion && "no question in the topic",
        ].filter(Boolean);
        log(
          logs,
          "info",
          `"${topic.judul}": read ${row.replyCount} replies${notes.length ? ` -- ${notes.join(", ")}` : ""}.`
        );

        const mine = ownTopLevelReply(thread, username);
        if (mine) row.myReply = htmlToText(mine.konten);

        const context = {
          ...base,
          topicTitle: topic.judul,
          topicText: text,
          lecturerPosts: analysis.lecturerPosts,
          classmateQuestions: analysis.classmateQuestions,
        };

        if (readOnly) {
          drafts.push(row);
          continue;
        }

        // Asking a question after answering is normal, so only answers skip.
        if (mine && !includeAnswered && kind !== "question") {
          log(logs, "warning", `"${topic.judul}": already answered, no new answer drafted.`);
        } else {
          log(logs, "info", `"${topic.judul}": drafting ${kind} with ${provider}...`);
          row.draft = await generateForumReply({ ...context, kind }, provider);
          log(logs, "success", `"${topic.judul}": draft ready (${row.draft.length} chars).`);
        }

        // Follow-ups are answers by nature; they are drafted in answer mode only.
        if (kind === "answer") {
          for (const followUp of row.followUps.filter((f) => !f.answered)) {
            try {
              log(logs, "info", `"${topic.judul}": drafting answer to lecturer follow-up...`);
              followUp.draft = await generateForumReply(
                {
                  ...context,
                  kind: "followup",
                  myPost: followUp.parentText,
                  followUpText: followUp.text,
                },
                provider
              );
            } catch (err) {
              followUp.error = err instanceof Error ? err.message : String(err);
              log(logs, "error", `"${topic.judul}" follow-up: ${followUp.error}`);
            }
          }
        }
      } catch (err) {
        row.error = err instanceof Error ? err.message : String(err);
        log(logs, "error", `"${topic.judul}": ${row.error}`);
      }

      drafts.push(row);
    }

    const payload: ForumPreviewResponse = {
      forum: {
        judul: forum.judul,
        theme,
        kode_course: forum.kode_course,
        kode_section: forum.kode_section,
      },
      topics: drafts,
      logs,
    };
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(logs, "error", `Failed: ${message}`);
    const payload: ForumPreviewResponse = { topics: [], logs, error: message };
    return NextResponse.json(payload, { status: 500 });
  }
}
