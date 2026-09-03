/**
 * The markdown subset ContextVault renders for assistant answers.
 *
 * Everything a model says quotes documents of unknown provenance, so this
 * parser exists to *avoid* HTML: the output is a tree of plain data that the
 * renderer turns into elements. There is no `dangerouslySetInnerHTML` here and
 * none is needed — `<script>` in an answer stays literal text because nothing
 * in this module ever interprets angle brackets.
 *
 * Supported: paragraphs, ATX headings, fenced and inline code, bullet and
 * numbered lists, blockquotes, rules, bold, italic, web links, and `[n]`
 * passage markers, which become citations rather than links.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'link'; text: string; href: string }
  | { type: 'citation'; text: string; cite: number };

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'heading'; level: number; children: Inline[] }
  | { type: 'quote'; children: Inline[] }
  | { type: 'code'; text: string; lang?: string }
  | { type: 'list'; ordered: boolean; items: { children: Inline[] }[] }
  | { type: 'hr' };

/** Passage numbers are short. Anything longer is a year, a time or a page range. */
const CITE_MAX_DIGITS = 2;

const INLINE_PATTERN =
  /`([^`\n]+)`|\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*|\*(?!\s)([^*\n]+?)(?<!\s)\*|\[([^\]\n]+)\]\(([^)\s]+)\)|\[(\d{1,2})\]/g;

/** Only these schemes may become a clickable link. */
function safeHref(raw: string): string | null {
  const href = raw.trim();
  return /^https?:\/\//i.test(href) || /^mailto:/i.test(href) ? href : null;
}

/** Split one line of text into inline runs, leaving anything unmatched as text. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let plain = '';
  let cursor = 0;
  const pattern = new RegExp(INLINE_PATTERN.source, 'g');
  let match: RegExpExecArray | null;

  const flush = () => {
    if (plain.length > 0) {
      out.push({ type: 'text', text: plain });
      plain = '';
    }
  };

  while ((match = pattern.exec(src)) !== null) {
    plain += src.slice(cursor, match.index);
    cursor = pattern.lastIndex;
    const [full, code, bold, italic, linkText, linkHref, cite] = match;

    if (code !== undefined) {
      flush();
      out.push({ type: 'code', text: code });
    } else if (bold !== undefined) {
      flush();
      out.push({ type: 'bold', text: bold });
    } else if (italic !== undefined) {
      flush();
      out.push({ type: 'italic', text: italic });
    } else if (linkText !== undefined && linkHref !== undefined) {
      const href = safeHref(linkHref);
      if (href) {
        flush();
        out.push({ type: 'link', text: linkText, href });
      } else {
        // A dangerous target is not dropped silently: the words the model wrote
        // stay on screen, they simply are not clickable.
        plain += linkText;
      }
    } else if (cite !== undefined && cite.length <= CITE_MAX_DIGITS) {
      flush();
      out.push({ type: 'citation', text: full, cite: Number(cite) });
    } else {
      plain += full;
    }
  }

  plain += src.slice(cursor);
  flush();
  return out;
}

const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/;
const FENCE = /^\s*```+\s*([\w+-]*)\s*$/;
const RULE = /^\s*([-*_])\s*(\1\s*){2,}$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let index = 0;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) });
      paragraph = [];
    }
  };

  while (index < lines.length) {
    const line = lines[index];

    if (FENCE.test(line)) {
      flushParagraph();
      const lang = FENCE.exec(line)?.[1] || undefined;
      const body: string[] = [];
      index += 1;
      // An unclosed fence runs to the end of the message: while an answer is
      // streaming, half a code block is the normal state, not broken markup.
      while (index < lines.length && !FENCE.test(lines[index])) body.push(lines[index++]);
      index += 1;
      blocks.push({ type: 'code', text: body.join('\n'), lang });
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', level: heading[1].length, children: parseInline(heading[2]) });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      flushParagraph();
      const body: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index])) body.push(QUOTE.exec(lines[index++])![1]);
      blocks.push({ type: 'quote', children: parseInline(body.join(' ')) });
      continue;
    }

    const bullet = BULLET.test(line);
    const numbered = NUMBERED.test(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = numbered;
      const pattern = ordered ? NUMBERED : BULLET;
      const items: { children: Inline[] }[] = [];
      while (index < lines.length) {
        const current = lines[index];
        if (current.trim() === '') {
          // A blank line only ends the list if the next line is not another item.
          if (index + 1 >= lines.length || !(BULLET.test(lines[index + 1]) || NUMBERED.test(lines[index + 1]))) {
            break;
          }
          index += 1;
          continue;
        }
        const item = pattern.exec(current);
        if (!item) break;
        items.push({ children: parseInline(item[1]) });
        index += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    paragraph.push(line.trim());
    index += 1;
  }

  flushParagraph();
  return blocks;
}

/**
 * The passage numbers an answer cites, in order of first appearance.
 *
 * Anything that is not a short number in square brackets is not a citation, and
 * a marker inside inline code does not count: quoting a literal `[1]` in a code
 * sample is not the model claiming a source.
 */
export function findCitationMarkers(src: string): number[] {
  const seen: number[] = [];
  for (const block of parseMarkdown(src)) {
    const inlines =
      block.type === 'paragraph' || block.type === 'heading' || block.type === 'quote'
        ? block.children
        : block.type === 'list'
          ? block.items.flatMap((item) => item.children)
          : [];
    for (const inline of inlines) {
      if (inline.type === 'citation' && !seen.includes(inline.cite)) seen.push(inline.cite);
    }
  }
  return seen;
}
