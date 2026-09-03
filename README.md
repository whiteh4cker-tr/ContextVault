# ContextVault

**Ask questions of your own documents. Nothing leaves the machine.**

ContextVault is an offline desktop application for asking questions about local PDFs
and text files, with every answer tied back to the page it came from. It is built for
the kind of material that should not be pasted into a website — contracts, invoices,
client files, internal policy — where the useful question is not "what does this say"
but "what do these eleven documents say together, and where is it written".

There is no server component, no account, and no telemetry. The documents are read
from disk, indexed into a local vector store, and answered by a language model that
runs on your own CPU and GPU. The only moment the application touches the network is
when you press a download button to fetch a model file, and that request goes to
Hugging Face for a file you chose.

---

## Contents

- [What it does](#what-it-does)
- [Why it is built this way](#why-it-is-built-this-way)
- [Getting started](#getting-started)
- [Choosing the models](#choosing-the-models)
- [What the settings actually mean](#what-the-settings-actually-mean)
- [How a question becomes an answer](#how-a-question-becomes-an-answer)
- [Where things are stored](#where-things-are-stored)
- [Measurements](#measurements)
- [Accessibility](#accessibility)
- [Testing and verification](#testing-and-verification)
- [Project layout](#project-layout)
- [Troubleshooting](#troubleshooting)
- [Limitations, honestly stated](#limitations-honestly-stated)

---

## What it does

**Drop files in.** PDF, TXT, Markdown, CSV, JSON, log files — dragged onto the window
or picked with the file dialog. Each document runs through four visible stages:
parsing, chunking, embedding, indexing. Progress is per document, and a failure stops
that document rather than the corpus.

**Switch documents in and out of the answer.** Every document has an on/off switch. A
document that is switched off stays indexed but cannot be retrieved — which is what
you want when a comparison document is in the window for a different reason.

**Ask in one language, find it in another.** Embeddings are multilingual, so an
English question over a Turkish invoice returns the Turkish clause. There is no
translation step and no claim that there is one: the question and the passage meet in
a shared vector space.

**Get an answer with the receipts.** Each answer cites its sources as `[1]`, `[2]`.
Every marker is a button that opens the exact passage, its document, its page and the
similarity score that brought it back. Sources are derived from the markers the model
actually wrote, so a source list cannot silently pad the grounding of an answer.

**Accept an honest "I don't know".** When nothing clears the similarity floor, the
answer says so and is labelled *no context*. When the retrieved passages do not
support an answer, it is labelled *not grounded*. These are visible states in the
interface, not silent ones — an unexplained confident sentence is the failure mode
this application exists to avoid.

**Watch the memory while it works.** A gauge shows free and total RAM; the model
selector shows, before you commit, whether the context size you typed will fit.

---

## Why it is built this way

**Two models, not one.** A chat model is a causal decoder: it writes sentences and has
no pooling head, so it cannot produce a usable embedding. An embedding model is the
opposite: it maps text to a vector space and cannot generate a sentence to save its
life. Retrieval and generation are separate jobs with separate weights, and pretending
otherwise is why single-model "RAG" demos retrieve badly.

**Retrieval quality is measured, not assumed.** A similarity floor of 0.25 sounds
arbitrary until you see a distribution: the correct passage on the test invoice scores
0.68 while the wrong ones score 0.42 and 0.29. The floor is a control on the interface
precisely because it is a judgement about your corpus, not a constant.

**Filtering happens in TypeScript, after the vector search.** The vector library's
metadata filters (`$in`, `$ne`, `$nin`) return zero rows silently on this release. A
filter that returns nothing looks exactly like "no relevant passages" — the most
dangerous possible answer, because it is indistinguishable from a correct one. So the
index is over-fetched by 3× and filtered in code where the logic is testable.

**The index lives in its own process.** The vector library reserves a large arena per
index, and opening a second one in the same process aborts it rather than returning an
error. One index per process, therefore, and if that process dies the parent restarts
it and reopens the file.

**The embedder stays on the CPU while the chat model holds the GPU.** Measured: one
~70-token passage costs 170 ms on the CPU against 70 ms in VRAM, but with the embedder
resident in VRAM the 12 B chat model could no longer fit its 16 384-token window. A
token of an answer is generated thousands of times per question; a passage is embedded
once, in the background, behind a progress bar. Two resident models must not bid for
the same memory, so one of them explicitly gives it up.

**Weights are memory-mapped and loaded once.** One engine instance, at most one loaded
model per role, `useMmap: true`, and `gpuLayers: { fitContext }` so the engine reserves
the key-value cache before filling VRAM with weights. Asking for `"max"` instead is how
a model ends up copied across VRAM and system RAM in the worst order.

**Citations are data, and the parser produces no HTML.** `dangerouslySetInnerHTML` is
never used. A document containing `<img onerror=...>` displays those characters.
Untrusted text is fenced in the prompt and its tag-openers are neutralised before it
reaches the model, so a document cannot instruct the model on the user's behalf.

**A `[7]` with no seventh source is not a button.** An invented marker renders as
text. A clickable citation for a passage that does not exist would fabricate
provenance, which is worse than no citation at all.

---

## Getting started

Requires Node.js 22 or newer.

```bash
npm install
npm run dev:electron        # build, then launch the desktop application
```

Other useful commands:

| Command | What it does |
| --- | --- |
| `npm test` | 285 tests across 20 files, no models or GPU required |
| `npm run typecheck` | TypeScript on both sides of the bridge |
| `npm run lint` | oxlint |
| `npm run build` | renderer into `dist-react`, main process into `dist-electron` |
| `npm run smoke:engine` | headless engine harness — loads the real models, prints timings (see [Measurements](#measurements)) |
| `node scripts/app-e2e.mjs <file> "<question>"` | drives the running application over DevTools: indexes a real file, asks a real question, prints the answer and its citations |
| `node scripts/app-lifecycle.mjs <file>` | lifecycle pass: add, toggle, stop mid-answer, remove, settings round-trip |
| `npm run dist:win` | package a Windows installer and a portable exe |

**First run.** The application opens on a gate that explains the two models it needs
and offers a download button for each. Downloads are several gigabytes, happen once,
and are the only network activity in the product's life. If you already own `.gguf`
files, register them with *Import* instead — they are copied into the vault directory.

---

## Choosing the models

ContextVault is designed around this pair, and offers it as the recommended choice:

| Role | File | Size | Architecture | Vector width | Trained context |
| --- | --- | --- | --- | --- | --- |
| Chat | `gemma-4-12B-it-qat-UD-Q4_K_XL.gguf` | 6 716 356 800 B | `gemma4` | — | 262 144 |
| Embedding | `qwen3-embedding-4b-q4_k_m.gguf` | 2 496 703 776 B | `qwen3`, `pooling_type: last` | 2 560 | 40 960 |

The catalogue is a suggestion list, not a whitelist. **Any** `.gguf` can be registered;
whether it is offered for a role is decided by the file's own `pooling_type`, not by its
name. That distinction is not academic: Qwen3 Embedding declares architecture `qwen3`,
the identical string the Qwen3 chat models declare, and only the pooling head separates
an embedder from a chat model. A reranker (`pooling_type: rank`) produces scores rather
than vectors and is refused outright, because indexing one would fill the store with
numbers that are not embeddings and never return a hit.

Two properties of the embedding model are load-bearing, and both are read from the file
at load time rather than configured:

- **Vector width** decides the index schema. The index filename carries it
  (`qwen3-embedding-4b-q4-k-m-2560-cosine.rvf`, that is: `<model>-<dims>-<metric>.rvf`), so switching
  embedders creates a new index and marks the existing documents *stale* rather than
  comparing vectors drawn from two different coordinate systems.
- **The query instruction.** Qwen3 Embedding was trained with a task sentence in front
  of the query side of each pair. Queries are therefore prefixed; passages are embedded
  exactly as written, because only one side of the training pair carried an instruction
  and prefixing both would move the whole corpus. The prefix is applied only when the
  loaded model's metadata says it expects it, so a different embedder is not silently
  reinterpreted.

---

## What the settings actually mean

**Context size (a number you type).** Tokens the model will hold in one exchange: the
question, the retrieved passages, and the answer that grows. It is the single biggest
lever on both quality and memory. The field measures the actual file with the engine's
own estimator and refuses only what the model cannot represent; a size that fits the
model but not the memory free *right now* warns rather than blocks, because the
measurement is a snapshot and the decision belongs to you. If the engine still refuses
at load time, the window steps down to the largest that fits and says so in the status
line rather than showing an error.

**Passages retrieved (top-K).** How many passages go into the prompt. More passages
means more to find the answer in and less room to answer with: passages are dropped
whole, from the bottom up, when they do not fit, and the interface tells you how many
were dropped.

**Similarity floor.** The weakest match worth including, as `1 − distance`. Raising it
trades recall for confidence; at 0.9 on a small corpus the application will usually
decline to answer at all, which is the correct behaviour and looks like it.

**Chunk size and overlap.** Passages are cut with a moving window that snaps to a
sentence boundary when one is available and never advances without progress. Every
chunk records its exact character offsets, so `source.slice(start, end)` returns the
chunk — which is what makes a citation checkable rather than a claim about where
something was written.

---

## How a question becomes an answer

```
                    ┌────────────── ingestion (per document) ──────────────┐
 drop .pdf ──► extract (pdf-parse, page boundaries kept)
                    ├─► chunk (window, sentence-snapped, exact offsets)
                    ├─► embed (Qwen3 Embedding, CPU, batched)
                    └─► index (ruvector HNSW, in its own child process)

                    ┌────────────── one question ─────────────────────────┐
 question ──► embed query (task-sentence prefixed, same model as corpus)
                    ├─► search 3× top-K            ← over-fetch, deliberately
                    ├─► filter to active documents ← in TypeScript, not in the index
                    ├─► apply similarity floor, sort, cut to top-K
                    ├─► build prompt: fenced passages + [n] labels + injection rules
                    ├─► generate (Gemma, streamed token by token, abortable)
                    ├─► keep only the [n] markers the answer actually wrote
                    └─► transcript: text, citations, provenance, token timing
```

The order matters. The question is embedded with the same model that embedded the
corpus — a mismatch there produces confident nonsense that no test would catch.

---

## Where things are stored

| Run | Data directory |
| --- | --- |
| Development (`npm run dev:electron`) | `<repository>/.contextvault` |
| Installed application | Electron's per-user data directory |
| Portable build | beside the executable |

```
.contextvault/
├── models/                     the .gguf files you chose or imported
├── index/<model>-<dims>-<metric>.rvf     the vector store
├── registry.json               the corpus: files, state, chunk counts, per-document settings
├── conversations.json          transcripts, with citations and provenance
├── settings.json               model selections and context size
└── app-settings.json           retrieval and chunking settings
```

**Deleting that folder is the entire reset.** There is no other state: no database
server, no configuration under a system directory, no identifiers sent anywhere.

---

## Measurements

Taken with `npm run smoke:engine` and `scripts/app-e2e.mjs` on one machine, and
reported as measured rather than as typical:

**Reference machine.** Windows, 31.6 GB RAM, NVIDIA GeForce RTX 3060 (12 GB).

| What | Measured |
| --- | --- |
| Embedding model load | 1.8 s (mmap), 36 layers, on the CPU by policy |
| Chat model load | 4.1 s (mmap), 49 of 48 layer slots in VRAM |
| Context window granted | 16384 tokens |
| One passage embedded, CPU | ~170 ms (after a 802 ms cold first call) |
| One question embedded while the chat model is resident | 178 ms |
| Generation | 2.4 – 9 tokens/s |

**Retrieval quality**, the number that says whether the pipeline works at all. Question:
*"How much advance notice is required before the contract ends?"* over three passages —
one relevant, one topically adjacent, one irrelevant:

```
relevant passage     0.683   ← ranked first
adjacent passage     0.421
irrelevant passage   0.284   margin to second place: 0.262
```

**End-to-end through the running application.** A Turkish e-archive invoice
(`invoice.pdf`, one page, 1 611 characters) indexed into 2 passages, then asked in
English:

> **Q:** What is the total amount on this invoice, and in which currency?
>
> **A:** The total amount including taxes ("Vergiler Dahil Toplam Tutar") is 1.799,00TL
> **[2]** and the amount to be paid ("Ödenecek Tutar") is 1.799,00TL **[2]** on page 1 of
> invoice.pdf. The currency is TürkLirası, as indicated by the text "Yalnız
> BinYediYüzDoksanDokuzTürkLirası" **[1]** on page 1 of invoice.pdf.

110 tokens, 4.24 tokens/s, provenance `cited`, two page-level citations, each opening
the passage it came from.

**Lifecycle pass:** 10 of 10 assertions — a `.txt` is accepted; the answer comes from
the right document; a switched-off document is not cited and the application says the
passages do not support an answer rather than inventing one; stopping leaves a partial
answer labelled *stopped by you*; a removed document stops answering questions; a 0.9
floor declines to answer instead of padding the context; settings round-trip.

---

## Accessibility

Target: WCAG 2.0 AA. Enforced in three ways, because each catches what the others
cannot:

1. **Arithmetic.** `contrast.test.ts` computes every foreground/background pair in the
   palette — 53 assertions over every surface and state combination, including the ones nobody looks at, like disabled text — and
   fails if any falls below 4.5:1 for body text or 3:1 for large text and non-text
   indicators. A negative control proves the calculation can fail.
2. **axe-core.** The rendered application is scanned in five states (empty, first-run
   gate, conversation with citations, document list, and a deliberately broken
   fragment) under the WCAG 2 A/AA rule set.
3. **Roles and names, in the component tests.** Assertions are about what a screen
   reader announces: a log region for the transcript, a labelled dialog, named
   controls, progress reported as a value rather than as a colour. One test asserts
   that no control carries its accessible name only in a tooltip, because a tooltip
   never opens for a screen reader.

Colour is never the only signal: every state that has a colour also has a word.

---

## Testing and verification

```
20 test files   285 tests   ~2 700 lines of test against ~11 000 lines of source
```

| Area | What is asserted |
| --- | --- |
| Retrieval | floor/sort/cut ordering, over-fetch depth, registry filtering, `1 − distance` conversion |
| Prompt | injection fencing (a document cannot close its own fence), token budgeting, whole-passage dropping, citation subset, provenance classification |
| Chunker | invariants on every input: `source.slice(start, end) === text`, full character coverage, strictly increasing progress, no cascade of fragments |
| Markdown | citations recognised, `[2024]` and `[12:30]` not, no HTML produced, only `http`/`https`/`mailto` links |
| Index | the real vector library: insert/search/delete/count, the JSON-RPC protocol, restart-on-death, and a 2 560-dimension regression guard |
| Bridge | every channel in the contract exists in the preload, and the preload invents none |
| Models | role detection by `pooling_type`, catalogue invariants, query instruction, sizes that match the real files |
| Memory | budget arithmetic, largest safe context, context-size validation |
| Interface | streaming, cancellation, citation chips, gates, empty and error states, unsubscribe-on-unmount |
| Accessibility | the three mechanisms above |

Two habits worth naming, because they are what keeps a suite honest:

**Negative controls.** A contrast test, an axe scan or an injection guard that always
passes is worth nothing, so each is given a case it must fail.

**Tests that reach the real dependency.** The index tests use the real vector library,
and `scripts/app-e2e.mjs` drives the running application through the same IPC bridge
the interface uses. Unit tests with everything mocked would have missed both of the
real bugs found this way: the vector library's default index capacity, and a splitter
fault that only appeared at the end of a real document.

---

## Project layout

```
src/shared/      the contract: types, IPC channel map, memory-budget maths
src/electron/    main process
  ├── main.ts            window, lifecycle, security hardening
  ├── ipc.ts             one registration per channel, derived from the contract
  ├── preload.cjs        the only bridge; a test keeps it and the contract in step
  ├── modelManager.ts    catalogue, download, import, delete, measured context bounds
  ├── llamaService.ts    engine lifecycle, VRAM policy, streaming, abort
  ├── backend.ts         the whole API surface, one switch over the channel map
  └── rag/               extract · chunker · registry · store + storeWorker (child
                         process) · retrieve · prompt · instruction · pipeline ·
                         transcript · chatRunner
src/ui/          renderer — React 19, Material UI, no direct filesystem or network
  ├── components/        21 components (gate, sidebar, transcript, composer, gauges)
  ├── state/             hooks over the bridge, engine gating
  ├── render/markdown.ts the citation-aware, HTML-free renderer
  └── mock/fakeBackend.ts  a full in-browser implementation of the contract, so the
                           interface can be developed and demonstrated without models
scripts/         engine harness, application E2E driver, lifecycle pass
docs/            design notes and screenshots
```

The renderer knows nothing about Node. Everything it does goes through one typed
interface with 31 methods, and the same interface is implemented twice — once against
the engine, once in the browser as a fake — which is why the interface has its own test
suite that runs without a GPU.

---

## Troubleshooting

**"This file's *xlmr* architecture is not supported by the bundled engine."**
Some published GGUF conversions use an architecture the engine has no code for. BGE-M3
is the common case: converted as `xlmr`, it cannot load here at all. Choose a
catalogue model.

**"Context reduced from 16384 to 8192 tokens."** The window you asked for did not fit
the memory available at that moment. Close other applications or lower the number; the
status line tells you what was actually granted.

---

## Limitations, honestly stated

- **Answers are only as good as retrieval.** Generation is grounded in the retrieved
  passages, but a model can still misread a passage it was given. The citations are
  what make that checkable; they are not a guarantee.
- **Context windows are finite and passages are dropped.** When passages do not fit,
  whole ones are dropped from the bottom up and the interface says how many. A long
  document asked about comprehensively may see less of itself than you expect.
- **No OCR.** A scanned PDF has no text layer, so extraction returns nothing and the
  document is reported as such rather than quietly indexed as empty.
- **Inference speed is hardware-bound.** Around 2–4 tokens/s on the reference machine.
  Long answers take tens of seconds, which is why the transcript streams and the stop
  button exists.
- **The vector library is young.** Its metadata filters return zero rows silently, so
  filtering is done in application code; its default index capacity aborts processes;
  and one index per process is a constraint inherited from the native layer. All three
  are worked around explicitly and tested.
- **Packaging has been built but not signed.** Unsigned installers trip operating
  system warnings; that is a distribution step, not an engineering one.

---

## Acknowledgements

Built with [node-llama-cpp](https://node-llama-cpp.withcat.ai/) (llama.cpp inference),
[ruvector](https://www.npmjs.com/package/ruvector) (HNSW vector store), Electron, React 19
and Material UI; [pdf-parse](https://www.npmjs.com/package/pdf-parse) for extraction;
axe-core for the accessibility scan. Model weights belong to their publishers:
Gemma 4 (Google, via unsloth) and Qwen3 Embedding (Alibaba, via enacimie's conversion)
are used under their respective licences.
