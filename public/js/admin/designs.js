/**
 * Aruvi Embroidery — Admin Designs Management JavaScript
 * Controls: Bulk operations, delete modals, image replacement, bulk upload, and 3-step bulk import.
 */

// Global CSRF helper
function getCsrfToken() {
  if (window.CSRF_TOKEN) return window.CSRF_TOKEN;
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (meta) return meta.getAttribute('content');
  return '';
}

// Global Toast Popup
function showAdminToast(msg) {
  let toast = document.getElementById('adminToastPopup');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'adminToastPopup';
    toast.style.cssText = 'position: fixed; top: 25px; right: 25px; background: #1B5E20; color: white; padding: 1.1rem 1.8rem; border-radius: 14px; box-shadow: 0 12px 30px rgba(0,0,0,0.25); z-index: 999999; display: flex; align-items: center; gap: 12px; font-weight: 600; font-size: 1rem; border: 2px solid #81C784;';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<i class="fa-solid fa-circle-check" style="font-size: 1.5rem; color: #66BB6A;"></i><span>${msg}</span><button type="button" onclick="this.parentElement.style.display='none'" style="background: none; border: none; color: white; margin-left: 15px; cursor: pointer; font-size: 1.3rem;">&times;</button>`;
  toast.style.display = 'flex';
  setTimeout(() => { if (toast) toast.style.display = 'none'; }, 4000);
}

// -----------------------------------------------------------------------------
// Selection & Bulk Actions
// -----------------------------------------------------------------------------
let pendingDeleteId = null;

function toggleSelectAllDesigns(master) {
  const checkboxes = document.querySelectorAll('.design-checkbox');
  checkboxes.forEach(cb => cb.checked = master.checked);
  updateSelectedCount();
}

function updateSelectedCount() {
  const checked = document.querySelectorAll('.design-checkbox:checked');
  const count = checked.length;
  const btn = document.getElementById('deleteSelectedBtn');
  const numEl = document.getElementById('selectedCountNum');
  if (numEl) numEl.textContent = count;
  if (btn) {
    btn.style.display = count > 0 ? 'inline-flex' : 'none';
  }
  const master = document.getElementById('selectAllCheckbox');
  const all = document.querySelectorAll('.design-checkbox');
  if (master && all.length > 0) {
    master.checked = checked.length === all.length;
  }
}

function confirmDeleteDesign(id, title) {
  pendingDeleteId = id;
  const msgEl = document.getElementById('deleteModalMessage');
  if (msgEl) {
    msgEl.textContent = title ? `Are you sure you want to permanently delete design "${title}"?` : 'Are you sure you want to permanently delete this design?';
  }
  const modal = document.getElementById('deleteDesignModal');
  if (modal) modal.style.display = 'flex';
}

function closeDeleteModal() {
  pendingDeleteId = null;
  const modal = document.getElementById('deleteDesignModal');
  if (modal) modal.style.display = 'none';
}

function executeDeleteDesign() {
  if (!pendingDeleteId) return;
  const id = pendingDeleteId;
  const btn = document.getElementById('confirmDeleteBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting...'; }

  const csrf = getCsrfToken();

  fetch('/admin/designs/delete/' + id + '?format=json', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-Token': csrf
    },
    body: JSON.stringify({ _csrf: csrf })
  })
  .then(res => res.json())
  .then(data => {
    closeDeleteModal();
    if (btn) { btn.disabled = false; btn.textContent = 'Delete Design'; }
    if (data.success) {
      const row = document.getElementById('designRow-' + id);
      if (row) {
        row.style.opacity = '0';
        row.style.transition = 'opacity 0.3s ease';
        setTimeout(() => row.remove(), 300);
      }
      showAdminToast(data.message || 'Design deleted successfully.');
    } else {
      alert(data.message || 'Unable to delete design. Please try again.');
    }
  })
  .catch(err => {
    console.error(err);
    closeDeleteModal();
    if (btn) { btn.disabled = false; btn.textContent = 'Delete Design'; }
    alert('Unable to delete design. Please try again.');
  });
}

function confirmDeleteAllDesigns() {
  const modal = document.getElementById('deleteAllDesignsModal');
  if (modal) modal.style.display = 'flex';
}

function closeDeleteAllModal() {
  const modal = document.getElementById('deleteAllDesignsModal');
  if (modal) modal.style.display = 'none';
}

function executeDeleteAllDesigns() {
  const btn = document.getElementById('confirmDeleteAllBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting All...'; }

  const csrf = getCsrfToken();

  fetch('/admin/designs/delete-all', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-Token': csrf
    },
    body: JSON.stringify({ _csrf: csrf })
  })
  .then(res => res.json())
  .then(data => {
    closeDeleteAllModal();
    if (btn) { btn.disabled = false; btn.textContent = 'Yes, Delete All Designs'; }
    if (data.success) {
      showAdminToast(data.message || 'All designs permanently removed.');
      setTimeout(() => window.location.reload(), 600);
    } else {
      alert(data.message || 'Unable to delete all designs. Please try again.');
    }
  })
  .catch(err => {
    console.error(err);
    closeDeleteAllModal();
    if (btn) { btn.disabled = false; btn.textContent = 'Yes, Delete All Designs'; }
    alert('Unable to delete all designs. Please try again.');
  });
}

function confirmDeleteSelectedDesigns() {
  const checked = document.querySelectorAll('.design-checkbox:checked');
  if (checked.length === 0) return;
  if (confirm(`Are you sure you want to permanently delete the ${checked.length} selected design(s)?`)) {
    executeDeleteSelectedDesigns();
  }
}

function executeDeleteSelectedDesigns() {
  const checked = document.querySelectorAll('.design-checkbox:checked');
  const ids = Array.from(checked).map(cb => cb.value);
  if (ids.length === 0) return;

  const csrf = getCsrfToken();

  fetch('/admin/designs/delete-bulk', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-Token': csrf
    },
    body: JSON.stringify({ ids, _csrf: csrf })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      showAdminToast(data.message || 'Selected designs deleted successfully.');
      setTimeout(() => window.location.reload(), 600);
    } else {
      alert(data.message || 'Unable to delete selected designs.');
    }
  })
  .catch(err => {
    console.error(err);
    alert('Error deleting selected designs.');
  });
}

function toggleDesignStatus(id, checkbox) {
  const csrf = getCsrfToken();
  fetch('/admin/designs/toggle-status/' + id, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf
    },
    body: JSON.stringify({ _csrf: csrf })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      const label = document.getElementById('statusLabel-' + id);
      if (label) {
        label.textContent = data.is_active ? 'Active' : 'Inactive';
        label.style.color = data.is_active ? '#2E7D32' : 'var(--admin-text-muted)';
      }
    } else {
      alert(data.message || 'Unable to update status');
      checkbox.checked = !checkbox.checked;
    }
  })
  .catch(err => {
    console.error(err);
    checkbox.checked = !checkbox.checked;
  });
}

async function duplicateDesign(id, title) {
  if (!confirm(`Duplicate design "${title}"? A new draft copy will be created with the next SKU.`)) return;
  try {
    const res = await fetch(`/admin/designs/duplicate/${id}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-CSRF-Token': getCsrfToken()
      }
    });
    const data = await res.json();
    if (data.success) {
      showAdminToast(data.message || 'Design duplicated successfully!');
      setTimeout(() => { window.location.reload(); }, 900);
    } else {
      alert(data.message || 'Error duplicating design');
    }
  } catch (e) {
    alert('Network error duplicating design.');
  }
}

