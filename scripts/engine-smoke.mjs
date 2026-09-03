/**
 * Headless engine harness — no window, no interface, just the engine.
 *
 * Run with `npm run smoke:engine` (Electron must not be running). It exercises
 * the same `ModelManager` and `LlamaService` the application uses, from the same
 * files on disk, and prints what a person cannot see from the interface:
 *
 *   - which GPU backend the engine picked, from llama.cpp's own report
 *   - how many layers were placed in VRAM out of how many, per model
 *   - resident memory and free memory before and after each load, so a duplicate
 *     copy of the weights is visible rather than assumed
 *   - whether the embedder's vectors put a related passage nearer a question than
 *     an unrelated one — the one number that says retrieval works at all
 *   - generated tokens per second
 *
 * Every phase is skipped rather than failed when its model is absent, so this
 * still runs on a machine with only one of the two files.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist-electron', 'electron');
const load = async (name) => import(pathToFileURL(path.join(dist, name)).href);

const gib = (bytes) => (bytes / 1024 ** 3).toFixed(2);

function snapshot(label) {
  const line = {
    point: label,
    rssGiB: Number(gib(process.memoryUsage().rss)),
    freeGiB: Number(gib(os.freemem())),
    systemFreeGiB: Number(gib(os.totalmem())),
  };
  console.log('MEM ' + JSON.stringify(line));
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

const passages = [
  'The term of this agreement is twenty-four (24) months from the Effective Date and renews for successive twelve-month periods unless either party gives ninety (90) days written notice of non-renewal.',
  'Licensee shall maintain commercially reasonable safeguards for Confidential Information, including encryption of personal data at rest and in transit, and shall notify Licensor within forty-eight hours of any confirmed personal data breach.',
  'The cafeteria serves soup and a sandwich at lunchtime, and the coffee machine on the third floor was repaired on Tuesday.',
];

const question = 'How much advance notice is required before the contract ends?';

async function main() {
  const { resolvePaths } = await load('paths.js');
  const { ModelManager } = await load('modelManager.js');
  const { LlamaService } = await load('llamaService.js');

  // `app.getAppPath()` is the directory of whatever was launched, and here that is
  // this script's own folder rather than the repository root, so the harness asks
  // for the vault one level up. The application itself launches from the root and
  // needs no such correction.
  const paths = resolvePaths({
    app,
    portableDir: process.env.PORTABLE_EXECUTABLE_DIR,
    devDirName: path.join('..', '.contextvault'),
  });
  const manager = new ModelManager({ paths });
  const llama = new LlamaService({ manager, modelsDir: paths.modelsDir });

  console.log('DATA ' + paths.dataDir);
  snapshot('start');

  const exists = async (fileName) =>
    fileName
      ? fs
          .stat(path.join(paths.modelsDir, fileName))
          .then(() => true)
          .catch(() => false)
      : false;

  // Point the manager at the catalogue's recommended pair, whichever files are
  // actually present. `select` validates the role against the file's own
  // metadata, so this also proves the pooling-based role detection on real GGUFs.
  const { recommendedFor } = await load('catalog.js');
  for (const role of ['embedding', 'chat']) {
    const entry = recommendedFor(role);
    if (!(await exists(entry.fileName))) {
      console.log('SKIP ' + role + ' — ' + entry.fileName + ' is not in ' + paths.modelsDir);
      continue;
    }
    await manager.select(role, entry.fileName);
    console.log('SELECTED ' + role + ' = ' + entry.fileName);
  }

  // ── Embeddings ────────────────────────────────────────────────────────────
  let retrievalWorked = null;
  if ((await manager.status()).embedding.fileName) {
    const started = Date.now();
    snapshot('before embedding model');
    const handle = await llama.ensureEmbeddings();
    console.log('EMBED LOAD ' + ((Date.now() - started) / 1000).toFixed(1) + 's');
    console.log(
      'EMBED dimensions=' + handle.dimensions + ' gpuLayers=' + handle.gpuLayers + '/' + handle.layerCount,
    );
    snapshot('after embedding model');

    const embedStarted = Date.now();
    const vectors = await llama.embed(passages);
    console.log('EMBED 3 passages in ' + ((Date.now() - embedStarted) / 1000).toFixed(2) + 's');

    const questionVector = await llama.embedQuery(question);
    const scores = vectors.map((vector, index) => ({ index, score: cosine(questionVector, vector) }));
    console.log('SCORES ' + JSON.stringify(scores));

    const best = scores.reduce((a, b) => (b.score > a.score ? b : a));
    retrievalWorked = best.index === 0;
    const margin = best.score - Math.max(...scores.filter((s) => s.index !== 0).map((s) => s.score));
    console.log('RETRIEVAL ' + (retrievalWorked ? 'correct passage ranked first' : 'WRONG passage ranked first'));
    console.log('MARGIN ' + margin.toFixed(4));
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  if ((await manager.status()).chat.fileName) {
    const started = Date.now();
    snapshot('before chat model');
    const handle = await llama.ensureChat();
    console.log('CHAT LOAD ' + ((Date.now() - started) / 1000).toFixed(1) + 's');
    // `contextSize` is what the engine granted, which can be less than the setting
    // when memory disagreed; the split says how much of the file is in VRAM.
    console.log('CHAT context=' + handle.contextSize + ' gpuLayers=' + handle.gpuLayers + '/' + handle.layerCount);

    const prompt =
      'Context: "The term of this agreement is twenty-four (24) months from the Effective Date ' +
      'unless either party gives ninety (90) days written notice of non-renewal." [1]\n\n' +
      'Question: How much advance notice is required before the contract ends? ' +
      'Answer in one sentence and cite the source as [1].';

    let chars = 0;
    const generateStarted = Date.now();
    const result = await llama.streamChat(prompt, {
      onTextChunk: (chunk) => {
        chars += chunk.length;
      },
    });
    const seconds = (Date.now() - generateStarted) / 1000;
    console.log('ANSWER ' + JSON.stringify(result.text.trim().slice(0, 300)));
    console.log(
      'GENERATION tokens=' +
        result.tokenCount +
        ' chars=' +
        chars +
        ' tokensPerSecond=' +
        result.tokensPerSecond.toFixed(2) +
        ' seconds=' +
        seconds.toFixed(1),
    );
    snapshot('after generation');
  }

  // The state the application lives in between turns: both models mapped, the
  // embedder answering on the CPU while the generator holds the graphics memory.
  if ((await manager.status()).embedding.fileName) {
    const embedStarted = Date.now();
    await llama.embedQuery(question);
    console.log('EMBED_WITH_CHAT_RESIDENT ms=' + (Date.now() - embedStarted));
  }

  const stats = await llama.stats();
  console.log('STATS ' + JSON.stringify({ ...stats, modelBytes: Number(gib(stats.modelBytes)) }));
  const report = llama.systemReport;
  await llama.releaseAll();
  snapshot('after release');

  console.log('GPU BACKEND ' + String(stats.gpuBackend));
  // llama.cpp's own summary: device names, VRAM, and which of the compiled backends
  // it actually loaded. Printed in full because "GPU" is not an explanation.
  // llama.cpp's own summary: device names, VRAM, which compiled backends loaded.
  // Read before shutdown, because the engine is what holds the answer.
  console.log('GPU REPORT ' + report.replace(/\s+/g, ' ').slice(0, 1400));
  console.log(
    'RESULT ' +
      JSON.stringify({
        retrievalCorrect: retrievalWorked,
        gpuBackend: stats.gpuBackend,
        chatLayersOffloaded: stats.chat ? stats.chat.gpuLayers : null,
        embeddingLayersOffloaded: stats.embedding ? stats.embedding.gpuLayers : null,
      }),
  );

  app.exit(retrievalWorked === false ? 1 : 0);
}

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error('SMOKE FAILED', error);
    app.exit(1);
  });
