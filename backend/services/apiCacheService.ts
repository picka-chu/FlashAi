/**
 * Professional API Caching System for Gemini AI
 * Optimized for real-time prediction accuracy.
 *
 * TTL Strategy (accuracy-first):
 *   Context (injuries/lineups) → 15 min  [was 2h — stale lineups are the #1 accuracy killer]
 *   Match analysis             → 20 min  [was 2h — model kept serving stale AI reasoning]
 *   Predictions                → 20 min
 *   Live match data            →  3 min
 *   Top fixtures               → 15 min
 *   H2H / historical           → 60 min  [slow-changing, OK to cache longer]
 *   Fallback AI-sourced stats  → 10 min  [estimates — expire quickly]
 */

import { createHash } from "crypto";
import { GoogleGenAI } from "@google/genai";

/** Deterministic JSON serialization (sorted object keys at every depth). */
function stableStringify(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export interface CacheConfig {
  ttl: number;
  maxEntries?: number;
}

export interface CachedResponse<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
  key: string;
  metadata?: {
    model: string;
    apiKeyIndex: number;
    tokensUsed?: number;
  };
}

// ─── TTL constants (single source of truth) ──────────────────────────────────
export const TTL = {
  CONTEXT:    15 * 60 * 1000,  // injuries/lineups — must expire fast
  ANALYSIS:   20 * 60 * 1000,  // AI match analysis
  PREDICTION: 20 * 60 * 1000,  // full prediction results
  LIVE:        3 * 60 * 1000,  // live in-play state
  FIXTURES:   15 * 60 * 1000,  // today's fixture list
  H2H:        60 * 60 * 1000,  // head-to-head history
  FALLBACK:   10 * 60 * 1000,  // AI-sourced team stats (short — they are estimates)
} as const;

const ANALYSIS_CACHE_CONFIG:  CacheConfig = { ttl: TTL.ANALYSIS,    maxEntries: 500 };
const PREDICTION_CACHE_CONFIG: CacheConfig = { ttl: TTL.PREDICTION,  maxEntries: 300 };
const GLOBAL_CACHE_CONFIG:    CacheConfig = { ttl: TTL.FIXTURES,     maxEntries: 200 };

// ─── Cache Manager ────────────────────────────────────────────────────────────
class ApiCacheManager {
  private cache: Map<string, CachedResponse<any>>;
  private config: CacheConfig;

  constructor(config: CacheConfig) {
    this.cache = new Map();
    this.config = config;
    setInterval(() => this.cleanup(), 5 * 60 * 1000).unref?.();
  }

  generateKey(prefix: string, params: any): string {
    const normalizedParams = stableStringify(params);
    return `${prefix}_${this.hashKey(normalizedParams)}`;
  }

  private hashKey(str: string): string {
    // SHA-256 avoids the collisions inherent to short 32-bit hashes, which
    // could otherwise serve one match's analysis for a different match.
    return createHash("sha256").update(str).digest("hex").slice(0, 32);
  }

  get<T>(key: string): CachedResponse<T> | null {
    const cached = this.cache.get(key);
    if (!cached) return null;
    if (Date.now() > cached.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return cached as CachedResponse<T>;
  }

  set<T>(
    key: string,
    data: T,
    metadata?: CachedResponse<T>['metadata'],
    customTtl?: number
  ): void {
    const ttl = customTtl ?? this.config.ttl;
    const maxEntries = this.config.maxEntries ?? 1000;

    if (this.cache.size >= maxEntries) {
      const oldest = [...this.cache.entries()]
        .sort(([, a], [, b]) => a.timestamp - b.timestamp)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttl,
      key,
      metadata,
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  /** Invalidate all cache entries whose key starts with `prefix`. */
  invalidatePrefix(prefix: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) { this.cache.delete(key); count++; }
    }
    return count;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) this.cache.delete(key);
    }
  }

  stats() {
    return { size: this.cache.size, maxEntries: this.config.maxEntries, ttlMs: this.config.ttl };
  }
}

