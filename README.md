# JobHunter

A local job-hunting app. Drop in your resume, get a profile you can correct,
search job boards for roles posted in the last two weeks, rank them against your
actual experience, generate a tailored version of your resume for one, and get
walked into the application form with the fields prefilled.

Runs on `localhost`. No auth, no deploy, no account. Your resume, profile and
saved jobs stay in `data/` on this machine.

---

## Quick start

```bash
npm install
```

```bash
cp .env.example .env.local
```

```bash
npm run dev -- --port 5055
```

Then open <http://localhost:5055>.

**Out of the box it costs nothing.** `.env.example` ships with
`CLAUDE_PROVIDER=mock` and `JOB_SOURCE=mock`, so the whole app works end to end
on sample data with no API calls. Turn each one on when you are ready.

---

## The flow

1. **Resume** (`/upload`) — drop in a `.docx`. It is parsed into a structured
   profile and stored in `data/resumes/`.
2. **Preferences** (`/preferences`) — the things a resume does not say: target
   titles, locations, work mode, salary floor, work authorisation, earliest
   start. This screen is what makes search results good rather than generic.
3. **Profile** (`/review`) — everything read off your resume, editable. A wrong
   skills list quietly ruins every match score, so it is worth a minute here.
4. **Jobs** (`/jobs`) — press *Run search*. Postings older than 14 days are
   discarded, the same role posted on several boards is collapsed into one row,
   and the rest are ranked with the reasons they matched.
5. **Tailor** — on any job, generate a tailored `.docx` with a word-level diff
   of every change.
6. **Apply** — get the prefill packet and a ready-made prompt for the Claude for
   Chrome extension. **The app never submits an application.**

---

## Getting your keys

Two keys, in this order. The first is free and instant; the second costs money,
so do it second and only once you have seen the app work.

After each one, verify it before trusting it:

```bash
npm run check-keys
```

That prints what is configured, checks each key against the live service, and
never prints a key in full.

### 1. Job search — RapidAPI (free, ~3 minutes)

1. Sign up at <https://rapidapi.com/auth/sign-up>.
2. Open the JSearch listing:
   <https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch/pricing>
3. Subscribe to **Basic — $0.00/mo**. It is 200 requests a month, hard-capped,
   and takes no credit card, so it cannot bill you by surprise.
4. Go to the **Endpoints** tab. Your key is shown in the code sample as
   `x-rapidapi-key`. Copy it.
5. In `.env.local`:

   ```
   JOB_SOURCE=jsearch-rapidapi
   RAPIDAPI_KEY=paste-it-here
   JSEARCH_MONTHLY_QUOTA=200
   ```

6. `npm run check-keys` — this spends 1 of your 200 requests and reports how
   many your plan says you have left.

A search uses up to 4 requests, so 200/month is roughly 50 searches. If you
later move to the Pro tier, set `JSEARCH_MONTHLY_QUOTA=10000`.

### 2. Claude — the Anthropic Console (costs money)

Remember: this is **not** your Claude.ai subscription. Separate product,
separate balance.

1. Sign in at <https://platform.claude.com>.
2. **Billing → add credit.** The minimum is \$5, which at this app's usage is
   a couple of months. Nothing works until there is credit on the account.
3. **API keys → Create key.** Copy it immediately; it is shown once.
4. In `.env.local`:

   ```
   CLAUDE_PROVIDER=api
   ANTHROPIC_API_KEY=sk-ant-...
   CLAUDE_MONTHLY_USD_CAP=5.00
   ```

5. Verify:

   ```bash
   npm run check-keys -- --spend
   ```

   Without `--spend` the check is free but only proves the key is **valid** —
   token counting works even at a \$0 balance. With `--spend` it makes one
   real call costing about \$0.00002, which is the only way to prove billing
   actually works.

### Then restart

`.env.local` is read at startup, so restart the dev server after editing it:

```bash
npm run dev -- --port 5055
```

The header will stop showing the amber **mock** badges once both are live.

### If you would rather not pay for Claude

Set `CLAUDE_PROVIDER=cli` instead and skip step 2 entirely — calls then go
through your installed `claude` binary and bill your Pro/Max subscription. Read
the trade-offs under *Claude backend* below first; it is workable for tailoring
and poor for scoring.

