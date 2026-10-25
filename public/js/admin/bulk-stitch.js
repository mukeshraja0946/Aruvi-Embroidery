/**
 * Bulk Stitch Count Update Engine
 * Multi-step safe modal handling spreadsheet upload, rules, recalculation,
 * live preview, batch apply, and undo history.
 */

(function () {
  'use strict';

  // Global state for Bulk Stitch Modal
  let currentStep = 1;
  let previewData = null;
  let excludedRowSkus = new Set();
  let previewFilter = 'all'; // 'all' | 'changed' | 'errors' | 'unchanged'
  let previewSearch = '';
  let previewPage = 1;
  const PREVIEW_PAGE_SIZE = 15;
  let isApplying = false;

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.content) return meta.content;
    const input = document.querySelector('input[name="_csrf"]');
    return input ? input.value : '';
  }

  // Open modal
  window.openBulkStitchModal = function (preselectScope = null) {
    const modal = document.getElementById('bulkStitchModal');
    if (!modal) return;

    currentStep = 1;
    previewData = null;
    excludedRowSkus.clear();
    previewFilter = 'all';
    previewSearch = '';
    previewPage = 1;
    isApplying = false;

    // Reset forms and inputs
    const form = document.getElementById('bulkStitchForm');
    if (form) form.reset();

    const fileInput = document.getElementById('stitchSpreadsheetInput');
    if (fileInput) fileInput.value = '';
    const fileLabel = document.getElementById('stitchSpreadsheetFileName');
    if (fileLabel) fileLabel.textContent = 'No file chosen';

    // Handle selected rows count
    const checkedBoxes = document.querySelectorAll('.design-checkbox:checked');
    const selectedCount = checkedBoxes.length;
    const selectedBadge = document.getElementById('stitchModalSelectedCount');
    if (selectedBadge) selectedBadge.textContent = selectedCount;

    const scopeSelectedRadio = document.querySelector('input[name="stitchScope"][value="selected"]');
    const scopeSelectedLabel = document.getElementById('stitchScopeSelectedLabel');

    if (preselectScope === 'selected' && selectedCount > 0) {
      if (scopeSelectedRadio) scopeSelectedRadio.checked = true;
      if (scopeSelectedLabel) scopeSelectedLabel.style.display = 'flex';
      const ruleRadio = document.querySelector('input[name="stitchMethod"][value="rule"]');
      if (ruleRadio) ruleRadio.checked = true;
    } else {
      const scopeAllRadio = document.querySelector('input[name="stitchScope"][value="all"]');
      if (scopeAllRadio) scopeAllRadio.checked = true;
      if (scopeSelectedLabel) scopeSelectedLabel.style.display = selectedCount > 0 ? 'flex' : 'none';
    }

    renderStepViews();
    handleStitchMethodChange();
    handleStitchScopeChange();

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  };

  window.openBulkStitchModalForSelected = function () {
    window.openBulkStitchModal('selected');
  };

  window.closeBulkStitchModal = function () {
    if (isApplying) {
      if (!confirm('An update is currently in progress. Closing this modal will not stop background processing. Are you sure?')) {
        return;
      }
    }
    const modal = document.getElementById('bulkStitchModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
  };

  // Switch between Steps (1, 2, 3)
  function renderStepViews() {
    const s1 = document.getElementById('bulkStitchStep1');
    const s2 = document.getElementById('bulkStitchStep2');
    const s3 = document.getElementById('bulkStitchStep3');

    const tab1 = document.getElementById('stepStitchTab1');
    const tab2 = document.getElementById('stepStitchTab2');
    const tab3 = document.getElementById('stepStitchTab3');

    const footerS1 = document.getElementById('stitchFooterStep1');
    const footerS2 = document.getElementById('stitchFooterStep2');
    const footerS3 = document.getElementById('stitchFooterStep3');

    if (s1) s1.style.display = currentStep === 1 ? 'block' : 'none';
    if (s2) s2.style.display = currentStep === 2 ? 'block' : 'none';
    if (s3) s3.style.display = currentStep === 3 ? 'block' : 'none';

    if (footerS1) footerS1.style.display = currentStep === 1 ? 'flex' : 'none';
    if (footerS2) footerS2.style.display = currentStep === 2 ? 'flex' : 'none';
    if (footerS3) footerS3.style.display = currentStep === 3 ? 'flex' : 'none';

    // Stepper tab styling
    [tab1, tab2, tab3].forEach((tab, idx) => {
      if (!tab) return;
      const stepNum = idx + 1;
      if (stepNum === currentStep) {
        tab.style.background = '#4A148C'; // Deep Royal Violet/Indigo
        tab.style.color = '#FFFFFF';
      } else if (stepNum < currentStep) {
        tab.style.background = '#E8EAF6';
        tab.style.color = '#283593';
      } else {
        tab.style.background = '#ECEFF1';
        tab.style.color = '#546E7A';
      }
    });
  }

  // Handle method radio toggle
  window.handleStitchMethodChange = function () {
    const method = document.querySelector('input[name="stitchMethod"]:checked')?.value || 'spreadsheet';
    const spreadsheetBox = document.getElementById('stitchMethodSpreadsheetBox');
    const ruleBox = document.getElementById('stitchMethodRuleBox');
    const recalcBox = document.getElementById('stitchMethodRecalcBox');
    const targetingBox = document.getElementById('stitchTargetingBox');

    if (spreadsheetBox) spreadsheetBox.style.display = method === 'spreadsheet' ? 'block' : 'none';
    if (ruleBox) ruleBox.style.display = method === 'rule' ? 'block' : 'none';
    if (recalcBox) recalcBox.style.display = method === 'recalculate' ? 'block' : 'none';

    // Targeting scope is relevant for rule and recalculate, but not spreadsheet (spreadsheet targets by SKU)
    if (targetingBox) {
      targetingBox.style.display = method === 'spreadsheet' ? 'none' : 'block';
    }
  };

  // Handle target scope radio toggle
  window.handleStitchScopeChange = function () {
    const scope = document.querySelector('input[name="stitchScope"]:checked')?.value || 'all';
    const customBox = document.getElementById('stitchCustomFiltersBox');
    if (customBox) {
      customBox.style.display = scope === 'custom' ? 'block' : 'none';
    }
  };

  // File chosen event listener
  window.handleStitchFileSelected = function (input) {
    const label = document.getElementById('stitchSpreadsheetFileName');
    if (input.files && input.files[0]) {
      const file = input.files[0];
      if (label) label.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    } else {
      if (label) label.textContent = 'No file chosen';
    }
  };

  // Step 1 -> Step 2: Fetch and build preview
  window.proceedToStitchPreview = async function () {
    const method = document.querySelector('input[name="stitchMethod"]:checked')?.value || 'spreadsheet';
    const scope = document.querySelector('input[name="stitchScope"]:checked')?.value || 'all';
    const treatEmptyAsClear = document.getElementById('treatEmptyAsClearCheckbox')?.checked || false;
    const includeManualTotals = document.getElementById('includeManualTotalsCheckbox')?.checked || false;

    const checkedBoxes = Array.from(document.querySelectorAll('.design-checkbox:checked'));
    const selectedIds = checkedBoxes.map(cb => cb.value);

    const formData = new FormData();
    formData.append('_csrf', getCsrfToken());
    formData.append('method', method);
    formData.append('scope', scope);
    formData.append('treatEmptyAsClear', treatEmptyAsClear ? '1' : '0');
    formData.append('includeManualTotals', includeManualTotals ? '1' : '0');

    selectedIds.forEach(id => formData.append('selectedIds[]', id));

    if (method === 'spreadsheet') {
      const fileInput = document.getElementById('stitchSpreadsheetInput');
      if (!fileInput || !fileInput.files || !fileInput.files[0]) {
        alert('Please select an Excel (.xlsx) or CSV file first.');
        return;
      }
      formData.append('file', fileInput.files[0]);
    } else if (method === 'rule') {
      const targetField = document.getElementById('stitchRuleTargetField')?.value || 'stitch_count_front';
      const operation = document.getElementById('stitchRuleOperation')?.value || 'fixed';
      const valueInput = document.getElementById('stitchRuleValue');
      const val = valueInput ? valueInput.value.trim() : '';

      if (val === '' || isNaN(val)) {
        alert('Please enter a valid numeric value for the rule operation.');
        if (valueInput) valueInput.focus();
        return;
      }

      formData.append('targetField', targetField);
      formData.append('operation', operation);
      formData.append('value', val);
    }

    if (scope === 'custom') {
      const catSelect = document.getElementById('stitchFilterCategory');
      if (catSelect && catSelect.value) formData.append('categoryIds[]', catSelect.value);

      const statusSelect = document.getElementById('stitchFilterStatus');
      if (statusSelect && statusSelect.value) formData.append('status', statusSelect.value);

      const stitchSelect = document.getElementById('stitchFilterStitchStatus');
      if (stitchSelect && stitchSelect.value) formData.append('stitchFilter', stitchSelect.value);
    }

    // Show loading indicator
    const btn = document.getElementById('stitchProceedPreviewBtn');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing & Building Preview...';
    }

    try {
      const res = await fetch('/admin/api/bulk-stitch/preview', {
        method: 'POST',
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: formData
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.message || 'Failed to generate preview.');
      }

      previewData = data;
      excludedRowSkus.clear();
      previewPage = 1;
      previewFilter = 'all';
      previewSearch = '';

      renderPreviewSummary();
      renderPreviewTable();

      currentStep = 2;
      renderStepViews();
    } catch (err) {
      alert('Error building preview: ' + err.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }
  };

  // Back to Step 1
  window.stitchBackToStep1 = function () {
    currentStep = 1;
    renderStepViews();
  };

  // Format number helper with thousand commas
  function formatNum(n) {
    if (n === null || n === undefined || n === '') return '<span style="color: #9E9E9E;">—</span>';
    return Number(n).toLocaleString('en-IN');
  }

  // Render preview summary metrics
  function renderPreviewSummary() {
    if (!previewData || !previewData.summary) return;
    const s = previewData.summary;

    const totalEl = document.getElementById('stitchPreviewTotalCount');
    const validEl = document.getElementById('stitchPreviewValidCount');
    const errorEl = document.getElementById('stitchPreviewErrorCount');
    const unchangedEl = document.getElementById('stitchPreviewUnchangedCount');

    if (totalEl) totalEl.textContent = s.totalDesigns || 0;
    if (validEl) validEl.textContent = s.validCount || 0;
    if (errorEl) errorEl.textContent = s.errorCount || 0;
    if (unchangedEl) unchangedEl.textContent = s.unchangedCount || 0;

    // Disable Proceed button if no valid changed items exist
    const applyBtn = document.getElementById('stitchProceedApplyBtn');
    if (applyBtn) {
      applyBtn.disabled = (s.validCount === 0);
    }
  }

  // Set filter for preview table
  window.setStitchPreviewFilter = function (filter) {
    previewFilter = filter;
    previewPage = 1;

    // Update pill styles
    document.querySelectorAll('.stitch-filter-pill').forEach(pill => {
      const f = pill.dataset.filter;
      if (f === filter) {
        pill.classList.add('active');
        pill.style.background = '#4A148C';
        pill.style.color = '#FFFFFF';
      } else {
        pill.classList.remove('active');
        pill.style.background = '#F5F5F5';
        pill.style.color = '#616161';
      }
    });

    renderPreviewTable();
  };

  // Handle search input inside preview table
  window.handleStitchPreviewSearch = function (query) {
    previewSearch = (query || '').toLowerCase().trim();
    previewPage = 1;
    renderPreviewTable();
  };

  // Toggle exclusion of a single SKU
  window.toggleStitchRowExclusion = function (sku, checkbox) {
    if (!checkbox.checked) {
      excludedRowSkus.add(sku);
    } else {
      excludedRowSkus.delete(sku);
    }
    updateExcludedCountNotice();
  };

  function updateExcludedCountNotice() {
    const el = document.getElementById('stitchExcludedNotice');
    if (!el) return;
    if (excludedRowSkus.size > 0) {
      el.textContent = `(${excludedRowSkus.size} design(s) excluded from update)`;
      el.style.display = 'inline';
    } else {
      el.style.display = 'none';
    }
  }

  // Render Preview Table rows
  function renderPreviewTable() {
    const tbody = document.getElementById('stitchPreviewTbody');
    if (!tbody || !previewData || !previewData.items) return;

    let items = previewData.items;

    // 1. Filter by status
    if (previewFilter === 'changed') {
      items = items.filter(i => i.status === 'valid' && i.is_changed);
    } else if (previewFilter === 'errors') {
      items = items.filter(i => i.status === 'error');
    } else if (previewFilter === 'unchanged') {
      items = items.filter(i => i.status === 'unchanged' || !i.is_changed);
    }

    // 2. Filter by search
    if (previewSearch) {
      items = items.filter(i =>
        (i.sku && i.sku.toLowerCase().includes(previewSearch)) ||
        (i.title && i.title.toLowerCase().includes(previewSearch))
      );
    }

    // 3. Pagination
    const totalMatching = items.length;
    const totalPages = Math.ceil(totalMatching / PREVIEW_PAGE_SIZE) || 1;
    if (previewPage > totalPages) previewPage = totalPages;

    const startIdx = (previewPage - 1) * PREVIEW_PAGE_SIZE;
    const pageItems = items.slice(startIdx, startIdx + PREVIEW_PAGE_SIZE);

    if (pageItems.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 2rem; color: #9E9E9E;">
            <i class="fa-solid fa-folder-open" style="font-size: 1.8rem; margin-bottom: 6px; display: block;"></i>
            No designs match the current filter or search.
          </td>
        </tr>
      `;
      renderPreviewPagination(totalMatching, totalPages);
      return;
    }

    tbody.innerHTML = pageItems.map(item => {
      const isExcluded = excludedRowSkus.has(item.sku);
      const isError = item.status === 'error';
      const isUnchanged = item.status === 'unchanged' || !item.is_changed;

      let statusBadge = '';
      if (isError) {
        statusBadge = `<span style="background: #FFEBEE; color: #C62828; padding: 3px 8px; border-radius: 6px; font-weight: 700; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-circle-exclamation"></i> Error</span>`;
      } else if (isUnchanged) {
        statusBadge = `<span style="background: #F5F5F5; color: #757575; padding: 3px 8px; border-radius: 6px; font-weight: 600; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-minus"></i> Unchanged</span>`;
      } else {
        statusBadge = `<span style="background: #E8F5E9; color: #2E7D32; padding: 3px 8px; border-radius: 6px; font-weight: 700; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-check"></i> Ready</span>`;
      }

      // Format changes with subtle arrow
      const renderCell = (oldVal, newVal) => {
        if (oldVal === newVal) {
          return `<span style="color: #424242;">${formatNum(oldVal)}</span>`;
        }
        return `
          <div style="display: flex; align-items: center; gap: 4px;">
            <span style="color: #9E9E9E; text-decoration: line-through; font-size: 0.75rem;">${formatNum(oldVal)}</span>
            <i class="fa-solid fa-arrow-right" style="font-size: 0.65rem; color: #6A1B9A;"></i>
            <strong style="color: #1B5E20; font-size: 0.82rem;">${formatNum(newVal)}</strong>
          </div>
        `;
      };

      const manualBadge = item.new_manual ?
        '<span style="font-size: 0.65rem; background: #FFF8E1; color: #F57F17; border: 1px solid #FFE082; padding: 1px 4px; border-radius: 4px; font-weight: 600; margin-left: 4px;" title="Manual Total Override">Manual</span>' : '';

      return `
        <tr style="background: ${isError ? '#FFF9F9' : (isExcluded ? '#FAFAFA' : '#FFFFFF')}; opacity: ${isExcluded ? '0.6' : '1'};">
          <td style="text-align: center;">
            <input type="checkbox" ${isExcluded ? '' : 'checked'} ${isError ? 'disabled' : ''} onchange="toggleStitchRowExclusion('${item.sku}', this)">
          </td>
          <td>
            <strong style="color: #212121; font-size: 0.82rem; display: block;">${item.sku}</strong>
            <span style="font-size: 0.74rem; color: #757575;">${item.title || '-'}</span>
            ${item.error_message ? `<div style="color: #C62828; font-size: 0.72rem; margin-top: 2px;"><i class="fa-solid fa-triangle-exclamation"></i> ${item.error_message}</div>` : ''}
          </td>
          <td>${renderCell(item.old_front, item.new_front)}</td>
          <td>${renderCell(item.old_back, item.new_back)}</td>
          <td>${renderCell(item.old_sleeve, item.new_sleeve)}</td>
          <td>
            ${renderCell(item.old_total, item.new_total)}
            ${manualBadge}
          </td>
          <td style="text-align: center;">${statusBadge}</td>
        </tr>
      `;
    }).join('');

    renderPreviewPagination(totalMatching, totalPages);
  }

  function renderPreviewPagination(totalMatching, totalPages) {
    const info = document.getElementById('stitchPreviewPageInfo');
    const prevBtn = document.getElementById('stitchPreviewPrevBtn');
    const nextBtn = document.getElementById('stitchPreviewNextBtn');

    if (info) {
      info.textContent = `Showing Page ${previewPage} of ${totalPages} (${totalMatching} rows)`;
    }
    if (prevBtn) prevBtn.disabled = (previewPage <= 1);
    if (nextBtn) nextBtn.disabled = (previewPage >= totalPages);
  }

  window.stitchPreviewPrevPage = function () {
    if (previewPage > 1) {
      previewPage--;
      renderPreviewTable();
    }
  };

  window.stitchPreviewNextPage = function () {
    previewPage++;
    renderPreviewTable();
  };

  // Step 2 -> Step 3: Apply update in batches of 500
  window.proceedToStitchApply = async function () {
    if (!previewData || !previewData.items) return;

    // Determine applicable items (valid, changed, not excluded)
    const applicableItems = previewData.items.filter(i =>
      i.design_id &&
      !excludedRowSkus.has(i.sku) &&
      i.status === 'valid' &&
      i.is_changed
    );

    if (applicableItems.length === 0) {
      alert('No valid designs to update. Please review your selections.');
      return;
    }

    if (!confirm(`Are you sure you want to apply stitch count updates to ${applicableItems.length} design(s)? This will execute inside a safe database transaction.`)) {
      return;
    }

    currentStep = 3;
    renderStepViews();
    isApplying = true;

    const progressBar = document.getElementById('stitchApplyProgressBar');
    const progressPercent = document.getElementById('stitchApplyProgressPercent');
    const progressText = document.getElementById('stitchApplyProgressText');
    const successBox = document.getElementById('stitchApplySuccessBox');
    const errorBox = document.getElementById('stitchApplyErrorBox');

    if (progressBar) progressBar.style.width = '10%';
    if (progressPercent) progressPercent.textContent = '10%';
    if (progressText) progressText.textContent = `Preparing batch update for ${applicableItems.length} design(s)...`;
    if (successBox) successBox.style.display = 'none';
    if (errorBox) errorBox.style.display = 'none';

    try {
      if (progressBar) progressBar.style.width = '40%';
      if (progressPercent) progressPercent.textContent = '40%';
      if (progressText) progressText.textContent = 'Processing transaction in database...';

      const res = await fetch('/admin/api/bulk-stitch/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
          _csrf: getCsrfToken(),
          items: applicableItems,
          filterSummary: `Bulk Stitch Update (${applicableItems.length} designs)`,
          methodSummary: `Method: ${document.querySelector('input[name="stitchMethod"]:checked')?.value || 'Spreadsheet'}`
        })
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.message || 'Bulk update transaction failed.');
      }

      if (progressBar) progressBar.style.width = '100%';
      if (progressPercent) progressPercent.textContent = '100%';
      if (progressText) progressText.textContent = 'Completed successfully!';

      if (successBox) {
        successBox.style.display = 'block';
        const msg = document.getElementById('stitchApplySuccessMessage');
        if (msg) {
          msg.textContent = `Successfully updated ${data.totalAffected || applicableItems.length} design(s) in database! Audit Log #${data.logId} created.`;
        }
      }

      // Show Done & Refresh button
      const doneBtn = document.getElementById('stitchApplyDoneBtn');
      if (doneBtn) doneBtn.style.display = 'inline-flex';
    } catch (err) {
      if (errorBox) {
        errorBox.style.display = 'block';
        const errMsg = document.getElementById('stitchApplyErrorMessage');
        if (errMsg) errMsg.textContent = 'Transaction rolled back safely: ' + err.message;
      }
    } finally {
      isApplying = false;
    }
  };

  window.finishStitchUpdateAndRefresh = function () {
    window.location.reload();
  };

})();
