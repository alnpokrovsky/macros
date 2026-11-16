import type MacrosPlugin from '../../main';
import { CLASS_NAMES } from '../../utils';
import { t } from '../../lang/I18nManager';

/**
 * MacrosCalcDashboardRenderer
 * ---------------------------
 * Handles rendering of the dashboard header, summary label,
 * and dashboard layout toggles for the macroscalc dashboard.
 */
export class MacrosCalcDashboardRenderer {
  private plugin: MacrosPlugin;
  private isDashboardCollapsed: boolean = false;

  constructor(plugin: MacrosPlugin) {
    this.plugin = plugin;
  }

  /**
   * Render the dashboard container with header and content areas.
   */
  renderDashboard(
    container: HTMLDivElement,
    totals: { calories: number; protein: number; fat: number; carbs: number },
    onToggle: (isCollapsed: boolean) => void,
    onEdit: () => void
  ): HTMLDivElement {
    const dashboardContainer = container.createDiv({
      cls: `${CLASS_NAMES.DASHBOARD.CONTAINER} macroscalc-dashboard-container`,
    });

    // Create header with edit button and toggle functionality
    const dashboardHeader = dashboardContainer.createDiv({
      cls: `${CLASS_NAMES.DASHBOARD.HEADER} macroscalc-dashboard-header collapsible-header`,
    });

    const headerContent = dashboardHeader.createDiv({ cls: 'header-content' });

    // Add title
    headerContent.createSpan({
      cls: 'header-label',
      text: this.getSummaryLabel(),
    });

    // Add edit button
    const editButton = headerContent.createSpan({
      cls: 'macroscalc-edit-metrics-btn',
      text: '⚙️',
      attr: { 'aria-label': t('metrics.edit.title') },
    });

    // Add toggle button
    const toggleButton = headerContent.createSpan({
      cls: 'toggle-icon',
    });

    // Set initial toggle state
    if (this.isDashboardCollapsed) {
      toggleButton.classList.add('collapsed');
      dashboardHeader.classList.add('collapsed');
    }

    // Edit button click handler
    this.plugin.registerDomEvent(editButton, 'click', (e: Event) => {
      e.stopPropagation();
      onEdit();
    });

    // Toggle button click handler
    this.plugin.registerDomEvent(dashboardHeader, 'click', (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('macroscalc-edit-metrics-btn')) {
        return; // Don't toggle when clicking edit button
      }
      this.toggleDashboard(
        dashboardContainer,
        toggleButton,
        dashboardContainer.querySelector('.macroscalc-dashboard-content')
      );
      onToggle(this.isDashboardCollapsed);
    });

    // Create content area
    const dashboardContent = dashboardContainer.createDiv({
      cls: `${CLASS_NAMES.DASHBOARD.CONTENT} macroscalc-dashboard-content collapsible-content`,
    });

    // Apply initial collapse state
    if (this.isDashboardCollapsed) {
      dashboardContent.classList.add('collapsed');
    }

    return dashboardContainer;
  }

  /**
   * Render basic metrics (deprecated - kept for backward compatibility).
   */
  renderBasicMetrics(
    _container: HTMLDivElement,
    _totals: { calories: number; protein: number; fat: number; carbs: number }
  ): void {
    // Remove this method's content entirely since we now have organized custom metrics
    // that include totals, averages, and ratios in a much better format.
    // The custom metrics system handles all the data display we need.
    // This method is now intentionally empty to avoid redundant metric cards
    return;
  }

  /**
   * Get the summary label based on the current IDs.
   * This method should be overridden by subclasses or configured externally.
   */
  getSummaryLabel(): string {
    return t('calculator.summaryTables', {
      count: 0,
      tables: '',
    });
  }

  /**
   * Set the summary label provider.
   */
  setSummaryLabelProvider(provider: () => string): void {
    this.getSummaryLabel = provider;
  }

  /**
   * Get the current dashboard collapsed state.
   */
  getIsDashboardCollapsed(): boolean {
    return this.isDashboardCollapsed;
  }

  /**
   * Set the dashboard collapsed state.
   */
  setIsDashboardCollapsed(collapsed: boolean): void {
    this.isDashboardCollapsed = collapsed;
  }

  /**
   * Toggle the dashboard collapse state.
   */
  toggleDashboard(
    container: HTMLDivElement,
    toggleButton: HTMLElement,
    content: HTMLDivElement
  ): void {
    this.isDashboardCollapsed = !this.isDashboardCollapsed;

    const dashboardHeader = container.querySelector('.macroscalc-dashboard-header');
    const tableContainer = container.querySelector('.macroscalc-container');
    const chartSection = container.querySelector('.macroscalc-chart-section');

    // Update the toggle button and header state
    toggleButton.classList.toggle('collapsed', this.isDashboardCollapsed);
    if (dashboardHeader) {
      dashboardHeader.classList.toggle('collapsed', this.isDashboardCollapsed);
    }

    if (this.isDashboardCollapsed) {
      if (content) {
        content.classList.add('collapsed');
      }
      // Only hide table if it exists
      if (tableContainer) tableContainer.classList.add('macroscalc-hidden');
      // Only hide chart if it exists
      if (chartSection) chartSection.classList.add('macroscalc-hidden');
    } else {
      if (content) {
        content.classList.remove('collapsed');
      }
      // Only show table if it exists
      if (tableContainer) tableContainer.classList.remove('macroscalc-hidden');
      // Only show chart if it exists
      if (chartSection) chartSection.classList.remove('macroscalc-hidden');
    }
  }

  /**
   * Refresh the dashboard content area.
   */
  refreshDashboardContent(
    container: HTMLDivElement,
    renderContent: (container: HTMLDivElement) => void
  ): void {
    container.empty();
    renderContent(container);
  }
}
