import fs from 'node:fs/promises';
import path from 'node:path';
import type { DocumentKind } from '../../shared/types.js';

/**
 * Turning a file on disk into text with its page boundaries intact.
 *
 * Page numbers are the point. A citation that says "page 7" lets someone check
 * the answer against the printed document they signed; a citation that says
 * "character 41 233" does not, and page 1 for everything would be worse than
 * nothing because it would look like a real reference.
 *
 * Plain text is split on form feeds, which is how paginated text files have
 * carried page breaks since line printers — better than pretending a 900-page log
 * is one page.
 */
export interface ExtractedPage {
  page: number;
  text: string;
}

export interface Extraction {
  kind: DocumentKind;
  pages: ExtractedPage[];
  /** Every page joined in reading order, for the whole-document hash. */
  text: string;
}

const PDF_SUFFIXES = ['.pdf'];
const TEXT_SUFFIXES = ['.txt', '.md', '.markdown', '.log', '.csv', '.json'];

export function kindForFile(filePath: string): DocumentKind {
  const suffix = path.extname(filePath).toLowerCase();
  if (PDF_SUFFIXES.includes(suffix)) return 'application/pdf';
  if (TEXT_SUFFIXES.includes(suffix)) return 'text/plain';
  throw new Error(
    `Unsupported file type "${suffix || 'unknown'}". ContextVault indexes PDF and plain-text files.`,
  );
}

export function isSupported(filePath: string): boolean {
  try {
    kindForFile(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Split plain text into pages on form feeds, dropping empty trailing pages. */
export function pagesFromPlainText(raw: string): ExtractedPage[] {
  const parts = raw.split('\f');
  const pages: ExtractedPage[] = [];
  for (const part of parts) {
    const text = part.replace(/\r\n/g, '\n');
    if (text.trim().length === 0 && pages.length > 0) continue;
    pages.push({ page: pages.length + 1, text });
  }
  return pages.length > 0 ? pages : [{ page: 1, text: '' }];
}

/**
 * Extract text from a PDF, page by page.
 *
 * `pdf-parse` is imported lazily so the module loads on a machine where its
 * native-free bundle still fails for some other reason, and so a text-only
 * session never pays for loading it.
 */
export async function pagesFromPdf(buffer: Uint8Array): Promise<ExtractedPage[]> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer as unknown as Uint8Array });
  try {
    const result = await parser.getText();
    const pages = result.pages
      .map((page) => ({ page: page.num, text: (page.text ?? '').replace(/\r\n/g, '\n') }))
      .filter((page) => page.text.trim().length > 0);
    return pages.length > 0 ? pages : [{ page: 1, text: '' }];
  } finally {
    await parser.destroy();
  }
}

/** Read one file into pages, in reading order. */
export async function extractDocument(filePath: string): Promise<Extraction> {
  const kind = kindForFile(filePath);
  const bytes = await fs.readFile(filePath);

  const pages =
    kind === 'application/pdf'
      ? await pagesFromPdf(new Uint8Array(bytes))
      : pagesFromPlainText(bytes.toString('utf8'));

  return { kind, pages, text: pages.map((page) => page.text).join('\n\n') };
}