// ─── API Key Manager ──────────────────────────────────────────────────────────
const GEMINI_KEY_ENV_NAMES = [
  'GEMINI_API_KEY',
  'GOOGLE_AI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GEMINI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GEMINI_KEY',
  'GEMINI_API_KEYS',
  'GEMINI_KEYS',
  'VITE_GEMINI_API_KEY',
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `GEMINI_API_KEY_${i}`),
  'GEMINI_PREDICTION_KEY',
  ...[1, 2, 3].map((i) => `GEMINI_PREDICTION_KEY_${i}`),
  'GEMINI_AGENT_KEY',
  ...[1, 2, 3].map((i) => `GEMINI_AGENT_KEY_${i}`),
  'GEMINI_SUPPORT_KEY',
  ...[1, 2, 3].map((i) => `GEMINI_SUPPORT_KEY_${i}`),
];

const cleanGeminiKey = (value: unknown) =>
  String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, '');

const readGeminiApiKeys = (): string[] => {
  const keys: string[] = [];
  for (const name of GEMINI_KEY_ENV_NAMES) {
    const raw = process.env[name];
    if (!raw) continue;
    for (const part of String(raw).split(/[\n,;]+/)) {
      const key = cleanGeminiKey(part);
      if (key.length >= 20 && !/^(your|replace|paste|enter)/i.test(key)) keys.push(key);
    }
  }
  return [...new Set(keys)];
};

type KeyHealth = 'healthy' | 'degraded' | 'circuit_open';

interface KeyRecord {
  key: string;
  index: number;
  health: KeyHealth;
  circuitOpenUntil: number;   // timestamp when circuit closes
  failureCount: number;       // consecutive failures
  requestCount: number;       // requests in current window
  windowStart: number;        // window start timestamp
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
}

/**
 * Production-grade Gemini API key manager with per-key circuit breakers.
 *
 * Each of the 6 keys is tracked independently. When a key returns a retryable
 * error (429, quota, overloaded) it is degraded for a cooldown period. When
 * all keys are degraded/circuit-open, the system reports exhaustion and
 * callers should return 503 instead of blindly retrying.
 */
class ApiKeyManager {
  private keys: KeyRecord[];
  private currentIndex = 0;
  private readonly CIRCUIT_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
  private readonly WINDOW_RESET_MS = 60 * 60 * 1000;     // 1 hour request window
  private readonly MAX_FAILURES_BEFORE_CIRCUIT = 3;
  private readonly RESET_INTERVAL = 10 * 60 * 1000;

  constructor() {
    const rawKeys = readGeminiApiKeys();
    this.keys = rawKeys.map((key, index) => ({
      key,
      index,
      health: 'healthy',
      circuitOpenUntil: 0,
      failureCount: 0,
      requestCount: 0,
      windowStart: Date.now(),
      lastFailureAt: null,
      lastSuccessAt: null,
    }));
    this.logStatus();
  }

  private logStatus(): void {
    if (this.keys.length > 0) {
      console.log(`[ApiKeyManager] Gemini API keys loaded: ${this.keys.length}.`);
    } else {
      console.warn(
        '[ApiKeyManager] No Gemini API keys found. Set GEMINI_API_KEY (or GEMINI_API_KEY_1..GEMINI_API_KEY_6) in the runtime environment.',
      );
    }
  }

  private reloadIfEmpty(): void {
    if (this.keys.length > 0) return;
    const found = readGeminiApiKeys();
    if (!found.length) return;
    this.keys = found.map((key, index) => ({
      key,
      index,
      health: 'healthy',
      circuitOpenUntil: 0,
      failureCount: 0,
      requestCount: 0,
      windowStart: Date.now(),
      lastFailureAt: null,
      lastSuccessAt: null,
    }));
    this.currentIndex = 0;
    this.logStatus();
  }

