import { App, Modal, Notice, Component, setIcon } from 'obsidian';
import type { PluginSettings } from '../../settings/StorageService';
import type { UnifiedFoodResult } from '../../core/search';
import {
  searchAllSources,
  searchFoundationFoodsOnly,
  searchOpenFoodFactsUnified,
} from '../../core/search';
import { searchByBarcode, validateBarcodeChecksum } from '../../core/barcodeSearch';
import { searchFoods } from '../../core/usda';
import { BarcodeScannerModal } from '../../utils/BarcodeScanner';
import MacrosPlugin from '../../main';
import { t } from '../../lang/I18nManager';
import {
  buildFuseIndex,
  fuseSearch,
  unifiedResultToFoodDoc,
  generateSearchVariants,
  FoodDoc,
} from '../../core/fuseSearch';
import { SearchCacheManager } from './SearchCacheManager';
import { SearchTabManager } from './SearchTabManager';
import { FoodFileSaver } from './FoodFileSaver';
import { SearchRenderer } from './SearchRenderer';

type SearchTab =
  | 'all'
  | 'fatsecret'
  | 'usda-branded'
  | 'usda-foundation'
  | 'usda-legacy'
  | 'openfoodfacts';

/**
 * LiveFoodSearchModal
 * -------------------
 * Live food search modal with support for multiple food databases
 * (FatSecret, USDA, Open Food Facts), barcode scanning, and fuzzy search.
 *
 * Responsibilities:
 * - UI layout and event handling
 * - Search orchestration (debounce, abort, pagination)
 * - Coordinating sub-modules: cache, tabs, renderer, file saver
 *
 * Extracted modules:
 * - SearchCacheManager: result caching with TTL/size limits
 * - SearchTabManager: tab availability and state
 * - FoodFileSaver: saving food results as markdown files
 * - SearchRenderer: rendering result items with micronutrient chips
 */
export class LiveFoodSearchModal extends Modal {
  private searchInput!: HTMLInputElement;
  private searchContainer!: HTMLElement;
  private barcodeButton!: HTMLElement;
  private resultsContainer!: HTMLElement;
  private loadingIndicator!: HTMLElement;
  private noResultsMessage!: HTMLElement;
  private errorMessage!: HTMLElement;
  private errorTextEl!: HTMLSpanElement;
  private errorRetryButton?: HTMLElement;
  private lastSearchTerm: string = '';
  private searchTimeout: number | null = null;
  private maxResults = 50;
  private searchDebounceMs = 300;
  private results: UnifiedFoodResult[] = [];
  private allResults: UnifiedFoodResult[] = [];
  private selectedIndex = -1;
  private isSearching = false;
  private currentPage = 0;
  private hasMoreResults = true;
  private isLoadingMore = false;
  private currentSearchTerm = '';
  private scrollHandler?: (event: Event) => void;
  private currentSearchAbortController: AbortController | null = null;
  private isBarcodeSearch = false;

  // Sub-modules
  private cacheManager: SearchCacheManager;
  private tabManager: SearchTabManager;
  private fileSaver: FoodFileSaver;
  private renderer!: SearchRenderer;

  private component: Component;

