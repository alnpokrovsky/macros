import { normalizePath, TFile, Notice } from 'obsidian';
import type { App } from 'obsidian';
import type MacrosPlugin from '../../main';
import type { UnifiedFoodResult } from '../../core/search';
import {
  MICRONUTRIENT_KEYS,
  MICRONUTRIENT_MAP,
  formatMicroAmount,
} from '../../utils/nutrition/micronutrients';
import { fetchFatSecretMicronutrients } from '../../core/api';

/**
 * FoodFileSaver
 * -------------
 * Handles saving food search results as markdown files in the vault.
 * Extracted from LiveFoodSearchModal to isolate file creation concerns.
 */
export class FoodFileSaver {
  private app: App;
  private plugin: MacrosPlugin | undefined;

  constructor(app: App, plugin: MacrosPlugin | undefined) {
    this.app = app;
    this.plugin = plugin;
  }

  /**
   * Sanitize filename - MUST match DataManager.createSafeFileName()
   */
  sanitizeFileName(fileName: string): string {
    return fileName
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid filename characters
      .replace(/\s+/g, ' ') // Normalize spaces
      .replace(/^\s+|\s+$/g, '') // Trim whitespace
      .substring(0, 100) // Limit length
      .replace(/\.$/, ''); // Remove trailing period if present
  }

  /**
   * Check if a file with the given name already exists in the storage folder.
   */
  async checkFileExists(fileName: string): Promise<{
    exists: boolean;
    path?: string;
  }> {
    if (!this.plugin) return { exists: false };

    try {
      const safeFileName = this.sanitizeFileName(fileName);
      const folder = normalizePath(this.plugin.settings.storageFolder);
      const filePath = normalizePath(`${folder}/${safeFileName}.md`);

      // Use proper Obsidian API to check file existence
      const existingFile = this.app.vault.getAbstractFileByPath(filePath);

      // Ensure it's actually a file, not a folder
      const exists = existingFile instanceof TFile;

      this.plugin.logger.debug(`File existence check: ${safeFileName}.md -> ${exists}`);

      return { exists, path: filePath };
    } catch (error) {
      this.plugin.logger.error('Error checking file existence:', error);
      return { exists: false };
    }
  }

