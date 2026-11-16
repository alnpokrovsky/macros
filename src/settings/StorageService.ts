import { DEFAULT_SETTINGS } from './settingsSchema';
import { ToleranceData } from '../ui/modals/ToleranceModal';
import type { MicronutrientProfile } from '../utils/nutrition/micronutrients';

// Export interfaces and default settings
export interface MealTemplate {
  name: string;
  items: string[];
}

export interface MetricConfig {
  id: string;
  enabled: boolean;
  settings?: Record<string, unknown>;
}

export interface PluginSettings {
  storageFolder: string;
  proteinColor: string;
  fatColor: string;
  carbsColor: string;
  mealTemplates: MealTemplate[];
  fatSecretApiKey: string;
  fatSecretApiSecret: string;
  fatSecretEnabled: boolean;
  usdaEnabled: boolean;
  usdaApiKey: string;
  // NEW: Open Food Facts settings
  openFoodFactsEnabled: boolean;
  openFoodFactsLanguage: string; // 'auto', 'en', 'fr', 'de', 'es', etc.
  openFoodFactsDataQualityFilter: 'all' | 'medium' | 'high';
  dailyCaloriesTarget: number;
  dailyProteinTarget: number;
  dailyFatTarget: number;
  dailyCarbsTarget: number;
  showSummaryRows: boolean;
  disableTooltips: boolean;
  showCellPercentages: boolean;
  developerModeEnabled: boolean;
  uiCollapseStates?: Record<string, boolean>;
  energyUnit: 'kcal' | 'kJ';
  addToMacrosTabOrder: ('meals' | 'foods' | 'group')[];
  // Rename tracking settings
  followRenamesEnabled: boolean;
  autoConfirmRenames: boolean;
  backupOnRename: boolean;
  caseSensitiveFoodMatch: boolean;
  includeAliasesOnRename: boolean;
  // Macroscalc metrics configuration
  macroscalcMetricsConfigs: MetricConfig[];
  // NEW: Food tolerances/intolerances
  foodTolerances: Record<string, ToleranceData>;
  // NEW: Micronutrient tracking
  // Master toggle for the micronutrient tracking feature.
  micronutrientTrackingEnabled: boolean;
  // Personal profile used to derive default (recommended) micronutrient targets.
  micronutrientProfile: MicronutrientProfile;
  // User overrides for individual micronutrient targets (key -> amount). When a
  // key is absent the recommended value derived from the profile is used.
  micronutrientTargets: Record<string, number>;
  // Micronutrient keys the user cares about. Pinned nutrients are pre-added in
  // manual food entry and always shown in the micronutrient table; when any are
  // pinned, the remaining nutrients are collapsed behind a "show more" toggle.
  pinnedMicronutrients: string[];
}
export { DEFAULT_SETTINGS };
