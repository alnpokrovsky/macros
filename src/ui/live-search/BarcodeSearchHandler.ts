import type { App } from 'obsidian';
import { Notice } from 'obsidian';
import type MacrosPlugin from '../../main';
import { searchByBarcode, validateBarcodeChecksum } from '../../core/barcodeSearch';
import type { UnifiedFoodResult } from '../../core/search';
import { t } from '../../lang/I18nManager';

/**
 * BarcodeSearchHandler
 * --------------------
 * Handles barcode scanning and search logic for LiveFoodSearchModal.
 * Extracted from LiveSearchModal to isolate barcode-specific concerns.
 */
export class BarcodeSearchHandler {
  private app: App;
  private plugin: MacrosPlugin | undefined;
  private onBarcodeScanned: (barcode: string) => void;

  constructor(
    app: App,
    plugin: MacrosPlugin | undefined,
    onBarcodeScanned: (barcode: string) => void
  ) {
    this.app = app;
    this.plugin = plugin;
    this.onBarcodeScanned = onBarcodeScanned;
  }

  /**
   * Open the barcode scanner modal.
   */
  async openScanner(): Promise<void> {
    if (!this.plugin) {
      new Notice('Plugin context not available for barcode scanning');
      return;
    }

    const { BarcodeScannerModal } = await import('../../utils/BarcodeScanner');

    const scannerModal = new BarcodeScannerModal(
      this.app,
      this.plugin,
      (barcode: string) => void this.handleBarcodeScanned(barcode)
    );

    scannerModal.open();
  }

  /**
   * Handle barcode scan result.
   */
  async handleBarcodeScanned(barcode: string): Promise<void> {
    // Validate barcode
    if (!validateBarcodeChecksum(barcode)) {
      new Notice(t('barcode.manual.checksumWarning', { code: barcode }));
    }

    // Perform barcode-specific search
    await this.performBarcodeSearch(barcode);

    // Notify caller
    this.onBarcodeScanned(barcode);
  }

  /**
   * Perform barcode-specific search with proper result handling.
   */
  async performBarcodeSearch(barcode: string): Promise<UnifiedFoodResult[]> {
    if (!this.plugin) {
      new Notice('Plugin context not available for barcode search');
      return [];
    }

    const settings = this.plugin.settings;

    // Configure sources for barcode search
    const sources = {
      openFoodFacts: { enabled: settings.openFoodFactsEnabled !== false },
      usda:
        settings.usdaEnabled && settings.usdaApiKey
          ? { enabled: true, apiKey: settings.usdaApiKey }
          : undefined,
    };

    // Get user's locale
    const userLocale = this.plugin.i18nManager?.getCurrentLocale() || 'en';

    // Search by barcode
    const barcodeResults = await searchByBarcode(this.app, barcode, sources, userLocale);

    if (barcodeResults.length > 0) {
      new Notice(
        t('barcode.scanner.foundResults', {
          count: barcodeResults.length,
          code: barcode,
        })
      );
    } else {
      new Notice(t('barcode.scanner.noResults', { code: barcode }));
    }

    return barcodeResults;
  }
}
