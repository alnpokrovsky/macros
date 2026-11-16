import type { UnifiedFoodResult } from '../../core/search';

/**
 * Cache entry for search results
 */
interface CacheEntry {
  results: UnifiedFoodResult[];
  page: number;
  hasMore: boolean;
  timestamp: number;
}

/**
 * SearchCacheManager
 * ------------------
 * Manages caching of food search results with TTL and size limits.
 * Used by LiveFoodSearchModal to avoid re-fetching results that haven't changed.
 */
export class SearchCacheManager {
  private resultCache: Map<string, CacheEntry> = new Map();

  /** Results older than this are considered stale and re-fetched. */
  public static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /** Cap the number of cached queries so the cache cannot grow unboundedly. */
  public static readonly MAX_CACHE_ENTRIES = 50;

  /**
   * Generate a cache key from tab, language, data quality, and search term.
   * Including language and data-quality filter makes the cache self-correcting:
   * results filtered under different settings are stored under different keys
   * and never served stale even if settings-change invalidation is missed.
   */
  getCacheKey(
    currentTab: string,
    searchTerm: string,
    openFoodFactsLanguage?: string,
    openFoodFactsDataQualityFilter?: string
  ): string {
    const language = openFoodFactsLanguage ?? 'auto';
    const dataQuality = openFoodFactsDataQualityFilter ?? 'all';
    return `${currentTab}::${language}::${dataQuality}::${searchTerm.toLowerCase()}`;
  }

  /**
   * Store search results in cache.
   */
  storeResults(
    cacheKey: string,
    results: UnifiedFoodResult[],
    page: number,
    hasMore: boolean
  ): void {
    this.evictStaleCacheEntries();
    this.enforceCacheSizeCap();

    this.resultCache.set(cacheKey, {
      results: results.slice(),
      page,
      hasMore,
      timestamp: Date.now(),
    });
  }

  /**
   * Restore results from cache if available and not stale.
   * Returns true if cached results were restored, false otherwise.
   */
  restoreResults(
    cacheKey: string,
    target: {
      setAllResults: (results: UnifiedFoodResult[]) => void;
      setResults: (results: UnifiedFoodResult[]) => void;
      setPage: (page: number) => void;
      setHasMore: (hasMore: boolean) => void;
      setIsBarcodeSearch: (isBarcode: boolean) => void;
    }
  ): boolean {
    const cached = this.resultCache.get(cacheKey);
    if (!cached || cached.results.length === 0) return false;

    // Ignore stale entries so callers re-fetch fresh results.
    if (Date.now() - cached.timestamp > SearchCacheManager.CACHE_TTL_MS) {
      this.resultCache.delete(cacheKey);
      return false;
    }

    target.setAllResults(cached.results.slice());
    target.setResults(cached.results.slice());
    target.setPage(cached.page);
    target.setHasMore(cached.hasMore);
    target.setIsBarcodeSearch(false);

    return true;
  }

  /** Drop cache entries that have exceeded the TTL. */
  evictStaleCacheEntries(): void {
    const now = Date.now();
    for (const [key, entry] of this.resultCache.entries()) {
      if (now - entry.timestamp > SearchCacheManager.CACHE_TTL_MS) {
        this.resultCache.delete(key);
      }
    }
  }

  /** Cap the cache size by removing the oldest entries. */
  enforceCacheSizeCap(): void {
    if (this.resultCache.size < SearchCacheManager.MAX_CACHE_ENTRIES) return;

    const entries = Array.from(this.resultCache.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    );
    const toRemove = entries.slice(0, entries.length - SearchCacheManager.MAX_CACHE_ENTRIES);
    for (const [key] of toRemove) {
      this.resultCache.delete(key);
    }
  }

  /** Clear all cached search results. Called when settings change. */
  clear(): void {
    this.resultCache.clear();
  }
}
