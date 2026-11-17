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

## Per Pertemuan (the default tab)

The guided way through a course, in the order Mentari expects:
**pre-test → forum diskusi → post-test → kuesioner**.

1. **Load my courses**: one scan (see below) lists every course with a progress bar.
2. **Pick a course**: every pertemuan shows four bars, one per step: green done,
   yellow to do, grey not published. The first pertemuan with work left is opened
   for you, on its first unfinished step. The course you picked is remembered.
3. **Work the steps**:
   - *Pre-test / Post-test*: one button, "Answer with AI & submit", then the grade and
     each question's AI reasoning. A quiz Mentari already marks done shows **Retake**
     behind a confirm, because `/quiz/start` resets the attempt.
   - *Forum Diskusi*: opens straight onto the topics (no AI yet). With several topics,
     chips at the top jump between them and show which are answered and which have
     lecturer follow-ups. Draft topics one by one, or **Draft all to-do**, then review
     and **Post selected**.
   - *Kuesioner*: Ya/Tidak for every question, then submit.
4. After each step the course is re-read so the done flags catch up, and the next
   unfinished step opens.

`src/lib/pertemuan.ts` builds this from the scan: quizzes by `kode_template`, forums
by `tipe: "FORUM"`, kuesioner by `tipe: "QUESIONER"` (each carries Mentari's
`completion` flag). The Quiz / Kuesioner / Forum Diskusi tabs are still there for doing
one thing by hand. The AI provider lives in the shared **Account & AI** card and the
last one picked is remembered in the browser.

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
| `vllm` | `VLLM_MODEL`, default `prod-model` (Qwen3 27B) | `VLLM_BASE_URL`, `VLLM_API_KEY` |

`ollama-cloud` hits `https://ollama.com/api/chat` with a bearer key — no local
daemon, no download. Model names there drop the `-cloud` suffix (that suffix is
only for a *local* Ollama offloading to the cloud); browse them at
<https://ollama.com/search?c=cloud>. Check the key and model with:

```bash
OLLAMA_API_KEY=... node scripts/smoke-ollama-cloud.mjs
```

## Forum diskusi

The **Forum Diskusi** tab drafts a reply to each topic of a pertemuan's forum, lets you
edit them, and posts only the ones you tick and confirm.

1. **Load forums** reuses the course scan; every published forum (`tipe: "FORUM"`,
   `kode_template: "FORUM_DISKUSI"`) is listed per course with its pertemuan theme.
2. **Draft Replies** → `POST /api/forum/preview` with
   `{ username, password, captcha?, forumId, provider?, courseName?, sectionTitle?, includeAnswered? }`.
   It reads the forum and each thread, and asks the AI for a plain-text reply in Indonesian.
   Topics you already replied to (matched by your NIM) are shown with your reply and
   no draft, unless `includeAnswered` is on. **Nothing is posted here.**
3. **Post N selected** → `POST /api/forum/post` with
   `{ username, password, captcha?, replies: [{ topicId, judul, konten }], allowDuplicate? }`.
   Each thread is re-read first and skipped if a reply of yours appeared since the draft;
   after posting it is read again to confirm the reply is visible.

**Open Forum** (`readOnly: true` on the preview call) loads every topic and its full
discussion without calling the AI, so a forum can be read here instead of on Mentari:
replies nested the way Mentari's "extended" view nests them, lecturer and your own posts
highlighted, and an All / Lecturer / Mine filter. Any topic or follow-up can still be
drafted one at a time from there.

**The whole thread is read, not just the topic post.** Across real courses the question
is often elsewhere (`src/lib/forum.ts` → `analyzeThread`):

- **Soal posted as a lecturer reply.** Some topics hold only instructions ("JANGAN REPLAY
  PADA SOAL … buat create baru") and the numbered soal sit in the lecturer's own post
  under the topic. Those posts are fed to the AI with the topic and shown in the card.
- **No question at all** ("silahkan diskusikan disini"). Classmates post their own
  "Izin bertanya" questions; the card suggests *Ask a question*, and question drafts are
  given the existing classmate questions so they don't repeat one.
- **Lecturer follow-ups to you.** A lecturer reply under one of your posts that asks
  something is listed under "Lecturer replied to you", marked answered once you have
  posted under that post of yours after it. In *Answer* mode unanswered ones get a
  draft; posting puts the answer under your own post (`id_post` = your post), the same
  place Mentari's reply button does.

Mentari endpoints (taken from its own forum pages):

| Call | Endpoint |
| --- | --- |
| Forum + topics | `GET /api/forum/topic/{subSectionId}` |
| Topic thread | `GET /api/forum/reply/{topicId}` — replies in `data`, linked by `id_parent` |
| Reply | `POST /api/forum/reply` `{ id_topic, id_post, konten, judul: "RE <topic>" }` |

A top-level reply uses the topic id for both `id_topic` and `id_post`. `konten` is rendered
as HTML with `white-space: pre-wrap`, so drafts are sent as plain text with `<`, `>`, `&`
escaped.

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
