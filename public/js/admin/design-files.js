/**
 * /public/js/admin/design-files.js
 * Robust, idempotent file upload and management engine for Admin Design Edit/Create.
 * Guarded against multiple script executions, duplicate listeners, and double submissions.
 */

(function () {
  'use strict';

  if (window.__designFilesBound) {
    console.warn('[DesignFiles] Script already bound. Skipping duplicate initialization.');
    return;
  }
  window.__designFilesBound = true;

  const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB chunks
  let isUploadingFiles = false;
  let labelDebounceTimers = {};

  // Global helper to get CSRF token
  function getCsrfToken() {
    const el = document.querySelector('input[name="_csrf"]');
    return el ? el.value : (window.CSRF_TOKEN || '');
  }

  // Helper to get current design ID
  function getCurrentDesignId() {
    if (window.currentDesignId !== undefined && window.currentDesignId !== null) {
      return String(window.currentDesignId).trim();
    }
    const form = document.getElementById('designForm');
    if (form && form.dataset && form.dataset.designId) {
      return String(form.dataset.designId).trim();
    }
    return '';
  }

  // Initialize staged array if not already defined
  if (!window.stagedDownloadFiles) {
    window.stagedDownloadFiles = [];
  }

  /**
   * Uploads a file in 2MB chunks with retry and idempotency.
   */
  async function uploadFileInChunks(file, fileKind = 'machine', onProgress = null, replaceFileId = null) {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const uploadId = 'up_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const token = getCsrfToken();
    const designId = getCurrentDesignId();

    for (let c = 0; c < totalChunks; c++) {
      const start = c * CHUNK_SIZE;
      const end = Math.min(file.size, start + CHUNK_SIZE);
      const blob = file.slice(start, end);

      let success = false;
      let lastErr = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const fd = new FormData();
          fd.append('chunk', blob, `chunk_${c}`);
          fd.append('uploadId', uploadId);
          fd.append('chunkIndex', String(c));
          fd.append('totalChunks', String(totalChunks));
          fd.append('_csrf', token);

          const res = await fetch('/admin/api/designs/upload-chunk', {
            method: 'POST',
            headers: { 'X-CSRF-Token': token },
            body: fd
          });
          const data = await res.json();
          if (res.ok && data.success) {
            success = true;
            break;
          } else {
            lastErr = new Error(data.message || 'Chunk error');
          }
        } catch (e) {
          lastErr = e;
        }
      }

      if (!success) {
        throw new Error(`Failed uploading chunk ${c + 1} of ${totalChunks}: ${lastErr ? lastErr.message : 'Network error'}`);
      }

      if (onProgress) {
        const pct = Math.round(((c + 1) / totalChunks) * 90);
        onProgress(pct);
      }
    }

    const completeBody = {
      uploadId,
      totalChunks,
      originalName: file.name,
      fileKind,
      designId: designId || null,
      replaceFileId: replaceFileId || null,
      _csrf: token
    };

    const compRes = await fetch('/admin/api/designs/upload-complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-CSRF-Token': token
      },
      body: JSON.stringify(completeBody)
    });
    const compData = await compRes.json();
    if (!compRes.ok || !compData.success) {
      throw new Error(compData.message || 'Upload processing failed.');
    }

    if (onProgress) onProgress(100);
    return compData;
  }

  /**
   * Handle file selection for download files.
   */
  async function handleDownloadFilesSelect(files) {
    if (!files || files.length === 0) return;
    if (isUploadingFiles) {
      console.warn('[DesignFiles] An upload is already in progress. Please wait.');
      return;
    }

    const fileList = Array.from(files);
    const existingRows = document.querySelectorAll('#downloadFilesTableBody .download-file-row').length;
    if (existingRows + fileList.length > 20) {
      alert('Maximum 20 download files allowed per design.');
      const fin = document.getElementById('multiDownloadFileInput');
      if (fin) fin.value = '';
      return;
    }

    isUploadingFiles = true;
    const pBox = document.getElementById('downloadUploadProgressBox');
    const pText = document.getElementById('downloadUploadStatusText');
    const pBar = document.getElementById('downloadProgressBarInner');
    const pPct = document.getElementById('downloadUploadPercent');
    if (pBox) pBox.style.display = 'block';

    const designId = getCurrentDesignId();

    try {
      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        if (pText) pText.textContent = `Uploading ${f.name} (${i + 1}/${fileList.length})...`;
        if (pBar) pBar.style.width = '0%';
        if (pPct) pPct.textContent = '0%';

        try {
          const result = await uploadFileInChunks(f, 'machine', (pct) => {
            if (pBar) pBar.style.width = pct + '%';
            if (pPct) pPct.textContent = pct + '%';
          });

          if (result.file && result.file.duplicateWarning) {
            const warnBox = document.getElementById('duplicateChecksumWarning');
            if (warnBox) warnBox.style.display = 'block';
          }

          if (result.file && result.file.detectedFormats && result.file.detectedFormats.length > 0) {
            syncDetectedFormats(result.file.detectedFormats);
          }

          // If creating a brand new design (no designId yet), stage file for create submit
          if (!designId) {
            // Check for duplicate in stagedDownloadFiles array
            const isStagedAlready = window.stagedDownloadFiles.some(item => 
              (result.file.id && item.id === result.file.id) ||
              (item.checksum_sha256 && item.checksum_sha256 === result.file.checksum_sha256) ||
              (item.storage_key && item.storage_key === result.file.storage_key)
            );
            if (!isStagedAlready) {
              window.stagedDownloadFiles.push(result.file);
              const stagedIn = document.getElementById('stagedFilesInput');
              if (stagedIn) stagedIn.value = JSON.stringify(window.stagedDownloadFiles);
            }
          } else {
            // On edit page: files are already persisted in DB by upload-complete endpoint!
            // Ensure stagedFilesInput remains empty so publish/save never tries to re-insert them
            const stagedIn = document.getElementById('stagedFilesInput');
            if (stagedIn) stagedIn.value = '[]';
          }

          appendDownloadFileRow(result.file);
        } catch (err) {
          alert(`Error uploading "${f.name}": ${err.message}`);
        }
      }
    } finally {
      isUploadingFiles = false;
      if (pBox) setTimeout(() => { pBox.style.display = 'none'; }, 1000);
      const fin = document.getElementById('multiDownloadFileInput');
      if (fin) fin.value = '';
    }
  }

  /**
   * Append a row to the Download Files table, preventing visual duplicate rows.
   */
  function appendDownloadFileRow(fileInfo) {
    const tbody = document.getElementById('downloadFilesTableBody');
    if (!tbody) return;

    const noRow = document.getElementById('noDownloadFilesRow');
    if (noRow) noRow.remove();

    const fileId = fileInfo.id || ('staged_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));

    // Prevent adding a duplicate DOM row for the same fileId
    if (fileInfo.id && tbody.querySelector(`tr[data-file-id="${fileInfo.id}"]`)) {
      console.warn(`[DesignFiles] Row for file ID ${fileInfo.id} already exists in table. Skipping.`);
      return;
    }

    const fExt = (fileInfo.file_format || (fileInfo.original_name ? fileInfo.original_name.split('.').pop() : 'ZIP')).toUpperCase();
    let badgeClass = 'fmt-badge-zip';
    if (fExt === 'DST') badgeClass = 'fmt-badge-dst';
    else if (fExt === 'PES') badgeClass = 'fmt-badge-pes';
    else if (fExt === 'JEF') badgeClass = 'fmt-badge-jef';
    else if (fExt === 'EXP') badgeClass = 'fmt-badge-exp';
    else if (fExt === 'RAR') badgeClass = 'fmt-badge-rar';
    else if (fExt === 'PNG') badgeClass = 'fmt-badge-png';

    const sizeDisplay = fileInfo.file_size ? (fileInfo.file_size / (1024 * 1024) >= 1 ? (fileInfo.file_size / (1024 * 1024)).toFixed(1) + ' MB' : Math.max(1, Math.round(fileInfo.file_size / 1024)) + ' KB') : '—';
    const dispName = fileInfo.original_name || fileInfo.file_name || ('file_' + fileId);

    const tr = document.createElement('tr');
    tr.className = 'download-file-row';
    tr.dataset.fileId = fileId;
    tr.style.borderBottom = '1px solid #F1E9E0';
    tr.innerHTML = `
      <td style="padding: 10px; font-weight: 600; color: var(--admin-text-dark); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        <i class="fa-solid fa-file-zipper" style="color: var(--admin-primary); margin-right: 6px;"></i>
        <span title="${dispName}">${dispName}</span>
      </td>
      <td style="padding: 10px;">
        <input type="text" class="form-control-custom file-label-input" value="${fileInfo.label || ''}" placeholder="e.g. 5x7 hoop, Front neck" style="height: 32px; font-size: 0.8rem; padding: 0 8px;">
      </td>
      <td style="padding: 10px;">
        <span class="fmt-badge ${badgeClass}" style="padding: 2px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 800;">${fExt}</span>
      </td>
      <td style="padding: 10px; font-size: 0.8rem; color: var(--admin-text-muted);">${sizeDisplay}</td>
      <td style="padding: 10px; text-align: right; white-space: nowrap;">
        <div style="display: inline-flex; align-items: center; gap: 4px;">
          <button type="button" class="btn btn-sm btn-move-up" title="Move Up" style="background: #F1E9E0; padding: 4px 8px; border-radius: 6px; border: none; cursor: pointer; font-size: 0.72rem;">
            <i class="fa-solid fa-arrow-up"></i>
          </button>
          <button type="button" class="btn btn-sm btn-move-down" title="Move Down" style="background: #F1E9E0; padding: 4px 8px; border-radius: 6px; border: none; cursor: pointer; font-size: 0.72rem;">
            <i class="fa-solid fa-arrow-down"></i>
          </button>
          ${fileInfo.id ? `<a href="/admin/api/designs/files/${fileInfo.id}/download" class="btn btn-sm" title="Download (admin test)" style="background: #E3F2FD; color: #1565C0; padding: 4px 8px; border-radius: 6px; text-decoration: none; font-size: 0.72rem; font-weight: 600;"><i class="fa-solid fa-download"></i></a>` : ''}
          <button type="button" class="btn btn-sm btn-replace-file" data-file-id="${fileId}" title="Replace File" style="background: #FFF3E0; color: #E65100; padding: 4px 8px; border-radius: 6px; border: none; cursor: pointer; font-size: 0.72rem; font-weight: 600;">
            <i class="fa-solid fa-rotate"></i>
          </button>
          <button type="button" class="btn btn-sm btn-delete-file" data-file-id="${fileId}" title="Delete File" style="background: #FFEBEE; color: #C62828; padding: 4px 8px; border-radius: 6px; border: none; cursor: pointer; font-size: 0.72rem; font-weight: 600;">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }

  function syncDetectedFormats(newFmts) {
    const fmtInput = document.getElementById('formatsInput');
    const badgeContainer = document.getElementById('detectedFormatsBadges');
    if (!fmtInput) return;

    let curList = fmtInput.value ? fmtInput.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : [];
    newFmts.forEach(f => {
      const u = f.trim().toUpperCase();
      if (u && !curList.includes(u)) curList.push(u);
    });

    fmtInput.value = curList.join(', ');
    if (badgeContainer) {
      badgeContainer.innerHTML = '';
      curList.forEach(fmt => {
        const span = document.createElement('span');
        span.className = 'detected-fmt-pill';
        span.style.cssText = 'background: #EDE7F6; color: #5E35B1; font-weight: 800; font-size: 0.76rem; padding: 4px 12px; border-radius: 6px; text-transform: uppercase;';
        span.textContent = fmt;
        badgeContainer.appendChild(span);
      });
    }
  }

  async function saveFileLabel(designId, fileId, label) {
    if (designId && !String(fileId).startsWith('staged_')) {
      const token = getCsrfToken();
      await fetch(`/admin/api/designs/${designId}/files/update-label/${fileId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': token
        },
        body: JSON.stringify({ label, _csrf: token })
      });
    } else {
      const item = window.stagedDownloadFiles.find(f => f.id === fileId || f.file_id === fileId);
      if (item) item.label = label;
      const stagedIn = document.getElementById('stagedFilesInput');
      if (stagedIn) stagedIn.value = JSON.stringify(window.stagedDownloadFiles);
    }
  }

  async function deleteDownloadFileRecord(designId, fileId, rowEl) {
    if (!confirm('Are you sure you want to remove this downloadable file?')) return;
    if (designId && !String(fileId).startsWith('staged_')) {
      const token = getCsrfToken();
      const res = await fetch(`/admin/api/designs/${designId}/files/delete/${fileId}`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': token }
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.message || 'Error deleting file');
        return;
      }
    } else {
      window.stagedDownloadFiles = window.stagedDownloadFiles.filter(f => f.id !== fileId && f.file_id !== fileId);
      const stagedIn = document.getElementById('stagedFilesInput');
      if (stagedIn) stagedIn.value = JSON.stringify(window.stagedDownloadFiles);
    }

    if (rowEl) rowEl.remove();

    const remaining = document.querySelectorAll('#downloadFilesTableBody .download-file-row');
    if (remaining.length === 0) {
      document.getElementById('downloadFilesTableBody').innerHTML = `
        <tr id="noDownloadFilesRow">
          <td colspan="5" style="text-align: center; padding: 2rem 1rem; color: var(--admin-text-muted); font-size: 0.85rem;">
            <i class="fa-solid fa-file-circle-plus" style="font-size: 1.8rem; display: block; margin-bottom: 6px; opacity: 0.5;"></i>
            No download files uploaded yet. Drag &amp; drop machine archives above.
          </td>
        </tr>
      `;
    }
  }

  function moveFileRowUp(row) {
    if (row && row.previousElementSibling && row.previousElementSibling.classList.contains('download-file-row')) {
      row.parentNode.insertBefore(row, row.previousElementSibling);
      persistFilesOrder();
    }
  }

  function moveFileRowDown(row) {
    if (row && row.nextElementSibling && row.nextElementSibling.classList.contains('download-file-row')) {
      row.parentNode.insertBefore(row.nextElementSibling, row);
      persistFilesOrder();
    }
  }

  async function persistFilesOrder() {
    const rows = Array.from(document.querySelectorAll('#downloadFilesTableBody .download-file-row'));
    const order = rows.map(r => r.dataset.fileId).filter(id => id && !id.startsWith('staged_'));
    const designId = getCurrentDesignId();
    if (designId && order.length > 0) {
      const token = getCsrfToken();
      await fetch(`/admin/api/designs/${designId}/files/reorder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': token
        },
        body: JSON.stringify({ order, _csrf: token })
      });
    }
  }

  function replaceSingleDownloadFile(fileId) {
    const tempInput = document.createElement('input');
    tempInput.type = 'file';
    tempInput.accept = '.zip,.rar,.dst,.pes,.jef,.exp,.png';
    tempInput.onchange = async () => {
      if (tempInput.files && tempInput.files[0]) {
        const file = tempInput.files[0];
        try {
          await uploadFileInChunks(file, 'machine', null, fileId);
          window.location.reload();
        } catch (e) {
          alert('Replace error: ' + e.message);
        }
      }
    };
    tempInput.click();
  }

  /**
   * Bind event delegation and dropzone listeners ONCE on DOM ready.
   */
  function bindHandlers() {
    const table = document.getElementById('downloadFilesTable');
    if (table) {
      // Event delegation for clicks (move up, move down, replace, delete)
      table.addEventListener('click', function (e) {
        const btnUp = e.target.closest('.btn-move-up');
        if (btnUp) {
          e.preventDefault();
          const row = btnUp.closest('tr');
          moveFileRowUp(row);
          return;
        }

        const btnDown = e.target.closest('.btn-move-down');
        if (btnDown) {
          e.preventDefault();
          const row = btnDown.closest('tr');
          moveFileRowDown(row);
          return;
        }

        const btnReplace = e.target.closest('.btn-replace-file');
        if (btnReplace) {
          e.preventDefault();
          const fileId = btnReplace.dataset.fileId || btnReplace.closest('tr')?.dataset.fileId;
          if (fileId) replaceSingleDownloadFile(fileId);
          return;
        }

        const btnDelete = e.target.closest('.btn-delete-file');
        if (btnDelete) {
          e.preventDefault();
          const row = btnDelete.closest('tr');
          const fileId = btnDelete.dataset.fileId || row?.dataset.fileId;
          const designId = getCurrentDesignId();
          if (fileId) deleteDownloadFileRecord(designId, fileId, row);
          return;
        }
      });

      // Event delegation for label input change / input
      table.addEventListener('change', function (e) {
        const input = e.target.closest('.file-label-input');
        if (input) {
          const row = input.closest('tr');
          const fileId = row ? row.dataset.fileId : null;
          const designId = getCurrentDesignId();
          if (fileId) {
            saveFileLabel(designId, fileId, input.value.trim());
          }
        }
      });

      // Debounced live typing for label input
      table.addEventListener('input', function (e) {
        const input = e.target.closest('.file-label-input');
        if (input) {
          const row = input.closest('tr');
          const fileId = row ? row.dataset.fileId : null;
          const designId = getCurrentDesignId();
          if (fileId) {
            clearTimeout(labelDebounceTimers[fileId]);
            labelDebounceTimers[fileId] = setTimeout(() => {
              saveFileLabel(designId, fileId, input.value.trim());
            }, 600);
          }
        }
      });
    }

    // Dropzone bindings
    const dlDrop = document.getElementById('downloadFilesDropzone');
    if (dlDrop) {
      ['dragenter', 'dragover'].forEach(evt => {
        dlDrop.addEventListener(evt, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dlDrop.style.borderColor = 'var(--admin-primary)';
          dlDrop.style.background = '#FAF0E8';
        }, false);
      });

      ['dragleave', 'drop'].forEach(evt => {
        dlDrop.addEventListener(evt, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dlDrop.style.borderColor = 'var(--admin-border)';
          dlDrop.style.background = '#FAF6F0';
        }, false);
      });

      dlDrop.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleDownloadFilesSelect(e.dataTransfer.files);
        }
      }, false);
    }

    // Input file change binding
    const fileInput = document.getElementById('multiDownloadFileInput');
    if (fileInput) {
      // Remove inline onchange if present to avoid duplicate handling
      fileInput.removeAttribute('onchange');
      fileInput.addEventListener('change', function () {
        if (this.files && this.files.length > 0) {
          handleDownloadFilesSelect(this.files);
        }
      });
    }

    // On edit design page, ensure stagedFilesInput is reset to empty array
    const designId = getCurrentDesignId();
    if (designId) {
      const stagedIn = document.getElementById('stagedFilesInput');
      if (stagedIn) stagedIn.value = '[]';
    }
  }

  // Bind on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindHandlers);
  } else {
    bindHandlers();
  }

  // Export public methods for backward compatibility
  window.handleDownloadFilesSelect = handleDownloadFilesSelect;
  window.appendDownloadFileRow = appendDownloadFileRow;
  window.saveFileLabel = saveFileLabel;
  window.deleteDownloadFileRecord = deleteDownloadFileRecord;
  window.moveFileRowUp = moveFileRowUp;
  window.moveFileRowDown = moveFileRowDown;
  window.replaceSingleDownloadFile = replaceSingleDownloadFile;
  window.uploadFileInChunks = uploadFileInChunks;
})();