  /**
   * Save a food search result as a markdown file in the vault.
   */
  async saveFoodFile(
    food: UnifiedFoodResult,
    fileName: string,
    defaultServing?: number
  ): Promise<void> {
    if (!this.plugin) return;

    // Extract nutrition data from the food result
    let calories = 0;
    let protein = 0;
    let fat = 0;
    let carbs = 0;

    // For Open Food Facts, we have direct access to nutrition data
    if (food.source === 'openfoodfacts' && food.raw && typeof food.raw === 'object') {
      const offData = food.raw as Record<string, unknown>;
      calories = (offData.calories as number) || 0;
      protein = (offData.protein as number) || 0;
      fat = (offData.fat as number) || 0;
      carbs = (offData.carbs as number) || 0;
    } else {
      // Parse nutrition data from description for other sources
      if (food.description) {
        const caloriesMatch = food.description.match(/Calories:\s*(\d+(?:\.\d+)?)/i);
        const proteinMatch = food.description.match(/Protein:\s*(\d+(?:\.\d+)?)g/i);
        const fatMatch = food.description.match(/Fat:\s*(\d+(?:\.\d+)?)g/i);
        const carbsMatch = food.description.match(/Carbs:\s*(\d+(?:\.\d+)?)g/i);

        calories = caloriesMatch ? parseFloat(caloriesMatch[1]) : 0;
        protein = proteinMatch ? parseFloat(proteinMatch[1]) : 0;
        fat = fatMatch ? parseFloat(fatMatch[1]) : 0;
        carbs = carbsMatch ? parseFloat(carbsMatch[1]) : 0;
      }
    }

    const servingSize = food.gramsServing || 100;

    // Resolve micronutrients for this food. USDA and Open Food Facts attach
    // canonical per-100g data to the search result; FatSecret only exposes it
    // via a detail lookup, so fetch it on demand here.
    let micronutrients: Record<string, number> = {};
    if (food.micronutrients && typeof food.micronutrients === 'object') {
      micronutrients = { ...food.micronutrients };
    }
    if (
      Object.keys(micronutrients).length === 0 &&
      food.source === 'fatsecret' &&
      food.raw &&
      typeof food.raw === 'object'
    ) {
      const foodId = (food.raw as Record<string, string>).food_id;
      const fsKey = this.plugin.settings.fatSecretApiKey?.trim();
      const fsSecret = this.plugin.settings.fatSecretApiSecret?.trim();
      if (foodId && fsKey && fsSecret) {
        try {
          const fsMicros = await fetchFatSecretMicronutrients(
            this.app,
            String(foodId),
            fsKey,
            fsSecret
          );
          if (fsMicros) micronutrients = fsMicros.micronutrients;
        } catch (microErr) {
          this.plugin.logger.error('Error fetching FatSecret micronutrients:', microErr);
        }
      }
    }
    // Source values are per 100g; rescale to the stored serving size so they
    // match the macros and the scaling done by extractMicronutrients().
    if (Object.keys(micronutrients).length > 0 && servingSize !== 100) {
      const microScale = servingSize / 100;
      const rescaled: Record<string, number> = {};
      for (const [k, v] of Object.entries(micronutrients)) rescaled[k] = v * microScale;
      micronutrients = rescaled;
    }

    // Create the markdown content
    const fdcId =
      food.source === 'usda' && food.raw && typeof food.raw === 'object' && 'fdcId' in food.raw
        ? String((food.raw as Record<string, string>).fdcId)
        : '';

    // Sanitize filename for actual file creation
    const safeFileName = this.sanitizeFileName(fileName);

    let frontmatter = `---
calories: ${calories}
protein: ${protein}
fat: ${fat}
carbs: ${carbs}
serving_size: ${servingSize}g${defaultServing ? `\ndefault_serving_size: ${defaultServing}g` : ''}
source: ${food.source}`;

    // Add source-specific metadata
    if (food.source === 'usda') {
      frontmatter += `\nfdc_id: ${fdcId}\ndata_type: ${food.dataType || ''}`;
    } else if (food.source === 'openfoodfacts') {
      const offCode =
        food.raw && typeof food.raw === 'object' && 'code' in food.raw
          ? String((food.raw as Record<string, string>).code)
          : '';
      frontmatter += `\noff_code: ${offCode}`;
    }

    if (food.brandName) frontmatter += `\nbrand: ${food.brandName}`;
    if (food.nutritionGrade) frontmatter += `\nnutrition_grade: ${food.nutritionGrade}`;
    if (food.novaGroup) frontmatter += `\nnova_group: ${food.novaGroup}`;
    if (food.dataQuality) frontmatter += `\ndata_quality: ${food.dataQuality}`;

    // Add micronutrient keys (read back by extractMicronutrients()).
    for (const microKey of MICRONUTRIENT_KEYS) {
      const microValue = micronutrients[microKey];
      if (microValue == null || !Number.isFinite(microValue) || microValue === 0) continue;
      frontmatter += `\n${microKey}: ${formatMicroAmount(microValue)}`;
    }

    frontmatter += `\ncreated: ${new Date().toISOString()}
---

# ${fileName}

${food.description}

## Nutritional Information (per ${servingSize}g)
- **Calories:** ${calories} kcal
- **Protein:** ${protein}g
- **Fat:** ${fat}g
- **Carbohydrates:** ${carbs}g`;

    // Readable micronutrient breakdown for any nutrients that were resolved.
    const microKeysPresent = MICRONUTRIENT_KEYS.filter(
      (k) =>
        micronutrients[k] != null && Number.isFinite(micronutrients[k]) && micronutrients[k] !== 0
    );
    if (microKeysPresent.length > 0) {
      frontmatter += `\n\n## Micronutrients (per ${servingSize}g)`;
      for (const microKey of microKeysPresent) {
        const def = MICRONUTRIENT_MAP[microKey];
        const microLabel = def ? def.label : microKey;
        const microUnit = def ? def.unit : '';
        frontmatter += `\n- **${microLabel}:** ${formatMicroAmount(micronutrients[microKey])}${microUnit}`;
      }
    }

    let sourceText = '';
    if (food.source === 'usda') {
      sourceText = 'USDA FoodData Central';
    } else if (food.source === 'openfoodfacts') {
      sourceText = 'Open Food Facts (Community Database)';
    } else {
      sourceText = 'FatSecret';
    }

    frontmatter += `\n\n**Source:** ${sourceText}`;
    if (food.brandName) frontmatter += `\n**Brand:** ${food.brandName}`;
    if (food.nutritionGrade)
      frontmatter += `\n**Nutrition Grade:** ${food.nutritionGrade.toUpperCase()} (Nutri-Score)`;
    if (food.novaGroup) {
      const novaLabels = [
        '',
        'Unprocessed or minimally processed',
        'Processed culinary ingredients',
        'Processed foods',
        'Ultra-processed foods',
      ];
      frontmatter += `\n**Processing Level:** NOVA ${food.novaGroup} (${novaLabels[food.novaGroup]})`;
    }
    if (defaultServing && defaultServing !== servingSize) {
      frontmatter += `\n**Default Serving Size:** ${defaultServing}g`;
    }
    if (food.categories) frontmatter += `\n**Categories:** ${food.categories}`;
    if (food.ingredients) frontmatter += `\n\n**Ingredients:** ${food.ingredients}`;

    // Add data quality notice for Open Food Facts
    if (food.source === 'openfoodfacts' && food.dataQuality !== 'high') {
      frontmatter += `\n\n> **Note:** This data comes from the Open Food Facts community database. Please verify nutrition information if accuracy is critical for your needs.`;
    }

    const folderPath = normalizePath(this.plugin.settings.storageFolder);

    // Ensure folder exists
    const folder = this.app.vault.getFolderByPath(folderPath);
    if (!folder) {
      await this.app.vault.createFolder(folderPath);
    }

    const filePath = normalizePath(`${folderPath}/${safeFileName}.md`);

    try {
      // Use proper Obsidian API for file creation
      await this.app.vault.create(filePath, frontmatter);

      let successMessage = `Food item "${fileName}" saved successfully!`;
      if (defaultServing && defaultServing !== servingSize) {
        successMessage += ` Default serving: ${defaultServing}g`;
      }
      new Notice(successMessage);

      // Update the food object with the saved file name
      food.name = fileName;

      // Invalidate cache to make new file immediately available
      this.plugin.dataManager.invalidateFileCache();
    } catch (error) {
      if ((error as Error).message?.includes('already exists')) {
        throw new Error('File already exists. Please choose a different name.');
      }
      throw error;
    }
  }
}
