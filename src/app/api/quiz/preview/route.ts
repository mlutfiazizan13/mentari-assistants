import { NextRequest, NextResponse } from "next/server";
import { login, startQuiz, getQuizSoal } from "@/lib/mentari";
import { answerAllQuestions } from "@/lib/ai";
import type { AutomationRequest, QuizQuestion, AIAnswerResult } from "@/types/mentari";

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface PreviewQuestion {
  id: string;
  sort: number;
  deskripsi: string;
  options: { id: string; text: string; sort: number }[];
  aiAnswer?: AIAnswerResult;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AutomationRequest;
    const { username, password, quizId, captcha = "test", provider = "gemini" } = body;

    if (!username || !password || !quizId) {
      return NextResponse.json(
        { error: "username, password, and quizId are required" },
        { status: 400 }
      );
    }

    const authData = await login({ username, password, captcha });
    const token = authData.access_token;

    await startQuiz(token, quizId);
    const soalData = await getQuizSoal(token, quizId);
    const questions: QuizQuestion[] = soalData.data;

    const aiAnswers = await answerAllQuestions(questions, provider);

    const preview: PreviewQuestion[] = questions.map((q) => ({
      id: q.id,
      sort: q.sort,
      deskripsi: stripHtml(q.deskripsi),
      options: q.list_jawaban.map((opt) => ({
        id: opt.id,
        text: stripHtml(opt.jawaban),
        sort: opt.sort,
      })),
      aiAnswer: aiAnswers.find((a) => a.questionId === q.id),
    }));

    return NextResponse.json({
      kode_course: soalData.kode_course,
      kode_section: soalData.kode_section,
      judul: soalData.judul,
      duration: soalData.duration,
      time_left: soalData.time_left,
      token,
      quizId,
      questions: preview,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
