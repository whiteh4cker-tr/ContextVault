import { describe, expect, it } from 'vitest';
import { chunkText } from './chunker';

const SAMPLE = [
  'The contract begins on the first page. It defines the parties and the term of service.',
  'Termination requires ninety days written notice to the address on the signature page.',
  '',
  'Fees are payable monthly in arrears. Late payments accrue interest at one percent per month.',
  'The provider may suspend service after thirty days of non-payment following written warning.',
].join('\n');

describe('chunkText', () => {
  it('returns nothing for text with no content', () => {
    expect(chunkText('', { chunkSize: 200, chunkOverlap: 20 })).toEqual([]);
    expect(chunkText('   \n\n  ', { chunkSize: 200, chunkOverlap: 20 })).toEqual([]);
  });

  it('keeps a short document in one passage', () => {
    const chunks = chunkText(SAMPLE, { chunkSize: 4000, chunkOverlap: 200 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.start).toBe(SAMPLE.indexOf('The contract'));
    expect(chunks[0]!.text).toBe(SAMPLE.trim());
  });

  it('reports offsets that point back at the exact source text', () => {
    const chunks = chunkText(SAMPLE, { chunkSize: 160, chunkOverlap: 40 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(SAMPLE.slice(chunk.start, chunk.end)).toBe(chunk.text);
    }
  });

  it('numbers passages in reading order', () => {
    const chunks = chunkText(SAMPLE, { chunkSize: 120, chunkOverlap: 0 });
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    const ordered = [...chunks].sort((a, b) => a.start - b.start);
    expect(chunks).toEqual(ordered);
  });

  it('repeats text between neighbouring passages so a straddling sentence is findable twice', () => {
    const chunks = chunkText(SAMPLE, { chunkSize: 160, chunkOverlap: 40 });
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i]!.start).toBeLessThan(chunks[i - 1]!.end);
    }
  });

  it('honours the requested passage length', () => {
    const size = 160;
    const chunks = chunkText(SAMPLE, { chunkSize: size, chunkOverlap: 40 });
    for (const chunk of chunks) expect(chunk.end - chunk.start).toBeLessThanOrEqual(size);
  });

  it('covers every character of the source', () => {
    const chunks = chunkText(SAMPLE, { chunkSize: 90, chunkOverlap: 15 });
    const covered = new Set<number>();
    for (const chunk of chunks) for (let at = chunk.start; at < chunk.end; at += 1) covered.add(at);
    for (let at = 0; at < SAMPLE.length; at += 1) {
      // Whitespace between passages is the only thing allowed to go uncovered.
      if (!/\s/.test(SAMPLE[at]!)) expect(covered.has(at), `character ${at} (${SAMPLE[at]})`).toBe(true);
    }
  });

  it('makes progress even when the overlap is set as large as the passage', () => {
    const chunks = chunkText(SAMPLE, { chunkSize: 100, chunkOverlap: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.at(-1)!.end).toBeCloseTo(SAMPLE.trimEnd().length, -1);
  });

  it('cuts a token longer than a passage instead of losing it', () => {
    const blob = 'x'.repeat(500);
    const chunks = chunkText(`intro ${blob} outro`, { chunkSize: 120, chunkOverlap: 0 });
    const recovered = chunks.map((c) => c.text).join('');
    expect(recovered).toContain(blob.slice(0, 240));
    expect(chunks.every((c) => c.end - c.start <= 120)).toBe(true);
  });

  it('ends a passage at a sentence boundary when one is available', () => {
    // The first paragraph is 172 characters, so a 200-character window covers it
    // entirely and must not reach into the next paragraph mid-sentence.
    const chunks = chunkText(SAMPLE, { chunkSize: 200, chunkOverlap: 0 });
    expect(chunks[0]!.text.endsWith('signature page.')).toBe(true);
    expect(chunks[1]!.text.startsWith('Fees are payable')).toBe(true);
  });

  it('does not cascade one-character passages at the end of a document', () => {
    // A document whose last line is followed by whitespace reached its content end a
    // few characters short of the offset the loop tested against, so the loop kept
    // running: it re-emitted the tail, then the tail minus one character, and so on.
    // A 6.7 KB input produced 135 passages of which 110 were shorter than a word —
    // all indexed, all able to outrank a real answer, and none of them a passage.
    const newline = String.fromCharCode(10);
    const document = SAMPLE + newline + newline + '   ';
    const chunkSize = 100;
    const overlap = 20;
    const chunks = chunkText(document, { chunkSize, chunkOverlap: overlap });

    // The most passages a window of this stride can need, plus one for a ragged end.
    const ceiling = Math.ceil(document.trimEnd().length / (chunkSize - overlap)) + 1;
    expect(chunks.length, 'produced ' + chunks.length + ' passages, ceiling ' + ceiling).toBeLessThanOrEqual(
      ceiling,
    );

    const fragments = chunks.slice(0, -1).filter((entry) => entry.end - entry.start < chunkSize / 4);
    expect(fragments, 'fragment lengths: ' + fragments.map((entry) => entry.end - entry.start).join(',')).toHaveLength(
      0,
    );
  });

  it('stops at the last character that carries content', () => {
    const trailing = 'First sentence here. Second sentence here.' + '   ' + String.fromCharCode(10);
    const chunks = chunkText(trailing, { chunkSize: 40, chunkOverlap: 5 });
    expect(chunks.at(-1)!.end).toBe('First sentence here. Second sentence here.'.length);
    expect(chunks.some((entry) => entry.end - entry.start < 3)).toBe(false);
  });
});
