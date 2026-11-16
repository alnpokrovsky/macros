import type MacrosPlugin from '../../main';
import {
  MacroscalcMetric,
  MetricConfig,
  MetricData,
  MetricsRegistry,
} from './metrics/MetricsRegistry';
import { registerBuiltinMetrics } from './metrics/index';
import { safeAttachTooltip } from '../../utils';
import { t } from '../../lang/I18nManager';

/**
 * MacrosCalcMetricsRenderer
 * -------------------------
 * Handles rendering of metrics cards and metrics sections
 * for the macroscalc dashboard.
 */
export class MacrosCalcMetricsRenderer {
  private plugin: MacrosPlugin;
  private metricsConfigs: MetricConfig[] = [];

  constructor(plugin: MacrosPlugin) {
    this.plugin = plugin;
    this.initializeMetrics();
  }

  private initializeMetrics(): void {
    // Register built-in metrics
    const registry = MetricsRegistry.getInstance();
    registerBuiltinMetrics(registry);

    // Load user's metric configurations
    this.loadMetricsConfig();
  }

  private loadMetricsConfig(): void {
    // Get saved configs from plugin settings
    const savedConfigs = this.plugin.settings.macroscalcMetricsConfigs || [];

    // If no saved configs, use defaults
    if (savedConfigs.length === 0) {
      const registry = MetricsRegistry.getInstance();
      this.metricsConfigs = registry.getAll().map((metric) => ({
        id: metric.id,
        enabled: metric.defaultEnabled,
        settings: metric.getConfigUI?.()?.getDefaultConfig() || {},
      }));
    } else {
      this.metricsConfigs = savedConfigs;
    }
  }

  /**
   * Save metrics configs to plugin settings.
   */
  saveMetricsConfig(): void {
    this.plugin.settings.macroscalcMetricsConfigs = this.metricsConfigs;
    void this.plugin.saveData(this.plugin.settings);
  }

  /**
   * Replace the current metrics configs.
   */
  setMetricsConfigs(configs: MetricConfig[]): void {
    this.metricsConfigs = configs;
  }

  /**
   * Return a copy of the current metrics configs.
   */
  getMetricsConfigsSnapshot(): MetricConfig[] {
    return [...this.metricsConfigs];
  }

  /**
   * Get display options from metrics config.
   */
  getDisplayOptions(): { showTable: boolean; showChart: boolean } {
    // Find the display options config
    const displayConfig = this.metricsConfigs.find((config) => config.id === 'display-options');

    if (displayConfig && displayConfig.enabled && displayConfig.settings) {
      return {
        showTable: displayConfig.settings.showTable !== false,
        showChart: displayConfig.settings.showChart !== false,
      };
    }

    // Default to showing both if no config found
    return { showTable: true, showChart: true };
  }

  /**
   * Render custom metrics for the given totals.
   */
  renderCustomMetrics(
    container: HTMLDivElement,
    totals: { calories: number; protein: number; fat: number; carbs: number },
    breakdown: {
      id: string;
      totals: { calories: number; protein: number; fat: number; carbs: number };
    }[]
  ): void {
    // Create metrics data with configs included
    const metricsData: MetricData & { configs?: MetricConfig[] } = {
      id: 'calc',
      totals,
      breakdown: breakdown,
      dateIds: [],
      targets: {
        calories: this.plugin.settings.dailyCaloriesTarget,
        protein: this.plugin.settings.dailyProteinTarget,
        fat: this.plugin.settings.dailyFatTarget,
        carbs: this.plugin.settings.dailyCarbsTarget,
      },
      configs: this.metricsConfigs,
    };

    // Calculate metrics with configs passed in the data
    const registry = MetricsRegistry.getInstance();
    const metricResults = registry.calculateMetrics(metricsData, this.metricsConfigs);

    // Group metrics by category
    const categorizedMetrics = new Map<
      string,
      { metric: MacroscalcMetric; values: import('./metrics/MetricsRegistry').MetricValue[] }[]
    >();

    for (const [metricId, values] of metricResults) {
      const metric = registry.get(metricId);
      if (!metric || values.length === 0) continue;

      const category = metric.category || 'other';
      if (!categorizedMetrics.has(category)) {
        categorizedMetrics.set(category, []);
      }
      categorizedMetrics.get(category)?.push({ metric, values });
    }

    // Render categories in a specific order (excluding display since it doesn't show metrics)
    const categoryOrder = ['totals', 'ratios', 'trends', 'extremes', 'adherence', 'other'];

    categoryOrder.forEach((categoryKey) => {
      const categoryMetrics = categorizedMetrics.get(categoryKey);
      if (!categoryMetrics || categoryMetrics.length === 0) return;

      // Create section for this category
      const categorySection = container.createDiv({
        cls: 'macroscalc-metrics-category-section',
      });

      // Add category header
      const categoryHeader = categorySection.createDiv({
        cls: 'macroscalc-metrics-section-header',
      });
      categoryHeader.textContent = this.getCategoryDisplayName(categoryKey);

      // Create appropriate grid for this category
      const gridClass = this.getGridClassForCategory(categoryKey);
      const categoryGrid = categorySection.createDiv({
        cls: gridClass,
      });

      // Render all metrics in this category
      categoryMetrics.forEach(({ values }) => {
        values.forEach((value) => {
          this.createCustomMetricCard(categoryGrid, value, categoryKey);
        });
      });
    });
  }

  /**
   * Get category display name.
   */
  getCategoryDisplayName(category: string): string {
    const categoryNames: Record<string, string> = {
      totals: t('metrics.categories.totals'),
      ratios: t('metrics.categories.ratios'),
      trends: t('metrics.categories.trends'),
      extremes: t('metrics.categories.extremes'),
      adherence: t('metrics.categories.adherence'),
      other: t('metrics.categories.other'),
    };
    return categoryNames[category] || category.toUpperCase();
  }

  /**
   * Get grid CSS class for category.
   */
  getGridClassForCategory(category: string): string {
    const gridClasses: Record<string, string> = {
      totals: 'macroscalc-totals-grid',
      ratios: 'macroscalc-ratios-grid',
      trends: 'macroscalc-trends-grid',
      extremes: 'macroscalc-extremes-grid',
      adherence: 'macroscalc-adherence-grid',
      other: 'macroscalc-metrics-category-grid',
    };
    return gridClasses[category] || 'macroscalc-metrics-category-grid';
  }

  /**
   * Create a custom metric card.
   */
  createCustomMetricCard(
    container: HTMLDivElement,
    metricValue: import('./metrics/MetricsRegistry').MetricValue,
    category?: string
  ): void {
    const card = container.createDiv({
      cls: 'macroscalc-custom-metric-card',
    });

    // Add category data attribute for styling
    if (category) {
      card.setAttribute('data-category', category);
    }

    if (metricValue.color) {
      card.style.borderLeftColor = metricValue.color;
      card.addClass('colored-metric');
    }

    card.createDiv({
      cls: 'metric-label',
      text: metricValue.label,
    });

    const valueEl = card.createDiv({
      cls: 'metric-value',
      text: metricValue.value.toString(),
    });

    if (metricValue.unit) {
      valueEl.createSpan({
        cls: 'metric-unit',
        text: metricValue.unit,
      });
    }

    if (metricValue.subtext) {
      card.createDiv({
        cls: 'metric-subtext',
        text: metricValue.subtext,
      });
    }

    if (metricValue.tooltip) {
      safeAttachTooltip(card, metricValue.tooltip, this.plugin);
    }
  }
}
