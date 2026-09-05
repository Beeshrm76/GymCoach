# GymCoach V4

A workout logger you build yourself. No fixed split, no fixed columns, no build step —
one folder of static files that runs from `index.html` or any static host.

Everything is stored on your device: plans and logs in `localStorage`, uploaded images and
videos in IndexedDB. There is no backend and nothing is uploaded anywhere unless you
explicitly point Settings at an AI endpoint.

---

## Run it

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. Opening `index.html` directly works too — you just lose
offline caching, because browsers don't allow service workers on `file://`.

To publish it, push the folder to GitHub and enable Pages; `.github/workflows/pages.yml`
deploys the root on every push to `main`.

---

## What it does

**Projects, not a fixed program.** A project is an ordered list of days. Each day is either
a workout with any number of exercises, or a rest day. Nothing about the schedule is
hard-coded — a 6-day PPL and a 5-day PPL are two projects you create, not two code paths.
Templates (`6x PPL`, `5x PPL rolling`, `4x Upper/Lower`, `3x Full Body`, blank) are only
starting points; rename days, reorder them, flip any day between Workout and Rest, and add
or delete exercises freely. Switching a day to Rest keeps its exercises so you can switch
it back.

**The front list is a scan list.** Each exercise row is an image thumbnail, the name, your
target chips, and one tick button. That's it — no set-number counter, no Demo button, no
RIR chip. Everything else is one tap away in the details panel.

**Custom set table — rows *and* columns.** Every exercise owns its own columns. Ship with
Weight / Reps / RIR, then add RPE, Tempo, Rest, Time, Distance, Effort, Band, Incline, Note
or anything you type; rename them inline, reorder them, remove them. Add and remove set
rows independently. "Apply to day" copies one exercise's column layout to every exercise on
that day. Each row also has its own note, done tick and timestamp.

**Collapsible, independently scrollable panels.** The left sidebar and the right session
rail each minimize to an icon strip and expand again — at any window width — and the state
survives a reload. Put the cursor in a panel and the wheel scrolls that panel only.

**Rest timer** with 60s / 90s / 2m / 3m presets and a custom seconds field.

**Progress view** with per-day completion bars, a set-log history and body measurements kept
as a dated history rather than a single overwritten weigh-in.

**AI Coach export** captures the whole record, in five formats: prompt text, JSON, Markdown,
PDF, Word. Column values are exported by their *label*, so a renamed column is still
readable to a coach. Optionally send it straight to a model — see below.

---

## AI Coach

`AI Coach` builds one self-describing payload: project metadata, every day in order with its
type, every exercise with targets and RIR/rest/tempo/equipment/notes/cues, each exercise's
column definitions, **every** set row with labelled values, per-set notes, done flags and
timestamps, whether media is attached, per-day and per-project completion, and your
measurement history. Copy it into any AI chat, or download it.

To have the app call a model itself, open **Settings** and pick a provider:

| Provider | What it needs |
|---|---|
| Anthropic | Your API key. Model defaults to `your-model-id`. |
| OpenAI-compatible | Base URL + key — OpenAI, OpenRouter, LM Studio, Ollama. |
| Custom proxy | Your own URL. The app POSTs `{prompt, model, system}` and shows the reply. |

Your key is written to this browser's `localStorage` and sent only to the endpoint you
choose. Calling a model API straight from a browser exposes the key to anything running on
the page — if that matters to you, use the **Custom proxy** option and keep the key
server-side, or just use **Copy Prompt** and paste into a chat.

---

## Layout

```
index.html            markup + the DOM contract every module binds to
manifest.json         PWA metadata
sw.js                 offline cache
assets/app.css        all app styling
assets/custom.css     your overrides — loaded last, ships empty
assets/icons/         generated PWA icons
data/templates.js     project templates + set-column presets
data/seed-project.js  the 6-Day PPL starter project
js/ui.js              toasts, dialogs, modals, panel layout state
js/store.js           the live project store — single source of truth
js/mediaStore.js      IndexedDB for image/video/logo blobs
js/settings.js        branding, AI connection, install/offline, storage tools
js/app.js             Today view, details panel, custom set table, timer
js/manage.js          the project/day/exercise builder
js/report.js          AI Coach export in five formats
tools/                icon generator + DOM contract checker
videos/               optional place for video files you keep as files
```

Load order matters and is fixed in `index.html`: `ui` → `mediaStore` → `store` → `settings`
→ `app` → `manage` → `report`.

---

## Working on it

Two checks, both stdlib Python, no dependencies:

```bash
python tools/check-contract.py
```

Verifies every element id the JS reads exists in `index.html`, and every `data-action` in the
HTML has a handler. This is the guard against the failure mode that made V3 feel broken —
buttons wired to nothing. It exits non-zero on a break.

```bash
python tools/make-icons.py
```

Regenerates `assets/icons/*.png` from code if you change the mark.

Styling: edit `assets/custom.css`, not `app.css`. It loads last, so it wins.

---

## Backup

`Build → Export backup` writes a JSON file with every project, log and measurement. Import
replaces what's there. Uploaded media is **not** in the backup — blobs stay in IndexedDB on
the device that recorded them. Clearing site data erases everything, so export before you
do.

---

## Browser support

Any current Chrome, Edge, Firefox or Safari. Install to the home screen via the sidebar's
**Install app** button, or your browser's own install menu item.

See [CHANGELOG.md](CHANGELOG.md) for what changed from V3 and why.


## V7.2 updates

- Exercise Set Log is displayed as aligned **Previous | Current** pairs under every column.
- Weekly Check keeps Previous and Current as separate side-by-side cards; an absent previous record shows `-`.
- Cardio is a separate optional section accessible beside `+ Exercise` and `Clear log`.
- Cardio supports optional duration, calories, incline, speed and gear fields.
- Missing values are accepted everywhere and become `not counted` in AI/Markdown/Word/CSV exports.
- Save & update details refreshes the AI Coach data immediately.
- AI Coach has an explicit Update details button and CSV export.
- Intensity uses a 0–5 overall score based on completed planned sets and recorded reps, with a gradient bar only; no color-name labels are shown.
