import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { QuizQuestion, AIAnswerResult, AIProvider, ForumDraftKind } from "@/types/mentari";
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

// ── Provider layer ─────────────────────────────────────────────────────
// One text-in/text-out call per provider. `json` switches on the provider's
// native JSON mode (quiz answers); off is free text (forum replies).

interface CompleteOptions {
  json: boolean;
  maxTokens: number;
  temperature: number;
}

async function completeWithAnthropic(prompt: string, opts: CompleteOptions): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    messages: [{ role: "user", content: prompt }],
  });

  const content = message.content[0];
  if (content?.type !== "text") throw new Error("Unexpected Anthropic response type");
  return content.text;
}

async function completeWithGemini(prompt: string, opts: CompleteOptions): Promise<string> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens,
      // Native JSON mode: the model escapes quotes carried over from the question.
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  });

  const result = await model.generateContent(prompt);
  return result.response.text();
}

/** POST an OpenAI-style chat completion; shared by local Ollama and vLLM. */
async function completeOpenAICompatible(
  label: string,
  url: string,
  apiKey: string | undefined,
  model: string,
  prompt: string,
  opts: CompleteOptions,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      stream: false,
      ...extra,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${label} HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string | null } }[];
  };
  return data.choices[0]?.message?.content ?? "";
}

// Ollama — local, no API key required
// Optimal model for Indonesian multilingual quiz: qwen2.5:7b
// Run: ollama pull qwen2.5:7b
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";

function completeWithOllama(prompt: string, opts: CompleteOptions): Promise<string> {
  return completeOpenAICompatible(
    "Ollama",
    `${OLLAMA_BASE_URL}/v1/chat/completions`,
    undefined,
    OLLAMA_MODEL,
    prompt,
    opts
  );
}

// Ollama Cloud -- hosted models at ollama.com, needs an API key.
// Uses the native /api/chat endpoint documented for direct cloud calls. Model names
// drop the "-cloud" suffix here; that suffix only exists when a local Ollama offloads
// to the cloud. Browse models: https://ollama.com/search?c=cloud
const OLLAMA_CLOUD_BASE_URL =
  process.env.OLLAMA_CLOUD_BASE_URL ?? "https://ollama.com";
const OLLAMA_CLOUD_MODEL = process.env.OLLAMA_CLOUD_MODEL ?? "gpt-oss:120b";

async function completeWithOllamaCloud(prompt: string, opts: CompleteOptions): Promise<string> {
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
      messages: [{ role: "user", content: prompt }],
      ...(opts.json ? { format: "json" } : {}),
      options: { temperature: opts.temperature, num_predict: opts.maxTokens },
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
  return data.message?.content ?? "";
}

// vLLM -- self-hosted, OpenAI-compatible server. VLLM_MODEL must match an id
// from GET {VLLM_BASE_URL}/v1/models (the served name, not the weights path).
// Qwen3 thinks by default; that would burn the token budget before the answer,
// so thinking is switched off via the chat template.
function completeWithVllm(prompt: string, opts: CompleteOptions): Promise<string> {
  const baseUrl = process.env.VLLM_BASE_URL?.replace(/\/+$/, "");
  if (!baseUrl) throw new Error("VLLM_BASE_URL is not set");

  return completeOpenAICompatible(
    "vLLM",
    `${baseUrl}/v1/chat/completions`,
    process.env.VLLM_API_KEY,
    process.env.VLLM_MODEL ?? "prod-model",
    prompt,
    opts,
    { chat_template_kwargs: { enable_thinking: false } }
  );
}

function complete(
  provider: AIProvider,
  prompt: string,
  opts: CompleteOptions
): Promise<string> {
  if (provider === "anthropic") return completeWithAnthropic(prompt, opts);
  if (provider === "ollama") return completeWithOllama(prompt, opts);
  if (provider === "ollama-cloud") return completeWithOllamaCloud(prompt, opts);
  if (provider === "vllm") return completeWithVllm(prompt, opts);
  return completeWithGemini(prompt, opts);
}

