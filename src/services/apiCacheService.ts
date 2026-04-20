/**
 * Professional API Caching System for Gemini AI
 * Optimized for analysis and prediction usage
 * Features:
 * - Intelligent cache key generation
 * - TTL-based expiration
 * - Circular API key rotation (9 keys)
 * - Rate limit handling
 * - Error recovery
 */

import { GoogleGenAI } from "@google/genai";

// Cache configuration
export interface CacheConfig {
  ttl: number; // Time to live in milliseconds
  maxEntries?: number; // Maximum cache entries (for memory safety)
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

// Default cache configuration
const DEFAULT_CACHE_CONFIG: CacheConfig = {
  ttl: 60 * 60 * 1000, // 1 hour for predictions
  maxEntries: 1000,
};

// Analysis-specific cache (longer TTL for stable data)
const ANALYSIS_CACHE_CONFIG: CacheConfig = {
  ttl: 2 * 60 * 60 * 1000, // 2 hours
  maxEntries: 500,
};

// Prediction-specific cache (shorter TTL for real-time accuracy)
const PREDICTION_CACHE_CONFIG: CacheConfig = {
  ttl: 30 * 60 * 1000, // 30 minutes
  maxEntries: 300,
};

class ApiCacheManager {
  private cache: Map<string, CachedResponse<any>>;
  private config: CacheConfig;
  private storageAvailable: boolean;

  constructor(config: CacheConfig = DEFAULT_CACHE_CONFIG) {
    this.cache = new Map();
    this.config = config;
    this.storageAvailable = typeof localStorage !== 'undefined';
    
    // Load from localStorage if available
    if (this.storageAvailable) {
      this.loadFromStorage();
    }

    // Periodic cleanup
    setInterval(() => this.cleanup(), 5 * 60 * 1000); // Every 5 minutes
  }

  /**
   * Generate intelligent cache key based on request type and parameters
   */
  generateKey(prefix: string, params: any): string {
    const normalizedParams = JSON.stringify(params, Object.keys(params).sort());
    const hash = this.simpleHash(normalizedParams);
    return `${prefix}_${hash}`;
  }

  /**
   * Simple hash function for cache keys
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Get cached response if valid
   */
  get<T>(key: string): CachedResponse<T> | null {
    const cached = this.cache.get(key);
    
    if (!cached) {
      return null;
    }

    // Check expiration
    if (Date.now() > cached.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return cached as CachedResponse<T>;
  }

  /**
   * Set cache entry
   */
  set<T>(key: string, data: T, metadata?: CachedResponse<T>['metadata'], customTtl?: number): void {
    const ttl = customTtl || this.config.ttl;
    const now = Date.now();
    
    const entry: CachedResponse<T> = {
      data,
      timestamp: now,
      expiresAt: now + ttl,
      key,
      metadata,
    };

    // Enforce max entries
    if (this.config.maxEntries && this.cache.size >= this.config.maxEntries) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, entry);
    
    // Persist to localStorage if available
    if (this.storageAvailable) {
      this.saveToStorage();
    }
  }

  /**
   * Invalidate cache entries matching pattern
   */
  invalidate(pattern: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(pattern)) {
        this.cache.delete(key);
      }
    }
    
    if (this.storageAvailable) {
      this.saveToStorage();
    }
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
    if (this.storageAvailable) {
      localStorage.removeItem('gemini_api_cache');
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; hits: number; misses: number } {
    return {
      size: this.cache.size,
      hits: 0, // Would need tracking
      misses: 0,
    };
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
    
    if (this.storageAvailable) {
      this.saveToStorage();
    }
  }

  /**
   * Save cache to localStorage
   */
  private saveToStorage(): void {
    try {
      const serializable = Array.from(this.cache.entries()).map(([key, entry]) => ({
        key,
        ...entry,
      }));
      localStorage.setItem('gemini_api_cache', JSON.stringify(serializable));
    } catch (error) {
      console.warn('Failed to save cache to localStorage:', error);
    }
  }

