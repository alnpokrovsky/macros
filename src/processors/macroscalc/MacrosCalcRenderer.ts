import type MacrosPlugin from '../../main';
import { MacroTotals, formatCalories, formatGrams, CLASS_NAMES } from '../../utils';
import { convertEnergyUnit } from '../../utils/energyUtils';
import { t } from '../../lang/I18nManager';
import type { CalcBreakdown } from './calculator';
import type { MetricConfig } from './metrics/MetricsRegistry';
import { MacrosCalcTableRenderer } from './MacrosCalcTableRenderer';
import { MacrosCalcChartRenderer } from './MacrosCalcChartRenderer';
import { MacrosCalcMetricsRenderer } from './MacrosCalcMetricsRenderer';
import { MacrosCalcDashboardRenderer } from './MacrosCalcDashboardRenderer';

export class MacrosCalcRenderer {
  private plugin: MacrosPlugin;
  public el: HTMLElement;
  private ids: string[];
  private needsDataRefresh = true;
  private lastCalculatedTotals: MacroTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
  private lastBreakdownData: CalcBreakdown[] = [];

  // Sub-renderers
  private tableRenderer: MacrosCalcTableRenderer;
  private chartRenderer: MacrosCalcChartRenderer;
  private metricsRenderer: MacrosCalcMetricsRenderer;
  private dashboardRenderer: MacrosCalcDashboardRenderer;

  constructor(plugin: MacrosPlugin, el: HTMLElement, ids: string[]) {
    this.plugin = plugin;
    this.el = el;
    this.ids = ids;

    // Initialize sub-renderers
    this.tableRenderer = new MacrosCalcTableRenderer(plugin);
    this.chartRenderer = new MacrosCalcChartRenderer(plugin);
    this.metricsRenderer = new MacrosCalcMetricsRenderer(plugin);
    this.dashboardRenderer = new MacrosCalcDashboardRenderer(plugin);

    // Set up summary label provider
    this.dashboardRenderer.setSummaryLabelProvider(() => this.getSummaryLabel());
  }

  public getIds(): string[] {
    return this.ids;
  }

  public setNeedsRefresh(): void {
    this.needsDataRefresh = true;
    this.plugin.logger.debug(`MacrosCalc renderer for ${this.ids.join(',')} marked for refresh`);
  }

