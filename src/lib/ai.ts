import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { QuizQuestion, AIAnswerResult, AIProvider } from "@/types/mentari";

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPrompt(question: QuizQuestion): string {
  const questionText = stripHtml(question.deskripsi);
  const options = question.list_jawaban
    .map((opt, idx) => `${idx + 1}. [ID: ${opt.id}] ${stripHtml(opt.jawaban)}`)
    .join("\n");

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

Only respond with the JSON object, no other text.`;
}

function parseAIResponse(
  text: string,
  question: QuizQuestion
): AIAnswerResult {
  // Strip markdown code fences if present
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();

  // Reasoning models sometimes wrap the object in prose; fall back to the first
  // {...} block before giving up.
  let raw = cleaned;
  try {
    JSON.parse(raw);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`No JSON object in model response: ${text.slice(0, 200)}`);
    raw = match[0];
  }

  const parsed = JSON.parse(raw) as {
    selected_index: number;
    selected_id: string;
    reasoning: string;
  };

  const validIds = question.list_jawaban.map((o) => o.id);
  if (!validIds.includes(parsed.selected_id)) {
    const idx = Math.max(
      0,
      Math.min(parsed.selected_index - 1, validIds.length - 1)
    );
    parsed.selected_id = validIds[idx];
  }

  return {
    questionId: question.id,
    selectedAnswerId: parsed.selected_id,
    reasoning: parsed.reasoning,
  };
}

async function answerWithAnthropic(question: QuizQuestion): Promise<AIAnswerResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 256,
    messages: [{ role: "user", content: buildPrompt(question) }],
  });

  const content = message.content[0];
  if (content.type !== "text") throw new Error("Unexpected Anthropic response type");

  return parseAIResponse(content.text, question);
}

async function answerWithGemini(question: QuizQuestion): Promise<AIAnswerResult> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const result = await model.generateContent(buildPrompt(question));
  const text = result.response.text();

  return parseAIResponse(text, question);
}

// Ollama — local, no API key required
// Optimal model for Indonesian multilingual quiz: qwen2.5:7b
// Run: ollama pull qwen2.5:7b
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";

async function answerWithOllama(question: QuizQuestion): Promise<AIAnswerResult> {
  const res = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: "user", content: buildPrompt(question) }],
      max_tokens: 256,
      temperature: 0.1,
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

async function answerWithOllamaCloud(question: QuizQuestion): Promise<AIAnswerResult> {
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
      messages: [{ role: "user", content: buildPrompt(question) }],
      format: "json",
      options: { temperature: 0.1, num_predict: 512 },
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
  provider: AIProvider = "gemini"
): Promise<AIAnswerResult> {
  if (provider === "anthropic") return answerWithAnthropic(question);
  if (provider === "ollama") return answerWithOllama(question);
  if (provider === "ollama-cloud") return answerWithOllamaCloud(question);
  return answerWithGemini(question);
}

export async function answerAllQuestions(
  questions: QuizQuestion[],
  provider: AIProvider = "gemini"
): Promise<AIAnswerResult[]> {
  const results: AIAnswerResult[] = [];
  for (const question of questions) {
    const result = await answerQuestion(question, provider);
    results.push(result);
  }
  return results;
}
