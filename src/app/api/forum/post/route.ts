import { NextRequest, NextResponse } from "next/server";
import { login, getForumThread, addForumReply } from "@/lib/mentari";
import { toForumKonten } from "@/lib/ai";
import { log, ownPosts } from "@/lib/forum";
import type {
  AutomationLog,
  ForumPostRequest,
  ForumPostResponse,
  ForumPostResult,
} from "@/types/mentari";

// Drives a real Chrome via patchright, so this can never run on the edge runtime.
export const runtime = "nodejs";

const time = (iso: string) => new Date(iso).getTime() || 0;

/**
 * Post reviewed replies, titled "RE <post>" the way Mentari's own reply box does.
 *
 * POST { username, password, captcha?, allowDuplicate?,
 *        replies: [{ key, topicId, judul, konten, parentId?, replyToId?, allowDuplicate? }] }
 *
 * Without `parentId` the reply goes straight under the topic (`id_post` = the
 * topic id). With it, the reply goes under that post -- used to answer a
 * lecturer's follow-up, and only allowed under your own post.
 *
 * Each thread is re-read right before posting, and a reply of yours that
 * appeared since the preview skips the item unless `allowDuplicate` is set:
 * for a topic, any reply of yours; for a follow-up, one under the same post
 * made after the follow-up. After posting, the thread is read once more to
 * confirm the reply actually landed.
 */
export async function POST(req: NextRequest) {
  const logs: AutomationLog[] = [];
  const results: ForumPostResult[] = [];

  try {
    const body = (await req.json()) as ForumPostRequest;
    const { username, password, captcha = "test", replies, allowDuplicate = false } = body;

    const valid = Array.isArray(replies)
      ? replies.filter((r) => r?.topicId && r.konten?.trim())
      : [];

    if (!username || !password || valid.length === 0) {
      const payload: ForumPostResponse = {
        success: false,
        results,
        logs,
        error: "username, password and at least one non-empty reply are required",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    log(logs, "info", `Logging in as ${username}...`);
    const { access_token: token } = await login({ username, password, captcha });
    log(logs, "success", "Login successful.");

    for (const reply of valid) {
      const key = reply.key || reply.topicId;
      const label = `"${reply.judul || reply.topicId}"${reply.parentId ? " (follow-up)" : ""}`;
      const push = (status: ForumPostResult["status"], message: string) =>
        results.push({ key, topicId: reply.topicId, status, message });

      try {
        const before = await getForumThread(token, reply.topicId);
        const posts = Array.isArray(before.data) ? before.data : [];
        const mineBefore = ownPosts(before, username);

        let idPost = before.id;
        let judul = `RE ${before.judul}`;
        let existing = mineBefore;

        if (reply.parentId) {
          const parent = posts.find((p) => p.id === reply.parentId);
          if (!parent || !mineBefore.some((p) => p.id === parent.id)) {
            push("failed", "That post is not one of yours in this thread.");
            log(logs, "error", `${label}: parent post is not yours, refused.`);
            continue;
          }
          const replyTo = posts.find((p) => p.id === reply.replyToId);
          const since = replyTo ? time(replyTo.createdAt) : 0;
          idPost = parent.id;
          judul = `RE ${parent.judul}`;
          existing = mineBefore.filter(
            (p) => p.id_parent === parent.id && time(p.createdAt) > since
          );
        }

        if (existing.length && !(reply.allowDuplicate ?? allowDuplicate)) {
          push("skipped", "You already have a reply here.");
          log(logs, "warning", `${label}: you already replied, skipped.`);
          continue;
        }

        log(logs, "info", `${label}: posting reply...`);
        await addForumReply(token, {
          id_topic: before.id,
          id_post: idPost,
          konten: toForumKonten(reply.konten),
          judul,
        });

        const after = await getForumThread(token, reply.topicId);
        const landed = ownPosts(after, username).length > mineBefore.length;

        push(
          "posted",
          landed
            ? "Posted and visible in the thread."
            : "Mentari accepted it, but it is not in the thread yet."
        );
        log(
          logs,
          landed ? "success" : "warning",
          `${label}: ${landed ? "posted." : "accepted, not visible in the thread yet."}`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        push("failed", message);
        log(logs, "error", `${label}: ${message}`);
      }
    }

    const payload: ForumPostResponse = {
      success: results.every((r) => r.status !== "failed"),
      results,
      logs,
    };
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(logs, "error", `Failed: ${message}`);
    const payload: ForumPostResponse = { success: false, results, logs, error: message };
    return NextResponse.json(payload, { status: 500 });
  }
}
