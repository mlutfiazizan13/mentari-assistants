This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Copy `.env.example` to `.env.local` and fill in the AI provider key you intend to use.

Setting `MENTARI_USERNAME` / `MENTARI_PASSWORD` (plus the optional `MENTARI_QUIZ_ID`,
`MENTARI_KODE_COURSE`, `MENTARI_KODE_SECTION`, `MENTARI_AI_PROVIDER`) prefills the form
on page load, so you stop retyping credentials every run. The page reads them from
`GET /api/defaults`; a field you have already typed into is never overwritten. That
endpoint serves the password to the browser, which is only safe because this app is
local-only — one more reason not to deploy it.

## Picking a quiz or a pertemuan

**Load quizzes** (Quiz tab) and **Load courses** (Kuesioner tab) run the same scan: log
in, walk every enrolled course, and list what each one holds. Clicking a quiz fills the
Quiz ID field; clicking a pertemuan fills both Kode Course and Kode Section. Nothing has
to be copied out of a Mentari URL, and one scan populates both tabs.

Each row is labelled with its **matakuliah** (the course header) and its **pertemuan**,
because every quiz on Mentari is titled just "Pretest" or "Posttest" — the pertemuan is
the only thing telling them apart. The selected one is echoed under the Quiz ID box.

Behind it: `POST /api/mentari/courses` with `{ username, password, captcha?, kodeCourse? }`.
It calls `GET /api/user-course` for the course list, then `GET /api/user-course/{kode}`
per course, and `src/lib/course-content.ts` reads the tree:

```jsonc
{ "kode_course": "...", "coursename": "[3] ARSITEKTUR ... (Sabtu) [E-2]",
  "data": [ { "kode_section": "PERTEMUAN_1", "nama_section": "Pertemuan 1", "sort": 1,
              "sub_section": [ { "id": "<uuid>", "tipe": "QUIZ", "judul": "Pretest",
                                 "kode_template": "PRE_TEST", "sort": 0 } ] } ] }
```

`sub_section.id` is the quizId (`id_trx_course_sub_section`); it is `null` for anything
the lecturer hasn't published, and those rows are skipped. `kode_template` gives
`PRE_TEST` / `POST_TEST`, and `completion` is Mentari's own done flag — the green tick
in its UI — so finished quizzes show a `✓` and each course header counts `done/total`.
Results are ordered by pertemuan, pre-test before post-test.

A course laid out differently falls back to a generic tree walk that takes any node with
a UUID id and a quiz-ish title. One course failing is reported on its own row; the rest
still list. Pass `kodeCourse` to scan a single course instead of all of them.

The same pass collects each course's sections (`PERTEMUAN_1` = "Pertemuan 1", …), which
is what a kuesioner is addressed to. Kuesioner themselves are not in the course tree —
they live behind `/kuesioner/{kode_course}/{kode_section}` — so every pertemuan is
offered and the submit call decides whether one exists.

If a course's quizzes don't show up, grab its raw JSON:

```bash
curl -s -X POST http://localhost:3000/api/mentari/courses \
  -H "Content-Type: application/json" \
  -d '{"username":"...","password":"...","kodeCourse":"20261-...","debug":true}' \
  | jq .sample
```

## AI providers

Picked per run in the UI, or via `"provider"` in the request body.

| `provider` | Model | Needs |
| --- | --- | --- |
| `gemini` (default) | `gemini-2.0-flash` | `GEMINI_API_KEY` |
| `ollama-cloud` | `OLLAMA_CLOUD_MODEL`, default `gpt-oss:120b` | `OLLAMA_API_KEY` |
| `ollama` | `OLLAMA_MODEL`, default `qwen2.5:7b` | a local `ollama serve` |
| `anthropic` | `claude-haiku-4-5` | `ANTHROPIC_API_KEY` |

`ollama-cloud` hits `https://ollama.com/api/chat` with a bearer key — no local
daemon, no download. Model names there drop the `-cloud` suffix (that suffix is
only for a *local* Ollama offloading to the cloud); browse them at
<https://ollama.com/search?c=cloud>. Check the key and model with:

```bash
OLLAMA_API_KEY=... node scripts/smoke-ollama-cloud.mjs
```

## How it talks to Mentari

`mentari.unpam.ac.id` sits behind a **Cloudflare Managed Challenge** — an interactive
Turnstile checkbox. A plain HTTP request from Node (or Postman) gets a `403` with
`Enable JavaScript and cookies to continue`, so the app cannot use `fetch` directly.

Instead, every Mentari call is issued as a same-origin `fetch()` **inside a real Chrome
window** driven by [patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) (a
hardened Playwright fork). Chrome solves the challenge, earns the `cf_clearance` cookie,
and each request then carries a genuine Chrome TLS fingerprint, cookies and client hints.

| File | Role |
| --- | --- |
| `src/lib/browser.ts` | Launches and owns the single long-lived Chrome; clears the challenge; serialises access |
| `src/lib/browser-fetch.ts` | `fetch`-shaped adapter that runs the request inside the page and returns a real `Response` |
| `src/lib/mentari.ts` | Unchanged API surface — it just calls `browserFetch` instead of `fetch` |

### What this means in practice

- **A Chrome window will open** the first time you trigger an action, and stay open.
  Don't close it; it is the session. It closes itself after 10 minutes idle.
- **Headless does not work.** The Turnstile checkbox only clears with a visible window.
  Setting `MENTARI_BROWSER_HEADLESS=true` will make every request fail.
- **First call takes ~6s** (Chrome start + challenge). Subsequent calls are ~150ms.
- The Chrome profile is persisted to `%LOCALAPPDATA%\mentari-assistants\chrome-profile`,
  so restarting the dev server reuses the existing clearance (~1.8s instead of ~6s).
- **This is local-only by design.** It will not work on Vercel or any serverless host.

### Verifying it works

```bash
# standalone, outside Next entirely
node scripts/smoke-browser.mjs

# or with the dev server running
curl http://localhost:3000/api/health/browser
```

Healthy output — a genuine reply from Mentari rather than Cloudflare:

```json
{ "ok": true, "title": "Mentari | UNPAM", "loginStatus": 400,
  "body": "{\"statusCode\":400,\"message\":\"Username atau password salah\"}" }
```

### Troubleshooting

- **Challenge never clears** — make sure the Chrome window is visible and on-screen, and
  solve the "Verifikasi bahwa Anda adalah manusia" checkbox by hand once. The persisted
  profile reuses that clearance afterwards.
- **`Browser launch failed` / stale profile lock** — a force-killed run can leave Chrome
  holding the profile. Delete `%LOCALAPPDATA%\mentari-assistants\chrome-profile`.
- **See every request** — run with `MENTARI_BROWSER_DEBUG=1`.
- **Rule the browser out** — `MENTARI_BROWSER_DISABLED=1` falls back to plain `fetch`,
  which should reproduce the original Cloudflare `403`.

All tuning knobs are documented in `.env.example`.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)