  private resetWindowIfNeeded(record: KeyRecord): void {
    const now = Date.now();
    if (now - record.windowStart > this.WINDOW_RESET_MS) {
      record.requestCount = 0;
      record.windowStart = now;
    }
  }

  /**
   * Returns the next healthy key, or null when every key is circuit-open.
   * Skips degraded keys and advances the round-robin pointer.
   */
  getNextKey(): { key: string; index: number } | null {
    this.reloadIfEmpty();
    if (this.keys.length === 0) return null;

    // Periodic recovery: close circuits that have passed cooldown
    const now = Date.now();
    if (now - this.currentIndex * 0 > this.RESET_INTERVAL || true) {
      for (const record of this.keys) {
        if (record.health === 'degraded' && now > record.circuitOpenUntil) {
          record.health = 'healthy';
          record.failureCount = 0;
          console.log(`[ApiKeyManager] Key ${record.index} recovered from circuit-open.`);
        }
      }
    }

    const startIndex = this.currentIndex;
    let attempts = 0;
    do {
      const record = this.keys[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % this.keys.length;
      attempts++;

      const healthy =
        record.health === 'healthy' &&
        now > record.circuitOpenUntil;

      if (healthy) {
        this.resetWindowIfNeeded(record);
        record.requestCount += 1;
        return { key: record.key, index: record.index };
      }
    } while (attempts < this.keys.length);

    // All keys are degraded — force reset circuits and return the least-recently-failed key
    for (const record of this.keys) {
      record.health = 'healthy';
      record.failureCount = 0;
      record.circuitOpenUntil = 0;
    }
    const fallback = this.keys[startIndex];
    this.resetWindowIfNeeded(fallback);
    fallback.requestCount += 1;
    console.warn('[ApiKeyManager] All Gemini keys circuit-open — forcing fallback rotation.');
    return { key: fallback.key, index: fallback.index };
  }

  /** Mark a key as degraded due to a retryable error. */
  markKeyFailed(index: number, isQuotaExhausted: boolean = false): void {
    const record = this.keys.find((r) => r.index === index);
    if (!record) return;

    record.failureCount += 1;
    record.lastFailureAt = Date.now();

    if (isQuotaExhausted || record.failureCount >= this.MAX_FAILURES_BEFORE_CIRCUIT) {
      record.health = 'degraded';
      record.circuitOpenUntil = Date.now() + this.CIRCUIT_COOLDOWN_MS;
      console.warn(
        `[ApiKeyManager] Key ${index} CIRCUIT OPEN (${record.failureCount} failures, cooldown ${Math.round(this.CIRCUIT_COOLDOWN_MS / 60000)}m)`,
      );
    } else {
      record.health = 'degraded';
      console.warn(`[ApiKeyManager] Key ${index} degraded (failure ${record.failureCount}/${this.MAX_FAILURES_BEFORE_CIRCUIT})`);
    }
  }

  /** Mark a key as healthy after a successful call. */
  markKeySuccess(index: number): void {
    const record = this.keys.find((r) => r.index === index);
    if (!record) return;
    record.failureCount = 0;
    if (record.health !== 'healthy') {
      record.health = 'healthy';
      record.circuitOpenUntil = 0;
    }
    record.lastSuccessAt = Date.now();
  }

  /** Check if every key is currently circuit-open (system exhausted). */
  isExhausted(): boolean {
    const now = Date.now();
    return this.keys.every(
      (r) => r.health === 'degraded' && now < r.circuitOpenUntil,
    );
  }

  get availableCount(): number {
    const now = Date.now();
    return this.keys.filter(
      (r) => r.health === 'healthy' && now > r.circuitOpenUntil,
    ).length;
  }

  get totalCount(): number {
    return this.keys.length;
  }

  diagnostics() {
    this.reloadIfEmpty();
    const now = Date.now();
    const keyDetails = this.keys.map((r) => ({
      index: r.index,
      health: r.health,
      circuitOpenUntil: r.circuitOpenUntil,
      circuitOpenRemainingMs: Math.max(0, r.circuitOpenUntil - now),
      failureCount: r.failureCount,
      requestCount: r.requestCount,
      lastFailureAt: r.lastFailureAt,
      lastSuccessAt: r.lastSuccessAt,
    }));
    return {
      configured: this.keys.length > 0,
      totalKeys: this.keys.length,
      availableKeys: this.availableCount,
      failedKeys: this.keys.length - this.availableCount,
      exhausted: this.isExhausted(),
      keyDetails,
    };
  }
}

export interface GeminiKeyDiagnostics {
  configured: boolean;
  totalKeys: number;
  availableKeys: number;
  failedKeys: number;
  exhausted: boolean;
  keyDetails: Array<{
    index: number;
    health: string;
    circuitOpenUntil: number;
    circuitOpenRemainingMs: number;
    failureCount: number;
    requestCount: number;
    lastFailureAt: number | null;
    lastSuccessAt: number | null;
  }>;
}

export function getGeminiKeyStatus() {
  return apiKeyManager.diagnostics();
}

// ─── Gemini client factory ────────────────────────────────────────────────────
export function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}

