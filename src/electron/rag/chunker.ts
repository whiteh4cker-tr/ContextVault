/**
 * Splitting extracted text into passages that can be embedded and cited.
 *
 * Two properties matter more than cleverness here.
 *
 * First, **an overlap is not a nicety**: a sentence that straddles a boundary is
 * findable from either side, so a question about it does not depend on where the
 * splitter happened to cut.
 *
 * Second, **every chunk records the characters it came from**. `start` and `end`
 * are exact offsets into the extracted text, so `source.slice(start, end)` returns
 * the chunk. That is what makes a citation checkable rather than a claim about
 * where something was written.
 *
 * The algorithm is a moving window whose boundaries snap outward to something
 * human — end at a sentence, start at a word. Two invariants are asserted by the
 * tests for every input: no non-whitespace character is left out of every
 * passage, and consecutive passages share up to `chunkOverlap` characters.
 */
export interface ChunkOptions {
  /** Target passage length in characters. */
  chunkSize: number;
  /** Characters repeated between consecutive passages. */
  chunkOverlap: number;
}

export interface TextChunk {
  text: string;
  /** Zero-based index within the document. */
  index: number;
  /** Exact offsets into the extracted text. */
  start: number;
  end: number;
}

const TERMINATOR = /[.!?…]/;
const SENTENCE_FLOOR = 0.6;

/** Advance past whitespace so a passage never begins on a space or a newline. */
function snapStart(source: string, from: number): number {
  let at = from;
  while (at < source.length && /\s/.test(source[at]!)) at += 1;
  return at;
}

/**
 * Choose where a passage ends: the last sentence terminator in the tail of the
 * window, then the last space, then the hard limit.
 *
 * The 60 % floor keeps a passage close to the requested length — without it, one
 * early full stop would turn a 1 000-character passage into a 60-character one,
 * and a corpus of fragments retrieves badly.
 */
function snapEnd(source: string, from: number, to: number): number {
  const floor = from + Math.ceil((to - from) * SENTENCE_FLOOR);

  for (let at = to - 1; at >= floor; at -= 1) {
    if (TERMINATOR.test(source[at]!)) {
      // Include the terminator; stop after it, not on it.
      let after = at + 1;
      while (after < to && TERMINATOR.test(source[after]!)) after += 1;
      return after;
    }
  }

  for (let at = to - 1; at >= floor; at -= 1) {
    if (/\s/.test(source[at]!)) return at;
  }
  return to;
}

/**
 * Cut extracted text into overlapping passages.
 *
 * `chunkSize` is a target for a passage; a single token longer than the target is
 * cut across passages rather than dropped, because a hole in an index is
 * invisible — no query will ever reveal that a paragraph was never embedded.
 */
export function chunkText(source: string, options: ChunkOptions): TextChunk[] {
  const size = Math.max(1, Math.floor(options.chunkSize));
  // Half a passage is the useful maximum overlap: beyond that every chunk is
  // mostly a copy of its neighbour, and a full-size overlap would never advance.
  const overlap = Math.max(0, Math.min(Math.floor(options.chunkOverlap), Math.floor(size / 2)));

  if (source.trim().length === 0) return [];

  // The end that matters is the last character carrying content, not the length of
  // the string. A document that closes with "\n\n   " would otherwise keep the
  // window alive for those five characters: the passage emitted for each of them is
  // one character shorter than the last, and every one of them goes into the index.
  const contentEnd = snapTrimEnd(source, 0, source.length);

  const chunks: TextChunk[] = [];
  let pos = snapStart(source, 0);

  while (pos < contentEnd) {
    const limit = Math.min(pos + size, contentEnd);
    // The last passage takes everything that is left, boundary or not. Snapping its
    // end back to a sentence does two damaging things at once: the characters after
    // that boundary appear in no passage at all — a hole in an index is invisible,
    // since no query can reveal that a line was never embedded — and the window is
    // never told it has finished, so it re-emits the same tail one character shorter
    // until the offset catches up.
    const end = limit >= contentEnd ? contentEnd : snapEnd(source, pos, limit);
    const trimmedEnd = snapTrimEnd(source, pos, end);

    if (trimmedEnd > pos) {
      chunks.push({ text: source.slice(pos, trimmedEnd), index: chunks.length, start: pos, end: trimmedEnd });
    }

    if (end >= contentEnd) break;

    // Step back inside the passage just emitted, then forward to a word start, so
    // the overlap is whole words rather than a word sawn in half.
    const candidate = Math.max(end - overlap, pos + 1);
    const next = snapStart(source, candidate);
    // Progress must strictly increase or the loop cannot terminate.
    if (next <= pos) break;
    pos = next;
  }

  return chunks;
}

/** Drop trailing whitespace from a passage without moving its end past content. */
function snapTrimEnd(source: string, from: number, to: number): number {
  let at = to;
  while (at > from && /\s/.test(source[at - 1]!)) at -= 1;
  return at;
}