## Configuration

Everything lives in `.env.local`. See `.env.example` for the annotated version.

### Claude backend — `CLAUDE_PROVIDER`

| Value | What it does | Cost |
|---|---|---|
| `mock` | Canned responses. Resume parsing still works on your real file via a pattern-matching fallback. | Free |
| `api` | The Anthropic API with `ANTHROPIC_API_KEY`. Guaranteed-valid structured output. **Recommended.** | Per token, capped |
| `cli` | Shells out to your locally installed `claude` binary, billed to your Claude Pro/Max subscription. | Subscription |

**A Claude.ai subscription is not an API key.** They are separate products with
separate billing. The API bills from a credit balance at
<https://platform.claude.com>; a Pro/Max seat covers claude.ai and Claude Code.
There is no way to point an app at your subscription — except the `cli`
provider, which drives the tool you already have.

`CLAUDE_PROVIDER=cli` is offered because it answers a real question, but the
trade-offs are real: the CLI is built for interactive developer use rather than
as an app backend, your subscription's usage limits will throttle bulk scoring,
it is slower, and it **loses the structured-output guarantee** — JSON is
extracted from text and validated, which sometimes fails. Workable for the
occasional tailoring run; poor for scoring sweeps. The `api` path is the
reliable one.

### Spending

Two independent meters, both shown in the header and on the overview page.

- **`CLAUDE_MONTHLY_USD_CAP`** (default `$5.00`) is a hard brake, not a budget.
  Once the month's real spend passes it, paid Claude calls are refused with a
  402 rather than silently continuing. Mock and CLI calls never count toward it.
- **`JSEARCH_MONTHLY_QUOTA`** is your job-API plan's allowance, shown as
  `requests / quota`. Past it, the overage is shown in dollars at
  `JSEARCH_OVERAGE_USD` per request.

Rough costs at current rates (Opus 5.5 at \$4/\$20 per MTok, Haiku 5.5 at
\$0.10/\$0.50):

| Operation | Model | Approx. cost |
|---|---|---|
| Parse a resume | Opus 5.5 | ~\$0.05, once per resume |
| Score 25 jobs in a search | Haiku 5.5 | ~\$0.004 |
| Tailor a resume for one job | Opus 5.5 | ~\$0.10 |

Fifty searches and twenty tailored resumes is roughly **\$2.20 a month**.

### Job source — `JOB_SOURCE`

| Value | What it does |
|---|---|
| `mock` | Sample postings. No network, no cost. |
| `jsearch-rapidapi` | [JSearch via RapidAPI](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch). Needs `RAPIDAPI_KEY`. |
| `jsearch-direct` | The same API bought direct from OpenWeb Ninja. Needs `OPENWEBNINJA_API_KEY` **and** `JSEARCH_DIRECT_BASE_URL`. |

JSearch is published by OpenWeb Ninja and sold both ways — same data, same
parameters, different host and auth header. It aggregates LinkedIn, Indeed,
Glassdoor, ZipRecruiter and company sites through Google for Jobs.

**Which to buy.** RapidAPI's free BASIC tier is 200 requests a month,
hard-capped, no credit card — which also means it cannot surprise you with a
bill. That is roughly 50 searches. If you outgrow it, going direct is
pay-as-you-go at \$0.003/request with no monthly floor, whereas RapidAPI's Pro
tier charges \$25/month whether you use 50 requests or 10,000. Break-even is
around 8,300 requests a month, which a single job hunter will not reach.

The direct base URL is deliberately not hardcoded: OpenWeb Ninja's public agent
storefront does not document a plain REST host, so copy the search endpoint
from your own dashboard into `JSEARCH_DIRECT_BASE_URL`.

### Search behaviour

- `MAX_JOB_AGE_DAYS` (default `14`) — the recency rule.
- `SCORE_TOP_N` (default `25`) — how many prefiltered postings reach Claude.
- Queries per search are capped at **4** (in `lib/jobs/index.ts`), because each
  one is a billed request. Two titles across two locations is four queries.

---

## How ranking works

Two stages, so you only pay to think about postings worth thinking about.

1. **Prefilter (free).** Token overlap between your profile and the posting,
   weighted: job title counts most, named skills and tools next, industry last.
   A salary floor the posting cannot meet is a penalty. Runs over everything.
