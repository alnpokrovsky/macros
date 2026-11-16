import type MacrosPlugin from '../../main';

type SearchTab =
  | 'all'
  | 'fatsecret'
  | 'usda-branded'
  | 'usda-foundation'
  | 'usda-legacy'
  | 'openfoodfacts';

/**
 * SearchTabManager
 * ----------------
 * Determines which search tabs are available based on configured API sources,
 * and manages the current tab state.
 */
export class SearchTabManager {
  private plugin: MacrosPlugin | undefined;
  private availableTabs: SearchTab[] = [];
  private currentTab: SearchTab = 'openfoodfacts';

  constructor(plugin?: MacrosPlugin) {
    this.plugin = plugin;
    this.determineAvailableTabs();
  }

  /**
   * Determine available tabs based on configured API sources.
   * Priority: Open Food Facts (free, no key required) is preferred when available.
   */
  determineAvailableTabs(): void {
    if (!this.plugin) {
      // Fallback includes Open Food Facts since it doesn't require API keys
      this.availableTabs = ['openfoodfacts', 'fatsecret'];
      this.currentTab = 'openfoodfacts';
      return;
    }

    const settings = this.plugin.settings;
    const hasFatSecret =
      settings.fatSecretEnabled && settings.fatSecretApiKey && settings.fatSecretApiSecret;
    const hasUsda = settings.usdaEnabled && settings.usdaApiKey;
    const hasOpenFoodFacts = settings.openFoodFactsEnabled !== false; // Default to enabled

    if (hasFatSecret && hasUsda && hasOpenFoodFacts) {
      // All three enabled → show All, Foundation, Legacy, Branded, OpenFoodFacts, FatSecret tabs
      this.availableTabs = [
        'all',
        'usda-foundation',
        'usda-legacy',
        'usda-branded',
        'openfoodfacts',
        'fatsecret',
      ];
      this.currentTab = 'all';
    } else if (hasUsda && hasOpenFoodFacts) {
      // USDA + Open Food Facts → show Foundation, Legacy, Branded, and OpenFoodFacts tabs
      this.availableTabs = ['usda-foundation', 'usda-legacy', 'usda-branded', 'openfoodfacts'];
      this.currentTab = 'usda-foundation';
    } else if (hasFatSecret && hasOpenFoodFacts) {
      // FatSecret + Open Food Facts → show OpenFoodFacts, FatSecret, and All tabs
      this.availableTabs = ['all', 'openfoodfacts', 'fatsecret'];
      this.currentTab = 'openfoodfacts'; // Prefer OFF since it's free
    } else if (hasUsda) {
      // Only USDA → show Foundation, Legacy, and Branded tabs
      this.availableTabs = ['usda-foundation', 'usda-legacy', 'usda-branded'];
      this.currentTab = 'usda-foundation';
    } else if (hasFatSecret) {
      // Only FatSecret → show FatSecret tab and Open Food Facts if enabled
      this.availableTabs = hasOpenFoodFacts ? ['openfoodfacts', 'fatsecret'] : ['fatsecret'];
      this.currentTab = hasOpenFoodFacts ? 'openfoodfacts' : 'fatsecret';
    } else if (hasOpenFoodFacts) {
      // Only Open Food Facts → show just Open Food Facts tab
      this.availableTabs = ['openfoodfacts'];
      this.currentTab = 'openfoodfacts';
    } else {
      // No APIs configured → fallback to Open Food Facts (free)
      this.availableTabs = ['openfoodfacts'];
      this.currentTab = 'openfoodfacts';
    }
  }

  getTabs(): SearchTab[] {
    return this.availableTabs;
  }

  getCurrentTab(): SearchTab {
    return this.currentTab;
  }

  setTab(tab: SearchTab): void {
    this.currentTab = tab;
  }

  hasMultipleTabs(): boolean {
    return this.availableTabs.length > 1;
  }
}