  /**
   * Load cache from localStorage
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem('gemini_api_cache');
      if (stored) {
        const parsed = JSON.parse(stored);
        const now = Date.now();
        
        for (const item of parsed) {
          // Only load non-expired entries
          if (item.expiresAt && now <= item.expiresAt) {
            this.cache.set(item.key, item);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load cache from localStorage:', error);
    }
  }
}

/**
 * Circular API Key Manager
 * Rotates through analysis keys (GEMINI_API_KEY + GEMINI_API_KEY_1..7)
 * to distribute load and avoid rate limits.
 */
class ApiKeyManager {
  private keys: string[] = [];
  private currentIndex = 0;
  private keyHealth: Map<number, { failures: number; lastFailure: number; cooldownUntil: number }> = new Map();
  
  constructor() {
    this.initializeKeys();
  }

  /**
   * Initialize analysis API keys from environment variables.
   */
  private initializeKeys(): void {
    // Analysis / football workloads (primary heavy-token usage pool)
    const potentialKeys = [
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_1,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3,
      process.env.GEMINI_API_KEY_4,
      process.env.GEMINI_API_KEY_5,
      process.env.GEMINI_API_KEY_6,
      process.env.GEMINI_API_KEY_7,
    ].filter(Boolean) as string[];

    // Deduplicate while preserving order
    const uniqueKeys = [...new Set(potentialKeys)];
    this.keys = uniqueKeys.slice(0, 8); // GEMINI_API_KEY + _1.._7
    
    // Initialize health tracking for each key
    this.keys.forEach((_, index) => {
      this.keyHealth.set(index, {
        failures: 0,
        lastFailure: 0,
        cooldownUntil: 0,
      });
    });

    console.log(`✅ Initialized ${this.keys.length} analysis Gemini API keys for circular rotation`);
  }

  /**
   * Get next healthy API key using circular rotation
   */
  getNextKey(): { key: string; index: number } | null {
    if (this.keys.length === 0) {
      console.error('❌ No API keys configured');
      return null;
    }

    const now = Date.now();
    let attempts = 0;
    const maxAttempts = this.keys.length;

    while (attempts < maxAttempts) {
      const index = this.currentIndex;
      this.currentIndex = (this.currentIndex + 1) % this.keys.length;
      
      const health = this.keyHealth.get(index);
      
      // Skip keys in cooldown
      if (health && now < health.cooldownUntil) {
        attempts++;
        continue;
      }

      return {
        key: this.keys[index],
        index,
      };
    }

    // All keys in cooldown, return least recently failed
    let bestIndex = 0;
    let minCooldown = Infinity;
    
    for (let i = 0; i < this.keys.length; i++) {
      const health = this.keyHealth.get(i);
      if (health && health.cooldownUntil < minCooldown) {
        minCooldown = health.cooldownUntil;
        bestIndex = i;
      }
    }

    return {
      key: this.keys[bestIndex],
      index: bestIndex,
    };
  }

  /**
   * Report successful API call
   */
  reportSuccess(index: number): void {
    const health = this.keyHealth.get(index);
    if (health) {
      // Reduce failure count on success
      health.failures = Math.max(0, health.failures - 1);
      health.lastFailure = 0;
    }
  }

  /**
   * Report failed API call
   */
  reportFailure(index: number, isRateLimit: boolean): void {
    const health = this.keyHealth.get(index);
    if (health) {
      health.failures += 1;
      health.lastFailure = Date.now();
      
      // Set cooldown based on failure type and count
      const baseCooldown = isRateLimit ? 60 * 1000 : 10 * 1000; // 1min for rate limit, 10s for other errors
      const exponentialCooldown = baseCooldown * Math.pow(2, Math.min(health.failures - 1, 5));
      health.cooldownUntil = Date.now() + Math.min(exponentialCooldown, 5 * 60 * 1000); // Max 5 min cooldown
      
      console.warn(`⚠️ API key ${index + 1} marked unhealthy. Failures: ${health.failures}, Cooldown until: ${new Date(health.cooldownUntil).toISOString()}`);
    }
  }

