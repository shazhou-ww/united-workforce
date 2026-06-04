import { describe, it, expect } from 'vitest';
import { mergeRefsWithContentHash, normalizeRefsField } from '../src/refs-field.js';

describe('mergeRefsWithContentHash', () => {
  it('appends a new content hash', () => {
    expect(mergeRefsWithContentHash(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
  });

  it('skips duplicate content hash', () => {
    expect(mergeRefsWithContentHash(['a', 'b'], 'b')).toEqual(['a', 'b']);
  });

  it('preserves order', () => {
    expect(mergeRefsWithContentHash(['x', 'y'], 'z')).toEqual(['x', 'y', 'z']);
  });

  it('handles empty refs', () => {
    expect(mergeRefsWithContentHash([], 'a')).toEqual(['a']);
  });
});

describe('normalizeRefsField', () => {
  it('returns empty array for non-array', () => {
    expect(normalizeRefsField(null)).toEqual([]);
    expect(normalizeRefsField(undefined)).toEqual([]);
    expect(normalizeRefsField(42)).toEqual([]);
  });

  it('passes through string array', () => {
    expect(normalizeRefsField(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('filters non-strings from mixed array', () => {
    expect(normalizeRefsField(['a', 1, 'b', null])).toEqual(['a', 'b']);
  });

  it('handles empty array', () => {
    expect(normalizeRefsField([])).toEqual([]);
  });
});
