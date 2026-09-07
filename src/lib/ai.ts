import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { QuizQuestion, AIAnswerResult, AIProvider } from "@/types/mentari";
import { stripHtml } from "./html";

/**
 * Code questions ("Apa fungsi dari array_push($arr, "Data");?") make models
 * quote the snippet back inside `reasoning`, which is how a reply stops being
 * valid JSON. Long answers are also what truncation hits, so keep the budget
 * well above what one object needs.
 */
const MAX_TOKENS = 700;
const MAX_ATTEMPTS = 3;

function buildPrompt(question: QuizQuestion, retryHint = false): string {
  const questionText = stripHtml(question.deskripsi);
  const options = question.list_jawaban
    .map((opt, idx) => `${idx + 1}. [ID: ${opt.id}] ${stripHtml(opt.jawaban)}`)
    .join("\n");

  const retry = retryHint
    ? `\nYour previous reply could not be parsed. Reply with the raw JSON object only: no code fences, no prose, no line breaks inside string values.\n`
    : "";

  return `You are answering a multiple choice quiz question. Choose the most correct answer.

Question:
${questionText}

Answer options:
${options}

Respond with a JSON object in this exact format:
{
  "selected_index": <1-based index of correct answer>,
  "selected_id": "<ID of the correct answer option>",
  "reasoning": "<brief explanation>"
}

Keep "reasoning" under 140 characters, on one line, and do not use double quotes
inside it -- the question may contain code, so refer to it without quoting it.
Only respond with the JSON object, no other text.${retry}`;
}

/**
 * First `{...}` block with balanced braces, ignoring braces inside strings.
 * A greedy `/\{[\s\S]*\}/` also grabs trailing prose and, worse, matches
 * nothing at all when the reply was truncated mid-object.
 */
function extractJsonBlock(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

interface ParsedAnswer {
  selected_index?: number;
  selected_id?: string;
  reasoning?: string;
}

/**
 * Last resort when the object will not parse -- typically unescaped quotes in
 * `reasoning`, or a body cut off by the token limit. The choice fields are
 * simple scalars and survive both, so pull them out directly.
 */
function scrapeFields(text: string): ParsedAnswer | null {
  const id = /"selected_id"\s*:\s*"([^"]*)"/.exec(text)?.[1];
  const index = /"selected_index"\s*:\s*(\d+)/.exec(text)?.[1];
  if (!id && !index) return null;

  const reasoning =
    /"reasoning"\s*:\s*"([\s\S]*?)"\s*[,}]/.exec(text)?.[1] ??
    /"reasoning"\s*:\s*"([\s\S]*)/.exec(text)?.[1];

  return {
    selected_id: id,
    selected_index: index ? Number(index) : undefined,
    reasoning: reasoning?.replace(/\\"/g, '"').replace(/\s+/g, " ").trim(),
  };
}

function parseAIResponse(text: string, question: QuizQuestion): AIAnswerResult {
  const cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();

  let parsed: ParsedAnswer | null = null;
  for (const candidate of [cleaned, extractJsonBlock(cleaned)]) {
    if (!candidate) continue;
    try {
      parsed = JSON.parse(candidate) as ParsedAnswer;
      break;
    } catch {
      // fall through to the next candidate
    }
  }

  parsed ??= scrapeFields(cleaned);

  if (!parsed) {
    throw new Error(`No usable answer in model response: ${text.slice(0, 200)}`);
  }

  const validIds = question.list_jawaban.map((o) => o.id);
  let selectedId = parsed.selected_id;

  if (!selectedId || !validIds.includes(selectedId)) {
    const index = Number(parsed.selected_index);
    if (!Number.isFinite(index)) {
      throw new Error(
        `Model returned neither a valid answer ID nor an index: ${text.slice(0, 200)}`
      );
    }
    selectedId = validIds[Math.max(0, Math.min(index - 1, validIds.length - 1))];
  }

  if (!selectedId) {
    throw new Error("Question has no answer options to choose from");
  }

  return {
    questionId: question.id,
    selectedAnswerId: selectedId,
    reasoning: parsed.reasoning?.trim() || "(no reasoning returned)",
  };
}

async function answerWithAnthropic(
  question: QuizQuestion,
  retryHint: boolean
): Promise<AIAnswerResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: buildPrompt(question, retryHint) }],
  });

  const content = message.content[0];
  if (content.type !== "text") throw new Error("Unexpected Anthropic response type");

  return parseAIResponse(content.text, question);
}

