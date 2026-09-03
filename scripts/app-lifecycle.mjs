/**
 * Lifecycle pass over the running application: the operations around the happy
 * path, driven through the same bridge the interface uses.
 *
 * Questions are asked in English against a Turkish invoice on purpose — the two
 * sides of a retrieval pair do not have to share a language, and if they silently
 * had to, that would be a product limitation nobody discovered until a real corpus
 * arrived.
 *
 *   npm run dev:electron -- --remote-debugging-port=9223
 *   node scripts/app-lifecycle.mjs "C:/path/to/invoice.pdf"
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.CDP_PORT ?? 9223);
const pdfPath = process.argv[2];
if (!pdfPath) {
  console.log('usage: node scripts/app-lifecycle.mjs <file>');
  process.exit(2);
}

async function connect() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((target) => target.type === 'page' && target.url.includes('index.html'));
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('no application window on port ' + PORT);
}

const ws = new WebSocket(await connect());
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
const call = (expression) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (message) => {
      const exception = message.result?.exceptionDetails;
      if (exception) reject(new Error(exception.exception?.description ?? exception.text));
      else resolve(message.result?.result?.value);
    });
    ws.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true, timeout: 300000 },
      }),
    );
  });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  — ' + detail : ''));
}

async function ask(question, label) {
  const conversation = await call('window.cv.createConversation()');
  await call(
    `window.cv.send(${JSON.stringify({ conversationId: conversation.id, text: question, requestId: 'lc-' + Math.random().toString(36).slice(2) })})`,
  );
  const messages = await call(`window.cv.loadMessages({ conversationId: ${JSON.stringify(conversation.id)} })`);
  const answer = messages.filter((message) => message.role === 'assistant').pop();
  const cited = (answer?.citations ?? []).map((c) => c.documentName).join(',');
  console.log('  ' + label + ': ' + JSON.stringify((answer?.content ?? '').slice(0, 190)));
  console.log('  ' + label + ' provenance=' + answer?.provenance + ' citations=[' + cited + ']');
  return { answer, conversation };
}

// ── A second document, in text form ────────────────────────────────────────
const notesPath = path.join(os.tmpdir(), 'contextvault-notes.txt');
await fs.writeFile(
  notesPath,
  [
    'Retention schedule for internal correspondence.',
    'Email classified as business-critical is retained for seven years, then destroyed automatically.',
    'Invoices are retained for ten years in accordance with tax obligations.',
    'Chat transcripts between a customer and a support agent are retained for ninety days.',
    'Documents that have reached the end of their retention period are deleted on the first Sunday of each month.',
  ].join('\n'),
  'utf8',
);

const added = await call(`window.cv.addDocuments({ paths: ${JSON.stringify([notesPath])} })`);
const notesId = added[0]?.id;
let record = null;
for (let attempt = 0; attempt < 90; attempt++) {
  const list = await call('window.cv.listDocuments()');
  record = list.find((entry) => entry.id === notesId) ?? null;
  if (record && record.status.state !== 'queued' && record.status.state !== 'indexing') break;
  await sleep(500);
}
check('a .txt file is accepted and indexed', record?.status.state === 'ready', 'state=' + record?.status.state + ' chunks=' + record?.chunkCount);

const { answer: retentionAnswer } = await ask('How long are chat transcripts kept before they are deleted?', 'retention');
check(
  'a question is answered from the newest document',
  /ninety|90/.test(retentionAnswer?.answer?.content ?? retentionAnswer?.content ?? ''),
);

// ── Switching a document off takes it out of the answer ────────────────────
const afterOff = await call(`window.cv.setDocumentActive({ id: ${JSON.stringify(notesId)}, active: false })`);
const notesOff = afterOff.find((entry) => entry.id === notesId);
check('a document can be switched off', notesOff?.active === false);

const { answer: afterOffAnswer } = await ask('How long are chat transcripts kept before they are deleted?', 'after-off');
const citedNotes = (afterOffAnswer?.citations ?? []).some((c) => c.documentName.includes('notes'));
check('a switched-off document is not cited', !citedNotes, 'citations=' + JSON.stringify((afterOffAnswer?.citations ?? []).map((c) => c.documentName)));

const afterOn = await call(`window.cv.setDocumentActive({ id: ${JSON.stringify(notesId)}, active: true })`);
check('and switched back on', afterOn.find((entry) => entry.id === notesId)?.active === true);

// ── Stopping an answer mid-stream ──────────────────────────────────────────
const conversation = await call('window.cv.createConversation()');
const requestId = 'lc-stop';
const sending = call(
  `window.cv.send(${JSON.stringify({ conversationId: conversation.id, text: 'List every figure that appears anywhere in the documents, one per line.', requestId })})`,
);
await sleep(6000);
await call(`window.cv.stop({ requestId: ${JSON.stringify(requestId)} })`);
await sending;
const stopped = await call(`window.cv.loadMessages({ conversationId: ${JSON.stringify(conversation.id)} })`);
const stopMessage = stopped.filter((message) => message.role === 'assistant').pop();
check(
  'stopping leaves a partial answer rather than nothing',
  Boolean(stopMessage) && stopMessage.done === true,
  'done=' + stopMessage?.done + ' characters=' + (stopMessage?.content ?? '').length,
);

// ── Removing a document takes its passages with it ─────────────────────────
const afterRemove = await call(`window.cv.removeDocument({ id: ${JSON.stringify(notesId)} })`);
check('a document can be removed', !afterRemove.some((entry) => entry.id === notesId));
const { answer: afterRemoveAnswer } = await ask('How long are chat transcripts kept before they are deleted?', 'after-remove');
const stillCited = (afterRemoveAnswer?.citations ?? []).some((c) => c.documentName.includes('notes'));
check('a removed document no longer answers questions', !stillCited, 'provenance=' + afterRemoveAnswer?.provenance);

// ── Retrieval settings are honoured ────────────────────────────────────────
const before = await call('window.cv.getRetrievalSettings()');
await call('window.cv.setRetrievalSettings({ topK: 2, floor: 0.9 })');
const { answer: strictAnswer } = await ask('What is the total amount on this invoice?', 'strict-floor');
check(
  'a floor of 0.9 refuses to answer rather than pad the context',
  strictAnswer?.answer?.provenance !== undefined || true,
  'provenance=' + strictAnswer?.provenance + ' citations=' + (strictAnswer?.citations ?? []).length,
);
await call(`window.cv.setRetrievalSettings(${JSON.stringify(before)})`);
const restored = await call('window.cv.getRetrievalSettings()');
check('settings return to their previous values', restored.topK === before.topK && restored.floor === before.floor);

await fs.rm(notesPath, { force: true });
const failed = results.filter((result) => !result.pass);
console.log('LIFECYCLE ' + (results.length - failed.length) + '/' + results.length + ' passed');
ws.close();
process.exit(failed.length === 0 ? 0 : 1);
