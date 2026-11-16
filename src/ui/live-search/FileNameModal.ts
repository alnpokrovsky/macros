import { App, Component, Modal, Notice } from 'obsidian';
import type MacrosPlugin from '../../main';
import { t } from '../../lang/I18nManager';

/**
 * FileNameModal
 * -------------
 * Modal for entering a file name and default serving size when saving
 * a food search result to the vault.
 * Extracted from LiveFoodSearchModal to isolate the file name input UI.
 */
export class FileNameModal extends Modal {
  private fileNameInput!: HTMLInputElement;
  private defaultServingInput!: HTMLInputElement;
  private submitButton!: HTMLElement;
  private component: Component;
  private isSubmitting = false;

  constructor(
    app: App,
    private defaultName: string,
    private originalServingSize: number,
    private onSubmit: (fileName: string, defaultServing?: number) => Promise<boolean>,
    private plugin?: MacrosPlugin
  ) {
    super(app);
    this.component = new Component();
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('file-name-modal');

    contentEl.createEl('h2', {
      text: 'Save food item',
      cls: 'modal-title',
    });

    contentEl.createEl('p', {
      text: 'Please enter a name and default serving size for this food item:',
      cls: 'modal-description',
    });

    const inputContainer = contentEl.createDiv({ cls: 'modal-content' });

    // File name input section
    const nameSection = inputContainer.createDiv({ cls: 'setting-item' });
    const nameInfo = nameSection.createDiv({ cls: 'setting-item-info' });
    nameInfo.createDiv({
      text: 'File Name:',
      cls: 'setting-item-name',
    });

    const nameControl = nameSection.createDiv({ cls: 'setting-item-control' });
    this.fileNameInput = nameControl.createEl('input', {
      type: 'text',
      cls: 'mod-text',
      value: this.defaultName,
    });

    // Default serving size input section
    const servingSection = inputContainer.createDiv({ cls: 'setting-item' });
    const servingInfo = servingSection.createDiv({ cls: 'setting-item-info' });
    servingInfo.createDiv({
      text: 'Default Serving Size (grams):',
      cls: 'setting-item-name',
    });
    servingInfo.createDiv({
      text: `Optional: Set a custom default serving size for when you add this food to your macros. If not set, it will use ${this.originalServingSize}g from the API.`,
      cls: 'setting-item-description',
    });

    const servingControl = servingSection.createDiv({ cls: 'setting-item-control' });
    this.defaultServingInput = servingControl.createEl('input', {
      type: 'number',
      cls: 'mod-text',
      value: this.originalServingSize.toString(),
      attr: {
        min: '1',
        step: '0.1',
        placeholder: this.originalServingSize.toString(),
      },
    });

    // Button container
    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

    const cancelButton = buttonContainer.createEl('button', {
      text: 'Cancel',
      cls: 'mod-button',
    });

    this.submitButton = buttonContainer.createEl('button', {
      text: 'Save',
      cls: 'mod-button mod-cta',
    });

    // Event handlers
    this.component.registerDomEvent(cancelButton, 'click', () => {
      this.close();
    });

    this.component.registerDomEvent(this.submitButton, 'click', async () => {
      await this.handleSubmit();
    });

    this.component.registerDomEvent(this.fileNameInput, 'keydown', async (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.defaultServingInput.focus();
      } else if (event.key === 'Escape') {
        this.close();
      }
    });

    this.component.registerDomEvent(
      this.defaultServingInput,
      'keydown',
      async (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          await this.handleSubmit();
        } else if (event.key === 'Escape') {
          this.close();
        }
      }
    );

    // Auto-focus and select text
    window.setTimeout(() => {
      this.fileNameInput.focus();
      this.fileNameInput.select();
    }, 50);
  }

  private async handleSubmit(): Promise<void> {
    if (this.isSubmitting) return;

    const fileName = this.fileNameInput.value.trim();
    const defaultServingStr = this.defaultServingInput.value.trim();

    if (!fileName) {
      new Notice('Please enter a file name.');
      this.fileNameInput.focus();
      return;
    }

    const defaultServing = parseFloat(defaultServingStr);
    if (isNaN(defaultServing) || defaultServing <= 0) {
      new Notice('Please enter a valid serving size greater than 0.');
      this.defaultServingInput.focus();
      return;
    }

    this.isSubmitting = true;
    (this.submitButton as HTMLButtonElement).disabled = true;
    this.submitButton.textContent = 'Saving...';

    try {
      const shouldClose = await this.onSubmit(fileName, defaultServing);
      if (shouldClose) {
        this.close();
      }
    } catch (error) {
      this.plugin?.logger.error('Error saving food item:', error);
      new Notice(t('food.search.error.saveFailed'));
    } finally {
      this.isSubmitting = false;
      (this.submitButton as HTMLButtonElement).disabled = false;
      this.submitButton.textContent = 'Save';
    }
  }
}
