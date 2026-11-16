import type { UnifiedFoodResult } from '../../core/search';
import {
  MICRONUTRIENT_KEYS,
  MICRONUTRIENT_MAP,
  formatMicroAmount,
} from '../../utils/nutrition/micronutrients';
import { t } from '../../lang/I18nManager';

/**
 * SearchRenderer
 * --------------
 * Renders food search results in the LiveFoodSearchModal.
 * Extracted from LiveSearchModal to isolate UI rendering concerns.
 */
export class SearchRenderer {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * Render search results in the container.
   */
  renderResults(
    searchTerm: string,
    results: UnifiedFoodResult[],
    isBarcodeSearch: boolean,
    _selectedIndex: number,
    onResultClick: (food: UnifiedFoodResult) => void,
    onResultMouseEnter: (index: number) => void
  ): void {
    this.container.empty();

    if (results.length === 0) {
      // No results message is handled by the caller
      return;
    }

    const normalizedQuery = searchTerm.toLowerCase();
    const escapedSearchTerm = this.escapeRegExp(searchTerm);

    // For barcode searches, show all results regardless of name matching
    const resultsToShow = isBarcodeSearch
      ? results
      : results.filter((food) => food.name.toLowerCase().includes(normalizedQuery));

    resultsToShow.forEach((food, index) => {
      const foodDiv = this.container.createDiv({
        cls: `food-result-item ${isBarcodeSearch ? 'barcode-result' : ''}`,
      });

      // Create main content container
      const contentDiv = foodDiv.createDiv({ cls: 'food-result-content' });

      // Food name with highlighting and brand info
      const nameDiv = contentDiv.createDiv({ cls: 'food-result-name' });
      const nameContentDiv = nameDiv.createDiv({ cls: 'food-name-content' });

      // Only highlight text matches for non-barcode searches
      if (isBarcodeSearch) {
        // For barcode searches, just show the name without highlighting
        nameContentDiv.createSpan({ text: food.name });
      } else {
        // For text searches, highlight matching text
        const regex = new RegExp(`(${escapedSearchTerm})`, 'gi');
        const parts = food.name.split(regex);

        parts.forEach((part) => {
          if (part.toLowerCase() === searchTerm.toLowerCase()) {
            nameContentDiv.createEl('strong', { text: part });
          } else if (part) {
            nameContentDiv.createSpan({ text: part });
          }
        });
      }

      // Add brand name if available
      if (food.brandName) {
        nameContentDiv.createSpan({
          cls: 'food-brand-name',
          text: ` (${food.brandName})`,
        });
      }

      // Create enhanced chips container
      const chipsDiv = nameDiv.createDiv({ cls: 'food-result-chips' });

      // Add enhanced source chip with more specific labeling
      let sourceLabel = '';
      let chipClass = `macros-source-chip macros-source-${food.source}`;

      if (food.source === 'usda') {
        if (food.isFoundation) {
          sourceLabel = 'USDA Foundation';
          chipClass += ' macros-source-foundation';
        } else if (food.isSrLegacy) {
          sourceLabel = 'USDA SR Legacy';
          chipClass += ' macros-source-sr-legacy';
        } else if (food.isBranded) {
          sourceLabel = 'USDA Branded';
          chipClass += ' macros-source-branded';
        } else {
          sourceLabel = 'USDA';
        }
      } else if (food.source === 'openfoodfacts') {
        sourceLabel = 'Open Food Facts';
        chipClass += ' macros-source-openfoodfacts';
      } else {
        sourceLabel = t(`food.search.source.${food.source}`);
      }

      chipsDiv.createSpan({
        cls: chipClass,
        text: sourceLabel,
      });

      // Add quality indicators for different sources
      if (food.isFoundation) {
        chipsDiv.createSpan({
          cls: 'macros-quality-chip macros-foundation-indicator',
          text: 'High Quality',
          attr: {
            title: 'Foundation data is the most reliable and comprehensive USDA data',
          },
        });
      } else if (food.source === 'openfoodfacts') {
        // Add data quality indicator for Open Food Facts
        if (food.dataQuality === 'high') {
          chipsDiv.createSpan({
            cls: 'macros-quality-chip macros-off-high-quality',
            text: 'High Quality',
            attr: { title: 'High quality Open Food Facts data' },
          });
        } else if (food.dataQuality === 'medium') {
          chipsDiv.createSpan({
            cls: 'macros-quality-chip macros-off-medium-quality',
            text: 'Medium Quality',
            attr: { title: 'Medium quality Open Food Facts data' },
          });
        }

        // Add nutrition grade if available
        if (
          food.nutritionGrade &&
          ['A', 'B', 'C', 'D', 'E'].includes(food.nutritionGrade.toUpperCase())
        ) {
          chipsDiv.createSpan({
            cls: `macros-nutrition-grade macros-nutrition-grade-${food.nutritionGrade.toLowerCase()}`,
            text: `Grade ${food.nutritionGrade.toUpperCase()}`,
            attr: { title: 'Nutri-Score nutrition grade' },
          });
        }

        // Add NOVA group indicator if available
        if (food.novaGroup && food.novaGroup >= 1 && food.novaGroup <= 4) {
          chipsDiv.createSpan({
            cls: `macros-nova-chip macros-nova-${food.novaGroup}`,
            text: `NOVA ${food.novaGroup}`,
            attr: { title: 'NOVA food processing classification' },
          });
        }
      }

      // Food description
      contentDiv.createDiv({
        cls: 'food-result-description',
        text: food.description,
      });

      // Micronutrient summary
      this.renderMicronutrientSummary(contentDiv, food);

      // Add product image for Open Food Facts if available
      if (food.source === 'openfoodfacts' && food.imageUrl) {
        const imageDiv = contentDiv.createDiv({ cls: 'food-result-image' });
        const img = imageDiv.createEl('img', {
          attr: {
            src: food.imageUrl,
            alt: food.name,
            loading: 'lazy',
          },
          cls: 'food-product-image',
        });

        // Handle image load errors gracefully
        img.addEventListener('error', () => {
          imageDiv.addClass('macros-u-hidden');
        });
      }

      if (index === _selectedIndex) {
        foodDiv.addClass('highlighted-result');
      }

      foodDiv.addEventListener('click', () => {
        void onResultClick(food);
      });

      foodDiv.addEventListener('mouseenter', () => {
        void onResultMouseEnter(index);
      });
    });
  }