  /**
   * Get key statistics
   */
  getStats(): { total: number; healthy: number; inCooldown: number } {
    const now = Date.now();
    return {
      total: this.keys.length,
      healthy: this.keys.filter((_, i) => {
        const h = this.keyHealth.get(i);
        return h && now >= h.cooldownUntil && h.failures < 3;
      }).length,
      inCooldown: this.keys.filter((_, i) => {
        const h = this.keyHealth.get(i);
        return h && now < h.cooldownUntil;
      }).length,
    };
  }
}

// Singleton instances
const globalCache = new ApiCacheManager(DEFAULT_CACHE_CONFIG);
const analysisCache = new ApiCacheManager(ANALYSIS_CACHE_CONFIG);
const predictionCache = new ApiCacheManager(PREDICTION_CACHE_CONFIG);
const apiKeyManager = new ApiKeyManager();
const inFlightRequests = new Map<string, Promise<any>>();

// Export singleton instances
export { globalCache, analysisCache, predictionCache, apiKeyManager };

/**
 * Helper function to check if error is retryable
 */
export function isRetryableGeminiError(error: any): boolean {
  const msg = String(error?.message || "").toLowerCase();
  const status = error?.status;
  
  return Boolean(
    status === 429 ||
    status === 500 ||
    status === 503 ||
    msg.includes("resource_exhausted") ||
    msg.includes("quota") ||
    msg.includes("rate") ||
    msg.includes("unavailable") ||
    msg.includes("overloaded") ||
    msg.includes("429")
  );
}

function extractErrorMessage(error: any): string {
  if (!error) return "Unknown error";
  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message;
  }
  if (typeof error?.error?.message === "string" && error.error.message.trim()) {
    return error.error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Execute API call with automatic retry and key rotation
 */
export async function executeWithRetry<T>(
  operation: (apiKey: string, index: number) => Promise<T>,
  options: {
    maxRetries?: number;
    cache?: ApiCacheManager;
    cacheKey?: string;
    customTtl?: number;
    metadata?: any;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    cache,
    cacheKey,
    customTtl,
    metadata,
  } = options;

  const inFlightKey = cacheKey ? `retry:${cacheKey}` : null;

  // Check cache first
  if (cache && cacheKey) {
    const cached = cache.get<T>(cacheKey);
    if (cached) {
      console.log(`✅ Cache hit for key: ${cacheKey}`);
      return cached.data;
    }
  }

  // De-duplicate concurrent identical requests to save API quota.
  if (inFlightKey && inFlightRequests.has(inFlightKey)) {
    return inFlightRequests.get(inFlightKey) as Promise<T>;
  }

  const runner = (async () => {
    let lastError: any = null;
    let attempt = 0;

    while (attempt < maxRetries) {
      const keyInfo = apiKeyManager.getNextKey();
      
      if (!keyInfo) {
        throw new Error('No API keys available');
      }

      try {
        const result = await operation(keyInfo.key, keyInfo.index);
        
        // Report success
        apiKeyManager.reportSuccess(keyInfo.index);
        
        // Cache result if cache provided
        if (cache && cacheKey) {
          cache.set(cacheKey, result, {
            ...metadata,
            apiKeyIndex: keyInfo.index,
          }, customTtl);
        }
        
        return result;
      } catch (error: any) {
        lastError = error;
        attempt++;
        
        const isRateLimit = isRetryableGeminiError(error);
        
        // Report failure
        apiKeyManager.reportFailure(keyInfo.index, isRateLimit);
        
        if (isRateLimit && attempt < maxRetries) {
          console.log(`🔄 Rate limit hit, rotating to next key (attempt ${attempt}/${maxRetries})`);
          continue;
        }
        
        if (!isRetryableGeminiError(error)) {
          console.error('❌ Non-retryable error:', error.message);
          throw error;
        }
        
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error(`All retries failed. Last error: ${extractErrorMessage(lastError)}`);
  })();

  if (inFlightKey) {
    inFlightRequests.set(inFlightKey, runner);
    runner.finally(() => inFlightRequests.delete(inFlightKey));
  }

  return runner;
}

/**
 * Create a Gemini client with the next available API key
 */
export function createGeminiClient(): { ai: GoogleGenAI; index: number } | null {
  const keyInfo = apiKeyManager.getNextKey();
  
  if (!keyInfo) {
    return null;
  }

  return {
    ai: new GoogleGenAI({ apiKey: keyInfo.key }),
    index: keyInfo.index,
  };
}

export default ApiCacheManager;
