import { NextRequest, NextResponse } from "next/server";
import { generateForumReply } from "@/lib/ai";
import type { ForumDraftRequest, ForumDraftResponse } from "@/types/mentari";

export const runtime = "nodejs";

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined;

/**
 * Draft one more reply for a single topic or lecturer follow-up. The page
 * already holds the thread context from /api/forum/preview, so this skips
 * Mentari entirely -- no login, no browser -- and only calls the AI. Nothing
 * is posted.
 *
 * POST { topicTitle, topicText, provider?, kind?, courseName?, sectionTitle?,
 *        forumTheme?, instructions?, lecturerPosts?, classmateQuestions?,
 *        myPost?, followUpText? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ForumDraftRequest;
    const { topicTitle, topicText, provider = "gemini", kind = "answer" } = body;

    if (!topicTitle || typeof topicText !== "string") {
      const payload: ForumDraftResponse = { error: "topicTitle and topicText are required" };
      return NextResponse.json(payload, { status: 400 });
    }
    if (kind === "followup" && !body.followUpText) {
      const payload: ForumDraftResponse = { error: "followUpText is required for a follow-up" };
      return NextResponse.json(payload, { status: 400 });
    }

    const draft = await generateForumReply(
      {
        topicTitle,
        topicText,
        kind,
        courseName: body.courseName,
        sectionTitle: body.sectionTitle,
        forumTheme: body.forumTheme,
        instructions: typeof body.instructions === "string" ? body.instructions : undefined,
        lecturerPosts: strings(body.lecturerPosts),
        classmateQuestions: strings(body.classmateQuestions),
        myPost: body.myPost,
        followUpText: body.followUpText,
        prompt: typeof body.prompt === "string" ? body.prompt : undefined,
        previousDraft: typeof body.previousDraft === "string" ? body.previousDraft : undefined,
      },
      provider
    );

    const payload: ForumDraftResponse = { draft };
    return NextResponse.json(payload);
  } catch (err) {
    const payload: ForumDraftResponse = {
      error: err instanceof Error ? err.message : String(err),
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
