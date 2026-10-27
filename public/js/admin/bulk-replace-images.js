/**
 * Bulk Image & ZIP Replace by Category Controller
 * Handles 4-step modal flow:
 * 1. Scope (Category filter, live count, status, checked rows)
 * 2. Select files (Multi-select, drag & drop, folder selection, subfolder detection e.g. "ARUVI BULK DESIGNS 2", replacement mode)
 * 3. Match preview (Old vs new image & ZIP thumbnails, status badges, untick, manual mapping dropdown)
 * 4. Apply (Chunked upload 5 files/req, 3 in parallel, progress bar, batch DB commit, 4-card report, CSV download, 7-day undo, retry failed)
 */

(function () {
  'use strict';

  class BulkImageReplace {
    constructor() {
      this.currentStep = 1;
      this.scopeCategories = [];
      this.selectedCategoryIds = [];
      this.scopeDesigns = [];
      this.rawSelectedFiles = [];  // All raw File objects selected from input/drop
      this.activeFiles = [];        // Files filtered by current subfolder
      this.subfolderMap = new Map();// subfolderPath -> File[]
      this.matchResult = null;
      this.manualOverrides = new Map(); // fileName -> designId
      this.excludedFiles = new Set();    // fileNames or designIds unticked by user
      this.isUploading = false;
      this.abortController = null;
      this.lastLogId = null;
      this.failedItems = [];

      this.initEvents();
    }

    getCSRF() {
      return window.CSRF_TOKEN ||
             document.querySelector('meta[name="csrf-token"]')?.content ||
             document.querySelector('input[name="_csrf"]')?.value || '';
    }

    initEvents() {
      // Wire folder upload button
      const folderBtn = document.getElementById('bulkReplaceFolderBtn');
      const folderInput = document.getElementById('bulkReplaceFolderInput');
      if (folderBtn && folderInput) {
        folderBtn.addEventListener('click', () => folderInput.click());
        folderInput.addEventListener('change', (e) => this.handleFilesSelected(e.target.files));
      }

      // Wire standard files input
      const filesInput = document.getElementById('bulkReplaceFileInput');
      if (filesInput) {
        filesInput.addEventListener('change', (e) => this.handleFilesSelected(e.target.files));
      }

      // Wire drag & drop
      const dropZone = document.getElementById('bulkReplaceDropZone');
      if (dropZone) {
        ['dragenter', 'dragover'].forEach(name => {
          dropZone.addEventListener(name, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('drag-active');
          });
        });
        ['dragleave', 'drop'].forEach(name => {
          dropZone.addEventListener(name, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-active');
          });
        });
        dropZone.addEventListener('drop', (e) => {
          if (e.dataTransfer && e.dataTransfer.files) {
            this.handleFilesSelected(e.dataTransfer.files);
          }
        });
      }
    }

    async openModal() {
      const modal = document.getElementById('bulkReplaceImagesModal');
      if (!modal) {
        console.error('[BulkReplace] Modal element #bulkReplaceImagesModal not found');
        return;
      }
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';

      this.currentStep = 1;
      this.rawSelectedFiles = [];
      this.activeFiles = [];
      this.subfolderMap.clear();
      this.matchResult = null;
      this.manualOverrides.clear();
      this.excludedFiles.clear();
      this.isUploading = false;
      this.lastLogId = null;
      this.failedItems = [];

      this.updateStepView();

      try {
        await this.loadScopeSummary();
      } catch (err) {
        console.warn('[BulkReplace] Failed to load scope summary on modal open:', err);
      }
    }

    closeModal() {
      if (this.isUploading) {
        if (!confirm('An upload is currently in progress. Are you sure you want to cancel and exit?')) {
          return;
        }
        if (this.abortController) this.abortController.abort();
      }
      const modal = document.getElementById('bulkReplaceImagesModal');
      if (modal) modal.style.display = 'none';
      document.body.style.overflow = '';
    }

    updateStepView() {
      for (let s = 1; s <= 4; s++) {
        const stepHeader = document.getElementById(`bulkReplaceStepHeader${s}`);
        const stepBody = document.getElementById(`bulkReplaceStepBody${s}`);
        const stepFooter = document.getElementById(`bulkReplaceStepFooter${s}`);

        if (stepHeader) {
          stepHeader.classList.toggle('active', s === this.currentStep);
          stepHeader.classList.toggle('completed', s < this.currentStep);

          if (s === this.currentStep) {
            stepHeader.style.background = '#0284C7';
            stepHeader.style.color = '#FFFFFF';
          } else if (s < this.currentStep) {
            stepHeader.style.background = '#E0F2FE';
            stepHeader.style.color = '#0369A1';
          } else {
            stepHeader.style.background = '#E2E8F0';
            stepHeader.style.color = '#475569';
          }
        }
        if (stepBody) stepBody.style.display = (s === this.currentStep) ? 'block' : 'none';
        if (stepFooter) stepFooter.style.display = (s === this.currentStep) ? 'flex' : 'none';
      }
    }

    // ==========================================
    // STEP 1: SCOPE SELECTION
    // ==========================================
    async loadScopeSummary() {
      const scopeBadge = document.getElementById('scopeLiveCountBadge');
      const catSelect = document.getElementById('bulkReplaceCategorySelect');
      if (scopeBadge) scopeBadge.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading designs...';

      const status = document.getElementById('bulkReplaceStatusFilter')?.value || 'all';
      const search = document.getElementById('bulkReplaceSearchFilter')?.value || '';

      const checkedBoxes = Array.from(document.querySelectorAll('input.design-checkbox:checked'));
      const checkedIds = checkedBoxes.map(cb => cb.value).filter(Boolean);

      const checkedOption = document.getElementById('scopeCheckedRowsOption');
      const checkedCountSpan = document.getElementById('scopeCheckedCount');
      if (checkedCountSpan) checkedCountSpan.textContent = checkedIds.length;
      if (checkedOption) {
        if (checkedIds.length > 0) {
          checkedOption.style.opacity = '1';
          checkedOption.querySelector('input').disabled = false;
        } else {
          checkedOption.style.opacity = '0.5';
          checkedOption.querySelector('input').disabled = true;
          if (checkedOption.querySelector('input').checked) {
            const catRadio = document.getElementById('scopeCategoryOption')?.querySelector('input');
            if (catRadio) catRadio.checked = true;
          }
        }
      }

      const useCheckedOnly = document.getElementById('scopeCheckedRadio')?.checked;
      let selectedCatIds = [];
      if (!useCheckedOnly && catSelect) {
        selectedCatIds = Array.from(catSelect.selectedOptions).map(opt => opt.value).filter(v => v !== 'all');
      }

      try {
        const queryParams = new URLSearchParams();
        if (useCheckedOnly) {
          checkedIds.forEach(id => queryParams.append('checkedIds', id));
        } else {
          selectedCatIds.forEach(id => queryParams.append('categoryIds', id));
          if (status !== 'all') queryParams.set('status', status);
          if (search) queryParams.set('search', search);
        }

        const res = await fetch(`/admin/designs/bulk-replace/scope-summary?${queryParams.toString()}`);
        const data = await res.json();

        if (data.success) {
          this.scopeCategories = data.categories || [];
          this.scopeDesigns = data.designs || [];

          // Populate or update category select
          if (catSelect) {
            const currentSelected = catSelect.value;
            if (catSelect.options.length <= 1 && this.scopeCategories.length > 0) {
              this.scopeCategories.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = `${c.name} (${c.design_count || 0} designs)`;
                catSelect.appendChild(opt);
              });
              if (currentSelected) catSelect.value = currentSelected;
            } else if (this.scopeCategories.length > 0) {
              Array.from(catSelect.options).forEach(opt => {
                if (opt.value !== 'all') {
                  const match = this.scopeCategories.find(c => String(c.id) === String(opt.value));
                  if (match) {
                    opt.textContent = `${match.name} (${match.design_count || 0} designs)`;
                  }
                }
              });
            }
          }

          let categoryLabel = 'All Categories';
          if (useCheckedOnly) {
            categoryLabel = `Checked Rows (${data.totalDesigns} selected)`;
          } else if (selectedCatIds.length === 1) {
            const foundCat = this.scopeCategories.find(c => String(c.id) === String(selectedCatIds[0]));
            if (foundCat) {
              categoryLabel = foundCat.name;
            } else if (catSelect && catSelect.selectedOptions && catSelect.selectedOptions[0]) {
              categoryLabel = catSelect.selectedOptions[0].text.replace(/\s*\(\d+\s*designs\)/i, '').trim();
            } else {
              categoryLabel = 'Selected Category';
            }
          } else if (selectedCatIds.length > 1) {
            categoryLabel = `${selectedCatIds.length} Categories Selected`;
          }

          if (scopeBadge) {
            scopeBadge.className = 'badge';
            scopeBadge.style.background = '#E0F2FE';
            scopeBadge.style.color = '#0369A1';
            scopeBadge.style.fontSize = '0.82rem';
            scopeBadge.style.padding = '4px 10px';
            scopeBadge.innerHTML = `<i class="fa-solid fa-layer-group"></i> ${categoryLabel}: <strong>${data.totalDesigns} designs</strong>`;
          }

          const nextBtn = document.getElementById('bulkReplaceScopeNextBtn');
          if (nextBtn) {
            nextBtn.disabled = data.totalDesigns === 0;
            nextBtn.title = data.totalDesigns === 0 ? 'No designs match the selected scope' : 'Proceed to file selection';
          }
        }
      } catch (err) {
        if (scopeBadge) scopeBadge.textContent = 'Error loading scope: ' + err.message;
      }
    }

    proceedToStep2() {
      if (this.scopeDesigns.length === 0) {
        alert('Please choose a scope that contains at least 1 design.');
        return;
      }
      this.currentStep = 2;
      this.updateStepView();
    }

    // ==========================================
    // STEP 2: FILE & FOLDER SELECTION, SUBFOLDER EXTRACTION
    // ==========================================
    handleFilesSelected(filesList) {
      if (!filesList || filesList.length === 0) return;

      const allowedExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.zip']);
      const validFiles = Array.from(filesList).filter(f => {
        const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase();
        return allowedExts.has(ext);
      });

      if (validFiles.length === 0) {
        alert('No supported files found. Supported formats: PNG, JPG, JPEG, WEBP, and ZIP.');
        return;
      }

      this.rawSelectedFiles = validFiles;
      this.subfolderMap.clear();

      // Inspect webkitRelativePath for nested folders (e.g. "ARUVI BULK DESIGNS 2")
      const subfolderSelect = document.getElementById('bulkReplaceSubfolderSelect');
      const subfolderWrapper = document.getElementById('bulkReplaceSubfolderWrapper');

      let hasFolders = false;
      let topFolderName = '';

      validFiles.forEach(f => {
        const relPath = f.webkitRelativePath || '';
        if (relPath && relPath.includes('/')) {
          hasFolders = true;
          const parts = relPath.split('/');
          if (!topFolderName) topFolderName = parts[0];

          // 1. Top-level folder
          const topFolder = parts[0];
          if (!this.subfolderMap.has(topFolder)) {
            this.subfolderMap.set(topFolder, []);
          }
          this.subfolderMap.get(topFolder).push(f);

          // 2. Immediate subfolders if path has 3+ parts: e.g. Parent/Sub/file.zip
          if (parts.length >= 3) {
            const subName = parts[1];
            if (!this.subfolderMap.has(subName)) {
              this.subfolderMap.set(subName, []);
            }
            this.subfolderMap.get(subName).push(f);
          }
        }
      });

      if (hasFolders && this.subfolderMap.size > 0 && subfolderSelect && subfolderWrapper) {
        subfolderWrapper.style.display = 'block';
        subfolderSelect.innerHTML = '';

        // Default option: all files
        const allOpt = document.createElement('option');
        allOpt.value = '__ALL__';
        allOpt.textContent = `All Selected Files (${validFiles.length} files)`;
        subfolderSelect.appendChild(allOpt);

        let defaultFolderKey = null;

        for (const [folderName, files] of this.subfolderMap.entries()) {
          const imgCount = files.filter(f => !f.name.toLowerCase().endsWith('.zip')).length;
          const zipCount = files.filter(f => f.name.toLowerCase().endsWith('.zip')).length;

          const opt = document.createElement('option');
          opt.value = folderName;
          opt.textContent = `📁 ${folderName} (${imgCount} images, ${zipCount} ZIPs - ${files.length} total)`;
          subfolderSelect.appendChild(opt);

          // Pre-select if folder matches "ARUVI BULK DESIGNS 2"
          if (/aruvi.*bulk.*designs.*2/i.test(folderName) || (this.subfolderMap.size === 1 && !defaultFolderKey)) {
            defaultFolderKey = folderName;
          }
        }

        if (defaultFolderKey) {
          subfolderSelect.value = defaultFolderKey;
          this.handleSubfolderSelect(defaultFolderKey);
        } else {
          subfolderSelect.value = '__ALL__';
          this.handleSubfolderSelect('__ALL__');
        }
      } else {
        if (subfolderWrapper) subfolderWrapper.style.display = 'none';
        this.activeFiles = validFiles;
        this.updateFileStatsUI(topFolderName || 'Selected Files');
      }

      const proceedBtn = document.getElementById('bulkReplaceFilesNextBtn');
      if (proceedBtn) {
        proceedBtn.disabled = this.activeFiles.length === 0;
      }
    }

    handleSubfolderSelect(subfolderKey) {
      let folderDisplayName = 'All Selected Files';

      if (!subfolderKey || subfolderKey === '__ALL__') {
        this.activeFiles = this.rawSelectedFiles;
      } else if (this.subfolderMap.has(subfolderKey)) {
        this.activeFiles = this.subfolderMap.get(subfolderKey);
        folderDisplayName = subfolderKey;
      } else {
        this.activeFiles = this.rawSelectedFiles;
      }

      this.updateFileStatsUI(folderDisplayName);

      const proceedBtn = document.getElementById('bulkReplaceFilesNextBtn');
      if (proceedBtn) {
        proceedBtn.disabled = this.activeFiles.length === 0;
      }
    }

    updateFileStatsUI(folderName) {
      const imgCount = this.activeFiles.filter(f => !f.name.toLowerCase().endsWith('.zip')).length;
      const zipCount = this.activeFiles.filter(f => f.name.toLowerCase().endsWith('.zip')).length;
      const totalCount = this.activeFiles.length;

      const summaryBadge = document.getElementById('selectedFilesSummaryBadge');
      const folderEl = document.getElementById('summaryFolderName');
      const imgEl = document.getElementById('summaryImagesCount');
      const zipEl = document.getElementById('summaryZipsCount');
      const totalEl = document.getElementById('summaryTotalCount');

      if (summaryBadge && folderEl && imgEl && zipEl && totalEl) {
        summaryBadge.style.display = 'flex';
        folderEl.textContent = folderName;
        imgEl.textContent = imgCount;
        zipEl.textContent = zipCount;
        totalEl.textContent = totalCount;
      }

      const countBadge = document.getElementById('selectedFilesCountBadge');
      if (countBadge) {
        countBadge.style.display = 'inline-block';
        countBadge.textContent = `${imgCount} Images, ${zipCount} ZIPs (${totalCount} Total)`;
      }
    }

    async proceedToStep3() {
      if (this.activeFiles.length === 0) {
        alert('Please select files or a folder containing preview images and/or ZIP packages.');
        return;
      }

      const nextBtn = document.getElementById('bulkReplaceFilesNextBtn');
      if (nextBtn) {
        nextBtn.disabled = true;
        nextBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing & Matching Images + ZIPs...';
      }

      const filesMetadata = this.activeFiles.map(f => ({
        name: f.name,
        size: f.size,
        type: f.type,
        isZip: f.name.toLowerCase().endsWith('.zip')
      }));

      const catSelect = document.getElementById('bulkReplaceCategorySelect');
      const useCheckedOnly = document.getElementById('scopeCheckedRadio')?.checked;
      const checkedBoxes = Array.from(document.querySelectorAll('input.design-checkbox:checked'));

      const categoryIds = (!useCheckedOnly && catSelect)
        ? Array.from(catSelect.selectedOptions).map(opt => opt.value).filter(v => v !== 'all')
        : [];
      const checkedIds = useCheckedOnly ? checkedBoxes.map(cb => cb.value) : [];
      const status = document.getElementById('bulkReplaceStatusFilter')?.value || 'all';
      const search = document.getElementById('bulkReplaceSearchFilter')?.value || '';
      const mode = document.querySelector('input[name="bulkReplaceMode"]:checked')?.value || 'replace_matching';

      try {
        const res = await fetch('/admin/designs/bulk-replace/preview-match', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'CSRF-Token': this.getCSRF()
          },
          body: JSON.stringify({
            files: filesMetadata,
            categoryIds,
            status,
            search,
            checkedIds,
            mode
          })
        });

        const data = await res.json();
        if (nextBtn) {
          nextBtn.disabled = false;
          nextBtn.innerHTML = 'Next: Preview Matches <i class="fa-solid fa-arrow-right"></i>';
        }

        if (data.success) {
          this.matchResult = data;
          this.currentStep = 3;
          this.updateStepView();
          this.renderPreviewTable();
        } else {
          alert('Error matching files: ' + (data.message || 'Unknown error'));
        }
      } catch (err) {
        if (nextBtn) {
          nextBtn.disabled = false;
          nextBtn.innerHTML = 'Next: Preview Matches <i class="fa-solid fa-arrow-right"></i>';
        }
        alert('Network error while matching: ' + err.message);
      }
    }

    // ==========================================
    // STEP 3: PREVIEW TABLE & MANUAL OVERRIDES
    // ==========================================
    renderPreviewTable() {
      if (!this.matchResult) return;

      const summary = this.matchResult.summary;
      const willReplaceEl = document.getElementById('previewStatWillReplace');
      const imgStatEl = document.getElementById('previewStatImages');
      const zipStatEl = document.getElementById('previewStatZips');
      const noFileEl = document.getElementById('previewStatNoFile');
      const unmatchedEl = document.getElementById('previewStatUnmatched');
      const ambiguousEl = document.getElementById('previewStatAmbiguous');

      if (willReplaceEl) willReplaceEl.textContent = summary.matchedDesignsCount || 0;
      if (imgStatEl) imgStatEl.textContent = summary.matchedImagesCount || 0;
      if (zipStatEl) zipStatEl.textContent = summary.matchedZipsCount || 0;
      if (noFileEl) noFileEl.textContent = summary.designsWithoutFilesCount || 0;
      if (unmatchedEl) unmatchedEl.textContent = summary.unmatchedFilesCount || 0;
      if (ambiguousEl) ambiguousEl.textContent = summary.ambiguousFilesCount || 0;

      const tbody = document.getElementById('bulkReplacePreviewTbody');
      tbody.innerHTML = '';

      // Quick lookup for active File objects
      const fileMap = new Map();
      this.activeFiles.forEach(f => fileMap.set(f.name, f));

      // 1. Matched Designs (Both Images and ZIPs)
      this.matchResult.previewList.forEach(item => {
        const hasImage = item.imageFiles && item.imageFiles.length > 0;
        const hasZip = item.zipFiles && item.zipFiles.length > 0;

        let primaryImageFile = hasImage ? item.imageFiles[0] : null;
        let primaryZipFile = hasZip ? item.zipFiles[0] : null;

        const imgFileObj = primaryImageFile ? fileMap.get(primaryImageFile.fileName) : null;
        const newImgSrc = imgFileObj ? URL.createObjectURL(imgFileObj) : (item.currentPrimaryImage || '/public/images/cat_floral.jpg');

        const isExcluded = this.excludedFiles.has(`design_${item.designId}`);

        let rowTypeClass = 'row-will-replace';
        if (hasImage && hasZip) {
          rowTypeClass += ' row-has-both';
        } else if (hasImage) {
          rowTypeClass += ' row-has-image-only';
        } else if (hasZip) {
          rowTypeClass += ' row-has-zip-only';
        }

        const tr = document.createElement('tr');
        tr.className = `preview-row ${rowTypeClass}`;
        tr.dataset.designId = item.designId;

        tr.innerHTML = `
          <td style="text-align: center; vertical-align: middle;">
            <input type="checkbox" class="preview-item-checkbox" data-design-id="${item.designId}" ${isExcluded ? '' : 'checked'} onchange="window.bulkImageReplaceInstance.toggleDesignExclusion(${item.designId}, this.checked)">
          </td>
          <td style="vertical-align: middle;">
            <strong>${item.sku || 'ID: ' + item.designId}</strong>
            <div style="font-size: 0.74rem; color: #555; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.title || ''}">${item.title || ''}</div>
            <span class="badge" style="font-size: 0.7rem; background: #EDE7F6; color: #512DA8; margin-top: 2px;">${item.categoryName || 'Design'}</span>
          </td>
          <td style="vertical-align: middle;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <img src="${item.currentPrimaryImage || '/public/images/cat_floral.jpg'}" alt="Old" style="width: 44px; height: 44px; object-fit: contain; background: #FAF6F0; border-radius: 6px; border: 1px solid #EEE;" onerror="this.src='/public/images/cat_floral.jpg';">
              <span style="color: #999; font-size: 0.8rem;"><i class="fa-solid fa-arrow-right"></i></span>
              ${hasImage ? `
                <img src="${newImgSrc}" alt="New" style="width: 44px; height: 44px; object-fit: contain; background: #FAF6F0; border-radius: 6px; border: 1px solid #81C784;" title="${primaryImageFile.fileName}">
              ` : `
                <span class="badge" style="background: #F5F5F5; color: #757575; font-size: 0.72rem; padding: 4px 6px;">Keep Existing</span>
              `}
            </div>
            ${hasImage ? `<div style="font-size: 0.7rem; color: #1565C0; margin-top: 3px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${primaryImageFile.fileName}">${primaryImageFile.fileName}</div>` : ''}
          </td>
          <td style="vertical-align: middle;">
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <div style="font-size: 0.72rem; color: #555;">
                Old: ${item.currentZipName ? `<code style="font-size: 0.72rem; color: #37474F;"><i class="fa-solid fa-file-zipper"></i> ${item.currentZipName}</code>` : '<span style="color: #999;">None</span>'}
              </div>
              <div style="font-size: 0.72rem;">
                New: ${hasZip ? `<code style="font-size: 0.72rem; color: #00796B; font-weight: 600;"><i class="fa-solid fa-file-zipper"></i> ${primaryZipFile.fileName}</code>` : '<span class="badge" style="background: #F5F5F5; color: #757575; font-size: 0.7rem;">Keep Existing</span>'}
              </div>
            </div>
          </td>
          <td style="vertical-align: middle;">
            ${hasImage ? `
              <span class="badge" style="background: #E8F5E9; color: #2E7D32; font-size: 0.74rem;">
                <i class="fa-solid fa-circle-check"></i> Replace
              </span>
            ` : `
              <span class="badge" style="background: #F5F5F5; color: #757575; font-size: 0.74rem;">
                Keep Existing
              </span>
            `}
          </td>
          <td style="vertical-align: middle;">
            ${hasZip ? `
              <span class="badge" style="background: #E0F7FA; color: #00796B; font-size: 0.74rem;">
                <i class="fa-solid fa-file-zipper"></i> Replace
              </span>
            ` : `
              <span class="badge" style="background: #F5F5F5; color: #757575; font-size: 0.74rem;">
                Keep Existing
              </span>
            `}
          </td>
          <td style="vertical-align: middle;">
            <span class="badge" style="background: #E0F2FE; color: #0369A1; font-size: 0.72rem; white-space: nowrap;">
              ${item.matchConfidence}
            </span>
          </td>
          <td style="vertical-align: middle;">
            <select class="form-control" style="font-size: 0.74rem; padding: 3px 6px; height: 28px; max-width: 160px;" onchange="window.bulkImageReplaceInstance.reassignDesign(${item.designId}, this.value)">
              <option value="${item.designId}" selected>Linked: ${item.sku}</option>
              <option value="__EXCLUDE__">-- Exclude this row --</option>
              ${this.scopeDesigns.filter(d => d.id !== item.designId).slice(0, 40).map(d => `<option value="${d.id}">${d.sku} (#${d.id})</option>`).join('')}
            </select>
          </td>
        `;
        tbody.appendChild(tr);
      });

      // 2. Ambiguous Files (Multiple products matched - requires manual choice)
      if (this.matchResult.ambiguousFiles && this.matchResult.ambiguousFiles.length > 0) {
        this.matchResult.ambiguousFiles.forEach(af => {
          const fileObj = fileMap.get(af.fileName);
          const isZip = af.isZip;
          const newThumbSrc = (!isZip && fileObj) ? URL.createObjectURL(fileObj) : '/public/images/cat_floral.jpg';
          const overrideId = this.manualOverrides.get(af.fileName);

          const tr = document.createElement('tr');
          tr.className = 'preview-row row-ambiguous';
          tr.style.background = '#FFFDE7';

          tr.innerHTML = `
            <td style="text-align: center; vertical-align: middle;">
              <input type="checkbox" class="preview-item-checkbox" data-filename="${af.fileName}" ${overrideId ? 'checked' : 'disabled'}>
            </td>
            <td style="vertical-align: middle;">
              <strong style="color: #C62828;">Ambiguous Match</strong>
              <div style="font-size: 0.72rem; color: #B71C1C;">Matches: ${af.matches.map(m => m.sku).join(', ')}</div>
            </td>
            <td style="vertical-align: middle;">
              ${!isZip ? `
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span style="color: #999; font-size: 0.75rem;">None</span>
                  <i class="fa-solid fa-arrow-right" style="color: #999; font-size: 0.75rem;"></i>
                  <img src="${newThumbSrc}" alt="New" style="width: 44px; height: 44px; object-fit: contain; background: #FAF6F0; border-radius: 6px; border: 1px solid #FFCA28;">
                </div>
              ` : '<span style="color: #999; font-size: 0.75rem;">-</span>'}
            </td>
            <td style="vertical-align: middle;">
              ${isZip ? `
                <code style="font-size: 0.72rem; color: #C62828;"><i class="fa-solid fa-file-zipper"></i> ${af.fileName}</code>
              ` : '<span style="color: #999; font-size: 0.75rem;">-</span>'}
            </td>
            <td style="vertical-align: middle;">
              <span class="badge" style="background: #FFEBEE; color: #C62828; font-size: 0.74rem;">
                ${isZip ? '-' : 'Multiple Matches'}
              </span>
            </td>
            <td style="vertical-align: middle;">
              <span class="badge" style="background: #FFEBEE; color: #C62828; font-size: 0.74rem;">
                ${isZip ? 'Multiple Matches' : '-'}
              </span>
            </td>
            <td style="vertical-align: middle;">
              <span class="badge" style="background: #FFEBEE; color: #C62828; font-size: 0.72rem;">Ambiguous</span>
            </td>
            <td style="vertical-align: middle;">
              <select class="form-control" style="font-size: 0.74rem; padding: 3px 6px; height: 28px; max-width: 170px; border-color: #FFA000;" onchange="window.bulkImageReplaceInstance.setManualOverride('${af.fileName}', this.value)">
                <option value="">-- Choose Matching Design --</option>
                ${af.matches.map(m => `<option value="${m.id}" ${overrideId == m.id ? 'selected' : ''}>${m.sku} (${m.title})</option>`).join('')}
              </select>
            </td>
          `;
          tbody.appendChild(tr);
        });
      }

      // 3. Unmatched Files (Allows manual mapping)
      if (this.matchResult.unmatchedFiles && this.matchResult.unmatchedFiles.length > 0) {
        this.matchResult.unmatchedFiles.forEach(uf => {
          const fileObj = fileMap.get(uf.fileName);
          const isZip = uf.isZip;
          const newThumbSrc = (!isZip && fileObj) ? URL.createObjectURL(fileObj) : '/public/images/cat_floral.jpg';
          const overrideId = this.manualOverrides.get(uf.fileName);

          const tr = document.createElement('tr');
          tr.className = 'preview-row row-unmatched';
          tr.innerHTML = `
            <td style="text-align: center; vertical-align: middle;">
              <input type="checkbox" class="preview-item-checkbox" data-filename="${uf.fileName}" ${overrideId ? 'checked' : 'disabled'}>
            </td>
            <td style="vertical-align: middle;">
              <span style="color: #888; font-style: italic; font-size: 0.78rem;">Unlinked File</span>
            </td>
            <td style="vertical-align: middle;">
              ${!isZip ? `
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span style="color: #999; font-size: 0.75rem;">None</span>
                  <i class="fa-solid fa-arrow-right" style="color: #999; font-size: 0.75rem;"></i>
                  <img src="${newThumbSrc}" alt="New" style="width: 44px; height: 44px; object-fit: contain; background: #FAF6F0; border-radius: 6px; border: 1px solid #CCC;">
                </div>
              ` : '<span style="color: #999; font-size: 0.75rem;">-</span>'}
            </td>
            <td style="vertical-align: middle;">
              ${isZip ? `
                <code style="font-size: 0.72rem; color: #C62828;"><i class="fa-solid fa-file-zipper"></i> ${uf.fileName}</code>
              ` : '<span style="color: #999; font-size: 0.75rem;">-</span>'}
            </td>
            <td style="vertical-align: middle;">
              <span class="badge" style="background: #FFF3E0; color: #E65100; font-size: 0.74rem;">
                ${isZip ? '-' : 'Unmatched'}
              </span>
            </td>
            <td style="vertical-align: middle;">
              <span class="badge" style="background: #FFF3E0; color: #E65100; font-size: 0.74rem;">
                ${isZip ? 'Unmatched' : '-'}
              </span>
            </td>
            <td style="vertical-align: middle;">
              <span class="badge" style="background: #FFF3E0; color: #E65100; font-size: 0.72rem;">None</span>
            </td>
            <td style="vertical-align: middle;">
              <select class="form-control" style="font-size: 0.74rem; padding: 3px 6px; height: 28px; max-width: 170px;" onchange="window.bulkImageReplaceInstance.setManualOverride('${uf.fileName}', this.value)">
                <option value="">-- Manually Link Design --</option>
                ${this.scopeDesigns.slice(0, 50).map(d => `<option value="${d.id}" ${overrideId == d.id ? 'selected' : ''}>${d.sku} (#${d.id})</option>`).join('')}
              </select>
            </td>
          `;
          tbody.appendChild(tr);
        });
      }

      // 4. Designs Without Files (Scope designs not matched)
      if (this.matchResult.designsWithoutFiles && this.matchResult.designsWithoutFiles.length > 0) {
        this.matchResult.designsWithoutFiles.slice(0, 30).forEach(df => {
          const tr = document.createElement('tr');
          tr.className = 'preview-row row-no-file';
          tr.style.opacity = '0.75';
          tr.innerHTML = `
            <td style="text-align: center; vertical-align: middle;"><span style="color: #BBB;">-</span></td>
            <td style="vertical-align: middle;">
              <strong>${df.sku || 'ID: ' + df.id}</strong>
              <div style="font-size: 0.74rem; color: #777;">${df.title || ''}</div>
              <span class="badge" style="font-size: 0.7rem; background: #EEE; color: #666;">${df.categoryName || 'Design'}</span>
            </td>
            <td style="vertical-align: middle;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <img src="${df.primaryImage || '/public/images/cat_floral.jpg'}" alt="Current" style="width: 44px; height: 44px; object-fit: contain; background: #FAF6F0; border-radius: 6px; border: 1px solid #EEE;" onerror="this.src='/public/images/cat_floral.jpg';">
                <span class="badge" style="background: #F5F5F5; color: #757575; font-size: 0.72rem;">Unchanged</span>
              </div>
            </td>
            <td style="vertical-align: middle;">
              <div style="font-size: 0.72rem; color: #777;">
                ${df.currentZipName ? `<code style="font-size: 0.72rem;"><i class="fa-solid fa-file-zipper"></i> ${df.currentZipName}</code>` : '<span style="color: #999;">None</span>'}
              </div>
            </td>
            <td style="vertical-align: middle;"><span class="badge" style="background: #F5F5F5; color: #757575; font-size: 0.74rem;">Unchanged</span></td>
            <td style="vertical-align: middle;"><span class="badge" style="background: #F5F5F5; color: #757575; font-size: 0.74rem;">Unchanged</span></td>
            <td style="vertical-align: middle;"><span class="badge" style="background: #F5F5F5; color: #757575; font-size: 0.72rem;">-</span></td>
            <td style="vertical-align: middle;"><span style="font-size: 0.74rem; color: #999;">No file in upload</span></td>
          `;
          tbody.appendChild(tr);
        });
      }
    }

    toggleDesignExclusion(designId, isChecked) {
      const key = `design_${designId}`;
      if (isChecked) {
        this.excludedFiles.delete(key);
      } else {
        this.excludedFiles.add(key);
      }
    }

    reassignDesign(currentDesignId, targetValue) {
      if (targetValue === '__EXCLUDE__') {
        this.excludedFiles.add(`design_${currentDesignId}`);
      } else {
        this.excludedFiles.delete(`design_${currentDesignId}`);
      }
    }

    setManualOverride(fileName, designId) {
      if (designId) {
        this.manualOverrides.set(fileName, parseInt(designId, 10));
      } else {
        this.manualOverrides.delete(fileName);
      }
      this.renderPreviewTable();
    }

    filterPreviewRows(filterType) {
      document.querySelectorAll('.preview-filter-tab').forEach(t => t.classList.remove('active'));
      const activeTab = document.getElementById(`filterTab_${filterType}`);
      if (activeTab) activeTab.classList.add('active');

      const rows = document.querySelectorAll('#bulkReplacePreviewTbody tr');
      rows.forEach(r => {
        if (filterType === 'all') {
          r.style.display = '';
        } else if (filterType === 'both') {
          r.style.display = r.classList.contains('row-has-both') ? '' : 'none';
        } else if (filterType === 'image_only') {
          r.style.display = r.classList.contains('row-has-image-only') ? '' : 'none';
        } else if (filterType === 'zip_only') {
          r.style.display = r.classList.contains('row-has-zip-only') ? '' : 'none';
        } else if (filterType === 'unmatched') {
          r.style.display = (r.classList.contains('row-unmatched') || r.classList.contains('row-ambiguous')) ? '' : 'none';
        } else if (filterType === 'no_file') {
          r.style.display = r.classList.contains('row-no-file') ? '' : 'none';
        }
      });
    }

    // ==========================================
    // STEP 4: CHUNKED UPLOAD & TRANSACTION COMMIT
    // ==========================================
    async proceedToStep4Apply() {
      if (this.isUploading) return;

      const itemsToUpload = [];
      const fileMap = new Map();
      this.activeFiles.forEach(f => fileMap.set(f.name, f));

      // 1. Items from previewList (Automatic Matches)
      if (this.matchResult && this.matchResult.previewList) {
        this.matchResult.previewList.forEach(item => {
          if (this.excludedFiles.has(`design_${item.designId}`)) return;

          // Matched Images
          if (item.imageFiles) {
            item.imageFiles.forEach(img => {
              const fileObj = fileMap.get(img.fileName);
              if (fileObj) {
                itemsToUpload.push({
                  designId: item.designId,
                  sku: item.sku,
                  title: item.title,
                  file: fileObj,
                  isZip: false,
                  isPrimary: img.isPrimary,
                  imageIndex: img.imageIndex || 1
                });
              }
            });
          }

          // Matched ZIP packages
          if (item.zipFiles) {
            item.zipFiles.forEach(zip => {
              const fileObj = fileMap.get(zip.fileName);
              if (fileObj) {
                itemsToUpload.push({
                  designId: item.designId,
                  sku: item.sku,
                  title: item.title,
                  file: fileObj,
                  isZip: true,
                  isPrimary: false,
                  imageIndex: 1
                });
              }
            });
          }
        });
      }

      // 2. Items from manual overrides
      for (const [fileName, designId] of this.manualOverrides.entries()) {
        const fileObj = fileMap.get(fileName);
        const design = this.scopeDesigns.find(d => d.id === designId);
        if (fileObj && design) {
          const isZip = fileName.toLowerCase().endsWith('.zip');
          itemsToUpload.push({
            designId,
            sku: design.sku,
            title: design.title,
            file: fileObj,
            isZip,
            isPrimary: !isZip,
            imageIndex: 1
          });
        }
      }

      if (itemsToUpload.length === 0) {
        alert('No files are selected or matched for replacement.');
        return;
      }

      const imgCount = itemsToUpload.filter(i => !i.isZip).length;
      const zipCount = itemsToUpload.filter(i => i.isZip).length;
      const confirmMsg = `Ready to replace files for ${new Set(itemsToUpload.map(i => i.designId)).size} designs?\n\n• Images to replace: ${imgCount}\n• ZIP packages to replace: ${zipCount}\n\nA 7-day rollback backup will be created automatically. Proceed?`;

      if (!confirm(confirmMsg)) {
        return;
      }

      this.currentStep = 4;
      this.updateStepView();

      const progressSection = document.getElementById('uploadProgressSection');
      const reportSection = document.getElementById('uploadReportSection');
      if (progressSection) progressSection.style.display = 'block';
      if (reportSection) reportSection.style.display = 'none';

      const progressBar = document.getElementById('bulkReplaceProgressBar');
      const progressPercent = document.getElementById('bulkReplaceProgressPercent');
      const progressStatus = document.getElementById('bulkReplaceProgressStatus');

      this.isUploading = true;
      this.abortController = new AbortController();

      const chunkSize = 5;
      const chunks = [];
      for (let i = 0; i < itemsToUpload.length; i += chunkSize) {
        chunks.push(itemsToUpload.slice(i, i + chunkSize));
      }

      let uploadedProcessedItems = [];
      let completedChunks = 0;
      this.failedItems = [];

      try {
        const parallelLimit = 3;
        let activeIdx = 0;

        const uploadWorker = async () => {
          while (activeIdx < chunks.length) {
            const currentIdx = activeIdx++;
            const chunkItems = chunks[currentIdx];

            const formData = new FormData();
            formData.append('_csrf', this.getCSRF());
            chunkItems.forEach(item => {
              formData.append('files', item.file, item.file.name);
            });

            const res = await fetch('/admin/designs/bulk-replace/upload-chunk', {
              method: 'POST',
              headers: {
                'CSRF-Token': this.getCSRF()
              },
              body: formData,
              signal: this.abortController.signal
            });

            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.message || `Server returned status ${res.status}`);
            }

            const data = await res.json();
            if (data.success && data.files) {
              data.files.forEach((pfile, idx) => {
                const originalItem = chunkItems[idx];
                uploadedProcessedItems.push({
                  designId: originalItem.designId,
                  sku: originalItem.sku,
                  title: originalItem.title,
                  originalName: pfile.originalName,
                  publicUrl: pfile.publicUrl || null,
                  thumbUrl: pfile.thumbUrl || null,
                  storageKey: pfile.storageKey || null,
                  fileSize: pfile.fileSize,
                  checksum: pfile.checksum,
                  isZip: pfile.isZip || false,
                  isPrimary: originalItem.isPrimary,
                  imageIndex: originalItem.imageIndex,
                  detectedFormats: pfile.detectedFormats || []
                });
              });
            }

            completedChunks++;
            const percent = Math.round((completedChunks / chunks.length) * 85);
            if (progressBar) progressBar.style.width = `${percent}%`;
            if (progressPercent) progressPercent.textContent = `${percent}%`;
            if (progressStatus) progressStatus.textContent = `Uploaded chunk ${completedChunks} of ${chunks.length}...`;
          }
        };

        const workers = [];
        for (let w = 0; w < Math.min(parallelLimit, chunks.length); w++) {
          workers.push(uploadWorker());
        }
        await Promise.all(workers);

        // Commit replacement in DB inside transactions
        if (progressStatus) progressStatus.textContent = 'Saving images & ZIP design packages to database in safe transactions...';
        if (progressBar) progressBar.style.width = '90%';
        if (progressPercent) progressPercent.textContent = '90%';

        const mode = document.querySelector('input[name="bulkReplaceMode"]:checked')?.value || 'replace_matching';
        const catSelect = document.getElementById('bulkReplaceCategorySelect');
        const catName = (catSelect && catSelect.selectedOptions && catSelect.selectedOptions[0]) ? catSelect.selectedOptions[0].textContent : 'Catalog';

        const commitRes = await fetch('/admin/designs/bulk-replace/commit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'CSRF-Token': this.getCSRF()
          },
          body: JSON.stringify({
            _csrf: this.getCSRF(),
            categoryId: (catSelect && catSelect.value !== 'all') ? catSelect.value : null,
            categoryName: catName,
            scopeSummary: `Replaced files for ${uploadedProcessedItems.length} items in ${catName}`,
            replacementMode: mode,
            items: uploadedProcessedItems
          }),
          signal: this.abortController.signal
        });

        const commitData = await commitRes.json();
        if (!commitData.success) {
          throw new Error(commitData.message || 'Database commit failed');
        }

        this.lastLogId = commitData.logId;
        this.isUploading = false;

        if (progressBar) progressBar.style.width = '100%';
        if (progressPercent) progressPercent.textContent = '100%';

        // Display Final Report Section
        if (progressSection) progressSection.style.display = 'none';
        if (reportSection) reportSection.style.display = 'block';

        const replacedImgEl = document.getElementById('reportCountReplacedImages');
        const replacedZipEl = document.getElementById('reportCountReplacedZips');
        const skippedEl = document.getElementById('reportCountSkipped');
        const failedEl = document.getElementById('reportCountFailed');

        if (replacedImgEl) replacedImgEl.textContent = commitData.replacedImagesCount || 0;
        if (replacedZipEl) replacedZipEl.textContent = commitData.replacedZipsCount || 0;
        if (skippedEl) skippedEl.textContent = commitData.skippedCount || 0;
        if (failedEl) failedEl.textContent = commitData.failedCount || 0;

        // CSV Report link
        const csvBtn = document.getElementById('bulkReplaceDownloadCsvBtn');
        if (csvBtn) {
          csvBtn.href = `/admin/designs/bulk-replace/export-csv/${commitData.logId}`;
        }

        // 7-day rollback button
        const undoBtn = document.getElementById('bulkReplaceUndoBtn');
        if (undoBtn) {
          undoBtn.style.display = 'inline-flex';
          undoBtn.onclick = () => this.undoCurrentReplace(commitData.logId);
        }

        // Retry failed button
        const retryBtn = document.getElementById('bulkReplaceRetryFailedBtn');
        if (retryBtn) {
          if (commitData.failedCount > 0) {
            retryBtn.style.display = 'inline-flex';
          } else {
            retryBtn.style.display = 'none';
          }
        }
      } catch (err) {
        this.isUploading = false;
        alert('Upload Error: ' + err.message);
        if (progressStatus) progressStatus.textContent = 'Error: ' + err.message;
      }
    }

    retryFailed() {
      // Return to preview to review and retry
      this.currentStep = 3;
      this.updateStepView();
    }

    cancelUpload() {
      if (this.abortController) {
        this.abortController.abort();
      }
      this.isUploading = false;
      alert('Upload cancelled.');
      this.currentStep = 3;
      this.updateStepView();
    }

    async undoCurrentReplace(logId) {
      if (!confirm(`Are you sure you want to undo this bulk replacement (Batch #${logId})?\n\nThis will restore all affected products to their previous preview images and ZIP packages.`)) {
        return;
      }

      try {
        const res = await fetch(`/admin/designs/bulk-replace/undo/${logId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'CSRF-Token': this.getCSRF()
          },
          body: JSON.stringify({ _csrf: this.getCSRF() })
        });
        const data = await res.json();
        if (data.success) {
          alert(data.message || 'Bulk replace successfully reverted.');
          window.location.reload();
        } else {
          alert('Undo Error: ' + (data.message || 'Failed to revert'));
        }
      } catch (err) {
        alert('Network error while undoing: ' + err.message);
      }
    }
  }

  // Ensure singleton instance
  function ensureInstance() {
    if (!window.bulkImageReplaceInstance) {
      window.bulkImageReplaceInstance = new BulkImageReplace();
    }
    return window.bulkImageReplaceInstance;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureInstance);
  } else {
    ensureInstance();
  }

  window.openBulkReplaceImagesModal = function () {
    try {
      const inst = ensureInstance();
      if (inst) {
        inst.openModal();
        return;
      }
    } catch (e) {
      console.error('[BulkReplace] Error opening modal via instance:', e);
    }

    const modal = document.getElementById('bulkReplaceImagesModal');
    if (modal) {
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
  };

  window.closeBulkReplaceImagesModal = function () {
    try {
      const inst = ensureInstance();
      if (inst) {
        inst.closeModal();
        return;
      }
    } catch (e) {
      console.error('[BulkReplace] Error closing modal via instance:', e);
    }

    const modal = document.getElementById('bulkReplaceImagesModal');
    if (modal) {
      modal.style.display = 'none';
      document.body.style.overflow = '';
    }
  };
})();