export async function answerQuestion(
  question: QuizQuestion,
  provider: AIProvider = "gemini",
  retryHint = false
): Promise<AIAnswerResult> {
  const text = await complete(provider, buildPrompt(question, retryHint), {
    json: true,
    maxTokens: MAX_TOKENS,
    temperature: 0.1,
  });
  return parseAIResponse(text, question);
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

// ── Forum diskusi ──────────────────────────────────────────────────────

/** Replies are short now, but Indonesian tokenises long and some models pad. */
const FORUM_MAX_TOKENS = 1000;

export interface ForumReplyContext {
  courseName?: string;
  /** e.g. "Pertemuan 3". */
  sectionTitle?: string;
  /** The forum's own blurb -- usually the pertemuan's theme. */
  forumTheme?: string;
  topicTitle: string;
  /** The lecturer's prompt, as plain text. */
  topicText: string;
  /** Free-form extra instructions typed by the student; they win over the defaults. */
  instructions?: string;
  /** Answer the topic (default), ask a question about it, or answer a follow-up. */
  kind?: ForumDraftKind;
  /** Lecturer posts directly under the topic -- sometimes the actual soal. */
  lecturerPosts?: string[];
  /** Questions classmates already asked; a drafted question must not repeat them. */
  classmateQuestions?: string[];
  /** "followup": your earlier post, and the lecturer's reply to it. */
  myPost?: string;
  followUpText?: string;
  /** A prompt typed for this one draft; beats the global instructions. */
  prompt?: string;
  /** The draft on screen. With a prompt, the model revises it instead of starting over. */
  previousDraft?: string;
}

/** Long enough for a real brief, short enough not to drown the topic. */
export const FORUM_INSTRUCTIONS_MAX = 2000;
export const FORUM_PROMPT_MAX = 1000;
const PREVIOUS_DRAFT_MAX = 4000;

function buildForumPrompt(ctx: ForumReplyContext): string {
  const where = [
    ctx.courseName && `Mata kuliah: ${ctx.courseName}`,
    ctx.sectionTitle && `Pertemuan: ${ctx.sectionTitle}`,
    ctx.forumTheme && `Tema pertemuan: ${ctx.forumTheme}`,
  ]
    .filter(Boolean)
    .join("\n");

  // Placed last so it is the freshest thing the model reads, and told to win
  // any conflict -- "make it longer" must beat the default word range.
  const extra = ctx.instructions?.trim().slice(0, FORUM_INSTRUCTIONS_MAX);
  // The per-draft prompt comes after the global instructions so it wins over
  // both them and the defaults. With a draft on screen it becomes a revision:
  // "lebih singkat" should shorten *that* draft, not produce a new one.
  const prompt = ctx.prompt?.trim().slice(0, FORUM_PROMPT_MAX);
  const previous = ctx.previousDraft?.trim().slice(0, PREVIOUS_DRAFT_MAX);
  const promptBlock = !prompt
    ? ""
    : previous
      ? `\n\nIni draft balasanmu sebelumnya:\n---\n${previous}\n---\nTulis ulang draft itu sesuai permintaan ini: ${prompt}\nPertahankan isi dan gaya yang tidak diminta untuk diubah, dan tetap ikuti aturan di atas kecuali permintaan ini berkata lain. Tulis hanya hasil akhirnya.`
      : `\n\nPermintaan khusus untuk balasan ini (paling utama, kalahkan aturan lain kalau bertentangan):\n${prompt}`;

  const extraBlock =
    (extra
      ? `\n\nInstruksi tambahan dari saya (ikuti ini, dan kalau bertentangan dengan aturan di atas, utamakan instruksi ini):\n${extra}`
      : "") + promptBlock;

  // The question is not always in the topic: some lecturers post the soal as
  // their own reply in the thread, so those go in alongside it.
  const lecturerPosts = (ctx.lecturerPosts ?? []).filter((t) => t.trim());
  const lecturerBlock = lecturerPosts.length
    ? `\n\nDosen juga memposting ini di dalam thread (bisa berisi soal yang harus dijawab):\n${lecturerPosts
        .map((t) => `---\n${t}`)
        .join("\n")}\n---`
    : "";

  const header = `Kamu mahasiswa biasa yang lagi aktif di forum diskusi kuliah online.

${where}

Dosen membuka topik berikut.
Judul: ${ctx.topicTitle}
Isi:
${ctx.topicText}${lecturerBlock}`;

  // Shared by every kind. Models drift toward essay voice, so the banned-phrase
  // list names the usual giveaways outright.
  const bans = `Jangan:
- Jangan pakai kata atau frasa seperti: krusial, signifikan, fundamental, esensial, holistik, komprehensif, optimal, strategis, "secara keseluruhan", "dengan demikian", "oleh karena itu", "kesimpulannya", "selain itu", "hal ini", "di era", "sangat penting untuk", "memastikan bahwa".
- Jangan pakai markdown, tanda bintang, judul, poin-poin, titik dua untuk daftar, tanda kurung penjelasan, atau tanda pisah panjang. Daftar bernomor hanya boleh kalau soalnya sendiri bernomor.
- Jangan menyebut dirimu AI, jangan menyapa dosen dengan nama, dan jangan menambahkan salam penutup.`;

  if (ctx.kind === "followup") {
    // The lecturer replied under your answer with a question of their own. The
    // reply goes under your post, so it reads as the next turn of that exchange.
    return `${header}

Kamu sudah memposting jawaban ini di thread:
${ctx.myPost || "(jawabanmu sebelumnya)"}

Dosen membalas postinganmu dengan:
${ctx.followUpText}

Tulis balasan untuk tanggapan dosen itu.

Gaya tulisan:
- Seperti mahasiswa yang mengetik sendiri, bukan seperti artikel atau jawaban AI.
- Singkat: 1 paragraf, sekitar 40-100 kata.
- Jawab pertanyaan dosen secara langsung. Kalau ada lebih dari satu pertanyaan, jawab semuanya singkat.
- Boleh mengaitkan dengan jawabanmu sebelumnya, tapi jangan mengulang isinya.
- Kalimat pendek, kata-kata sederhana, sopan tapi santai. Pakai "menurut saya" kalau pas.

${bans}

Awali dengan "Izin menjawab, Pak/Bu." hanya kalau terasa wajar, atau langsung "Menurut saya, ...". Tulis hanya isi balasannya.${extraBlock}`;
  }

  if (ctx.kind === "question") {
    // A question posted to the thread, the way students "izin bertanya" to keep
    // a discussion going. It must not answer the topic itself.
    const asked = (ctx.classmateQuestions ?? []).filter((t) => t.trim());
    const askedBlock = asked.length
      ? `\n\nPertanyaan yang sudah diajukan teman-teman di thread ini (jangan mengulang pertanyaan yang sama atau mirip):\n${asked
          .map((t) => `- ${t}`)
          .join("\n")}`
      : "";

    return `${header}${askedBlock}

Kamu sudah membaca topik itu. Sekarang tulis satu pertanyaan untuk didiskusikan di forum ini, ditujukan ke dosen atau teman-teman.

Gaya tulisan:
- Seperti mahasiswa yang mengetik sendiri, bukan seperti artikel atau jawaban AI.
- Singkat: 1 sampai 3 kalimat, sekitar 20-60 kata. Boleh satu kalimat pengantar singkat sebelum pertanyaannya.
- Kata-kata sederhana yang biasa dipakai sehari-hari. Sopan tapi santai.
- Pertanyaannya nyambung dengan isi topik dan spesifik, misalnya soal kasus nyata, perbedaan dua hal, atau apa yang terjadi kalau suatu kondisi berubah.
- Tanyakan sesuatu yang belum dijawab langsung oleh isi topik. Cukup satu pertanyaan utama.
- Jangan menjawab topiknya dan jangan menjawab pertanyaanmu sendiri.

${bans}

Awali dengan "Izin bertanya." lalu langsung ke pertanyaannya. Tulis hanya isi balasannya.${extraBlock}`;
  }

  // The goal is a reply that reads like a classmate typed it on a phone between
  // classes: short, plain words, one idea per sentence.
  return `${header}

Tulis balasanmu.

Gaya tulisan:
- Seperti mahasiswa yang mengetik sendiri, bukan seperti artikel, makalah, atau jawaban AI.
- Singkat: 1 atau 2 paragraf, sekitar 60-120 kata. Pastikan semua yang ditanyakan dosen terjawab, walaupun singkat.
- Kalau ada beberapa soal bernomor, jawab semuanya berurutan dengan nomor yang sama, sekitar 40-80 kata per soal.
- Kalimat pendek dan kata-kata sederhana yang biasa dipakai sehari-hari. Sopan tapi santai.
- Pakai sudut pandang sendiri, misalnya "menurut saya", dan kalau perlu kasih satu contoh sederhana.
- Jawab inti pertanyaannya saja. Kalau diminta membedakan beberapa istilah, jelaskan masing-masing dalam satu kalimat sederhana.
- Tidak perlu sempurna atau lengkap, tidak perlu kesimpulan di akhir.

${bans}

Awali dengan "Izin menjawab." lalu langsung jawab. Tulis hanya isi balasannya.${extraBlock}`;
}

/**
 * Turn a model reply into plain text for Mentari's `konten`. Markdown would
 * show up there as literal asterisks and hashes.
 */
export function cleanForumReply(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```[a-z]*\s*|\s*```$/gi, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    // Em/en dashes are a classic machine tell in Indonesian student writing.
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .replace(/^["“]([\s\S]*)["”]$/, "$1")
    .trim();
}

/**
 * The forum renders `konten` through innerHTML with `white-space: pre-wrap`
 * (that is how other students' plain-text replies keep their line breaks), so
 * newlines go through untouched and markup characters must be escaped.
 */
export function toForumKonten(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .trim();
}

export async function generateForumReply(
  ctx: ForumReplyContext,
  provider: AIProvider = "gemini"
): Promise<string> {
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const text = cleanForumReply(
        await complete(provider, buildForumPrompt(ctx), {
          json: false,
          maxTokens: FORUM_MAX_TOKENS,
          temperature: 0.7,
        })
      );
      // Anything this short is a refusal or a truncated reply. A question is
      // legitimately one sentence, so its floor is lower.
      // A typed prompt may legitimately ask for something very short.
      const minLength = ctx.prompt?.trim()
        ? 15
        : ctx.kind === "question" ? 30 : ctx.kind === "followup" ? 50 : 80;
      if (text.length < minLength) throw new Error(`Reply too short: ${text.slice(0, 80)}`);
      return text;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[ai] forum reply attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastError}`);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }

  throw new Error(`AI (${provider}) could not write a reply: ${lastError}`);
}