  constructor(
    public app: App,
    public apiKey: string,
    public apiSecret: string,
    public onSelect: (item: UnifiedFoodResult) => void,
    private plugin?: MacrosPlugin
  ) {
    super(app);
    this.component = new Component();

    // Initialize sub-modules
    this.cacheManager = new SearchCacheManager();
    this.tabManager = new SearchTabManager(plugin);
    this.fileSaver = new FoodFileSaver(app, plugin);

    // Register with the plugin so Open Food Facts settings changes can
    // invalidate this modal's result cache.
    if (this.plugin) {
      this.plugin.registerSearchModal(this);
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('live-food-search-modal');
    contentEl.createEl('h2', { text: t('food.search.title'), cls: 'mod-header' });

    this.createTabs();
    this.createSearchBarWithBarcode();
    this.createLoadingIndicator();
    this.createErrorMessage();
    this.createNoResultsMessage();
    this.createResultsContainer();

    // Auto-focus search input
    window.setTimeout(() => {
      this.searchInput.focus();
    }, 50);

    this.component.registerDomEvent(this.searchInput, 'input', this.handleSearchInput);
    this.component.registerDomEvent(this.searchInput, 'keydown', this.handleKeyboardNavigation);
  }

  onClose(): void {
    // Clean up search timeout
    if (this.searchTimeout) {
      window.clearTimeout(this.searchTimeout);
      this.searchTimeout = null;
    }

    // Cancel any ongoing search
    if (this.currentSearchAbortController) {
      this.currentSearchAbortController.abort();
      this.currentSearchAbortController = null;
    }

    // Clean up scroll handler
    if (this.scrollHandler && this.resultsContainer) {
      this.resultsContainer.removeEventListener('scroll', this.scrollHandler);
      this.scrollHandler = undefined;
    }

    // Component cleanup handles all registered DOM events
    this.component.unload();
    this.contentEl.empty();

    // Unregister from the plugin
    if (this.plugin) {
      this.plugin.unregisterSearchModal(this);
    }
  }

  /**
   * Clear cached search results. Called when settings change.
   */
  public clearSearchCache(): void {
    this.cacheManager.clear();
    this.isBarcodeSearch = false;
    this.currentSearchTerm = '';
  }

  private createTabs(): void {
    if (!this.tabManager.hasMultipleTabs()) return;

    this.searchContainer
      .createDiv({
        cls: 'search-tabs-container macros-search-tabs',
      })
      .replaceWith(this.contentEl.createDiv({ cls: 'search-tabs-container macros-search-tabs' }));

    const tabsContainer = this.contentEl.querySelector('.search-tabs-container');

    this.tabManager.getTabs().forEach((tabKey) => {
      const tabElement = tabsContainer.createEl('button', {
        cls: `search-tab macros-search-tab ${tabKey === this.tabManager.getCurrentTab() ? 'active' : ''}`,
        text: this.getTabLabel(tabKey),
      });

      this.component.registerDomEvent(tabElement, 'click', () => {
        this.switchTab(tabKey);
      });

      this.component.registerDomEvent(tabElement, 'mousedown', (e: MouseEvent) => {
        e.preventDefault();
      });
    });
  }

  private getTabLabel(tab: SearchTab): string {
    switch (tab) {
      case 'all':
        return t('food.search.tabs.all');
      case 'fatsecret':
        return 'FatSecret';
      case 'usda-branded':
        return 'USDA | Branded';
      case 'usda-foundation':
        return 'USDA | Foundation';
      case 'usda-legacy':
        return 'USDA | Legacy';
      case 'openfoodfacts':
        return 'Open Food Facts';
      default:
        return tab;
    }
  }

  private switchTab(tab: SearchTab): void {
    if (tab === this.tabManager.getCurrentTab()) return;

    this.tabManager.setTab(tab);
    this.hideError();

    // Update tab visual states
    this.contentEl.querySelectorAll('.search-tab').forEach((el) => {
      el.classList.toggle('active', el.textContent === this.getTabLabel(tab));
    });

    const currentQuery = this.searchInput.value.trim();
    if (currentQuery) {
      if (this.currentSearchAbortController) {
        this.currentSearchAbortController.abort();
        this.currentSearchAbortController = null;
      }

      const wasBarcodeSearch = this.isBarcodeSearch;

      const cacheKey = this.cacheManager.getCacheKey(
        tab,
        currentQuery,
        this.plugin?.settings.openFoodFactsLanguage,
        this.plugin?.settings.openFoodFactsDataQualityFilter
      );

      const hadCachedResults = this.cacheManager.restoreResults(cacheKey, {
        setAllResults: (r) => (this.allResults = r),
        setResults: (r) => (this.results = r),
        setPage: (p) => (this.currentPage = p),
        setHasMore: (h) => (this.hasMoreResults = h),
        setIsBarcodeSearch: () => (this.isBarcodeSearch = false),
      });

      if (!hadCachedResults) {
        this.results = [];
        this.allResults = [];
        this.loadingIndicator.classList.remove('is-hidden');
        this.noResultsMessage.classList.add('is-hidden');
      }

      if (wasBarcodeSearch) {
        void this.performBarcodeSearch(currentQuery);
      } else {
        void this.performSearch(currentQuery);
      }
    }

    window.setTimeout(() => {
      this.searchInput.focus();
    }, 10);
  }

  private hideError(): void {
    if (!this.errorMessage) return;
    this.errorMessage.classList.add('is-hidden');
  }

  private showError(message: string): void {
    if (!this.errorMessage || !this.errorTextEl) return;
    this.errorTextEl.textContent = message;
    this.errorMessage.classList.remove('is-hidden');
    if (this.errorRetryButton) {
      this.errorRetryButton.removeClass('is-hidden');
    }
    this.loadingIndicator.classList.add('is-hidden');
    this.noResultsMessage.classList.add('is-hidden');
    this.resultsContainer.empty();
  }

  private createSearchBarWithBarcode(): void {
    this.searchContainer = this.contentEl.createDiv({
      cls: 'search-container macros-search-container with-barcode',
    });

    this.searchInput = this.searchContainer.createEl('input', {
      type: 'text',
      placeholder: t('food.search.placeholder'),
      cls: 'live-search-input',
    });

    this.barcodeButton = this.searchContainer.createEl('button', {
      cls: 'barcode-scanner-button',
      attr: { 'aria-label': 'Scan barcode' },
    });

    setIcon(this.barcodeButton, 'barcode');

    this.component.registerDomEvent(this.barcodeButton, 'click', () => {
      this.openBarcodeScanner();
    });
  }

  private openBarcodeScanner(): void {
    if (!this.plugin) {
      new Notice('Plugin context not available for barcode scanning');
      return;
    }

    const scannerModal = new BarcodeScannerModal(
      this.app,
      this.plugin,
      (barcode: string) => void this.handleBarcodeScanned(barcode)
    );

    scannerModal.open();
  }

  async handleBarcodeScanned(barcode: string): Promise<void> {
    if (!validateBarcodeChecksum(barcode)) {
      new Notice(t('barcode.manual.checksumWarning', { code: barcode }));
    }

    this.searchInput.value = barcode;
    this.isBarcodeSearch = true;

    await this.performBarcodeSearch(barcode);

    window.setTimeout(() => {
      this.searchInput.focus();
      this.searchInput.select();
    }, 100);
  }

  private async performBarcodeSearch(barcode: string): Promise<void> {
    if (!this.plugin) {
      new Notice('Plugin context not available for barcode search');
      return;
    }

    this.lastSearchTerm = barcode;

    this.hideError();
    this.loadingIndicator.classList.remove('is-hidden');
    this.noResultsMessage.classList.add('is-hidden');
    this.isSearching = true;

    this.resultsContainer.empty();
    this.results = [];
    this.allResults = [];

    try {
      const settings = this.plugin.settings;

      const sources = {
        openFoodFacts: { enabled: settings.openFoodFactsEnabled !== false },
        usda:
          settings.usdaEnabled && settings.usdaApiKey
            ? { enabled: true, apiKey: settings.usdaApiKey }
            : undefined,
      };

      const userLocale = this.plugin.i18nManager?.getCurrentLocale() || 'en';

      const barcodeResults = await searchByBarcode(this.app, barcode, sources, userLocale);

      this.allResults = barcodeResults;
      this.results = barcodeResults;
      this.hasMoreResults = false;
      this.currentSearchTerm = barcode;

      this.loadingIndicator.classList.add('is-hidden');

      if (barcodeResults.length > 0) {
        const foodDocs: FoodDoc[] = barcodeResults.map(unifiedResultToFoodDoc);
        buildFuseIndex(this.tabManager.getCurrentTab(), foodDocs);

        this.renderer.renderResults(
          barcode,
          this.results,
          this.isBarcodeSearch,
          this.selectedIndex,
          (food) => void this.handleFoodSelection(food),
          (index) => {
            this.selectedIndex = index;
            this.renderer.highlightSelectedResult(index, () => {});
            this.renderer.scrollSelectedIntoView(index);
          }
        );
        new Notice(
          t('barcode.scanner.foundResults', {
            count: barcodeResults.length,
            code: barcode,
          })
        );
      } else {
        this.noResultsMessage.textContent = t('barcode.scanner.noResults', {
          code: barcode,
        });
        this.noResultsMessage.classList.remove('is-hidden');

        window.setTimeout(() => {
          this.searchInput.value = '';
          this.isBarcodeSearch = false;
          this.searchInput.placeholder = t('food.search.placeholder');
          this.searchInput.focus();
        }, 2000);
      }
    } catch (error) {
      this.plugin.logger.error('Barcode search error:', error);
      this.loadingIndicator.classList.add('is-hidden');
      this.showError(t('food.search.error.fetchFailed'));
      new Notice(t('barcode.errors.apiError'));
      this.isBarcodeSearch = false;
    } finally {
      this.isSearching = false;
    }
  }

  private createLoadingIndicator(): void {
    this.loadingIndicator = this.contentEl.createDiv({
      cls: 'loading-indicator macros-loading-indicator is-hidden',
      text: t('food.search.searching'),
    });
  }

  private createErrorMessage(): void {
    const container = this.contentEl.createDiv({
      cls: 'search-error-message macros-search-error is-hidden',
    });

    container.createSpan({
      cls: 'search-error-label',
      text: `${t('food.search.error.displayError')} `,
    });

    this.errorTextEl = container.createSpan({
      cls: 'search-error-text',
    });

    this.errorRetryButton = container.createEl('button', {
      cls: 'mod-button search-error-retry',
      text: t('food.search.error.retry'),
    });

    this.errorRetryButton.addClass('is-hidden');

    this.component.registerDomEvent(this.errorRetryButton, 'click', () => {
      const term = this.lastSearchTerm.trim();
      if (term) {
        this.hideError();
        this.loadingIndicator.classList.remove('is-hidden');
        if (this.isBarcodeSearch) {
          void this.performBarcodeSearch(term);
        } else {
          void this.performSearch(term);
        }
      }
    });

    this.errorMessage = container;
  }

  private createNoResultsMessage(): void {
    this.noResultsMessage = this.contentEl.createDiv({
      cls: 'no-results-message is-hidden',
      text: t('food.search.noResults'),
    });
  }

  private createResultsContainer(): void {
    this.resultsContainer = this.contentEl.createDiv({
      cls: 'results-container macros-results-container',
    });

    this.renderer = new SearchRenderer(this.resultsContainer);
  }

  handleSearchInput = () => {
    const searchTerm = this.searchInput.value.trim();

    if (!this.isBarcodeSearch || searchTerm !== this.currentSearchTerm) {
      this.isBarcodeSearch = false;
    }

    if (this.searchTimeout) {
      window.clearTimeout(this.searchTimeout);
    }

    if (this.currentSearchAbortController) {
      this.currentSearchAbortController.abort();
      this.currentSearchAbortController = null;
    }

    this.selectedIndex = -1;
    this.hideError();

    if (!searchTerm) {
      this.resultsContainer.empty();
      this.noResultsMessage.classList.add('is-hidden');
      this.loadingIndicator.classList.add('is-hidden');
      return;
    }

    // Use Fuse search if we have results indexed for current tab
    const fuseResults = fuseSearch(this.tabManager.getCurrentTab(), searchTerm);
    if (fuseResults.length > 0) {
      this.results = fuseResults;
      this.renderer.renderResults(
        searchTerm,
        this.results,
        this.isBarcodeSearch,
        this.selectedIndex,
        (food) => void this.handleFoodSelection(food),
        (index) => {
          this.selectedIndex = index;
          this.renderer.highlightSelectedResult(index, () => {});
          this.renderer.scrollSelectedIntoView(index);
        }
      );
      return;
    }

    this.loadingIndicator.classList.remove('is-hidden');
    this.noResultsMessage.classList.add('is-hidden');

    this.searchTimeout = window.setTimeout(() => {
      const currentSearchTerm = this.searchInput.value.trim();
      if (currentSearchTerm === searchTerm) {
        if (/^\d{8,14}$/.test(searchTerm)) {
          this.isBarcodeSearch = true;
          void this.performBarcodeSearch(searchTerm);
        } else {
          void this.performSearch(searchTerm);
        }
      }
    }, this.searchDebounceMs);
  };

  handleKeyboardNavigation = (event: KeyboardEvent) => {
    if (this.results.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % this.results.length;
      this.renderer.highlightSelectedResult(this.selectedIndex, () => {});
      this.renderer.scrollSelectedIntoView(this.selectedIndex);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selectedIndex = (this.selectedIndex - 1 + this.results.length) % this.results.length;
      this.renderer.highlightSelectedResult(this.selectedIndex, () => {});
      this.renderer.scrollSelectedIntoView(this.selectedIndex);
    } else if (event.key === 'Enter' && this.selectedIndex >= 0) {
      event.preventDefault();
      void this.handleFoodSelection(this.results[this.selectedIndex]);
    }
  };

  async performSearch(searchTerm: string): Promise<void> {
    this.currentSearchAbortController = new AbortController();
    const searchAbortSignal = this.currentSearchAbortController.signal;
    const requestSearchTerm = searchTerm;

    this.isSearching = true;
    this.lastSearchTerm = searchTerm;

    this.hideError();
    this.loadingIndicator.classList.remove('is-hidden');
    this.noResultsMessage.classList.add('is-hidden');

    try {
      if (!this.plugin) {
        throw new Error('Plugin context not available');
      }

      if (searchAbortSignal.aborted) return;

      const currentInputValue = this.searchInput.value.trim();
      if (currentInputValue !== requestSearchTerm) {
        this.plugin.logger.debug(
          `Search cancelled: input changed from "${requestSearchTerm}" to "${currentInputValue}"`
        );
        return;
      }

      const settings = this.plugin.settings;

      this.currentPage = 0;
      this.hasMoreResults = true;
      this.allResults = [];

      let newResults: UnifiedFoodResult[] = [];

      if (searchAbortSignal.aborted) return;

      newResults = await this.performApiSearch(requestSearchTerm, settings, searchAbortSignal);

      if (newResults.length === 0) {
        const variants = generateSearchVariants(requestSearchTerm);

        for (const variant of variants) {
          if (searchAbortSignal.aborted) return;

          const variantResults = await this.performApiSearch(variant, settings, searchAbortSignal);

          if (variantResults.length > 0) {
            newResults = variantResults;
            break;
          }
        }
      }

      const finalInputValue = this.searchInput.value.trim();
      if (finalInputValue !== requestSearchTerm || searchAbortSignal.aborted) {
        this.plugin.logger.debug(
          `Search results discarded: input changed from "${requestSearchTerm}" to "${finalInputValue}" or search was aborted`
        );
        return;
      }

      this.allResults = newResults;
      this.results = newResults;
      this.hasMoreResults = newResults.length > 0;

      if (newResults.length > 0) {
        const foodDocs: FoodDoc[] = newResults.map(unifiedResultToFoodDoc);
        buildFuseIndex(this.tabManager.getCurrentTab(), foodDocs);
      }

      this.loadingIndicator.classList.add('is-hidden');
      this.hideError();
      this.renderer.renderResults(
        requestSearchTerm,
        this.results,
        this.isBarcodeSearch,
        this.selectedIndex,
        (food) => void this.handleFoodSelection(food),
        (index) => {
          this.selectedIndex = index;
          this.renderer.highlightSelectedResult(index, () => {});
          this.renderer.scrollSelectedIntoView(index);
        }
      );
      this.storeResultsInCache(requestSearchTerm);

      window.setTimeout(() => {
        this.searchInput.focus();
      }, 10);
    } catch (error) {
      if (searchAbortSignal.aborted) return;

      if (this.plugin && this.plugin.logger) {
        this.plugin.logger.error('Error fetching food data:', error);
      }
      this.loadingIndicator.classList.add('is-hidden');
      this.showError(t('food.search.error.fetchFailed'));
      new Notice(t('food.search.error.fetchFailed'));
    } finally {
      this.isSearching = false;
      if (
        this.currentSearchAbortController &&
        this.currentSearchAbortController.signal === searchAbortSignal
      ) {
        this.currentSearchAbortController = null;
      }
    }
  }

  private async performApiSearch(
    searchTerm: string,
    settings: PluginSettings,
    searchAbortSignal: AbortSignal
  ): Promise<UnifiedFoodResult[]> {
    let newResults: UnifiedFoodResult[] = [];

    if (searchAbortSignal.aborted) return newResults;

    if (this.tabManager.getCurrentTab() === 'openfoodfacts') {
      if (settings.openFoodFactsEnabled !== false) {
        const cleanQuery = searchTerm.replace(/\s+/g, '');
        const isBarcodeSearch = /^\d{8,14}$/.test(cleanQuery);

        if (isBarcodeSearch) {
          const { searchByBarcode } = await import('../../core/barcodeSearch');

          const sources = {
            openFoodFacts: { enabled: true },
            usda: undefined,
          };

          const userLocale = this.plugin?.i18nManager?.getCurrentLocale() || 'en';
          newResults = await searchByBarcode(this.app, cleanQuery, sources, userLocale);
        } else {
          const userLocale = this.plugin?.i18nManager?.getCurrentLocale() || 'en';
          const offLanguage =
            settings.openFoodFactsLanguage === 'auto' ? userLocale : settings.openFoodFactsLanguage;

          newResults = await searchOpenFoodFactsUnified(
            this.app,
            searchTerm,
            0,
            this.maxResults,
            offLanguage
          );

          if (settings.openFoodFactsDataQualityFilter !== 'all') {
            newResults = newResults.filter((result) => {
              if (settings.openFoodFactsDataQualityFilter === 'high') {
                return result.dataQuality === 'high';
              } else if (settings.openFoodFactsDataQualityFilter === 'medium') {
                return result.dataQuality === 'high' || result.dataQuality === 'medium';
              }
              return true;
            });
          }
        }
      }
    } else if (this.tabManager.getCurrentTab() === 'usda-foundation') {
      if (settings.usdaEnabled && settings.usdaApiKey) {
        newResults = await searchFoundationFoodsOnly(
          this.app,
          searchTerm,
          this.maxResults,
          settings.usdaApiKey
        );
      }
    } else if (this.tabManager.getCurrentTab() === 'usda-branded') {
      if (settings.usdaEnabled && settings.usdaApiKey) {
        const usdaResults = await searchFoods(
          this.app,
          searchTerm,
          0,
          this.maxResults,
          settings.usdaApiKey
        );
        newResults = usdaResults
          .filter((item) => item.isBranded)
          .map((item) => ({
            id: `usda_${item.fdcId}`,
            name: item.description,
            description: item.displayDescription,
            gramsServing: item.gramsServing,
            source: 'usda' as const,
            brandName: item.brandName,
            isFoundation: item.isFoundation,
            isBranded: item.isBranded,
            isSrLegacy: item.isSrLegacy,
            dataType: item.dataType,
            micronutrients: item.micronutrients,
            raw: item,
          }));
      }
    } else if (this.tabManager.getCurrentTab() === 'usda-legacy') {
      if (settings.usdaEnabled && settings.usdaApiKey) {
        const usdaResults = await searchFoods(
          this.app,
          searchTerm,
          0,
          this.maxResults,
          settings.usdaApiKey
        );
        newResults = usdaResults
          .filter((item) => item.isSrLegacy)
          .map((item) => ({
            id: `usda_${item.fdcId}`,
            name: item.description,
            description: item.displayDescription,
            gramsServing: item.gramsServing,
            source: 'usda' as const,
            brandName: item.brandName,
            isFoundation: item.isFoundation,
            isBranded: item.isBranded,
            isSrLegacy: item.isSrLegacy,
            dataType: item.dataType,
            micronutrients: item.micronutrients,
            raw: item,
          }));
      }
    } else if (this.tabManager.getCurrentTab() === 'fatsecret') {
      if (settings.fatSecretEnabled && settings.fatSecretApiKey && settings.fatSecretApiSecret) {
        const { searchFatSecret } = await import('../../core/search');

        newResults = await searchFatSecret(
          this.app,
          searchTerm,
          this.currentPage,
          this.maxResults,
          settings.fatSecretApiKey,
          settings.fatSecretApiSecret
        );
      }
    } else {
      // 'all' tab
      const sources: Record<string, { enabled: boolean; apiKey?: string; apiSecret?: string }> = {};

      if (settings.fatSecretEnabled && settings.fatSecretApiKey && settings.fatSecretApiSecret) {
        sources.fatSecret = {
          enabled: true,
          apiKey: settings.fatSecretApiKey,
          apiSecret: settings.fatSecretApiSecret,
        };
      }
      if (settings.usdaEnabled && settings.usdaApiKey) {
        sources.usda = {
          enabled: true,
          apiKey: settings.usdaApiKey,
        };
      }
      if (settings.openFoodFactsEnabled !== false) {
        sources.openFoodFacts = { enabled: true };
      }

      const userLocale = this.plugin?.i18nManager?.getCurrentLocale() || 'en';
      const offLanguage =
        settings.openFoodFactsLanguage === 'auto' ? userLocale : settings.openFoodFactsLanguage;

      newResults = await searchAllSources(
        this.app,
        searchTerm,
        this.currentPage,
        this.maxResults,
        sources,
        offLanguage
      );

      if (settings.openFoodFactsDataQualityFilter !== 'all') {
        newResults = newResults
          .map((result) => {
            if (result.source === 'openfoodfacts') {
              if (
                settings.openFoodFactsDataQualityFilter === 'high' &&
                result.dataQuality !== 'high'
              ) {
                return null;
              } else if (
                settings.openFoodFactsDataQualityFilter === 'medium' &&
                result.dataQuality === 'low'
              ) {
                return null;
              }
            }
            return result;
          })
          .filter(Boolean);
      }
    }

    return newResults;
  }

  private storeResultsInCache(searchTerm: string): void {
    if (!searchTerm) return;

    const cacheKey = this.cacheManager.getCacheKey(
      this.tabManager.getCurrentTab(),
      searchTerm,
      this.plugin?.settings.openFoodFactsLanguage,
      this.plugin?.settings.openFoodFactsDataQualityFilter
    );

    this.cacheManager.storeResults(
      cacheKey,
      this.allResults,
      this.currentPage,
      this.hasMoreResults
    );
  }

  private setupInfiniteScroll(searchTerm: string): void {
    this.currentSearchTerm = searchTerm;

    if (this.scrollHandler) {
      this.resultsContainer.removeEventListener('scroll', this.scrollHandler);
    }

    this.scrollHandler = (_event: Event) => {
      void this.handleScroll();
    };

    this.component.registerDomEvent(this.resultsContainer, 'scroll', this.scrollHandler);
  }

  private handleScroll = async (): Promise<void> => {
    if (this.isLoadingMore || !this.hasMoreResults || this.isBarcodeSearch) return;

    const container = this.resultsContainer;
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;

    if (scrollTop + clientHeight >= scrollHeight - 100) {
      await this.loadMoreResults(this.currentSearchTerm);
    }
  };

  private async loadMoreResults(searchTerm: string): Promise<void> {
    if (this.isLoadingMore || !this.hasMoreResults || !this.plugin || this.isBarcodeSearch) return;

    this.isLoadingMore = true;
    this.currentPage++;

    try {
      const settings = this.plugin.settings;
      let newResults: UnifiedFoodResult[] = [];

      if (this.tabManager.getCurrentTab() === 'openfoodfacts') {
        if (settings.openFoodFactsEnabled !== false) {
          const userLocale = this.plugin.i18nManager?.getCurrentLocale() || 'en';
          const offLanguage =
            settings.openFoodFactsLanguage === 'auto' ? userLocale : settings.openFoodFactsLanguage;

          const { searchOpenFoodFacts } = await import('../../core/openFoodFacts');
          const offResults = await searchOpenFoodFacts(
            this.app,
            searchTerm,
            this.currentPage,
            this.maxResults,
            offLanguage
          );

          newResults = offResults.map((item) => ({
            id: `off_${item.code}`,
            name: item.productName,
            description: item.displayDescription,
            gramsServing: item.gramsServing,
            source: 'openfoodfacts' as const,
            brandName: item.brands,
            nutritionGrade: item.nutritionGrade,
            novaGroup: item.novaGroup,
            dataQuality: item.dataQuality,
            completeness: item.completeness,
            ecoscore: item.ecoscore,
            imageUrl: item.imageUrl,
            categories: item.categories,
            ingredients: item.ingredientsText,
            micronutrients: item.micronutrients,
            raw: item,
          }));
        }
      } else if (this.tabManager.getCurrentTab() === 'usda-foundation') {
        this.hasMoreResults = false;
        return;
      } else if (this.tabManager.getCurrentTab() === 'usda-branded') {
        if (settings.usdaEnabled && settings.usdaApiKey) {
          const usdaResults = await searchFoods(
            this.app,
            searchTerm,
            this.currentPage,
            this.maxResults,
            settings.usdaApiKey
          );
          newResults = usdaResults
            .filter((item) => item.isBranded)
            .map((item) => ({
              id: `usda_${item.fdcId}`,
              name: item.description,
              description: item.displayDescription,
              gramsServing: item.gramsServing,
              source: 'usda' as const,
              brandName: item.brandName,
              isFoundation: item.isFoundation,
              isBranded: item.isBranded,
              isSrLegacy: item.isSrLegacy,
              dataType: item.dataType,
              micronutrients: item.micronutrients,
              raw: item,
            }));
        }
      } else if (this.tabManager.getCurrentTab() === 'usda-legacy') {
        if (settings.usdaEnabled && settings.usdaApiKey) {
          const usdaResults = await searchFoods(
            this.app,
            searchTerm,
            this.currentPage,
            this.maxResults,
            settings.usdaApiKey
          );
          newResults = usdaResults
            .filter((item) => item.isSrLegacy)
            .map((item) => ({
              id: `usda_${item.fdcId}`,
              name: item.description,
              description: item.displayDescription,
              gramsServing: item.gramsServing,
              source: 'usda' as const,
              brandName: item.brandName,
              isFoundation: item.isFoundation,
              isBranded: item.isBranded,
              isSrLegacy: item.isSrLegacy,
              dataType: item.dataType,
              micronutrients: item.micronutrients,
              raw: item,
            }));
        }
      } else if (this.tabManager.getCurrentTab() === 'fatsecret') {
        if (settings.fatSecretEnabled && settings.fatSecretApiKey && settings.fatSecretApiSecret) {
          const { searchFatSecret } = await import('../../core/search');

          newResults = await searchFatSecret(
            this.app,
            searchTerm,
            this.currentPage,
            this.maxResults,
            settings.fatSecretApiKey,
            settings.fatSecretApiSecret
          );
        }
      } else if (this.tabManager.getCurrentTab() === 'all') {
        const sources: Record<string, { enabled: boolean; apiKey?: string; apiSecret?: string }> =
          {};

        if (settings.fatSecretEnabled && settings.fatSecretApiKey && settings.fatSecretApiSecret) {
          sources.fatSecret = {
            enabled: true,
            apiKey: settings.fatSecretApiKey,
            apiSecret: settings.fatSecretApiSecret,
          };
        }
        if (settings.usdaEnabled && settings.usdaApiKey) {
          sources.usda = {
            enabled: true,
            apiKey: settings.usdaApiKey,
          };
        }
        if (settings.openFoodFactsEnabled !== false) {
          sources.openFoodFacts = { enabled: true };
        }

        const userLocale = this.plugin.i18nManager?.getCurrentLocale() || 'en';
        const offLanguage =
          settings.openFoodFactsLanguage === 'auto' ? userLocale : settings.openFoodFactsLanguage;

        newResults = await searchAllSources(
          this.app,
          searchTerm,
          this.currentPage,
          this.maxResults,
          sources,
          offLanguage
        );
      }

      if (newResults.length > 0) {
        const existingIds = new Set(this.allResults.map((r) => r.id));
        const uniqueNewResults = newResults.filter((r) => !existingIds.has(r.id));

        if (uniqueNewResults.length > 0) {
          this.allResults.push(...uniqueNewResults);
          this.results = this.allResults;
          this.hasMoreResults = newResults.length > 0;

          const allFoodDocs: FoodDoc[] = this.allResults.map(unifiedResultToFoodDoc);
          buildFuseIndex(this.tabManager.getCurrentTab(), allFoodDocs);

          this.renderer.renderResults(
            searchTerm,
            this.results,
            this.isBarcodeSearch,
            this.selectedIndex,
            (food) => void this.handleFoodSelection(food),
            (index) => {
              this.selectedIndex = index;
              this.renderer.highlightSelectedResult(index, () => {});
              this.renderer.scrollSelectedIntoView(index);
            }
          );
          this.storeResultsInCache(searchTerm);
        } else {
          this.hasMoreResults = false;
        }
      } else {
        this.hasMoreResults = false;
      }
    } catch {
      this.hasMoreResults = false;
    } finally {
      this.isLoadingMore = false;
    }
  }

  private async handleFoodSelection(food: UnifiedFoodResult): Promise<void> {
    if (food.source === 'usda' || food.source === 'fatsecret' || food.source === 'openfoodfacts') {
      await this.promptForFileName(food);
    } else {
      this.onSelect(food);
      this.close();
    }
  }

  private async promptForFileName(food: UnifiedFoodResult): Promise<void> {
    // Import here to avoid circular dependency
    const { FileNameModal } = await import('./FileNameModal');

    const modal = new FileNameModal(
      this.app,
      food.name,
      food.gramsServing || 100,
      async (fileName: string, defaultServing?: number) => {
        const safeFileName = this.fileSaver.sanitizeFileName(fileName);

        if (safeFileName !== fileName.trim()) {
          this.plugin?.logger.debug(`Filename sanitized: "${fileName}" -> "${safeFileName}"`);
        }

        const existsResult = await this.fileSaver.checkFileExists(safeFileName);
        if (existsResult.exists) {
          new Notice(
            `A food item with the name "${safeFileName}" already exists in your Nutrition folder. Please choose a different name to avoid conflicts.`
          );
          return false;
        }

        try {
          await this.fileSaver.saveFoodFile(food, fileName, defaultServing);
          this.close();
          return true;
        } catch (error) {
          this.plugin?.logger.error('Error saving food file:', error);
          new Notice(t('food.search.error.saveFailed'));
          return false;
        }
      },
      this.plugin
    );

    modal.open();
  }
}