2. **Claude scoring (one batched call).** The top `SCORE_TOP_N` unscored
   postings go to Haiku in a single request and come back with a 0-100 fit
   score, the specific overlaps, and the honest gaps.

Postings already scored by Claude are **never scored again** — re-running a
search costs nothing extra. Postings that did not make the shortlist still
appear, ranked lower and labelled "keyword match only", rather than vanishing.

---

## How tailoring protects you

The rule is reword and reprioritise, never invent. Three defences, because a
prompt alone is not enough:

1. **Scope.** The model only ever sees paragraph indices marked editable. Your
   name, contact lines, section headings and date ranges are off limits.
2. **Figures are checked.** Every proposed edit is scanned for numbers that do
   not appear in your original resume. Those edits are **rejected outright** and
   shown to you as "attempted but blocked" — an invented metric is the most
   damaging failure here. Dropping a real figure is rejected too. Magnitudes are
   checked exactly, so an invented `$2M` is caught even if the digit `2` appears
   elsewhere in your resume.
3. **Unfamiliar terms are flagged.** A capitalised term in the rewrite that is
   nowhere in your resume raises a warning, since that is how a tool you have
   never used ends up on your CV.

What the posting needs and your resume genuinely cannot support is listed under
"What this resume cannot support" rather than papered over.

**The `.docx` rewrite preserves** your styles, fonts, margins, section layout,
headers and footers, and every paragraph it did not touch. **It does not
preserve** formatting that varies *within* a rewritten paragraph — if one word
in a bullet was bold, the rewritten bullet takes the first run's formatting
throughout. Paragraphs left alone are byte-identical.

---

## Assisted apply

`Help me apply` builds a packet: the prefill values, the resume to attach, and
an explicit list of what must never be filled in automatically.

The app does not drive your browser. It gives you a **ready-made prompt to
paste into the Claude for Chrome extension**, containing your field values and
the rules — including, in the prompt itself, *do not click submit* and *do not
create an account or enter a password*.

Hard rules, enforced in the packet and stated in the prompt:

- The submit button is never pressed automatically.
- No passwords, no account creation.
- No SSN, date of birth, government ID or bank details.
- Voluntary demographic questions are left for you to answer or decline.

**Expect this to be the fragile part.** Greenhouse, Lever and Ashby forms
generally go well. Workday and Taleo are multi-step wizards that lay their
fields out differently on every tenant, and you will have to help.

---

## Application folders

Press **Save application folder** on any job and it writes a self-contained
folder under `data/applications/`, so what you sent where outlives the
database:

```
data/applications/
  INDEX.md                                   every application, grouped by status
  2026-11-02_MiaRec_Software-QA-Engineer/
    README.md                                link, salary, match, pre-send checklist
    job-description.md                       the posting as captured
    resume.docx                              the tailored resume
    cover-letter.md / cover-letter.docx      the cover letter
    tailoring-notes.md                       every change, and what is NOT supported
```

`INDEX.md` is regenerated on every export and is the page to open when you
want to know what is outstanding.

**Exporting is free unless you ask for the expensive parts.** The API takes
`tailor` and `coverLetter` flags, both defaulting to true from the UI button.
With both false it writes the link, description and match only, costing
nothing:

```bash
curl -s -X POST localhost:5055/api/export -H 'Content-Type: application/json' -d '{"jobId":"<id>","tailor":false,"coverLetter":false}'
```

That makes it cheap to create a tracker folder for every result, then add a
tailored resume and cover letter only for the ones you actually apply to.

### Cover letters

Written by the tailoring model under the same rule as the resume: nothing may
be claimed that the resume does not support. The letter is also required to
return **every factual claim it makes**, which lands in `cover-letter.md` as a
checklist, and any claim whose wording does not trace back to your resume is
flagged separately. The prompt explicitly bans "passionate", "detail-oriented"
and "quick learner", because they are unfalsifiable and everybody writes them.

Application folders are gitignored. They contain your real contact details.

## What is solid and what is not