  /**
   * Render a compact micronutrient summary for a result.
   */
  renderMicronutrientSummary(container: HTMLElement, food: UnifiedFoodResult): void {
    const micros = food.micronutrients;
    if (!micros) return;

    const presentKeys = MICRONUTRIENT_KEYS.filter(
      (key) => micros[key] != null && Number.isFinite(micros[key]) && micros[key] !== 0
    );
    if (presentKeys.length === 0) return;

    const grams = food.gramsServing || 100;
    const microsDiv = container.createDiv({ cls: 'food-result-micros' });
    microsDiv.createSpan({
      cls: 'food-result-micros-label',
      text: t('food.search.micronutrients', { grams: String(grams) }),
    });

    const chipsWrap = microsDiv.createDiv({ cls: 'food-result-micros-chips' });
    for (const key of presentKeys) {
      const def = MICRONUTRIENT_MAP[key];
      const label = def ? def.label : key;
      const unit = def ? def.unit : '';
      chipsWrap.createSpan({
        cls: 'food-result-micro-chip',
        text: `${label} ${formatMicroAmount(micros[key])}${unit}`,
      });
    }
  }

  /**
   * Escape special characters in a string for use in a regular expression.
   */
  escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Highlight selected result in the list.
   */
  highlightSelectedResult(selectedIndex: number, onHighlightChange: (index: number) => void): void {
    const items = this.container.querySelectorAll('.food-result-item');
    items.forEach((item, index) => {
      if (index === selectedIndex) {
        item.classList.add('highlighted-result');
      } else {
        item.classList.remove('highlighted-result');
      }
    });
    onHighlightChange(selectedIndex);
  }

  /**
   * Scroll the selected result into view.
   */
  scrollSelectedIntoView(_selectedIndex: number): void {
    const selectedElement = this.container.querySelector('.food-result-item.highlighted-result');
    if (selectedElement) {
      selectedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  /**
   * Clear all rendered results.
   */
  clear(): void {
    this.container.empty();
  }
}