// -----------------------------------------------------------------------------
// Replace Single Product Image Modal
// -----------------------------------------------------------------------------
function openReplaceImageModal(id, title) {
  document.getElementById('replaceImageDesignId').value = id;
  document.getElementById('replaceImageTitle').textContent = `Product: ${title} (#${id})`;
  document.getElementById('replaceImageFileInput').value = '';
  document.getElementById('replaceImagePreviewContainer').style.display = 'none';
  document.getElementById('replaceImageModal').style.display = 'flex';
}

function closeReplaceImageModal() {
  document.getElementById('replaceImageModal').style.display = 'none';
}

function previewSelectedReplaceImage(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('replaceImagePreviewImg').src = e.target.result;
      document.getElementById('replaceImagePreviewContainer').style.display = 'block';
    };
    reader.readAsDataURL(input.files[0]);
  }
}

async function submitReplaceImage(event) {
  event.preventDefault();
  const id = document.getElementById('replaceImageDesignId').value;
  const fileInput = document.getElementById('replaceImageFileInput');
  if (!fileInput.files || fileInput.files.length === 0) {
    alert('Please select an image file to upload.');
    return;
  }

  const btn = document.getElementById('replaceImageSubmitBtn');
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';

  const formData = new FormData();
  formData.append('_csrf', getCsrfToken());
  formData.append('image', fileInput.files[0]);

  try {
    const res = await fetch(`/admin/designs/replace-image/${id}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: formData
    });
    const data = await res.json();
    btn.disabled = false;
    btn.innerHTML = origHtml;

    if (data.success) {
      closeReplaceImageModal();
      showAdminToast(data.message || 'Image replaced successfully!');
      setTimeout(() => { window.location.reload(); }, 900);
    } else {
      alert(data.message || 'Failed to replace image.');
    }
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = origHtml;
    alert('Network error while replacing image: ' + e.message);
  }
}

// -----------------------------------------------------------------------------
// Bulk Image Upload Modal
// -----------------------------------------------------------------------------
function openBulkImageUploadModal() {
  document.getElementById('bulkImageFilesInput').value = '';
  document.getElementById('bulkImageStatus').style.display = 'none';
  document.getElementById('bulkImageUploadModal').style.display = 'flex';
}

function closeBulkImageUploadModal() {
  document.getElementById('bulkImageUploadModal').style.display = 'none';
}

async function submitBulkImageUpload(event) {
  event.preventDefault();
  const fileInput = document.getElementById('bulkImageFilesInput');
  if (!fileInput.files || fileInput.files.length === 0) {
    alert('Please select one or more image files.');
    return;
  }

  const btn = document.getElementById('bulkImageSubmitBtn');
  const statusDiv = document.getElementById('bulkImageStatus');
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading & Linking...';

  const formData = new FormData();
  formData.append('_csrf', getCsrfToken());
  for (let i = 0; i < fileInput.files.length; i++) {
    formData.append('images', fileInput.files[i]);
  }

  try {
    const res = await fetch('/admin/designs/bulk-upload-images', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: formData
    });
    const data = await res.json();
    btn.disabled = false;
    btn.innerHTML = origHtml;

    if (data.success) {
      statusDiv.style.display = 'block';
      statusDiv.style.background = '#E8F5E9';
      statusDiv.style.color = '#2E7D32';
      statusDiv.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${data.message}`;
      setTimeout(() => {
        closeBulkImageUploadModal();
        window.location.reload();
      }, 1200);
    } else {
      statusDiv.style.display = 'block';
      statusDiv.style.background = '#FFEBEE';
      statusDiv.style.color = '#C62828';
      statusDiv.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ${data.message || 'Upload failed.'}`;
    }
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = origHtml;
    alert('Network error during bulk upload: ' + e.message);
  }
}

// -----------------------------------------------------------------------------
// 3-Step Bulk Importer Wizard
// -----------------------------------------------------------------------------
let currentImportBatchId = null;
let importJobPollingTimer = null;
let assetUploadAbortController = null;
let isAssetUploading = false;

function showImportError(msg) {
  const alertEl = document.getElementById('importErrorAlert');
  const msgEl = document.getElementById('importErrorMessage');
  if (msgEl) msgEl.textContent = msg || 'An unexpected error occurred.';
  if (alertEl) alertEl.style.display = 'block';
}

function clearImportError() {
  const alertEl = document.getElementById('importErrorAlert');
  if (alertEl) alertEl.style.display = 'none';
}

function openBulkImportModal() {
  clearImportError();
  currentImportBatchId = null;
  if (importJobPollingTimer) clearInterval(importJobPollingTimer);
  if (assetUploadAbortController) assetUploadAbortController.abort();

  // Reset views
  document.getElementById('step1View').style.display = 'block';
  document.getElementById('step2View').style.display = 'none';
  document.getElementById('step3View').style.display = 'none';

  document.getElementById('stepTab1').style.background = 'var(--admin-primary)';
  document.getElementById('stepTab1').style.color = '#FFF';
  document.getElementById('stepTab2').style.background = '#ECEFF1';
  document.getElementById('stepTab2').style.color = '#546E7A';
  document.getElementById('stepTab3').style.background = '#ECEFF1';
  document.getElementById('stepTab3').style.color = '#546E7A';

  document.getElementById('step1NextBtn').style.display = 'inline-flex';
  document.getElementById('step2NextBtn').style.display = 'none';
  document.getElementById('step3StartBtn').style.display = 'none';
  document.getElementById('finishRefreshBtn').style.display = 'none';

  document.getElementById('bulkImportModal').style.display = 'flex';
}

function closeBulkImportModal() {
  if (importJobPollingTimer) clearInterval(importJobPollingTimer);
  if (assetUploadAbortController) assetUploadAbortController.abort();
  const modal = document.getElementById('bulkImportModal');
  if (modal) modal.style.display = 'none';
}

async function submitStep1Spreadsheet() {
  clearImportError();
  const input = document.getElementById('step1SpreadsheetInput');
  if (!input.files || input.files.length === 0) {
    showImportError('Please select a spreadsheet file (.xlsx, .xls, .csv).');
    return;
  }

  const file = input.files[0];
  const btn = document.getElementById('step1NextBtn');
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Parsing Spreadsheet...';

  const formData = new FormData();
  formData.append('spreadsheet', file);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch('/admin/designs/import-preview', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': getCsrfToken()
      },
      body: formData,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const data = await res.json();
    btn.disabled = false;
    btn.innerHTML = origHtml;

    if (!res.ok || !data.success) {
      showImportError(data.message || 'Failed to parse spreadsheet file.');
      return;
    }

    currentImportBatchId = data.batchId;
    setupStep2(data);
  } catch (err) {
    clearTimeout(timeoutId);
    btn.disabled = false;
    btn.innerHTML = origHtml;
    if (err.name === 'AbortError') {
      showImportError('Request timed out. Please verify spreadsheet size or check connection.');
    } else {
      showImportError('Network error parsing spreadsheet: ' + err.message);
    }
  }
}

function setupStep2(data) {
  document.getElementById('step1View').style.display = 'none';
  document.getElementById('step2View').style.display = 'block';
  document.getElementById('step3View').style.display = 'none';

  document.getElementById('stepTab1').style.background = '#ECEFF1';
  document.getElementById('stepTab1').style.color = '#546E7A';
  document.getElementById('stepTab2').style.background = 'var(--admin-primary)';
  document.getElementById('stepTab2').style.color = '#FFF';

  document.getElementById('step1NextBtn').style.display = 'none';
  document.getElementById('step2NextBtn').style.display = 'inline-flex';

  const pillsEl = document.getElementById('step2SummaryPills');
  pillsEl.innerHTML = `
    <div style="background:#E3F2FD; color:#0D47A1; padding:6px 12px; border-radius:8px; font-size:0.78rem; font-weight:700;">
      Total Rows: ${data.totalRows}
    </div>
    <div style="background:#E8F5E9; color:#2E7D32; padding:6px 12px; border-radius:8px; font-size:0.78rem; font-weight:700;">
      Valid: ${data.validCount}
    </div>
    <div style="background:#FFF3E0; color:#E65100; padding:6px 12px; border-radius:8px; font-size:0.78rem; font-weight:700;">
      Duplicates in Catalog: ${data.duplicateCount}
    </div>
    <div style="background:#FFEBEE; color:#C62828; padding:6px 12px; border-radius:8px; font-size:0.78rem; font-weight:700;">
      Errors: ${data.errorCount}
    </div>
  `;

  document.getElementById('previewRowsCountBadge').textContent = `Showing ${data.previewRows ? data.previewRows.length : 0} of ${data.totalRows} rows`;

  const tbody = document.getElementById('step2PreviewTbody');
  tbody.innerHTML = '';
  const rows = data.previewRows || [];

  rows.forEach(r => {
    const tr = document.createElement('tr');
    if (r.validationStatus === 'error') tr.style.background = '#FFEBEE';
    else if (r.validationStatus === 'duplicate') tr.style.background = '#FFF8E1';

    let statusBadge = '<span style="background:#E8F5E9; color:#2E7D32; padding:2px 6px; border-radius:4px; font-weight:700; font-size:0.7rem;">VALID</span>';
    if (r.validationStatus === 'error') {
      statusBadge = '<span style="background:#FFEBEE; color:#C62828; padding:2px 6px; border-radius:4px; font-weight:700; font-size:0.7rem;">ERROR</span>';
    } else if (r.validationStatus === 'duplicate') {
      statusBadge = '<span style="background:#FFF3E0; color:#E65100; padding:2px 6px; border-radius:4px; font-weight:700; font-size:0.7rem;">DUPLICATE</span>';
    }

    tr.innerHTML = `
      <td style="font-weight:700;">${r.rowNumber}</td>
      <td>${statusBadge}</td>
      <td><code>${r.sku || '-'}</code></td>
      <td><strong>${r.title}</strong></td>
      <td>${r.categoryName || '-'}</td>
      <td>₹${r.price} ${r.salePrice ? '/ ₹' + r.salePrice : ''}</td>
      <td style="color:${r.validationError ? '#C62828' : '#2E7D32'}; font-size:0.72rem;">${r.validationError || 'Ready'}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function startChunkedAssetUpload() {
  clearImportError();
  const input = document.getElementById('step2AssetFilesInput');
  if (!input.files || input.files.length === 0) {
    showImportError('Please select preview images or machine ZIP files to upload.');
    return;
  }

  const allFiles = Array.from(input.files);
  const totalFiles = allFiles.length;
  const batchSize = 8;
  const batches = [];

  for (let i = 0; i < totalFiles; i += batchSize) {
    batches.push(allFiles.slice(i, i + batchSize));
  }

  const startBtn = document.getElementById('startAssetUploadBtn');
  const cancelBtn = document.getElementById('cancelAssetUploadBtn');
  const progressContainer = document.getElementById('assetUploadProgressContainer');
  const statusText = document.getElementById('assetUploadStatusText');
  const percentText = document.getElementById('assetUploadPercentText');
  const progressBar = document.getElementById('assetProgressBar');

  startBtn.disabled = true;
  cancelBtn.style.display = 'inline-flex';
  progressContainer.style.display = 'block';

  isAssetUploading = true;
  assetUploadAbortController = new AbortController();

  let uploadedFilesCount = 0;
  let totalMatchedImgs = 0;
  let totalMatchedZIPs = 0;
  let totalUnmatched = 0;

  const concurrency = 3;
  let currentBatchIndex = 0;

  async function uploadSingleBatch(batch, batchIdx) {
    if (!isAssetUploading) return;
    const formData = new FormData();
    formData.append('batchId', currentImportBatchId);
    batch.forEach(f => formData.append('assets', f));

    let attempts = 0;
    let success = false;
    let resultData = null;

    while (attempts < 3 && !success && isAssetUploading) {
      attempts++;
      try {
        const res = await fetch('/admin/designs/import-upload-assets', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRF-Token': getCsrfToken()
          },
          body: formData,
          signal: assetUploadAbortController.signal
        });
        const data = await res.json();
        if (res.ok && data.success) {
          success = true;
          resultData = data;
        } else {
          console.warn(`Batch ${batchIdx + 1} attempt ${attempts} failed:`, data.message);
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.warn(`Batch ${batchIdx + 1} attempt ${attempts} error:`, err);
      }
    }

    if (success && resultData) {
      uploadedFilesCount += batch.length;
      totalMatchedImgs = resultData.totalMatchedImages || totalMatchedImgs;
      totalMatchedZIPs = resultData.totalMatchedFiles || totalMatchedZIPs;
      if (resultData.results) {
        totalUnmatched += resultData.results.filter(r => r.status === 'unmatched').length;
      }

      const pct = Math.min(100, Math.round((uploadedFilesCount / totalFiles) * 100));
      progressBar.style.width = pct + '%';
      percentText.textContent = pct + '%';
      statusText.textContent = `Uploaded ${uploadedFilesCount} / ${totalFiles} asset files...`;
    }
  }

  async function worker() {
    while (currentBatchIndex < batches.length && isAssetUploading) {
      const idx = currentBatchIndex++;
      await uploadSingleBatch(batches[idx], idx);
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(concurrency, batches.length); w++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  isAssetUploading = false;
  startBtn.disabled = false;
  cancelBtn.style.display = 'none';

  document.getElementById('matchedImagesCount').textContent = totalMatchedImgs;
  document.getElementById('matchedFilesCount').textContent = totalMatchedZIPs;
  document.getElementById('unmatchedCount').textContent = totalUnmatched;
  document.getElementById('assetMatchReportCard').style.display = 'block';
  statusText.textContent = `Asset upload finished: ${uploadedFilesCount} files processed.`;
}

function cancelAssetUpload() {
  isAssetUploading = false;
  if (assetUploadAbortController) assetUploadAbortController.abort();
  document.getElementById('cancelAssetUploadBtn').style.display = 'none';
  document.getElementById('startAssetUploadBtn').disabled = false;
  document.getElementById('assetUploadStatusText').textContent = 'Upload cancelled by user.';
}

function goToStep3() {
  clearImportError();
  document.getElementById('step2View').style.display = 'none';
  document.getElementById('step3View').style.display = 'block';

  document.getElementById('stepTab2').style.background = '#ECEFF1';
  document.getElementById('stepTab2').style.color = '#546E7A';
  document.getElementById('stepTab3').style.background = 'var(--admin-primary)';
  document.getElementById('stepTab3').style.color = '#FFF';

  document.getElementById('step2NextBtn').style.display = 'none';
  document.getElementById('step3StartBtn').style.display = 'inline-flex';
}

async function submitStep3StartJob() {
  clearImportError();
  const btn = document.getElementById('step3StartBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Starting Import...';

  const updateExisting = document.getElementById('updateExistingCheckbox').checked;
  const skipErrors = document.getElementById('skipErrorsCheckbox').checked;

  try {
    const res = await fetch('/admin/designs/import-start-job', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': getCsrfToken()
      },
      body: JSON.stringify({
        batchId: currentImportBatchId,
        updateExisting,
        skipErrors
      })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-rocket"></i> Start Background Import';
      showImportError(data.message || 'Failed to start import job.');
      return;
    }

    btn.style.display = 'none';
    document.getElementById('step3ConfirmBox').style.display = 'none';
    document.getElementById('step3ProgressBox').style.display = 'block';

    startLivePolling(currentImportBatchId);

  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rocket"></i> Start Background Import';
    showImportError('Error starting import: ' + err.message);
  }
}

function startLivePolling(batchId) {
  if (importJobPollingTimer) clearInterval(importJobPollingTimer);

  importJobPollingTimer = setInterval(async () => {
    try {
      const res = await fetch(`/admin/designs/import-job-status/${batchId}`, {
        headers: { 'Accept': 'application/json' }
      });
      const status = await res.json();

      if (!res.ok || !status.success) return;

      const total = status.totalRows || 1;
      const processed = (status.importedCount || 0) + (status.skippedCount || 0) + (status.failedCount || 0);
      const pct = status.progressPercent || 0;

      document.getElementById('importLiveStatusSub').textContent = `${processed} / ${total} designs processed (${pct}%)`;
      document.getElementById('importLiveProgressBar').style.width = pct + '%';
      document.getElementById('liveImportedCount').textContent = status.importedCount || 0;
      document.getElementById('liveSkippedCount').textContent = status.skippedCount || 0;
      document.getElementById('liveFailedCount').textContent = status.failedCount || 0;

      if (status.status === 'completed' || status.status === 'failed') {
        clearInterval(importJobPollingTimer);
        onImportJobCompleted(status);
      }
    } catch (pollErr) {
      console.warn('Job polling warn:', pollErr);
    }
  }, 1000);
}

function onImportJobCompleted(status) {
  document.getElementById('importLiveStatusTitle').innerHTML = '<i class="fa-solid fa-circle-check" style="color:#2E7D32;"></i> Import Completed!';
  document.getElementById('finishRefreshBtn').style.display = 'inline-flex';

  const resultCard = document.getElementById('step3ResultCard');
  resultCard.style.display = 'block';

  document.getElementById('step3ResultSummaryText').innerHTML = `
    Successfully imported <strong>${status.importedCount || 0}</strong> design(s). 
    ${status.skippedCount > 0 ? `<strong>${status.skippedCount}</strong> row(s) skipped. ` : ''}
    ${status.failedCount > 0 ? `<span style="color:#C62828;"><strong>${status.failedCount}</strong> row(s) failed.</span>` : ''}
  `;

  document.getElementById('downloadErrorReportBtn').href = `/admin/designs/import-error-report/${currentImportBatchId}`;
}

async function rollbackCurrentImport() {
  if (!confirm('Are you sure you want to rollback this import? All designs created by this import session will be permanently deleted from catalog.')) {
    return;
  }

  const btn = document.getElementById('rollbackJobBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Rolling back...';

  try {
    const res = await fetch(`/admin/designs/import-rollback/${currentImportBatchId}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': getCsrfToken()
      }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert(data.message || 'Import rolled back successfully.');
      window.location.reload();
    } else {
      alert(data.message || 'Rollback failed.');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Rollback this Import';
    }
  } catch (e) {
    alert('Error rolling back: ' + e.message);
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Rollback this Import';
  }
}

function finishAndReload() {
  window.location.reload();
}

// -----------------------------------------------------------------------------
// Duplicate Design Handler
// -----------------------------------------------------------------------------
async function duplicateDesign(id, title) {
  if (!confirm(`Duplicate design "${title}"? A new draft copy will be created with the next SKU.`)) return;
  try {
    const res = await fetch(`/admin/designs/duplicate/${id}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': getCsrfToken()
      },
      body: JSON.stringify({ _csrf: getCsrfToken() })
    });
    const data = await res.json();
    if (data.success) {
      if (typeof showToast === 'function') showToast(data.message || 'Design duplicated successfully!');
      else if (typeof showAdminToast === 'function') showAdminToast(data.message || 'Design duplicated successfully!');
      else alert(data.message || 'Design duplicated successfully!');
      setTimeout(() => { window.location.reload(); }, 900);
    } else {
      alert(data.message || 'Error duplicating design');
    }
  } catch (e) {
    alert('Network error duplicating design.');
  }
}

// -----------------------------------------------------------------------------
// Replace Single Product Image Modal Handlers
// -----------------------------------------------------------------------------
function openReplaceImageModal(id, title) {
  const designIdInput = document.getElementById('replaceImageDesignId');
  if (designIdInput) designIdInput.value = id;
  const titleEl = document.getElementById('replaceImageTitle');
  if (titleEl) titleEl.textContent = `Product: ${title} (#${id})`;
  const fileInput = document.getElementById('replaceImageFileInput');
  if (fileInput) fileInput.value = '';
  const previewContainer = document.getElementById('replaceImagePreviewContainer');
  if (previewContainer) previewContainer.style.display = 'none';
  const modal = document.getElementById('replaceImageModal');
  if (modal) modal.style.display = 'flex';
}

function closeReplaceImageModal() {
  const modal = document.getElementById('replaceImageModal');
  if (modal) modal.style.display = 'none';
}

function previewSelectedReplaceImage(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const previewImg = document.getElementById('replaceImagePreviewImg');
      if (previewImg) previewImg.src = e.target.result;
      const previewContainer = document.getElementById('replaceImagePreviewContainer');
      if (previewContainer) previewContainer.style.display = 'block';
    };
    reader.readAsDataURL(input.files[0]);
  }
}

async function submitReplaceImage(event) {
  if (event) event.preventDefault();
  const id = document.getElementById('replaceImageDesignId').value;
  const fileInput = document.getElementById('replaceImageFileInput');
  if (!fileInput.files || fileInput.files.length === 0) {
    alert('Please select an image file to upload.');
    return;
  }

  const btn = document.getElementById('replaceImageSubmitBtn');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';
  }

  const formData = new FormData();
  formData.append('_csrf', getCsrfToken());
  formData.append('image', fileInput.files[0]);

  try {
    const res = await fetch(`/admin/designs/replace-image/${id}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': getCsrfToken()
      },
      body: formData
    });
    const data = await res.json();
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }

    if (data.success) {
      closeReplaceImageModal();
      if (typeof showToast === 'function') showToast(data.message || 'Image replaced successfully!');
      else if (typeof showAdminToast === 'function') showAdminToast(data.message || 'Image replaced successfully!');
      else alert(data.message || 'Image replaced successfully!');
      setTimeout(() => { window.location.reload(); }, 900);
    } else {
      alert(data.message || 'Failed to replace image.');
    }
  } catch (e) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
    alert('Network error while replacing image: ' + e.message);
  }
}

// -----------------------------------------------------------------------------
// Bulk Image Upload Modal Handlers
// -----------------------------------------------------------------------------
function openBulkImageUploadModal() {
  const fileInput = document.getElementById('bulkImageFilesInput');
  if (fileInput) fileInput.value = '';
  const statusDiv = document.getElementById('bulkImageStatus');
  if (statusDiv) statusDiv.style.display = 'none';
  const modal = document.getElementById('bulkImageUploadModal');
  if (modal) modal.style.display = 'flex';
}

function closeBulkImageUploadModal() {
  const modal = document.getElementById('bulkImageUploadModal');
  if (modal) modal.style.display = 'none';
}

async function submitBulkImageUpload(event) {
  if (event) event.preventDefault();
  const fileInput = document.getElementById('bulkImageFilesInput');
  if (!fileInput.files || fileInput.files.length === 0) {
    alert('Please select one or more image files.');
    return;
  }

  const btn = document.getElementById('bulkImageSubmitBtn');
  const statusDiv = document.getElementById('bulkImageStatus');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading & Linking...';
  }

  const formData = new FormData();
  formData.append('_csrf', getCsrfToken());
  for (let i = 0; i < fileInput.files.length; i++) {
    formData.append('images', fileInput.files[i]);
  }

  try {
    const res = await fetch('/admin/designs/bulk-upload-images', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': getCsrfToken()
      },
      body: formData
    });
    const data = await res.json();
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }

    if (data.success) {
      if (statusDiv) {
        statusDiv.style.display = 'block';
        statusDiv.style.background = '#E8F5E9';
        statusDiv.style.color = '#2E7D32';
        statusDiv.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${data.message}`;
      }
      setTimeout(() => {
        closeBulkImageUploadModal();
        window.location.reload();
      }, 1200);
    } else {
      if (statusDiv) {
        statusDiv.style.display = 'block';
        statusDiv.style.background = '#FFEBEE';
        statusDiv.style.color = '#C62828';
        statusDiv.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ${data.message || 'Upload failed.'}`;
      }
    }
  } catch (e) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
    alert('Network error during bulk upload: ' + e.message);
  }
}

