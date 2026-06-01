import { describe, it, expect } from 'vitest';
import { slugify, uniqueId } from '../src/util/id.js';

describe('slugify', () => {
  it('slugifies names', () => {
    expect(slugify('Paris Clock')).toBe('paris-clock');
    expect(slugify('Kitchen SmallTV!')).toBe('kitchen-smalltv');
  });
  it('strips accents', () => {
    expect(slugify('Héllo Wörld')).toBe('hello-world');
  });
  it('falls back to "item" for empty/symbol-only names', () => {
    expect(slugify('')).toBe('item');
    expect(slugify('!!!')).toBe('item');
  });
});

describe('uniqueId', () => {
  it('returns the base when free', () => {
    expect(uniqueId('paris-clock', ['other'])).toBe('paris-clock');
  });
  it('appends an incrementing suffix on collision', () => {
    expect(uniqueId('clock', ['clock'])).toBe('clock-2');
    expect(uniqueId('clock', ['clock', 'clock-2'])).toBe('clock-3');
  });
});
