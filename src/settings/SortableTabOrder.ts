import { Component } from 'obsidian';
import MacrosPlugin from '../main';
import { t } from '../lang/I18nManager';

/**
 * SortableTabOrder
 * ----------------
 * Drag-and-drop component for reordering the "Add to Macros" tabs
 * (meals / foods / group) in the settings display tab.
 */
export class SortableTabOrder extends Component {
  private plugin: MacrosPlugin;
  private containerEl: HTMLElement;
  private listEl!: HTMLElement;
  private draggedItem: HTMLElement | null = null;
  private draggedIndex = -1;

  constructor(plugin: MacrosPlugin, containerEl: HTMLElement) {
    super();
    this.plugin = plugin;
    this.containerEl = containerEl;
  }

  create(): void {
    const sortableContainer = this.containerEl.createDiv({
      cls: 'sortable-tab-order-container',
    });

    sortableContainer.createEl('p', {
      text: t('settings.display.tabOrderInstructions'),
      cls: 'sortable-instructions',
    });

    this.listEl = sortableContainer.createEl('ul', {
      cls: 'sortable-tab-list',
    });

    this.render();
    this.setupEventListeners();
  }

  private render(): void {
    this.listEl.empty();

    const tabOrder = this.plugin.settings.addToMacrosTabOrder;

    tabOrder.forEach((tabKey, index) => {
      const listItem = this.listEl.createEl('li', {
        cls: 'sortable-tab-item',
        attr: {
          'data-tab-key': tabKey,
          'data-index': index.toString(),
          draggable: 'true',
        },
      });

      listItem.createSpan({
        cls: 'drag-handle',
        text: '⋮⋮',
        attr: { title: t('settings.display.dragToReorder') },
      });

      const tabContent = listItem.createDiv({ cls: 'tab-content' });
      const tabLabel = this.getTabLabel(tabKey);

      tabContent.createSpan({ cls: 'tab-label', text: tabLabel });

      listItem.createSpan({
        cls: 'position-indicator',
        text: (index + 1).toString(),
      });
    });
  }

  private getTabLabel(tabKey: string): string {
    switch (tabKey) {
      case 'meals':
        return t('meals.addTo.mealTemplates');
      case 'foods':
        return t('meals.addTo.individualFoods');
      case 'group':
        return t('meals.addTo.createGroup');
      default:
        return tabKey;
    }
  }

  private setupEventListeners(): void {
    this.registerDomEvent(this.listEl, 'dragstart', (e: DragEvent) => {
      const target = e.target as HTMLElement;
      const listItem = target.closest<HTMLElement>('.sortable-tab-item');

      if (listItem) {
        this.draggedItem = listItem;
        this.draggedIndex = parseInt(listItem.dataset.index || '0');

        listItem.classList.add('dragging');

        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/html', listItem.outerHTML);
        }
      }
    });

    this.registerDomEvent(this.listEl, 'dragend', (_e: DragEvent) => {
      if (this.draggedItem) {
        this.draggedItem.classList.remove('dragging');
        this.draggedItem = null;
        this.draggedIndex = -1;
      }

      this.listEl.querySelectorAll('.sortable-tab-item').forEach((item) => {
        item.classList.remove('drag-over', 'drag-over-before', 'drag-over-after');
      });
    });

    this.registerDomEvent(this.listEl, 'dragover', (e: DragEvent) => {
      e.preventDefault();

      const target = e.target as HTMLElement;
      const listItem = target.closest<HTMLElement>('.sortable-tab-item');

      if (listItem && listItem !== this.draggedItem) {
        this.listEl.querySelectorAll('.sortable-tab-item').forEach((item) => {
          item.classList.remove('drag-over', 'drag-over-before', 'drag-over-after');
        });

        const rect = listItem.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;

        if (e.clientY < midpoint) {
          listItem.classList.add('drag-over-before');
        } else {
          listItem.classList.add('drag-over-after');
        }
      }
    });

    this.registerDomEvent(this.listEl, 'drop', async (e: DragEvent) => {
      e.preventDefault();

      if (!this.draggedItem) return;

      const target = e.target as HTMLElement;
      const dropTarget = target.closest<HTMLElement>('.sortable-tab-item');

      if (dropTarget && dropTarget !== this.draggedItem) {
        const dropIndex = parseInt(dropTarget.dataset.index || '0');
        const rect = dropTarget.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;

        let newIndex = dropIndex;
        if (e.clientY >= midpoint) {
          newIndex = dropIndex + 1;
        }

        await this.moveTab(this.draggedIndex, newIndex);
      }

      this.listEl.querySelectorAll('.sortable-tab-item').forEach((item) => {
        item.classList.remove('drag-over', 'drag-over-before', 'drag-over-after', 'dragging');
      });
    });
  }

  private async moveTab(fromIndex: number, toIndex: number): Promise<void> {
    const tabOrder = [...this.plugin.settings.addToMacrosTabOrder];

    if (fromIndex < toIndex) {
      toIndex--;
    }

    const [movedItem] = tabOrder.splice(fromIndex, 1);
    tabOrder.splice(toIndex, 0, movedItem);

    this.plugin.settings.addToMacrosTabOrder = tabOrder;
    await this.plugin.saveData(this.plugin.settings);

    this.render();
  }
}
