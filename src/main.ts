import { Plugin } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS } from './settings/StorageService';
import { initializePlugin, shutdownPlugin } from './managers/PluginBootstrap';
import { NutritionalSettingTab } from './settings/SettingsTab';
import { setFormatterPlugin } from './utils/formatters';
import {
  Logger,
  DataManager,
  RefreshManager,
  ChartManager,
  UIManager,
  MacroService,
  APIService,
} from './managers';
import { I18nManager } from './lang/I18nManager';
import { RenameWatcher } from './managers/RenameWatcher';

/**
 * Macros Plugin
 * -------------------------
 * This plugin integrates nutritional data fetching and processing into Obsidian.
 */
export default class MacrosPlugin extends Plugin {
  settings!: PluginSettings;
  nutritionalSettingTab!: NutritionalSettingTab;
  logger!: Logger;

  // Managers
  dataManager!: DataManager;
  chartManager!: ChartManager;
  refreshManager!: RefreshManager;
  uiManager!: UIManager;
  macroService!: MacroService;
  apiService!: APIService;
  i18nManager!: I18nManager;
  renameWatcher!: RenameWatcher;

  // Redraw all macroscalc dashboards in place
  redrawAllMacrocalc?: () => Promise<void>;

  // Live search modals that cache results; used to invalidate caches when
  // Open Food Facts settings change (language, data-quality filter, enabled).
  // Typed structurally (no import of LiveFoodSearchModal) to avoid a circular
  // import: LiveSearchModal.ts already imports MacrosPlugin from main.ts.
  private searchModals: Set<{ clearSearchCache(): void }> = new Set();

  /**
   * Plugin lifecycle: load
   */
  async onload() {
    // Bootstrap all plugin functionality
    await initializePlugin(this);

    // Set the plugin instance for formatters to access settings
    setFormatterPlugin(this);
  }

  /**
   * Plugin lifecycle: unload
   */
  onunload(): void {
    // Clean up all resources through the ManagerRegistry
    shutdownPlugin(this);

    this.logger.debug('Plugin shutdown complete');
  }

  /**
   * Loads plugin settings.
   */
  async loadSettings() {
    this.settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      ...((await this.loadData()) as Partial<PluginSettings>),
    };

    // Ensure uiCollapseStates exists after loading
    if (!this.settings.uiCollapseStates) {
      this.settings.uiCollapseStates = {};
    }

    // Ensure energyUnit exists and has a default value
    if (!this.settings.energyUnit) {
      this.settings.energyUnit = 'kcal';
    }

    // Ensure new USDA settings exist with defaults
    if (this.settings.usdaEnabled === undefined) {
      this.settings.usdaEnabled = false;
    }
    if (this.settings.usdaApiKey === undefined) {
      this.settings.usdaApiKey = '';
    }
    if (this.settings.fatSecretEnabled === undefined) {
      // Auto-enable FatSecret if credentials are present
      this.settings.fatSecretEnabled = !!(
        this.settings.fatSecretApiKey && this.settings.fatSecretApiSecret
      );
    }

    // Ensure macroscalc metrics configs exist with defaults
    if (!this.settings.macroscalcMetricsConfigs) {
      this.settings.macroscalcMetricsConfigs = [];
    }

    // Ensure micronutrient settings exist with defaults
    if (typeof this.settings.micronutrientTrackingEnabled !== 'boolean') {
      this.settings.micronutrientTrackingEnabled = false;
    }
    if (!this.settings.micronutrientProfile) {
      this.settings.micronutrientProfile = { sex: 'male', age: 30, lifeStage: 'none' };
    }
    if (!this.settings.micronutrientTargets) {
      this.settings.micronutrientTargets = {};
    }
    if (!Array.isArray(this.settings.pinnedMicronutrients)) {
      this.settings.pinnedMicronutrients = [];
    }
  }

  /** Register a live-search modal so its result cache can be invalidated when
   *  Open Food Facts settings change. Accepts any object with clearSearchCache()
   *  to avoid importing LiveFoodSearchModal (circular import). */
  registerSearchModal(modal: { clearSearchCache(): void }): void {
    this.searchModals.add(modal);
  }

  /** Unregister a live-search modal (e.g. on close). */
  unregisterSearchModal(modal: { clearSearchCache(): void }): void {
    this.searchModals.delete(modal);
  }

  /** Clear the result cache of every open live-search modal. Called when
   *  Open Food Facts settings (language, data-quality filter, enabled) change
   *  so cached results are not served stale. */
  clearSearchCaches(): void {
    for (const modal of this.searchModals) {
      modal.clearSearchCache();
    }
  }
}