| Part | Verdict |
|---|---|
| Resume parsing | Solid. Works without Claude too, via the pattern-matching fallback. |
| Match ranking and reasons | Solid. |
| Resume tailoring | Solid, with the fabrication guards above. |
| Recency filter | Solid. A posting with no date is discarded, not assumed fresh. |
| Dedupe across boards | Good, not perfect. Fuzzy company + title matching. |
| Cross-board coverage | Only as good as the source you pay for. LinkedIn has no open API and blocks scraping; nothing here scrapes it. |
| ATS form prefill | Fragile. See above. |
| Cover letters | Solid, with the same no-fabrication guard, plus a claims checklist. |
| Aggregator metadata | **Do not trust it.** Seen in live use: a posting listed as remote/Anywhere was onsite in Mesa, Arizona on the employer's own site. Always open the real posting before applying. |

---

## Data

Everything is in `data/`, which is gitignored:

```
data/
  jobhunter.db      SQLite: profile, jobs, matches, applications, tailorings, usage
  resumes/          your uploaded .docx files
  tailored/         generated tailored resumes
```

To start over, stop the server and delete `data/`.

---

## Deploying later

It is built local-first, and running locally keeps working whatever you do. If
you ever publish it, three things must change:

| Local now | Needed when published |
|---|---|
| SQLite file | Postgres or Turso — serverless filesystems are ephemeral |
| Resumes on disk | Blob storage (S3/R2/Vercel Blob) |
| No auth | **Auth, mandatory** — otherwise your resume and address are public |

All storage goes through `lib/db.ts`, so the first is one file to reimplement.
Every secret is read in `lib/config.ts` and never reaches the browser.

---

## Project layout

```
app/
  page.tsx            overview / setup checklist
  upload/             resume intake
  preferences/        the pre-screen questions
  review/             editable extracted profile
  jobs/               ranked list, and the job detail + tailor + apply screen
  api/                resume, profile, search, jobs, tailor, apply, usage
lib/
  config.ts           all env handling and model pricing
  db.ts               the only module that touches storage
  claude.ts           the single door to Claude: mock | api | cli, metered + capped
  docx.ts             .docx read and in-place rewrite
  resume.ts           parsing, plus the no-API heuristic fallback
  jobs/               source adapters, recency filter, dedupe
  match.ts            prefilter + batched scoring
  tailor.ts           tailoring and the anti-fabrication guards
components/           nav, usage meters, shared form pieces
```

---

## Gotchas

- **`better-sqlite3` is pinned to v11.** v13's prebuilt binary targets a newer
  Node ABI and segfaults on Node 20. If you move to Node 22+, you can unpin.
- **`magic-string` is pinned via `overrides`.** Tailwind v4's node package
  `require()`s it, and v1.x is ESM-only, which breaks the Next webpack build.
  Remove the override only once Tailwind fixes that.
- **The dev server runs on port 5055** to stay out of the way of anything on
  3000.
- **Do not run `npm run build` while `npm run dev` is running.** They share
  `.next/`, and the build replaces the chunks the dev server has open, which
  makes pages 500 with `Cannot find module './887.js'`. Restart the dev server
  after a build.

---

## Tests

```bash
npm test
```

72 checks over the parts most likely to break silently:

- **`scripts/docx-test.ts`** — the `.docx` round-trip against the awkward cases:
  runs split mid-sentence, bold sub-runs, table cells, tabs, entity escapes,
  textboxes with nested paragraphs, and run-less paragraphs. Also asserts that
  styles and page setup survive a rewrite.
- **`scripts/jobs-test.ts`** — query building, the 14-day filter (including that
  an undated posting is dropped), cross-board dedupe, exclusions, and the
  JSearch response mapping.
- **`scripts/tailor-test.ts`** — the anti-fabrication guard: invented figures
  rejected, dropped figures rejected, `$2M` caught even when a bare `2` exists
  in the resume, unfamiliar tools warned, sentence-initial capitals not
  mistaken for proper nouns, and the editable-paragraph filter.

Plus a live-service check of your keys:

```bash
npm run check-keys           # free for Claude, uses 1 job-API request
npm run check-keys -- --spend    # also proves you have Claude credit
npm run check-keys -- --no-jobs  # skip the job API entirely
```

Two more helpers, not part of `npm test`:

```bash
npm run sample-resume -- sample.docx
```

builds a realistic test resume, and `scripts/verify-docx.ts <original> <tailored>`
diffs a tailored document against its original paragraph by paragraph and fails
if any figure moved.