  /**
   * Main render method. Orchestrates all sub-renderers.
   */
  async render(aggregate: MacroTotals, breakdown: CalcBreakdown[]): Promise<void> {
    // Always force fresh data fetch if needed
    if (this.needsDataRefresh) {
      this.plugin.logger.debug('MacrosCalc refresh triggered - reloading all data');

      for (const id of this.ids) {
        if (this.plugin.macroService.macroTables.has(id)) {
          this.plugin.macroService.macroTables.delete(id);
        }

        this.plugin.logger.debug(`MacrosCalc reloading data for ${id}`);
        const allLines = await this.plugin.dataManager.getFullMacrosData(id);

        if (allLines && allLines.length > 0) {
          this.plugin.logger.debug(
            `MacrosCalc loaded ${allLines.length} lines for ${id} (including bullet points)`
          );
          this.plugin.macroService.macroTables.set(id, allLines);
        } else {
          this.plugin.logger.debug(`No data found for ID ${id}`);
        }
      }

      this.needsDataRefresh = false;
    }

    // Always recalculate the aggregate and breakdown using the fixed calculator
    let finalAggregate = aggregate;
    let finalBreakdown = breakdown;

    if (
      this.needsDataRefresh ||
      !this.lastCalculatedTotals ||
      this.lastCalculatedTotals.calories === 0
    ) {
      const { aggregate: freshAggregate, breakdown: freshBreakdown } =
        this.plugin.macroService.processNutritionalDataFromLines(this.ids);

      this.plugin.logger.debug('MacrosCalc using fresh calculations:', {
        aggregate: freshAggregate,
        breakdown: freshBreakdown,
      });

      // Cache the calculations for metrics
      this.lastCalculatedTotals = freshAggregate;
      this.lastBreakdownData = freshBreakdown;

      finalAggregate = freshAggregate;
      finalBreakdown = freshBreakdown;
    } else {
      // Use cached data for display-only refreshes
      finalAggregate = this.lastCalculatedTotals;
      finalBreakdown = this.lastBreakdownData;
      this.plugin.logger.debug('MacrosCalc using cached calculations for display refresh');
    }

    // Get display options
    const displayOptions = this.metricsRenderer.getDisplayOptions();

    // Create a container div to batch DOM operations
    const container = activeDocument.createElement('div');
    this.el.empty();

    // Render dashboard
    this.dashboardRenderer.renderDashboard(
      container,
      finalAggregate,
      (_isCollapsed: boolean) => {
        // Handle collapse state change
      },
      () => {
        this.openMetricsEditModal();
      }
    );

    // Only create the main table if showTable is enabled
    if (displayOptions.showTable) {
      const tableContainer = container.createDiv({
        cls: 'macroscalc-container',
      });

      // Apply initial collapse state
      if (this.dashboardRenderer.getIsDashboardCollapsed()) {
        tableContainer.classList.add('macroscalc-hidden');
      }

      const table = tableContainer.createEl('table', { cls: 'macroscalc-table' });

      // Create header row
      const headerRow = table.insertRow();
      const headerData = [
        { text: t('calculator.tableHeaders.id'), mobileText: 'ID' },
        { text: t('table.headers.calories'), mobileText: 'Cal' },
        { text: t('table.headers.protein'), mobileText: 'Pro' },
        { text: t('table.headers.fat'), mobileText: 'Fat' },
        { text: t('table.headers.carbs'), mobileText: 'Carb' },
      ];

      headerData.forEach((headerInfo, index) => {
        const cell = headerRow.insertCell();
        const headerContainer = cell.createDiv({ cls: 'macroscalc-header-container' });

        headerContainer.createSpan({
          cls: 'header-text-desktop',
          text: headerInfo.text,
        });

        headerContainer.createSpan({
          cls: 'header-text-mobile',
          text: headerInfo.mobileText,
        });

        if (index > 0) {
          const sortButton = headerContainer.createSpan({ cls: 'macroscalc-sort-icon' });
          sortButton.setText('⇅');

          if (this.tableRenderer.getSortConfig().column === headerInfo.text) {
            sortButton.setText(this.tableRenderer.getSortConfig().ascending ? '↑' : '↓');
            sortButton.classList.add('active');
          }

          sortButton.addEventListener('click', () => {
            this.tableRenderer.sortTable(table, headerInfo.text);
          });
        }

        cell.classList.add(CLASS_NAMES.TABLE.COLUMN_HEADER);

        if (headerInfo.text === t('table.headers.protein'))
          cell.classList.add(CLASS_NAMES.MACRO.PROTEIN_CELL);
        if (headerInfo.text === t('table.headers.fat'))
          cell.classList.add(CLASS_NAMES.MACRO.FAT_CELL);
        if (headerInfo.text === t('table.headers.carbs'))
          cell.classList.add(CLASS_NAMES.MACRO.CARBS_CELL);
        if (headerInfo.text === t('table.headers.calories'))
          cell.classList.add(CLASS_NAMES.MACRO.CALORIES_CELL);
      });

      // Render each breakdown row
      for (const [index, item] of finalBreakdown.entries()) {
        this.tableRenderer.renderTableRow(table, item, finalAggregate, index % 2 === 1);
        await this.tableRenderer.renderExpandableDetailRow(table, item);
      }

      // Render aggregate totals row
      const aggregateRow = table.insertRow();
      aggregateRow.classList.add(CLASS_NAMES.TABLE.TOTALS_ROW);

      const aggLabelCell = aggregateRow.insertCell();
      aggLabelCell.classList.add('macro-bold-cell');

      aggLabelCell.createSpan({
        cls: 'header-text-desktop',
        text: t('calculator.combinedTotals'),
      });

      aggLabelCell.createSpan({
        cls: 'header-text-mobile',
        text: t('table.summary.totals'),
      });

      // Calculate total macros for percentages
      const totalMacros = finalAggregate.protein + finalAggregate.fat + finalAggregate.carbs;

      // Enhanced calories cell with kJ support
      const aggCaloriesCell = aggregateRow.insertCell();
      aggCaloriesCell.classList.add('macro-bold-cell', CLASS_NAMES.MACRO.CALORIES_CELL);

      const currentEnergyUnit = this.plugin.settings.energyUnit;
      if (currentEnergyUnit === 'kJ') {
        const kjValue = convertEnergyUnit(finalAggregate.calories, 'kcal', 'kJ');
        aggCaloriesCell.textContent = `${kjValue.toFixed(1)} ${t('units.kj')}`;
      } else {
        aggCaloriesCell.textContent = formatCalories(finalAggregate.calories);
      }

      // Protein
      const aggProteinCell = aggregateRow.insertCell();
      aggProteinCell.classList.add('macro-bold-cell', CLASS_NAMES.MACRO.PROTEIN_CELL);
      aggProteinCell.textContent = formatGrams(finalAggregate.protein);

      if (totalMacros > 0 && this.plugin.settings.showCellPercentages) {
        const proteinPercentage = Math.round((finalAggregate.protein / totalMacros) * 100);
        aggProteinCell.createSpan({
          cls: CLASS_NAMES.MACRO.PERCENTAGE,
          text: `(${proteinPercentage}%)`,
        });
      }

      // Fat
      const aggFatCell = aggregateRow.insertCell();
      aggFatCell.classList.add('macro-bold-cell', CLASS_NAMES.MACRO.FAT_CELL);
      aggFatCell.textContent = formatGrams(finalAggregate.fat);

      if (totalMacros > 0 && this.plugin.settings.showCellPercentages) {
        const fatPercentage = Math.round((finalAggregate.fat / totalMacros) * 100);
        aggFatCell.createSpan({
          cls: CLASS_NAMES.MACRO.PERCENTAGE,
          text: `(${fatPercentage}%)`,
        });
      }

      // Carbs
      const aggCarbsCell = aggregateRow.insertCell();
      aggCarbsCell.classList.add('macro-bold-cell', CLASS_NAMES.MACRO.CARBS_CELL);
      aggCarbsCell.textContent = formatGrams(finalAggregate.carbs);

      if (totalMacros > 0 && this.plugin.settings.showCellPercentages) {
        const carbsPercentage = Math.round((finalAggregate.carbs / totalMacros) * 100);
        aggCarbsCell.createSpan({
          cls: CLASS_NAMES.MACRO.PERCENTAGE,
          text: `(${carbsPercentage}%)`,
        });
      }
    }

    // Only add comparison visualization if showChart is enabled
    if (displayOptions.showChart) {
      await this.chartRenderer.renderComparisonChart(container, finalBreakdown);
    }

    // Add to main element
    this.el.appendChild(container);
  }

