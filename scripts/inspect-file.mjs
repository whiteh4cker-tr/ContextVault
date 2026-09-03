import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = path.resolve(import.meta.dirname, '../dist-electron/electron');
const file = process.argv[2];
const { extractDocument } = await import(pathToFileURL(path.join(dist, 'rag/extract.js')).href);

const extracted = await extractDocument(file);
console.log('FILE ' + path.basename(file));
console.log('KIND ' + extracted.kind + ' PAGES ' + extracted.pages.length + ' CHARS ' + extracted.text.length);
for (const [index, page] of extracted.pages.entries()) {
  const body = page.text.replace(/\s+/g, ' ').trim();
  console.log('PAGE ' + (index + 1) + ' [' + body.length + ' chars] ' + body.slice(0, 700));
}
