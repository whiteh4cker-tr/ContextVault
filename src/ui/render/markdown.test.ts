import { describe, expect, it } from 'vitest';
import { findCitationMarkers, parseMarkdown } from './markdown';

const textOf = (src: string): string =>
  parseMarkdown(src)
    .map((block) =>
      block.type === 'paragraph' || block.type === 'heading' || block.type === 'quote'
        ? block.children.map((inline) => inline.text).join('')
        : block.type === 'code'
          ? block.text
          : block.type === 'list'
            ? block.items.map((item) => item.children.map((inline) => inline.text).join('')).join('|')
            : '---',
    )
    .join('\n');

describe('parseMarkdown — blocks', () => {
  it('splits paragraphs on blank lines', () => {
    const blocks = parseMarkdown('one\nstill one\n\ntwo');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph']);
    expect(textOf('one\nstill one\n\ntwo')).toBe('one still one\ntwo');
  });

  it('reads ATX headings at every level', () => {
    const blocks = parseMarkdown('# Title\n### Sub');
    expect(blocks).toMatchObject([
      { type: 'heading', level: 1 },
      { type: 'heading', level: 3 },
    ]);
  });

  it('keeps code inside a fence verbatim, without interpreting markdown in it', () => {
    const src = '```js\nconst a = **not bold**;\n# not a heading\n```';
    const blocks = parseMarkdown(src);
    expect(blocks).toHaveLength(1);
    if (blocks[0].type === 'code') {
      expect(blocks[0].lang).toBe('js');
      expect(blocks[0].text).toBe('const a = **not bold**;\n# not a heading');
    }
  });

  it('treats an unclosed fence as code to the end, not as broken markup', () => {
    const blocks = parseMarkdown('```\nstill code\n');
    expect(blocks[0].type).toBe('code');
  });

  it('reads bullet and numbered lists', () => {
    expect(parseMarkdown('- a\n- b')[0]).toMatchObject({ type: 'list', ordered: false });
    expect(parseMarkdown('1. a\n2. b')[0]).toMatchObject({ type: 'list', ordered: true });
    expect(textOf('- a\n- b')).toBe('a|b');
  });

  it('reads a blockquote and a rule', () => {
    expect(parseMarkdown('> quoted')[0].type).toBe('quote');
    expect(parseMarkdown('---')[0].type).toBe('hr');
  });

  it('ignores leading whitespace differences when choosing a block type', () => {
    expect(parseMarkdown('   # spaced heading')[0].type).toBe('heading');
  });
});

describe('parseMarkdown — inline', () => {
  it('marks bold, italic and inline code', () => {
    const blocks = parseMarkdown('a **b** *c* `d`');
    expect(blocks[0].type === 'paragraph' && blocks[0].children.map((i) => i.type)).toEqual([
      'text',
      'bold',
      'text',
      'italic',
      'text',
      'code',
    ]);
  });

  it('does not interpret emphasis inside inline code', () => {
    const blocks = parseMarkdown('use `**this**` now');
    if (blocks[0].type === 'paragraph') {
      const code = blocks[0].children.find((i) => i.type === 'code');
      expect(code?.text).toBe('**this**');
    }
  });

  it('renders angle-bracket content as text, never as markup', () => {
    // Model output quotes untrusted documents. A renderer that turned this into
    // an element would be an injection hole.
    expect(textOf('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
    expect(parseMarkdown('<script>alert(1)</script>')[0].type).toBe('paragraph');
  });

  it('keeps only web links, and takes the label as the text', () => {
    const blocks = parseMarkdown('see [the report](https://example.com/r) ok');
    if (blocks[0].type === 'paragraph') {
      const link = blocks[0].children.find((i) => i.type === 'link');
      expect(link).toMatchObject({ type: 'link', text: 'the report', href: 'https://example.com/r' });
    }
  });

  it('drops javascript: and file: link targets', () => {
    const blocks = parseMarkdown('[click](javascript:alert(1))');
    if (blocks[0].type === 'paragraph') {
      expect(blocks[0].children.some((i) => i.type === 'link')).toBe(false);
      expect(blocks[0].children.map((i) => i.text).join('')).toContain('click');
    }
  });

  it('leaves an unbalanced delimiter as literal text', () => {
    expect(textOf('2 * 3 * 4')).toBe('2 * 3 * 4');
  });
});

describe('citation markers', () => {
  it('finds bracketed passage numbers in order of appearance', () => {
    const blocks = parseMarkdown('Costs rose [1] while staffing held [2] and rose again [1].');
    const markers = blocks
      .flatMap((b) => (b.type === 'paragraph' ? b.children : []))
      .filter((i) => i.type === 'citation');
    expect(markers.map((m) => m.cite)).toEqual([1, 2, 1]);
  });

  it('reports the numbers a message cites, deduplicated', () => {
    expect(findCitationMarkers('a [3] b [1] c [3]')).toEqual([3, 1]);
  });

  it('does not read a bracketed year or a range as a citation', () => {
    // "[2024]", "[12:30]" and "[1-3]" are ordinary text; reading them as passage
    // numbers would invent sources the model never used.
    expect(findCitationMarkers('reported in [2024] at [12:30] pages [1-3]')).toEqual([]);
  });

  it('ignores a citation-looking marker that is inside code', () => {
    expect(findCitationMarkers('use `[1]` literally')).toEqual([]);
  });
});
