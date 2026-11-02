/**
 * Admin Feature Cards Manager
 * Handles client-side interactivity, live preview, reordering, validations, and AJAX sync.
 */
(function() {
  'use strict';

  const defaultState = {
    master: true,
    pages: {
      home: false,
      custom_order: true,
      about: true,
      design_detail: true,
      contact: true,
      categories: true
    },
    cards: [
      { id: 'card_1', title: 'Premium Quality', subtitle: 'Crafted with precision', icon: 'fa-solid fa-award', enabled: true, link: '', order: 1 },
      { id: 'card_2', title: 'Instant Download', subtitle: 'Get files immediately', icon: 'fa-solid fa-download', enabled: true, link: '', order: 2 },
      { id: 'card_3', title: '100% Tested', subtitle: 'Quality assured designs', icon: 'fa-solid fa-shield-halved', enabled: true, link: '', order: 3 },
      { id: 'card_4', title: 'Dedicated Support', subtitle: "We're here to help you", icon: 'fa-solid fa-headset', enabled: true, link: '', order: 4 }
    ]
  };

  class FeatureCardsManager {
    constructor() {
      this.state = this.loadInitialState();
      this.previewMode = 'desktop';
      this.initDom();
      this.bindEvents();
      this.renderPreview();
    }

    loadInitialState() {
      const inputEl = document.getElementById('featureCardsJsonInput');
      if (inputEl && inputEl.value) {
        try {
          const parsed = JSON.parse(inputEl.value);
          if (parsed && typeof parsed === 'object') {
            return {
              master: parsed.master !== false,
              pages: Object.assign({}, defaultState.pages, parsed.pages || {}),
              cards: Array.isArray(parsed.cards) && parsed.cards.length > 0 ? parsed.cards : JSON.parse(JSON.stringify(defaultState.cards))
            };
          }
        } catch (e) {
          console.warn('[FeatureCardsManager] Failed to parse initial JSON, using defaults:', e);
        }
      }
      return JSON.parse(JSON.stringify(defaultState));
    }

    initDom() {
      this.dom = {
        container: document.getElementById('featureCardsManagerBox'),
        jsonInput: document.getElementById('featureCardsJsonInput'),
        csrfToken: document.getElementById('featureCardsCsrfToken')?.value || '',
        masterToggle: document.getElementById('fcMasterToggle'),
        masterStatusText: document.getElementById('fcMasterStatusText'),
        pageCheckboxes: {
          home: document.getElementById('fcPageHome'),
          custom_order: document.getElementById('fcPageCustomOrder'),
          about: document.getElementById('fcPageAbout'),
          design_detail: document.getElementById('fcPageDesignDetail')
        },
        cardsContainer: document.getElementById('fcCardsContainer'),
        previewStage: document.getElementById('fcPreviewStage'),
        previewHiddenAlert: document.getElementById('fcPreviewHiddenAlert'),
        previewHiddenReason: document.getElementById('fcPreviewHiddenReason'),
        saveBtn: document.getElementById('fcSaveBtn'),
        saveFeedbackText: document.getElementById('fcSaveFeedbackText'),
        viewDesktopBtn: document.getElementById('fcViewDesktopBtn'),
        viewMobileBtn: document.getElementById('fcViewMobileBtn')
      };
    }

    bindEvents() {
      if (!this.dom.container) return;

      // Master Toggle
      if (this.dom.masterToggle) {
        this.dom.masterToggle.addEventListener('change', (e) => {
          this.state.master = e.target.checked;
          if (this.dom.masterStatusText) {
            this.dom.masterStatusText.textContent = this.state.master ? 'Active on enabled pages' : 'Hidden globally';
          }
          this.syncJsonInput();
          this.renderPreview();
        });
      }

      // Page Checkboxes
      Object.keys(this.dom.pageCheckboxes).forEach(pageKey => {
        const cb = this.dom.pageCheckboxes[pageKey];
        if (cb) {
          cb.addEventListener('change', (e) => {
            this.state.pages[pageKey] = e.target.checked;
            this.syncJsonInput();
            this.renderPreview();
          });
        }
      });

      // Card-specific events (delegation)
      this.dom.container.addEventListener('input', (e) => {
        const target = e.target;
        const cardId = target.dataset.cardId;
        if (!cardId) return;

        const card = this.getCard(cardId);
        if (!card) return;

        if (target.classList.contains('fc-card-input-title')) {
          card.title = target.value.trim().slice(0, 40);
          const counter = document.getElementById(`fcTitleCount_${cardId}`);
          if (counter) counter.textContent = `${target.value.length}/40`;
          this.syncJsonInput();
          this.renderPreview();
        } else if (target.classList.contains('fc-card-input-subtitle')) {
          card.subtitle = target.value.trim().slice(0, 80);
          const counter = document.getElementById(`fcSubCount_${cardId}`);
          if (counter) counter.textContent = `${target.value.length}/80`;
          this.syncJsonInput();
          this.renderPreview();
        } else if (target.classList.contains('fc-card-input-link')) {
          card.link = target.value.trim();
          this.syncJsonInput();
          this.renderPreview();
        } else if (target.classList.contains('fc-custom-icon-input')) {
          this.handleCustomIconInput(cardId, target.value.trim());
        }
      });

      this.dom.container.addEventListener('change', (e) => {
        const target = e.target;
        const cardId = target.dataset.cardId;
        if (!cardId) return;

        const card = this.getCard(cardId);
        if (!card) return;

        // Card Enable/Disable Toggle
        if (target.classList.contains('fc-card-toggle')) {
          card.enabled = target.checked;
          const cardEl = document.getElementById(`fcCardItem_${cardId}`);
          const badgeEl = document.getElementById(`fcBadgeHidden_${cardId}`);
          if (cardEl) {
            if (card.enabled) {
              cardEl.classList.remove('is-dimmed');
            } else {
              cardEl.classList.add('is-dimmed');
            }
          }
          if (badgeEl) {
            badgeEl.style.display = card.enabled ? 'none' : 'inline-block';
          }
          this.syncJsonInput();
          this.renderPreview();
        }

        // Icon Select Dropdown
        if (target.classList.contains('fc-icon-select')) {
          const val = target.value;
          const customRow = document.getElementById(`fcCustomIconRow_${cardId}`);
          if (val === '__custom__') {
            if (customRow) customRow.style.display = 'block';
            const customInput = customRow?.querySelector('.fc-custom-icon-input');
            const customVal = customInput ? customInput.value.trim() : card.icon;
            this.handleCustomIconInput(cardId, customVal || 'fa-solid fa-award');
          } else {
            if (customRow) customRow.style.display = 'none';
            card.icon = val;
            this.updateIconDisplay(cardId, val);
            this.syncJsonInput();
            this.renderPreview();
          }
        }
      });
    }

    getCard(cardId) {
      return this.state.cards.find(c => c.id === cardId);
    }

    handleCustomIconInput(cardId, customClass) {
      const card = this.getCard(cardId);
      if (!card) return;

      const feedbackEl = document.getElementById(`fcIconFeedback_${cardId}`);
      // Validate format: fa-solid fa-xxx or fa-xxx
      const isValid = /^fa-(solid|regular|brands)\s+fa-[a-z0-9-]+$/i.test(customClass) ||
                      /^fa-[a-z0-9-]+$/i.test(customClass);

      if (!customClass) {
        card.icon = 'fa-solid fa-award';
        if (feedbackEl) {
          feedbackEl.style.color = '#64748B';
          feedbackEl.textContent = 'Enter custom class (falls back to default icon).';
        }
      } else if (isValid) {
        card.icon = customClass;
        if (feedbackEl) {
          feedbackEl.style.color = '#16A34A';
          feedbackEl.innerHTML = '<i class="fa-solid fa-check"></i> Valid icon format';
        }
      } else {
        card.icon = 'fa-solid fa-award'; // fallback
        if (feedbackEl) {
          feedbackEl.style.color = '#DC2626';
          feedbackEl.innerHTML = '<i class="fa-solid fa-xmark"></i> Invalid format (e.g. use <code>fa-solid fa-heart</code>)';
        }
      }

      this.updateIconDisplay(cardId, card.icon);
      this.syncJsonInput();
      this.renderPreview();
    }

    updateIconDisplay(cardId, iconClass) {
      const previewBox = document.getElementById(`fcIconPreviewBox_${cardId}`);
      const miniIcon = document.getElementById(`fcMiniIcon_${cardId}`);
      const safeClass = this.escapeHtml(iconClass || 'fa-solid fa-award');
      if (previewBox) previewBox.innerHTML = `<i class="${safeClass}"></i>`;
      if (miniIcon) miniIcon.innerHTML = `<i class="${safeClass}"></i>`;
    }

    moveCard(cardId, delta) {
      const sorted = [...this.state.cards].sort((a, b) => (a.order || 0) - (b.order || 0));
      const idx = sorted.findIndex(c => c.id === cardId);
      if (idx === -1) return;

      const targetIdx = idx + delta;
      if (targetIdx < 0 || targetIdx >= sorted.length) return;

      // Swap orders
      const tempOrder = sorted[idx].order || (idx + 1);
      sorted[idx].order = sorted[targetIdx].order || (targetIdx + 1);
      sorted[targetIdx].order = tempOrder;

      // Re-sort state.cards
      this.state.cards.sort((a, b) => (a.order || 0) - (b.order || 0));

      // Reorder cards in DOM
      if (this.dom.cardsContainer) {
        this.state.cards.forEach((c) => {
          const el = document.getElementById(`fcCardItem_${c.id}`);
          if (el) this.dom.cardsContainer.appendChild(el);
        });
      }

      this.syncJsonInput();
      this.renderPreview();
    }

    switchPreviewMode(mode) {
      this.previewMode = mode;
      if (this.dom.viewDesktopBtn) {
        this.dom.viewDesktopBtn.classList.toggle('active', mode === 'desktop');
      }
      if (this.dom.viewMobileBtn) {
        this.dom.viewMobileBtn.classList.toggle('active', mode === 'mobile');
      }
      if (this.dom.previewStage) {
        this.dom.previewStage.className = `fc-preview-stage mode-${mode}`;
      }
      this.renderPreview();
    }

    renderPreview() {
      if (!this.dom.previewStage) return;

      // Check master toggle
      if (!this.state.master) {
        this.dom.previewStage.innerHTML = '';
        if (this.dom.previewHiddenAlert) {
          this.dom.previewHiddenAlert.style.display = 'block';
          if (this.dom.previewHiddenReason) {
            this.dom.previewHiddenReason.textContent = 'Feature cards are turned OFF by the master toggle above. They are hidden across all pages.';
          }
        }
        return;
      }

      // Filter enabled cards sorted by order
      const enabledCards = (this.state.cards || [])
        .filter(c => c.enabled !== false)
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

      if (enabledCards.length === 0) {
        this.dom.previewStage.innerHTML = '';
        if (this.dom.previewHiddenAlert) {
          this.dom.previewHiddenAlert.style.display = 'block';
          if (this.dom.previewHiddenReason) {
            this.dom.previewHiddenReason.textContent = 'All 4 feature cards are currently disabled. Enable at least 1 card to show them on the website.';
          }
        }
        return;
      }

      // Hide alert when active
      if (this.dom.previewHiddenAlert) {
        this.dom.previewHiddenAlert.style.display = 'none';
      }

      const count = enabledCards.length;
      const isMobile = this.previewMode === 'mobile';

      // Inline styles to ensure exact representation of desktop & mobile
      let gridStyle = '';
      if (isMobile) {
        gridStyle = (count === 1)
          ? 'display: grid; grid-template-columns: 1fr; gap: 10px; width: 100%;'
          : 'display: grid; grid-template-columns: 1fr 1fr; gap: 10px; width: 100%;';
      } else {
        gridStyle = `display: grid; grid-template-columns: repeat(${count}, 1fr); gap: 14px; width: 100%;`;
      }

      let cardsHtml = '';
      enabledCards.forEach(c => {
        const titleSafe = this.escapeHtml(c.title || 'Untitled');
        const subSafe = this.escapeHtml(c.subtitle || '');
        const iconSafe = this.escapeHtml(c.icon || 'fa-solid fa-award');
        const hasLink = Boolean(c.link && c.link.trim());

        if (isMobile) {
          // Mobile style matching public/css/main.css mobile view
          cardsHtml += `
            <div style="background: #FFFFFF; border: 1px solid #EFE7DD; border-radius: 14px; padding: 12px 10px; display: flex; flex-direction: column; align-items: center; text-align: center; justify-content: center; min-height: 124px; box-shadow: 0 2px 6px rgba(44, 24, 16, 0.04); position: relative;">
              ${hasLink ? '<span style="position: absolute; top: 6px; right: 6px; font-size: 0.65rem; background: #EFF6FF; color: #1D4ED8; border: 1px solid #BFDBFE; border-radius: 4px; padding: 1px 4px;"><i class="fa-solid fa-link"></i></span>' : ''}
              <div style="width: 32px; height: 32px; border-radius: 50%; background: #FDF4E7; color: #A93226; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; margin-bottom: 8px;">
                <i class="${iconSafe}"></i>
              </div>
              <strong style="font-size: 13px; font-weight: 700; color: #2C1810; line-height: 1.25; margin-bottom: 4px; word-break: break-word;">${titleSafe}</strong>
              <span style="font-size: 11px; color: #7D7168; line-height: 1.3; word-break: break-word;">${subSafe}</span>
            </div>
          `;
        } else {
          // Desktop style matching public/css/main.css desktop row
          cardsHtml += `
            <div style="background: #FFFFFF; border: 1px solid #EFE7DD; border-radius: 14px; padding: 14px 18px; display: flex; align-items: center; gap: 14px; box-shadow: 0 2px 8px rgba(44, 24, 16, 0.03); position: relative;">
              ${hasLink ? '<span style="position: absolute; top: 6px; right: 8px; font-size: 0.68rem; background: #EFF6FF; color: #1D4ED8; border: 1px solid #BFDBFE; border-radius: 4px; padding: 1px 5px;"><i class="fa-solid fa-arrow-up-right-from-square"></i> Link</span>' : ''}
              <div style="width: 44px; height: 44px; border-radius: 50%; background: #FDF4E7; color: #A93226; display: flex; align-items: center; justify-content: center; font-size: 1.15rem; flex-shrink: 0;">
                <i class="${iconSafe}"></i>
              </div>
              <div style="display: flex; flex-direction: column; min-width: 0;">
                <strong style="font-size: 0.92rem; font-weight: 700; color: #2C1810; line-height: 1.3; margin-bottom: 2px; word-break: break-word;">${titleSafe}</strong>
                <span style="font-size: 0.78rem; color: #7D7168; line-height: 1.35; word-break: break-word;">${subSafe}</span>
              </div>
            </div>
          `;
        }
      });

      this.dom.previewStage.innerHTML = `
        <div style="${gridStyle}">
          ${cardsHtml}
        </div>
      `;
    }

    syncJsonInput() {
      if (this.dom.jsonInput) {
        this.dom.jsonInput.value = JSON.stringify(this.state);
      }
    }

    validateState() {
      for (const card of this.state.cards) {
        if (!card.title || !card.title.trim()) {
          return { valid: false, message: `Card ${card.order || card.id} requires a title (up to 40 characters).` };
        }
        if (card.title.length > 40) {
          return { valid: false, message: `Title for "${card.title}" exceeds the 40 characters limit.` };
        }
        if (card.subtitle && card.subtitle.length > 80) {
          return { valid: false, message: `Subtitle for "${card.title}" exceeds the 80 characters limit.` };
        }
      }

      if (this.state.master) {
        const enabledCount = this.state.cards.filter(c => c.enabled !== false).length;
        if (enabledCount === 0) {
          return { valid: false, message: 'At least one card must be enabled when feature cards are visible on the website.' };
        }
      }

      return { valid: true };
    }

    async saveChanges() {
      const validation = this.validateState();
      if (!validation.valid) {
        this.showToast(validation.message, 'error');
        return;
      }

      const saveBtn = this.dom.saveBtn;
      const originalHtml = saveBtn ? saveBtn.innerHTML : '';
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Saving...</span>';
      }

      this.syncJsonInput();

      try {
        const csrfToken = this.dom.csrfToken || document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
        const response = await fetch('/admin/api/feature-cards', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'CSRF-Token': csrfToken,
            'X-CSRF-Token': csrfToken,
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            feature_cards: this.state
          })
        });

        const data = await response.json();

        if (response.ok && data.success) {
          this.showToast('Feature cards updated and synchronized across all pages!', 'success');
          if (this.dom.saveFeedbackText) {
            this.dom.saveFeedbackText.style.display = 'inline-block';
            setTimeout(() => {
              if (this.dom.saveFeedbackText) this.dom.saveFeedbackText.style.display = 'none';
            }, 3000);
          }
        } else {
          this.showToast(data.message || 'Failed to save feature cards.', 'error');
        }
      } catch (err) {
        console.error('[FeatureCardsManager save error]:', err);
        this.showToast('Network error while saving feature cards: ' + err.message, 'error');
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = originalHtml;
        }
      }
    }

    resetToDefaults() {
      if (!confirm('Reset all 4 feature cards and page visibility settings to default values?')) {
        return;
      }

      this.state = JSON.parse(JSON.stringify(defaultState));

      // Reset Master Toggle
      if (this.dom.masterToggle) {
        this.dom.masterToggle.checked = this.state.master;
        if (this.dom.masterStatusText) {
          this.dom.masterStatusText.textContent = 'Active on enabled pages';
        }
      }

      // Reset Page Checkboxes
      if (this.dom.pageCheckboxes.home) this.dom.pageCheckboxes.home.checked = false;
      if (this.dom.pageCheckboxes.custom_order) this.dom.pageCheckboxes.custom_order.checked = true;
      if (this.dom.pageCheckboxes.about) this.dom.pageCheckboxes.about.checked = true;
      if (this.dom.pageCheckboxes.design_detail) this.dom.pageCheckboxes.design_detail.checked = true;

      // Reset Each Card in DOM
      this.state.cards.forEach((card, idx) => {
        const cardEl = document.getElementById(`fcCardItem_${card.id}`);
        const badgeEl = document.getElementById(`fcBadgeHidden_${card.id}`);
        const toggleEl = cardEl?.querySelector('.fc-card-toggle');
        const titleInput = cardEl?.querySelector('.fc-card-input-title');
        const subInput = cardEl?.querySelector('.fc-card-input-subtitle');
        const linkInput = cardEl?.querySelector('.fc-card-input-link');
        const iconSelect = cardEl?.querySelector('.fc-icon-select');
        const customRow = document.getElementById(`fcCustomIconRow_${card.id}`);

        if (cardEl) cardEl.classList.remove('is-dimmed');
        if (badgeEl) badgeEl.style.display = 'none';
        if (toggleEl) toggleEl.checked = true;
        if (titleInput) titleInput.value = card.title;
        if (subInput) subInput.value = card.subtitle;
        if (linkInput) linkInput.value = card.link;
        if (iconSelect) iconSelect.value = card.icon;
        if (customRow) customRow.style.display = 'none';

        const titleCount = document.getElementById(`fcTitleCount_${card.id}`);
        const subCount = document.getElementById(`fcSubCount_${card.id}`);
        if (titleCount) titleCount.textContent = `${card.title.length}/40`;
        if (subCount) subCount.textContent = `${card.subtitle.length}/80`;

        this.updateIconDisplay(card.id, card.icon);
      });

      this.syncJsonInput();
      this.renderPreview();
      this.showToast('Reset to default values. Click "Save Changes" to apply.', 'info');
    }

    showToast(message, type = 'info') {
      const existing = document.getElementById('fcToastNotification');
      if (existing) existing.remove();

      const toast = document.createElement('div');
      toast.id = 'fcToastNotification';
      const bgColor = type === 'success' ? '#16A34A' : (type === 'error' ? '#DC2626' : '#0284C7');
      const icon = type === 'success' ? 'fa-circle-check' : (type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info');

      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: ${bgColor};
        color: #FFFFFF;
        padding: 12px 20px;
        border-radius: 10px;
        font-size: 0.88rem;
        font-weight: 600;
        box-shadow: 0 10px 25px rgba(0,0,0,0.2);
        display: flex;
        align-items: center;
        gap: 10px;
        z-index: 99999;
        transition: opacity 0.3s ease, transform 0.3s ease;
        animation: fcSlideUp 0.3s ease;
      `;
      toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${this.escapeHtml(message)}</span>`;
      document.body.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    }

    escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  }

  // Auto-instantiate when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    window.featureCardsManager = new FeatureCardsManager();
  });
})();
