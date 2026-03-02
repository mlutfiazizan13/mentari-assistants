import { NextRequest, NextResponse } from "next/server";
import { login, startQuiz, getQuizSoal, jawabSoal, endQuiz } from "@/lib/mentari";
import { answerAllQuestions } from "@/lib/ai";
import type { AutomationLog, AutomationRequest } from "@/types/mentari";

function log(
  logs: AutomationLog[],
  level: AutomationLog["level"],
  message: string
): void {
  logs.push({
    timestamp: new Date().toISOString(),
    level,
    message,
  });
  console.log(`[${level.toUpperCase()}] ${message}`);
}

export async function POST(req: NextRequest) {
  const logs: AutomationLog[] = [];

  try {
    const body = (await req.json()) as AutomationRequest;
    const { username, password, quizId, captcha = "test", provider = "gemini" } = body;

    if (!username || !password || !quizId) {
      return NextResponse.json(
        { success: false, error: "username, password, and quizId are required", logs },
        { status: 400 }
      );
    }

    // Step 1: Login
    log(logs, "info", `Logging in as ${username}...`);
    const authData = await login({ username, password, captcha });
    const token = authData.access_token;
    log(logs, "success", "Login successful, access token obtained.");

    // Step 2: Start quiz
    log(logs, "info", `Starting quiz with ID: ${quizId}...`);
    const startResult = await startQuiz(token, quizId);
    log(logs, "success", `Quiz started: ${startResult.message}`);

    // Step 3: Get questions
    log(logs, "info", "Fetching quiz questions...");
    const soalData = await getQuizSoal(token, quizId);
    const questions = soalData.data;
    log(
      logs,
      "success",
      `Fetched ${questions.length} questions. Time left: ${soalData.time_left}s`
    );

    if (questions.length === 0) {
      log(logs, "warning", "No questions found in this quiz.");
      return NextResponse.json({
        success: true,
        totalQuestions: 0,
        answeredQuestions: 0,
        logs,
      });
    }

    // Step 4: AI answers all questions
    log(logs, "info", `Sending ${questions.length} questions to AI (${provider}) for analysis...`);
    const aiAnswers = await answerAllQuestions(questions, provider);
    log(logs, "success", "AI has determined answers for all questions.");

    // Step 5: Submit each answer
    let answeredCount = 0;
    for (const answer of aiAnswers) {
      const question = questions.find((q) => q.id === answer.questionId);
      const questionText = question?.deskripsi
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);

      log(
        logs,
        "info",
        `Answering Q${question?.sort ?? "?"}: "${questionText}..." → Reasoning: ${answer.reasoning}`
      );

      await jawabSoal(token, {
        id_trx_quiz_user_soal: answer.questionId,
        id_jawaban: answer.selectedAnswerId,
      });

      answeredCount++;
      log(logs, "success", `Q${question?.sort ?? answeredCount} answered successfully.`);

      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 300));
    }

    // Step 6: End quiz
    log(logs, "info", "Submitting quiz...");
    const endResult = await endQuiz(token, quizId);
    log(logs, "success", `Quiz submitted: ${endResult.message}`);

    return NextResponse.json({
      success: true,
      totalQuestions: questions.length,
      answeredQuestions: answeredCount,
      logs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(logs, "error", `Automation failed: ${message}`);
    return NextResponse.json(
      { success: false, error: message, logs },
      { status: 500 }
    );
  }
}
