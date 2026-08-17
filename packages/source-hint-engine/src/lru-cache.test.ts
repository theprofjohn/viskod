import { describe, expect, it, vi } from 'vitest';
import { LruCache } from './lru-cache';

describe('LruCache', () => {
  it('stores and retrieves values', () => {
    const cache = new LruCache<string, number>(10);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.size).toBe(1);
  });

  it('evicts least-recently-used entry when full', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // evicts 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('refreshes access order on get', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // refresh 'a' — now 'b' is LRU
    cache.set('c', 3); // evicts 'b'
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('respects TTL expiration', () => {
    vi.useFakeTimers();
    const cache = new LruCache<string, number>(10, 50);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    vi.advanceTimersByTime(60);
    expect(cache.get('a')).toBeUndefined();
    vi.useRealTimers();
  });

  it('clears all entries', () => {
    const cache = new LruCache<string, number>(10);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });

  it('reports correct size', () => {
    const cache = new LruCache<string, number>(10);
    expect(cache.size).toBe(0);
    cache.set('a', 1);
    expect(cache.size).toBe(1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
    cache.delete('a');
    expect(cache.size).toBe(1);
  });

  it('has() returns true for existing keys', () => {
    const cache = new LruCache<string, number>(10);
    cache.set('a', 1);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });

  it('delete() removes entry and returns true', () => {
    const cache = new LruCache<string, number>(10);
    cache.set('a', 1);
    expect(cache.delete('a')).toBe(true);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('delete() returns false for non-existent key', () => {
    const cache = new LruCache<string, number>(10);
    expect(cache.delete('a')).toBe(false);
  });
});
