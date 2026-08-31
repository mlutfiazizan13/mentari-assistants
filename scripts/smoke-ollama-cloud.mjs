// Verifies the Ollama Cloud key, model and JSON-mode answer shape, outside Next.
//   OLLAMA_API_KEY=... node scripts/smoke-ollama-cloud.mjs
const baseUrl = process.env.OLLAMA_CLOUD_BASE_URL ?? "https://ollama.com";
const model = process.env.OLLAMA_CLOUD_MODEL ?? "gpt-oss:120b";
const apiKey = process.env.OLLAMA_CLOUD_API_KEY ?? process.env.OLLAMA_API_KEY;

if (!apiKey) {
  console.error("OLLAMA_API_KEY is not set. Create a key at https://ollama.com/settings/keys");
  process.exit(1);
}

const started = Date.now();
const res = await fetch(`${baseUrl}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    model,
    messages: [
      {
        role: "user",
        content:
          'Ibu kota Indonesia adalah? 1. [ID: a] Jakarta 2. [ID: b] Bandung. ' +
          'Respond with only {"selected_index": <n>, "selected_id": "<id>", "reasoning": "<why>"}.',
      },
    ],
    format: "json",
    options: { temperature: 0.1, num_predict: 512 },
    stream: false,
  }),
});

if (!res.ok) {
  console.error(`HTTP ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const data = await res.json();
if (data.error) {
  console.error(`Ollama Cloud error: ${data.error}`);
  process.exit(1);
}

const content = data.message?.content ?? "";
console.log(JSON.stringify({ model, ms: Date.now() - started, content }, null, 2));

try {
  const parsed = JSON.parse(content);
  console.log("parsed ok ->", parsed.selected_id);
} catch {
  console.error("Model did not return parseable JSON.");
  process.exit(1);
}