  /**
   * Open the metrics edit modal.
   */
  openMetricsEditModal(): void {
    void import('./metrics/MetricsEditModal').then((mod) => {
      const MetricsEditModal = mod.MetricsEditModal;
      const modal = new MetricsEditModal(
        this.plugin,
        this.metricsRenderer.getMetricsConfigsSnapshot(),
        (newConfigs: MetricConfig[]) => {
          this.metricsRenderer.setMetricsConfigs(newConfigs);
          this.metricsRenderer.saveMetricsConfig();

          this.forceCompleteRerender();
        }
      );
      modal.open();
    });
  }

  /**
   * Force complete re-render.
   */
  forceCompleteRerender(): void {
    // Mark that we need a data refresh (even though we don't, this ensures fresh rendering)
    this.setNeedsRefresh();

    // Force re-render the entire component with fresh calculations
    void this.render(this.lastCalculatedTotals, this.lastBreakdownData);
  }

  /**
   * Refresh the dashboard.
   */
  refreshDashboard(): void {
    const dashboardContent = this.el.querySelector('.macroscalc-dashboard-content');
    if (dashboardContent) {
      dashboardContent.empty();

      // Only render the organized custom metrics (removed basic metrics)
      this.metricsRenderer.renderCustomMetrics(
        dashboardContent as HTMLDivElement,
        this.lastCalculatedTotals,
        this.lastBreakdownData
      );
    }
  }

  /**
   * Get summary label based on IDs.
   */
  getSummaryLabel(): string {
    // Check if all IDs are dates in YYYY-MM-DD format
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const allDates = this.ids.every((id) => datePattern.test(id));

    if (allDates) {
      // Parse all dates and sort them
      const dates = this.ids
        .map((id) => {
          const [year, month, day] = id.split('-').map((n) => parseInt(n));
          return new Date(year, month - 1, day);
        })
        .sort((a, b) => a.getTime() - b.getTime());

      if (dates.length === 0) {
        return t('calculator.summaryTables', {
          count: this.ids.length,
          tables: this.ids.length === 1 ? '' : 's',
        });
      }

      const firstDate = dates[0];
      const lastDate = dates[dates.length - 1];

      // Format dates nicely
      const formatDate = (date: Date): string => {
        const months = [
          'January',
          'February',
          'March',
          'April',
          'May',
          'June',
          'July',
          'August',
          'September',
          'October',
          'November',
          'December',
        ];

        const month = months[date.getMonth()];
        const day = date.getDate();
        const year = date.getFullYear();

        // If same year as last date, omit year from first date
        if (firstDate !== lastDate && firstDate.getFullYear() === lastDate.getFullYear()) {
          return `${month} ${day}`;
        }
        return `${month} ${day}, ${year}`;
      };

      // Special case: single date
      if (dates.length === 1) {
        return t('calculator.summarySingleDate', {
          date: formatDate(firstDate),
        });
      }

      // Special case: same date (shouldn't happen but handle it)
      if (firstDate.getTime() === lastDate.getTime()) {
        return t('calculator.summarySingleDate', {
          date: formatDate(firstDate),
        });
      }

      // Special case: consecutive dates in same month
      if (
        firstDate.getMonth() === lastDate.getMonth() &&
        firstDate.getFullYear() === lastDate.getFullYear()
      ) {
        const month = [
          'January',
          'February',
          'March',
          'April',
          'May',
          'June',
          'July',
          'August',
          'September',
          'October',
          'November',
          'December',
        ][firstDate.getMonth()];

        return t('calculator.summaryDateRangeSameMonth', {
          month: month,
          startDay: firstDate.getDate(),
          endDay: lastDate.getDate(),
          year: firstDate.getFullYear(),
        });
      }

      // Different months or years
      return t('calculator.summaryDateRange', {
        startDate: formatDate(firstDate),
        endDate: formatDate(lastDate),
      });
    } else {
      // Mixed IDs or non-date IDs - use the original logic
      return t('calculator.summaryTables', {
        count: this.ids.length,
        tables: this.ids.length === 1 ? '' : 's',
      });
    }
  }

  /**
   * Destroy all charts.
   */
  destroyCharts(): void {
    this.chartRenderer.destroyCharts();
  }
}