async function answerWithGemini(
  question: QuizQuestion,
  retryHint: boolean
): Promise<AIAnswerResult> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: MAX_TOKENS,
      // Native JSON mode: the model escapes quotes carried over from the question.
      responseMimeType: "application/json",
    },
  });

  const result = await model.generateContent(buildPrompt(question, retryHint));
  const text = result.response.text();

  return parseAIResponse(text, question);
}

// Ollama — local, no API key required
// Optimal model for Indonesian multilingual quiz: qwen2.5:7b
// Run: ollama pull qwen2.5:7b
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";

async function answerWithOllama(
  question: QuizQuestion,
  retryHint: boolean
): Promise<AIAnswerResult> {
  const res = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: "user", content: buildPrompt(question, retryHint) }],
      max_tokens: MAX_TOKENS,
      temperature: 0.1,
      response_format: { type: "json_object" },
      stream: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama HTTP ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };

  const text = data.choices[0]?.message?.content ?? "";
  return parseAIResponse(text, question);
}

// Ollama Cloud -- hosted models at ollama.com, needs an API key.
// Uses the native /api/chat endpoint documented for direct cloud calls. Model names
// drop the "-cloud" suffix here; that suffix only exists when a local Ollama offloads
// to the cloud. Browse models: https://ollama.com/search?c=cloud
const OLLAMA_CLOUD_BASE_URL =
  process.env.OLLAMA_CLOUD_BASE_URL ?? "https://ollama.com";
const OLLAMA_CLOUD_MODEL = process.env.OLLAMA_CLOUD_MODEL ?? "gpt-oss:120b";

async function answerWithOllamaCloud(
  question: QuizQuestion,
  retryHint: boolean
): Promise<AIAnswerResult> {
  const apiKey = process.env.OLLAMA_CLOUD_API_KEY ?? process.env.OLLAMA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OLLAMA_API_KEY is not set. Create a key at https://ollama.com/settings/keys"
    );
  }

  const res = await fetch(`${OLLAMA_CLOUD_BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OLLAMA_CLOUD_MODEL,
      messages: [{ role: "user", content: buildPrompt(question, retryHint) }],
      format: "json",
      options: { temperature: 0.1, num_predict: MAX_TOKENS },
      stream: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama Cloud HTTP ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    message?: { content?: string };
    error?: string;
  };

  if (data.error) throw new Error(`Ollama Cloud error: ${data.error}`);

  return parseAIResponse(data.message?.content ?? "", question);
}

export async function answerQuestion(
  question: QuizQuestion,
  provider: AIProvider = "gemini",
  retryHint = false
): Promise<AIAnswerResult> {
  if (provider === "anthropic") return answerWithAnthropic(question, retryHint);
  if (provider === "ollama") return answerWithOllama(question, retryHint);
  if (provider === "ollama-cloud") return answerWithOllamaCloud(question, retryHint);
  return answerWithGemini(question, retryHint);
}

/**
 * One unparseable reply must not abandon a quiz that has already been started
 * with `reset: true`, so retry, then fall back to the first option and let the
 * caller report it. A run where *every* question failed is a misconfiguration
 * (bad key, model offline) rather than bad luck, and that does throw -- better
 * than silently submitting option 1 for the whole quiz.
 */
export async function answerAllQuestions(
  questions: QuizQuestion[],
  provider: AIProvider = "gemini"
): Promise<AIAnswerResult[]> {
  const results: AIAnswerResult[] = [];
  let lastError = "";

  for (const question of questions) {
    let answer: AIAnswerResult | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        answer = await answerQuestion(question, provider, attempt > 1);
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.warn(
          `[ai] Q${question.sort} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastError}`
        );
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
    }

    results.push(
      answer ?? {
        questionId: question.id,
        selectedAnswerId: question.list_jawaban[0]?.id ?? "",
        reasoning: `AI failed after ${MAX_ATTEMPTS} attempts, defaulted to option 1.`,
        fallback: true,
        error: lastError,
      }
    );
  }

  const fallbacks = results.filter((r) => r.fallback).length;
  if (questions.length > 0 && fallbacks === questions.length) {
    throw new Error(
      `AI (${provider}) failed on every question, nothing was submitted. Last error: ${lastError}`
    );
  }

  return results;
}
