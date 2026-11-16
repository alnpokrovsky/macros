import type MacrosPlugin from '../../main';
import { convertEnergyUnit, getCurrentEnergyUnitString } from '../../utils';
import { t } from '../../lang/I18nManager';
import type { CalcBreakdown } from './calculator';
import { ChartLoader } from '../../utils/ChartLoader';

export class MacrosCalcChartRenderer {
  private plugin: MacrosPlugin;

  constructor(plugin: MacrosPlugin) {
    this.plugin = plugin;
  }

  async renderComparisonChart(container: HTMLElement, breakdown: CalcBreakdown[]): Promise<void> {
    this.plugin.logger.debug(`renderComparisonChart called with ${breakdown.length} items`);

    const chartSection = container.createDiv({
      cls: 'macroscalc-chart-section macro-dashboard',
    });

    const dashboardHeader = chartSection.createDiv({
      cls: 'macroscalc-dashboard-header macro-dashboard-header',
    });

    const headerContent = dashboardHeader.createDiv({
      cls: 'macroscalc-header-content',
    });

    headerContent.createSpan({
      cls: 'macroscalc-header-title',
      text: t('calculator.chartTitle'),
    });

    const chartContent = chartSection.createDiv({
      cls: 'macro-dashboard-flex-container',
    });

    if (breakdown.length < 2) {
      chartContent.createEl('p', {
        text: t('calculator.notEnoughData', { count: breakdown.length }),
        cls: 'macroscalc-chart-info',
      });
      this.plugin.logger.debug('Not enough data points for chart');
      return;
    }

    try {
      const loader = ChartLoader.getInstance();
      await loader.loadChart();

      this.plugin.logger.debug('Chart.js available after loading:', !!window.Chart);

      if (!window.Chart) {
        throw new Error('Chart.js failed to load');
      }

      const chartWrapper = chartContent.createDiv({
        cls: 'macroscalc-chart-wrapper',
      });

      chartWrapper.setAttribute('data-height', '300');
      chartWrapper.setAttribute('data-width', '100');

      const chartCanvas = chartWrapper.createEl('canvas', {
        cls: 'macroscalc-line-chart',
        attr: {
          'data-width': '800',
          'data-height': '300',
        },
      });

      chartCanvas.width = 800;
      chartCanvas.height = 300;

      const chartId = `macroscalc-${this.plugin.constructor.name}-${Date.now()}`;
      chartCanvas.id = chartId;

      const ctx = chartCanvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }

      this.plugin.logger.debug('Creating chart with data:', {
        labels: breakdown.map((item) => item.id),
        proteinData: breakdown.map((item) => item.totals.protein),
        fatData: breakdown.map((item) => item.totals.fat),
        carbsData: breakdown.map((item) => item.totals.carbs),
        caloriesData: breakdown.map((item) => item.totals.calories),
      });

      const currentEnergyUnit = getCurrentEnergyUnitString();
      const isKjUnit = currentEnergyUnit === 'kJ';

      const calorieData = breakdown.map((item) => {
        if (isKjUnit) {
          return convertEnergyUnit(item.totals.calories, 'kcal', 'kJ');
        }
        return item.totals.calories;
      });

      const chartConfig: import('chart.js').ChartConfiguration<'line', number[], string> = {
        type: 'line',
        data: {
          labels: breakdown.map((item) => item.id),
          datasets: [
            {
              label: t('table.headers.protein') + ' (' + t('units.grams') + ')',
              data: breakdown.map((item) => item.totals.protein),
              borderColor: this.plugin.settings.proteinColor || '#4caf50',
              backgroundColor: (this.plugin.settings.proteinColor || '#4caf50') + '20',
              tension: 0.2,
              fill: false,
              pointRadius: 4,
              pointHoverRadius: 6,
            },
            {
              label: t('table.headers.fat') + ' (' + t('units.grams') + ')',
              data: breakdown.map((item) => item.totals.fat),
              borderColor: this.plugin.settings.fatColor || '#f44336',
              backgroundColor: (this.plugin.settings.fatColor || '#f44336') + '20',
              tension: 0.2,
              fill: false,
              pointRadius: 4,
              pointHoverRadius: 6,
            },
            {
              label: t('table.headers.carbs') + ' (' + t('units.grams') + ')',
              data: breakdown.map((item) => item.totals.carbs),
              borderColor: this.plugin.settings.carbsColor || '#2196f3',
              backgroundColor: (this.plugin.settings.carbsColor || '#2196f3') + '20',
              tension: 0.2,
              fill: false,
              pointRadius: 4,
              pointHoverRadius: 6,
            },
            {
              label:
                t('table.headers.calories') + ` (${isKjUnit ? t('units.kj') : t('units.kcal')})`,
              data: calorieData,
              borderColor: '#ff9800',
              backgroundColor: '#ff980020',
              tension: 0.2,
              fill: false,
              pointRadius: 4,
              pointHoverRadius: 6,
              yAxisID: 'y1',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            intersect: false,
          },
          plugins: {
            legend: {
              position: 'top',
            },
            tooltip: {
              callbacks: {
                label: function (context: import('chart.js').TooltipItem<'line'>) {
                  let value = context.parsed.y.toFixed(1);
                  let unit = '';
                  const isCalorieDataset = context.dataset.yAxisID === 'y1';

                  if (isCalorieDataset && isKjUnit) {
                    const kjValue = convertEnergyUnit(context.parsed.y, 'kcal', 'kJ');
                    value = kjValue.toFixed(1);
                    unit = t('units.kj');
                  } else if (isCalorieDataset) {
                    unit = t('units.kcal');
                  } else {
                    unit = t('units.grams');
                  }

                  return `${context.dataset.label}: ${value} ${unit}`;
                },
              },
            },
          },
          scales: {
            x: {
              title: {
                display: true,
                text: t('calculator.chartAxisDate'),
              },
            },
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: t('calculator.chartAxisGrams'),
              },
              position: 'left',
            },
            y1: {
              type: 'linear',
              display: true,
              position: 'right',
              title: {
                display: true,
                text: `${t('table.headers.calories')} (${isKjUnit ? t('units.kj') : t('units.kcal')})`,
              },
              grid: {
                drawOnChartArea: false,
              },
              beginAtZero: true,
            },
          },
        },
      };