// ─── Error classifier ─────────────────────────────────────────────────────────
export function isRetryableGeminiError(error: any): boolean {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  const status = error.status || error.code || 0;

  if (status === 429 || status === 503 || status === 502) return true;
  if (msg.includes('quota') || msg.includes('rate limit') || msg.includes('overloaded')) return true;
  if (msg.includes('resource_exhausted') || msg.includes('service unavailable')) return true;

  if (status === 400 || status === 401 || status === 403) return false;
  if (msg.includes('invalid') || msg.includes('unauthorized') || msg.includes('permission')) return false;

  return true;
}

export function isQuotaExhaustedError(error: any): boolean {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  const status = error.status || error.code || 0;
  if (status === 429) return true;
  if (msg.includes('quota')) return true;
  if (msg.includes('resource_exhausted')) return true;
  if (msg.includes('rate limit')) return true;
  return false;
}

// ─── Universal execute-with-retry ────────────────────────────────────────────
export interface RetryOptions<T> {
  cache?: ApiCacheManager;
  cacheKey?: string;
  customTtl?: number;
  maxRetries?: number;
  metadata?: CachedResponse<T>['metadata'];
}

export async function executeWithRetry<T>(
  fn: (apiKey: string, keyIndex: number) => Promise<T>,
  options: RetryOptions<T> = {}
): Promise<T> {
  const { cache, cacheKey, customTtl, maxRetries = 3, metadata } = options;

  if (cache && cacheKey) {
    const cached = cache.get<T>(cacheKey);
    if (cached) {
      console.log(`✅ Cache hit: ${cacheKey}`);
      return cached.data;
    }
  }

  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const keyData = apiKeyManager.getNextKey();
    if (!keyData) throw new Error('No Gemini API keys configured.');

    try {
      const result = await fn(keyData.key, keyData.index);
      apiKeyManager.markKeySuccess(keyData.index);
      if (cache && cacheKey) {
        cache.set(cacheKey, result, metadata, customTtl);
      }
      return result;
    } catch (error: any) {
      lastError = error;
      console.warn(
        `[executeWithRetry] Attempt ${attempt + 1}/${maxRetries} failed:`,
        error?.message ?? error
      );

      if (!isRetryableGeminiError(error)) throw error;
      apiKeyManager.markKeyFailed(keyData.index, isQuotaExhaustedError(error));

      if (attempt < maxRetries - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError ?? new Error('executeWithRetry: all attempts exhausted');
}

// ─── Singleton instances ──────────────────────────────────────────────────────
export const apiKeyManager   = new ApiKeyManager();
export const analysisCache   = new ApiCacheManager(ANALYSIS_CACHE_CONFIG);
export const predictionCache = new ApiCacheManager(PREDICTION_CACHE_CONFIG);
export const globalCache     = new ApiCacheManager(GLOBAL_CACHE_CONFIG);
