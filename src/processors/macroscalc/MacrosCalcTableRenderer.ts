import type MacrosPlugin from '../../main';
import {
  MACRO_TYPES,
  formatCalories,
  formatGrams,
  ProgressBarFactory,
  safeAttachTooltip,
  CLASS_NAMES,
} from '../../utils';
import { convertEnergyUnit } from '../../utils/energyUtils';
import { t } from '../../lang/I18nManager';
import type { MacroTotals } from '../../utils/types';
import { findMatchingFoodFile } from '../../utils/fileUtils';
import { processNutritionalData } from '../../utils/nutritionUtils';
import { parseGrams } from '../../utils/parsingUtils';

/**
 * MacrosCalcTableRenderer
 * -----------------------
 * Handles rendering of table rows, detail rows, food item rows, and table sorting
 * for the macroscalc dashboard.
 */
export class MacrosCalcTableRenderer {
  private plugin: MacrosPlugin;
  private expandedRows: Set<string> = new Set();
  private sortConfig: { column: string; ascending: boolean } = { column: '', ascending: true };

  constructor(plugin: MacrosPlugin) {
    this.plugin = plugin;
  }

  /**
   * Render a single table row for a macroscalc breakdown item.
   */
  renderTableRow(
    table: HTMLTableElement,
    item: { id: string; totals: MacroTotals },
    aggregate: MacroTotals,
    isAltRow: boolean
  ): void {
    const row = table.insertRow();
    row.dataset.id = item.id;

    if (isAltRow) {
      row.classList.add('macroscalc-alt-row');
    }

    // ID cell with expand toggle
    const idCell = row.insertCell();
    idCell.classList.add('macroscalc-id-cell-container');

    const expandToggle = idCell.createSpan({ cls: 'toggle-icon macroscalc-expand-toggle' });
    if (this.expandedRows.has(item.id)) {
      expandToggle.classList.add('expanded');
    }

    expandToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDetailRow(item.id, expandToggle);
    });

    idCell.createSpan({ text: item.id, cls: 'macroscalc-id-text' });

    // Calculate total macros for percentages
    const totalMacros = item.totals.protein + item.totals.fat + item.totals.carbs;

    // Enhanced calories cell with kJ support
    const caloriesCell = row.insertCell();
    caloriesCell.classList.add(CLASS_NAMES.MACRO.CELL, CLASS_NAMES.MACRO.CALORIES_CELL);

    const currentEnergyUnit = this.plugin.settings.energyUnit;
    if (currentEnergyUnit === 'kJ') {
      const kjValue = convertEnergyUnit(item.totals.calories, 'kcal', 'kJ');
      caloriesCell.textContent = `${kjValue.toFixed(1)} ${t('units.kj')}`;
    } else {
      caloriesCell.textContent = formatCalories(item.totals.calories);
    }

    const caloriePercentage = (item.totals.calories / aggregate.calories) * 100;
    ProgressBarFactory.createMacroProgressBar(
      caloriesCell,
      caloriePercentage,
      MACRO_TYPES.CALORIES
    );

    // Enhanced tooltip with energy unit support
    let calorieTooltip: string;
    if (currentEnergyUnit === 'kJ') {
      const kjValue = convertEnergyUnit(item.totals.calories, 'kcal', 'kJ');
      calorieTooltip = t('calculator.tooltips.calories', {
        value: kjValue.toFixed(1) + ' ' + t('units.kj'),
        id: item.id,
        percentage: caloriePercentage.toFixed(0),
      });
    } else {
      calorieTooltip = t('calculator.tooltips.calories', {
        value: item.totals.calories.toFixed(1),
        id: item.id,
        percentage: caloriePercentage.toFixed(0),
      });
    }

    safeAttachTooltip(caloriesCell, calorieTooltip, this.plugin);

    // Protein cell
    const proteinCell = row.insertCell();
    proteinCell.classList.add(CLASS_NAMES.MACRO.CELL, CLASS_NAMES.MACRO.PROTEIN_CELL);
    proteinCell.textContent = formatGrams(item.totals.protein);

    if (totalMacros > 0 && this.plugin.settings.showCellPercentages) {
      const proteinPercentage = Math.round((item.totals.protein / totalMacros) * 100);
      proteinCell.createSpan({
        cls: CLASS_NAMES.MACRO.PERCENTAGE,
        text: `(${proteinPercentage}%)`,
      });
    }

    const proteinPercentage = totalMacros > 0 ? (item.totals.protein / totalMacros) * 100 : 0;
    ProgressBarFactory.createMacroProgressBar(proteinCell, proteinPercentage, MACRO_TYPES.PROTEIN);

    safeAttachTooltip(
      proteinCell,
      t('calculator.tooltips.macro', {
        value: formatGrams(item.totals.protein),
        macro: t('table.headers.protein').toLowerCase(),
        percentage: Math.round(proteinPercentage),
      }),
      this.plugin
    );

    // Fat cell
    const fatCell = row.insertCell();
    fatCell.classList.add(CLASS_NAMES.MACRO.CELL, CLASS_NAMES.MACRO.FAT_CELL);
    fatCell.textContent = formatGrams(item.totals.fat);

    if (totalMacros > 0 && this.plugin.settings.showCellPercentages) {
      const fatPercentage = Math.round((item.totals.fat / totalMacros) * 100);
      fatCell.createSpan({
        cls: CLASS_NAMES.MACRO.PERCENTAGE,
        text: `(${fatPercentage}%)`,
      });
    }

    const fatPercentage = totalMacros > 0 ? (item.totals.fat / totalMacros) * 100 : 0;
    ProgressBarFactory.createMacroProgressBar(fatCell, fatPercentage, MACRO_TYPES.FAT);

    safeAttachTooltip(
      fatCell,
      t('calculator.tooltips.macro', {
        value: formatGrams(item.totals.fat),
        macro: t('table.headers.fat').toLowerCase(),
        percentage: Math.round(fatPercentage),
      }),
      this.plugin
    );

    // Carbs cell
    const carbsCell = row.insertCell();
    carbsCell.classList.add(CLASS_NAMES.MACRO.CELL, CLASS_NAMES.MACRO.CARBS_CELL);
    carbsCell.textContent = formatGrams(item.totals.carbs);

    if (totalMacros > 0 && this.plugin.settings.showCellPercentages) {
      const carbsPercentage = Math.round((item.totals.carbs / totalMacros) * 100);
      carbsCell.createSpan({
        cls: CLASS_NAMES.MACRO.PERCENTAGE,
        text: `(${carbsPercentage}%)`,
      });
    }

    const carbsPercentage = totalMacros > 0 ? (item.totals.carbs / totalMacros) * 100 : 0;
    ProgressBarFactory.createMacroProgressBar(carbsCell, carbsPercentage, MACRO_TYPES.CARBS);

    safeAttachTooltip(
      carbsCell,
      t('calculator.tooltips.macro', {
        value: formatGrams(item.totals.carbs),
        macro: t('table.headers.carbs').toLowerCase(),
        percentage: Math.round(carbsPercentage),
      }),
      this.plugin
    );
  }

  /**
   * Render an expandable detail row for a macroscalc breakdown item.
   */
  async renderExpandableDetailRow(table: HTMLTableElement, item: { id: string }): Promise<void> {
    const detailRow = table.insertRow();
    detailRow.dataset.parentId = item.id;
    detailRow.classList.add('macroscalc-detail-row');

    if (!this.expandedRows.has(item.id)) {
      detailRow.classList.add('table-row-hidden');
    } else {
      detailRow.classList.add('table-row-visible');
    }

    const detailCell = detailRow.insertCell();
    detailCell.colSpan = 5;

    const loadingMessage = detailCell.createEl('p', { text: t('general.loading') });

    try {
      const context = await this.plugin.dataManager.getDocumentContext(item.id);
      const detailContent = detailCell.createDiv();

      if (loadingMessage && loadingMessage.parentNode) {
        loadingMessage.parentNode.removeChild(loadingMessage);
      }

      if (!context || context.allLines.length === 0) {
        detailContent.createEl('p', { text: t('calculator.noDetailData') });
        return;
      }

      const foodList = detailContent.createEl('table', { cls: 'macroscalc-details-table' });

      const foodHeader = foodList.createTHead().insertRow();
      const detailHeaderData = [
        { text: t('table.headers.food'), mobileText: t('table.headers.food') },
        { text: t('calculator.quantity'), mobileText: 'Qty' },
        { text: t('table.headers.calories'), mobileText: 'Cal' },
        { text: t('table.headers.protein'), mobileText: 'Pro' },
        { text: t('table.headers.fat'), mobileText: 'Fat' },
        { text: t('table.headers.carbs'), mobileText: 'Carb' },
      ];

      detailHeaderData.forEach((headerInfo) => {
        const th = activeDocument.createElement('th');
        const desktopSpan = activeDocument.createElement('span');
        desktopSpan.className = 'header-text-desktop';
        desktopSpan.textContent = headerInfo.text;
        const mobileSpan = activeDocument.createElement('span');
        mobileSpan.className = 'header-text-mobile';
        mobileSpan.textContent = headerInfo.mobileText;
        th.appendChild(desktopSpan);
        th.appendChild(mobileSpan);
        foodHeader.appendChild(th);
      });

      const foodBody = foodList.createTBody();

      let currentMealName = '';

      context.allLines.forEach((line) => {
        if (line.trim() === '' || line.startsWith('id:')) return;

        if (line.toLowerCase().startsWith('meal:') || line.toLowerCase().startsWith('group:')) {
          const isGroup = line.toLowerCase().startsWith('group:');
          currentMealName = line.substring(isGroup ? 6 : 5).trim();

          let displayName = currentMealName;
          let comment = '';
          let timestamp = '';

          // Parse comment
          const commentIndex = currentMealName.indexOf('//');
          if (commentIndex !== -1) {
            displayName = currentMealName.substring(0, commentIndex).trim();
            comment = currentMealName.substring(commentIndex + 2).trim();
          }

          // Parse timestamp
          const timestampMatch = displayName.match(/@(\d{2}:\d{2})/);
          if (timestampMatch) {
            timestamp = timestampMatch[1];
            displayName = displayName.replace(/@\d{2}:\d{2}/g, '').trim();
          }

          const headerRow = foodBody.insertRow();
          const headerCell = headerRow.insertCell();
          headerCell.classList.add('macroscalc-meal-header');
          headerCell.colSpan = 6;

          const headerContainer = headerCell.createDiv({ cls: 'macro-food-name-container' });
          const headerContent = headerContainer.createDiv({ cls: 'food-name-content' });

          headerContent.createSpan({
            cls: 'macro-food-name',
            text: displayName,
          });

          // Create icons container for proper alignment
          const iconsContainer = headerContent.createDiv({ cls: 'food-icons-container' });

          // Add timestamp icon if timestamp exists
          if (timestamp) {
            const timestampIcon = iconsContainer.createSpan({
              cls: 'food-timestamp-icon',
              text: '⏰',
            });

            safeAttachTooltip(
              timestampIcon,
              t('timestamps.consumed', { time: timestamp }),
              this.plugin
            );
          }

          // Add comment icon if comment exists
          if (comment) {
            const commentIcon = iconsContainer.createSpan({
              cls: 'food-comment-icon',
              text: '💬',
            });

            safeAttachTooltip(commentIcon, comment, this.plugin);
            headerContent.classList.add('has-comment-icon');
          }
        } else if (line.startsWith('-') && currentMealName) {
          const bulletContent = line.substring(1).trim();
          this.renderFoodItemRowFromBullet(foodBody, bulletContent);
        } else if (!line.startsWith('-')) {
          this.renderFoodItemRowFromLine(foodBody, line);
        }
      });
    } catch (error) {
      this.plugin.logger.error(`Error rendering detail row for ID ${item.id}:`, error);
      if (loadingMessage && loadingMessage.parentNode) {
        loadingMessage.textContent = t('calculator.errorLoadingData', {
          error: (error as Error).message,
        });
      }
    }
  }

  /**
   * Parse timestamp from a macro line.
   */
  parseTimestampFromLine(line: string): string {
    const timestampMatch = line.match(/@(\d{2}:\d{2})/);
    return timestampMatch ? timestampMatch[1] : '';
  }

  /**
   * Render a food item row from a bullet point line.
   */
  renderFoodItemRowFromBullet(foodBody: HTMLTableSectionElement, bulletContent: string): void {
    let itemText = bulletContent;
    let comment = '';
    let timestamp = '';

    // Parse comment
    const commentIndex = bulletContent.indexOf('//');
    if (commentIndex !== -1) {
      itemText = bulletContent.substring(0, commentIndex).trim();
      comment = bulletContent.substring(commentIndex + 2).trim();
    }

    // Parse timestamp from the item text before extracting food name
    timestamp = this.parseTimestampFromLine(itemText);
    if (timestamp) {
      itemText = itemText.replace(/@\d{2}:\d{2}/g, '').trim();
    }

    let foodName = itemText;
    let quantity = t('calculator.standardQuantity');
    let specifiedQuantity: number | null = null;

    if (itemText.includes(':')) {
      const parts = itemText.split(':');
      foodName = parts[0].trim();
      quantity = parts.length > 1 ? parts[1].trim() : t('calculator.standardQuantity');
      specifiedQuantity = parseGrams(quantity);
    }

    const fullLine = comment ? `${itemText} // ${comment}` : itemText;
    this.renderFoodItemRow(
      foodBody,
      fullLine,
      quantity,
      specifiedQuantity,
      foodName,
      comment,
      timestamp
    );
  }

  /**
   * Render a food item row from a regular line.
   */
  renderFoodItemRowFromLine(foodBody: HTMLTableSectionElement, line: string): void {
    let itemText = line;
    let comment = '';
    let timestamp = '';

    // Parse comment
    const commentIndex = line.indexOf('//');
    if (commentIndex !== -1) {
      itemText = line.substring(0, commentIndex).trim();
      comment = line.substring(commentIndex + 2).trim();
    }

    // Parse timestamp from the item text before extracting food name
    timestamp = this.parseTimestampFromLine(itemText);
    if (timestamp) {
      itemText = itemText.replace(/@\d{2}:\d{2}/g, '').trim();
    }

    let foodName = itemText;
    let quantity = t('calculator.standardQuantity');
    let specifiedQuantity: number | null = null;

    if (itemText.includes(':')) {
      const parts = itemText.split(':');
      foodName = parts[0].trim();
      quantity = parts.length > 1 ? parts[1].trim() : t('calculator.standardQuantity');
      specifiedQuantity = parseGrams(quantity);
    }

    const fullLine = comment ? `${itemText} // ${comment}` : itemText;
    this.renderFoodItemRow(
      foodBody,
      fullLine,
      quantity,
      specifiedQuantity,
      foodName,
      comment,
      timestamp
    );
  }

  /**
   * Render a food item row.
   */
  renderFoodItemRow(
    foodBody: HTMLTableSectionElement,
    itemLine: string,
    quantity: string,
    specifiedQuantity: number | null = null,
    explicitFoodName?: string,
    comment?: string,
    timestamp?: string
  ): void {
    let cleanItemLine = itemLine;
    if (comment) {
      const commentIndex = itemLine.indexOf('//');
      if (commentIndex !== -1) {
        cleanItemLine = itemLine.substring(0, commentIndex).trim();
      }
    }

    let foodName = explicitFoodName || cleanItemLine;

    if (!explicitFoodName && cleanItemLine.includes(':') && specifiedQuantity === null) {
      const parts = cleanItemLine.split(':');
      foodName = parts[0].trim();
      quantity = parts.length > 1 ? parts[1].trim() : t('calculator.standardQuantity');
      specifiedQuantity = parseGrams(quantity);
    }

    const foodRow = foodBody.insertRow();

    const folderPath = this.plugin.settings.storageFolder;
    const files = this.plugin.dataManager.getFilesInFolder(folderPath);
    const matchingFile = findMatchingFoodFile(files, foodName);

    let nutritionData = { calories: 0, protein: 0, fat: 0, carbs: 0 };

    if (matchingFile) {
      const processed = processNutritionalData(this.plugin.app, matchingFile, specifiedQuantity);
      if (processed) {
        nutritionData = processed;
      }
    }

    const totalMacros = nutritionData.protein + nutritionData.fat + nutritionData.carbs;

    const nameCell = foodRow.insertCell();
    const nameContainer = nameCell.createDiv({ cls: 'macro-food-name-container' });
    const nameContentDiv = nameContainer.createDiv({ cls: 'food-name-content' });

    const nameSpan = nameContentDiv.createSpan({
      cls: 'macro-food-name',
    });
    nameSpan.textContent = foodName;

    // Create icons container for proper alignment
    const iconsContainer = nameContentDiv.createDiv({ cls: 'food-icons-container' });

    // Add timestamp icon first if timestamp exists (most important)
    if (timestamp) {
      const timestampIcon = iconsContainer.createSpan({
        cls: 'food-timestamp-icon',
        text: '⏰',
      });

      safeAttachTooltip(timestampIcon, t('timestamps.consumed', { time: timestamp }), this.plugin);
    }

    // Add comment icon if comment exists
    if (comment) {
      const commentIcon = iconsContainer.createSpan({
        cls: 'food-comment-icon',
        text: '💬',
      });

      safeAttachTooltip(commentIcon, comment, this.plugin);
      nameContentDiv.classList.add('has-comment-icon');
    }

    window.setTimeout(() => {
      const isOverflowing = nameSpan.scrollWidth > nameSpan.clientWidth + 2;
      if (isOverflowing) {
        nameSpan.removeAttribute('title');
        safeAttachTooltip(nameSpan, foodName, this.plugin);
      }
    }, 200);

    const quantityCell = foodRow.insertCell();
    quantityCell.textContent = quantity;

    const caloriesCell = foodRow.insertCell();
    const currentEnergyUnit = this.plugin.settings.energyUnit;
    if (currentEnergyUnit === 'kJ') {
      const kjValue = convertEnergyUnit(nutritionData.calories, 'kcal', 'kJ');
      caloriesCell.textContent = `${kjValue.toFixed(1)} ${t('units.kj')}`;
    } else {
      caloriesCell.textContent = formatCalories(nutritionData.calories);
    }

    const proteinCell = foodRow.insertCell();
    proteinCell.textContent = formatGrams(nutritionData.protein);

    if (totalMacros > 0 && this.plugin.settings.showCellPercentages) {
      const proteinPercentage = Math.round((nutritionData.protein / totalMacros) * 100);
      proteinCell.createSpan({
        cls: 'macro-percentage',
        text: `(${proteinPercentage}%)`,
      });
    }

    proteinCell.classList.add('macroscalc-protein-value');

    const fatCell = foodRow.insertCell();
    fatCell.textContent = formatGrams(nutritionData.fat);

    if (totalMacros > 0 && this.plugin.settings.showCellPercentages) {
      const fatPercentage = Math.round((nutritionData.fat / totalMacros) * 100);
      fatCell.createSpan({
        cls: 'macro-percentage',
        text: `(${fatPercentage}%)`,
      });
    }

    fatCell.classList.add('macroscalc-fat-value');

    const carbsCell = foodRow.insertCell();
    carbsCell.textContent = formatGrams(nutritionData.carbs);

    if (totalMacros > 0 && this.plugin.settings.showCellPercentages) {
      const carbsPercentage = Math.round((nutritionData.carbs / totalMacros) * 100);
      carbsCell.createSpan({
        cls: 'macro-percentage',
        text: `(${carbsPercentage}%)`,
      });
    }

    carbsCell.classList.add('macroscalc-carbs-value');
  }

  /**
   * Toggle an expandable detail row.
   */
  toggleDetailRow(id: string, toggle: HTMLElement): void {
    const detailRow = activeDocument.querySelector(`tr[data-parent-id="${id}"]`);

    if (!detailRow) return;

    if (detailRow.classList.contains('table-row-hidden')) {
      detailRow.classList.remove('table-row-hidden');
      detailRow.classList.add('table-row-visible');
      toggle.classList.add('expanded');
      this.expandedRows.add(id);
    } else {
      detailRow.classList.add('table-row-hidden');
      detailRow.classList.remove('table-row-visible');
      toggle.classList.remove('expanded');
      this.expandedRows.delete(id);
    }
  }

  /**
   * Sort a table by column.
   */
  sortTable(table: HTMLTableElement, column: string): void {
    const headers: Record<string, number> = {
      [t('calculator.tableHeaders.id')]: 0,
      [t('table.headers.calories')]: 1,
      [t('table.headers.protein')]: 2,
      [t('table.headers.fat')]: 3,
      [t('table.headers.carbs')]: 4,
    };

    const columnIndex = headers[column];

    let ascending = true;
    if (this.sortConfig.column === column) {
      ascending = !this.sortConfig.ascending;
    }

    this.sortConfig = { column, ascending };

    const headerRow = table.rows[0];
    for (let i = 0; i < headerRow.cells.length; i++) {
      const sortIcon = headerRow.cells[i].querySelector('.macroscalc-sort-icon');
      if (sortIcon) {
        if (i === columnIndex) {
          sortIcon.textContent = ascending ? '↑' : '↓';
          sortIcon.classList.add('active');
        } else {
          sortIcon.textContent = '⇅';
          sortIcon.classList.remove('active');
        }
      }
    }

    const allRows = Array.from(table.rows);
    const dataRowsWithDetails = allRows.slice(1, allRows.length - 1);
    const aggregateRow = allRows[allRows.length - 1];

    if (dataRowsWithDetails.length === 0) return;

    const rowGroups: Array<{ mainRow: HTMLTableRowElement; detailRow?: HTMLTableRowElement }> = [];
    let currentMainRow: HTMLTableRowElement | null = null;

    dataRowsWithDetails.forEach((row: HTMLTableRowElement) => {
      if (!row.classList.contains('macroscalc-detail-row')) {
        currentMainRow = row;
        rowGroups.push({ mainRow: currentMainRow });
      } else if (currentMainRow && row.classList.contains('macroscalc-detail-row')) {
        const lastGroup = rowGroups[rowGroups.length - 1];
        if (lastGroup) {
          lastGroup.detailRow = row;
        }
      }
    });

    rowGroups.sort((a, b) => {
      const aValue = a.mainRow.cells[columnIndex].textContent || '';
      const bValue = b.mainRow.cells[columnIndex].textContent || '';

      if (columnIndex > 0) {
        let aNum = 0;
        let bNum = 0;

        if (columnIndex === 1 && (aValue.includes('kJ') || bValue.includes('kJ'))) {
          const aKjMatch = aValue.match(/^([\d.]+)\s*kJ/);
          const bKjMatch = bValue.match(/^([\d.]+)\s*kJ/);

          if (aKjMatch) {
            aNum = convertEnergyUnit(parseFloat(aKjMatch[1]), 'kJ', 'kcal');
          } else {
            const aKcalMatch = aValue.match(/^([\d.]+)/);
            aNum = aKcalMatch ? parseFloat(aKcalMatch[1]) : 0;
          }

          if (bKjMatch) {
            bNum = convertEnergyUnit(parseFloat(bKjMatch[1]), 'kJ', 'kcal');
          } else {
            const bKcalMatch = bValue.match(/^([\d.]+)/);
            bNum = bKcalMatch ? parseFloat(bKcalMatch[1]) : 0;
          }
        } else {
          const aNumMatch = aValue.match(/^([\d.]+)/);
          const bNumMatch = bValue.match(/^([\d.]+)/);

          aNum = aNumMatch ? parseFloat(aNumMatch[1]) : 0;
          bNum = bNumMatch ? parseFloat(bNumMatch[1]) : 0;
        }

        if (ascending) {
          return aNum - bNum;
        } else {
          return bNum - aNum;
        }
      } else {
        if (ascending) {
          return aValue.localeCompare(bValue);
        } else {
          return bValue.localeCompare(aValue);
        }
      }
    });

    const tbody = table.tBodies[0];
    const headerClone = table.rows[0];

    while (tbody.rows.length > 0) {
      tbody.deleteRow(0);
    }

    tbody.appendChild(headerClone);

    rowGroups.forEach((group, index) => {
      if (index % 2 === 1) {
        group.mainRow.classList.add('macroscalc-alt-row');
      } else {
        group.mainRow.classList.remove('macroscalc-alt-row');
      }

      tbody.appendChild(group.mainRow);

      if (group.detailRow) {
        tbody.appendChild(group.detailRow);
      }
    });

    tbody.appendChild(aggregateRow);

    for (let i = 0; i < headerRow.cells.length; i++) {
      const sortIcon = headerRow.cells[i].querySelector('.macroscalc-sort-icon');
      if (sortIcon) {
        const newSortIcon = sortIcon.cloneNode(true) as HTMLElement;
        sortIcon.parentNode?.replaceChild(newSortIcon, sortIcon);

        const headerText = Array.from(Object.keys(headers)).find((key) => headers[key] === i);

        if (headerText) {
          newSortIcon.addEventListener('click', () => {
            this.sortTable(table, headerText);
          });
        }
      }
    }
  }

  /**
   * Get the set of expanded row IDs.
   */
  getExpandedRows(): Set<string> {
    return this.expandedRows;
  }

  /**
   * Get the current sort configuration.
   */
  getSortConfig(): { column: string; ascending: boolean } {
    return { ...this.sortConfig };
  }
}