      this.plugin.logger.debug('Scheduling Chart.js instance (draw when visible)...');

      const { drawWhenVisible } = await import('../../utils/visibility');
      drawWhenVisible(chartCanvas, () => {
        try {
          const chart = new window.Chart(ctx, chartConfig);

          this.plugin.logger.debug('Chart created successfully:', chart);

          const resizeHandler = () => {
            if (chartCanvas.isConnected) {
              chart.resize();
            }
          };

          window.addEventListener('resize', resizeHandler);
          this.plugin.registerDomEvent(chartCanvas, 'resize', resizeHandler);
        } catch (error) {
          this.plugin.logger.error('Error creating deferred chart:', error);
        }
      });
    } catch (error) {
      this.plugin.logger.error('Error creating chart:', error);

      const errorDiv = chartContent.createDiv({ cls: 'macroscalc-chart-error' });
      errorDiv.createEl('p', {
        text: t('calculator.chartError', { error: (error as Error).message }),
        cls: 'error-message',
      });

      this.renderFallbackTable(chartContent, breakdown);
    }
  }

  renderFallbackTable(container: HTMLElement, breakdown: CalcBreakdown[]): void {
    const fallbackDiv = container.createDiv({ cls: 'chart-fallback' });

    fallbackDiv.createEl('h4', { text: t('calculator.dataSummary') });

    const table = fallbackDiv.createEl('table', { cls: 'fallback-data-table' });
    const headerRow = table.insertRow();

    const currentEnergyUnit = getCurrentEnergyUnitString();
    [
      t('calculator.tableHeaders.id'),
      `${t('table.headers.calories')} (${currentEnergyUnit === 'kJ' ? t('units.kj') : t('units.kcal')})`,
      t('table.headers.protein'),
      t('table.headers.fat'),
      t('table.headers.carbs'),
    ].forEach((header) => {
      const th = activeDocument.createElement('th');
      th.textContent = header;
      headerRow.appendChild(th);
    });

    breakdown.forEach((item) => {
      const row = table.insertRow();
      row.insertCell().textContent = item.id;

      const currentEnergyUnit = this.plugin.settings.energyUnit;
      if (currentEnergyUnit === 'kJ') {
        const kjValue = convertEnergyUnit(item.totals.calories, 'kcal', 'kJ');
        row.insertCell().textContent = kjValue.toFixed(1) + ' ' + t('units.kj');
      } else {
        row.insertCell().textContent = item.totals.calories.toFixed(1) + ' ' + t('units.kcal');
      }

      row.insertCell().textContent = item.totals.protein.toFixed(1) + ' ' + t('units.grams');
      row.insertCell().textContent = item.totals.fat.toFixed(1) + ' ' + t('units.grams');
      row.insertCell().textContent = item.totals.carbs.toFixed(1) + ' ' + t('units.grams');
    });
  }

  destroyCharts(): void {
    // Chart cleanup is handled by ChartLoader
    // Individual chart instances are managed by the chart loader
  }
}
