/**
 * Drives the running application from outside, over the DevTools protocol.
 *
 * This is not a unit test and it is not a UI test. It is the closest thing to
 * sitting down at the machine: it attaches to the live window, hands the real
 * main process a real file, and then reads what the interface itself can see —
 * ingestion stages as they arrive, the document list, the answer as it streams,
 * and the citations underneath it. Everything it touches is the same code a
 * person touches: `window.cv`, the preload bridge, IPC, the pipeline, the index.
 *
 *   npm run dev:electron -- --remote-debugging-port=9223
 *   node scripts/app-e2e.mjs "C:/path/to/invoice.pdf" "What is the invoice number?"
 */
const PORT = Number(process.env.CDP_PORT ?? 9223);
const filePath = process.argv[2];
const question =
  process.argv[3] ?? 'What is the invoice number, the invoice date, and the payment method?';

if (!filePath) {
  console.log('usage: node scripts/app-e2e.mjs <file> [question]');
  process.exit(2);
}

/** One CDP connection, sequential evaluations. */
async function connect() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((target) => target.type === 'page' && target.url.includes('index.html'));
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* the window is not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('no application window on port ' + PORT);
}

const wsUrl = await connect();
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error('websocket failed'));
});

let nextId = 1;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
};

function evaluate(expression, { awaitIt = true } = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (message) => {
      const exception = message.result?.exceptionDetails;
      if (exception) {
        reject(new Error(exception.exception?.description ?? exception.text));
        return;
      }
      resolve(message.result?.result?.value);
    });
    ws.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: awaitIt, returnByValue: true, timeout: 600000 },
      }),
    );
  });
}

const call = (snippet) => evaluate(snippet);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Event collectors, installed inside the page, so the stream is observed rather
// than inferred from the final state.
await call(`
  window.__e2e = { progress: [], model: [], chunks: 0, stats: null };
  window.cv.onRagProgress((event) => window.__e2e.progress.push(event));
  window.cv.onModelEvent((event) => window.__e2e.model.push(event));
  window.cv.onChatChunk(() => { window.__e2e.chunks += 1; });
  window.cv.onSystemStats((stats) => { window.__e2e.stats = stats; });
  typeof window.cv.addDocuments;
`);

const bridge = await call('Object.keys(window.cv).length');
console.log('BRIDGE methods=' + bridge);

const status = await call('window.cv.modelStatus()');
console.log(
  'MODELS chat=' +
    status.chat.fileName +
    '(' + status.chat.state + ') embedding=' + status.embedding.fileName + '(' + status.embedding.state + ')',
);

console.log('ADD ' + filePath);
const added = await call(`window.cv.addDocuments({ paths: ${JSON.stringify([filePath])} })`);
const docId = added[0]?.id;
console.log('ADDED id=' + docId + ' name=' + added[0]?.name + ' state=' + added[0]?.status.state);

let document_ = null;
for (let attempt = 0; attempt < 150; attempt++) {
  const list = await call('window.cv.listDocuments()');
  document_ = list.find((entry) => entry.id === docId) ?? null;
  const state = document_?.status.state ?? 'gone';
  const stage = document_?.status.stage ?? '';
  if (state !== 'queued' && state !== 'indexing') break;
  if (attempt % 5 === 0) console.log('  ... ' + state + '/' + stage + ' ' + (document_?.status.message ?? ''));
  await sleep(1000);
}
console.log(
  'DOCUMENT state=' + document_?.status.state + ' chunks=' + document_?.chunkCount + ' pages=' + document_?.pages +
    ' message=' + (document_?.status.message ?? ''),
);

const progress = await call('window.__e2e.progress');
const stages = [];
for (const event of progress) {
  const key = event.stage + ':' + event.ratio.toFixed(2);
  if (stages[stages.length - 1] !== key) stages.push(key);
}
console.log('PROGRESSION ' + stages.join(' -> '));

if (document_?.status.state !== 'ready') {
  console.log('STOPPED — ingestion did not reach ready');
  ws.close();
  process.exit(1);
}

const settings = await call('window.cv.getRetrievalSettings()');
console.log('RETRIEVAL topK=' + settings.topK + ' floor=' + settings.floor);

const conversation = await call('window.cv.createConversation()');
console.log('CONVERSATION ' + conversation.id);

const askedAt = Date.now();
await call(
  `window.cv.send(${JSON.stringify({ conversationId: conversation.id, text: question, requestId: 'e2e-1' })})`,
);
const seconds = ((Date.now() - askedAt) / 1000).toFixed(1);

const messages = await call(`window.cv.loadMessages({ conversationId: ${JSON.stringify(conversation.id)} })`);
const answer = messages.filter((message) => message.role === 'assistant').pop();
const chunks = await call('window.__e2e.chunks');

console.log('QUESTION ' + question);
console.log('ANSWER (' + seconds + 's, ' + chunks + ' streamed chunk events)');
console.log((answer?.content ?? '(no answer message)').replace(/\r/g, ''));
console.log('TOKENS count=' + (answer?.tokenCount ?? '?') + ' perSecond=' + (answer?.tokensPerSecond?.toFixed(2) ?? '?'));
console.log('PROVENANCE ' + (answer?.provenance ?? '(none)'));
for (const citation of answer?.citations ?? []) {
  console.log(
    '  [' + citation.index + '] ' + citation.documentName + ' p.' + citation.page +
      ' chunk=' + citation.chunkIndex + ' similarity=' + citation.similarity.toFixed(3) +
      ' snippet=' + JSON.stringify(citation.snippet.slice(0, 110)),
  );
}

const stats = await call('window.__e2e.stats');
if (stats) {
  console.log(
    'STATS freeGiB=' + (stats.freeBytes / 1024 ** 3).toFixed(1) + ' totalGiB=' + (stats.totalBytes / 1024 ** 3).toFixed(1),
  );
}

ws.close();
console.log('E2E ' + (answer && answer.citations?.length > 0 && (answer.content ?? '').length > 40 ? 'PASS' : 'FAIL'));
process.exit(answer && answer.citations?.length > 0 && (answer.content ?? '').length > 40 ? 0 : 1);
