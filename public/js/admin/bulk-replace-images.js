/**
 * Bulk Image Replace by Category Controller
 * Handles 4-step modal flow:
 * 1. Scope (Category filter, live count, status, checked rows)
 * 2. Select files (Multi-select, drag & drop, folder selection, replacement mode)
 * 3. Match preview (Old vs new thumbnail, status badges, untick, manual mapping dropdown)
 * 4. Apply (Chunked upload 5 files/req, 3 in parallel, retry, cancel, progress bar, batch DB commit, CSV download, 7-day undo)
 */

(function () {
  'use strict';

  class BulkImageReplace {
    constructor() {
      this.currentStep = 1;
      this.scopeCategories = [];
      this.selectedCategoryIds = [];
      this.scopeDesigns = [];
      this.uploadedFiles = [];
      this.matchResult = null;
      this.manualOverrides = new Map(); // fileName -> designId
      this.excludedFiles = new Set();    // fileNames unticked by user
      this.isUploading = false;
      this.abortController = null;
      this.lastLogId = null;

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
      if (!modal) return;
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';

      this.currentStep = 1;
      this.uploadedFiles = [];
      this.matchResult = null;
      this.manualOverrides.clear();
      this.excludedFiles.clear();
      this.isUploading = false;
      this.lastLogId = null;

      this.updateStepView();
      await this.loadScopeSummary();
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
      // Step indicator pills
      for (let s = 1; s <= 4; s++) {
        const stepHeader = document.getElementById(`bulkReplaceStepHeader${s}`);
        const stepBody = document.getElementById(`bulkReplaceStepBody${s}`);
        const stepFooter = document.getElementById(`bulkReplaceStepFooter${s}`);

        if (stepHeader) {
          stepHeader.classList.toggle('active', s === this.currentStep);
          stepHeader.classList.toggle('completed', s < this.currentStep);
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
            document.getElementById('scopeCategoryOption').querySelector('input').checked = true;
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

          // Populate category select if empty
          if (catSelect && catSelect.options.length <= 1) {
            this.scopeCategories.forEach(c => {
              const opt = document.createElement('option');
              opt.value = c.id;
              opt.textContent = `${c.name} (${c.design_count} designs)`;
              catSelect.appendChild(opt);
            });
          }

          let categoryLabel = 'All Categories';
          if (useCheckedOnly) {
            categoryLabel = `Checked Rows (${data.totalDesigns} selected)`;
          } else if (selectedCatIds.length === 1) {
            const foundCat = this.scopeCategories.find(c => String(c.id) === String(selectedCatIds[0]));
            categoryLabel = foundCat ? foundCat.name : 'Selected Category';
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
    // STEP 2: FILE SELECTION & MODES
    // ==========================================
    handleFilesSelected(filesList) {
      if (!filesList || filesList.length === 0) return;
      const validFiles = Array.from(filesList).filter(f => {
        const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase();
        return ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
      });

      this.uploadedFiles = validFiles;

      const countBadge = document.getElementById('selectedFilesCountBadge');
      if (countBadge) {
        countBadge.style.display = 'inline-block';
        countBadge.textContent = `${validFiles.length} image files selected`;
      }

      const proceedBtn = document.getElementById('bulkReplaceFilesNextBtn');
      if (proceedBtn) {
        proceedBtn.disabled = validFiles.length === 0;
      }
    }

    async proceedToStep3() {
      if (this.uploadedFiles.length === 0) {
        alert('Please select at least one image file (PNG, JPG, or WEBP).');
        return;
      }

      const nextBtn = document.getElementById('bulkReplaceFilesNextBtn');
      if (nextBtn) {
        nextBtn.disabled = true;
        nextBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing & Matching...';
      }

      const filesMetadata = this.uploadedFiles.map(f => ({
        name: f.name,
        size: f.size,
        type: f.type
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
      const mode = document.querySelector('input[name="bulkReplaceMode"]:checked')?.value || 'replace_primary';

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
      document.getElementById('previewStatWillReplace').textContent = summary.matchedDesignsCount;
      document.getElementById('previewStatNoFile').textContent = summary.designsWithoutFilesCount;
      document.getElementById('previewStatUnmatched').textContent = summary.unmatchedFilesCount;
      document.getElementById('previewStatAmbiguous').textContent = summary.ambiguousFilesCount;

      const tbody = document.getElementById('bulkReplacePreviewTbody');
      tbody.innerHTML = '';

      // Create quick lookup for File objects
      const fileMap = new Map();
      this.uploadedFiles.forEach(f => fileMap.set(f.name, f));

      // 1. Matched Designs (Will Replace)
      this.matchResult.previewList.forEach(item => {
        const primaryFile = item.files.find(f => f.isPrimary) || item.files[0];
        const fileObj = fileMap.get(primaryFile.fileName);
        const newThumbSrc = fileObj ? URL.createObjectURL(fileObj) : '/public/images/cat_floral.jpg';
        const isExcluded = this.excludedFiles.has(primaryFile.fileName);

        const tr = document.createElement('tr');
        tr.className = 'preview-row row-will-replace';
        tr.innerHTML = `
          <td style="text-align: center;">
            <input type="checkbox" class="preview-item-checkbox" data-filename="${primaryFile.fileName}" ${isExcluded ? '' : 'checked'} onchange="window.bulkImageReplaceInstance.toggleRowExclusion('${primaryFile.fileName}', this.checked)">
          </td>
          <td style="width: 60px;">
            <img src="${item.currentPrimaryImage || '/public/images/cat_floral.jpg'}" alt="Old" style="width: 48px; height: 48px; object-fit: contain; background: #FAF6F0; border-radius: 6px; border: 1px solid #EEE;" onerror="this.src='/public/images/cat_floral.jpg';">
          </td>
          <td style="text-align: center; color: var(--admin-text-muted); width: 25px;">
            <i class="fa-solid fa-arrow-right"></i>
          </td>
          <td style="width: 60px;">
            <img src="${newThumbSrc}" alt="New" style="width: 48px; height: 48px; object-fit: contain; background: #FAF6F0; border-radius: 6px; border: 1px solid #C8E6C9;">
          </td>
          <td>
            <strong>${item.sku || 'ID: ' + item.designId}</strong>
            <div style="font-size: 0.78rem; color: #555; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.title || ''}</div>
          </td>
          <td>
            <code style="font-size: 0.78rem; color: #1565C0;">${primaryFile.fileName}</code>
            ${item.files.length > 1 ? `<span class="badge" style="font-size: 0.7rem; background: #EDE7F6; color: #512DA8; margin-left: 4px;">+${item.files.length - 1} extra</span>` : ''}
          </td>
          <td>
            <span class="badge" style="background: #E8F5E9; color: #2E7D32; font-size: 0.74rem;">
              <i class="fa-solid fa-circle-check"></i> Will Replace
            </span>
          </td>
          <td>
            <span style="font-size: 0.76rem; color: var(--admin-text-muted);">Auto Matched</span>
          </td>
        `;
        tbody.appendChild(tr);
      });

      // 2. Unmatched Files (Allows manual mapping)
      this.matchResult.unmatchedFiles.forEach(uf => {
        const fileObj = fileMap.get(uf.fileName);
        const newThumbSrc = fileObj ? URL.createObjectURL(fileObj) : '/public/images/cat_floral.jpg';
        const overrideId = this.manualOverrides.get(uf.fileName);

        const tr = document.createElement('tr');
        tr.className = 'preview-row row-unmatched';
        tr.innerHTML = `
          <td style="text-align: center;">
            <input type="checkbox" class="preview-item-checkbox" data-filename="${uf.fileName}" ${overrideId ? 'checked' : 'disabled'}>
          </td>
          <td style="width: 60px;">
            <div style="width: 48px; height: 48px; border: 1px dashed #CCC; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; color: #999;">None</div>
          </td>
          <td style="text-align: center; color: var(--admin-text-muted); width: 25px;">
            <i class="fa-solid fa-arrow-right"></i>
          </td>
          <td style="width: 60px;">
            <img src="${newThumbSrc}" alt="New" style="width: 48px; height: 48px; object-fit: contain; background: #FAF6F0; border-radius: 6px; border: 1px solid #CCC;">
          </td>
          <td>
            <span style="color: #888; font-style: italic; font-size: 0.82rem;">Unlinked File</span>
          </td>
          <td>
            <code style="font-size: 0.78rem; color: #C62828;">${uf.fileName}</code>
          </td>
          <td>
            <span class="badge" style="background: #FFF3E0; color: #E65100; font-size: 0.74rem;">
              <i class="fa-solid fa-question"></i> Unmatched
            </span>
          </td>
          <td>
            <select class="form-control" style="font-size: 0.76rem; padding: 3px 6px; height: 30px; max-width: 180px;" onchange="window.bulkImageReplaceInstance.setManualOverride('${uf.fileName}', this.value)">
              <option value="">-- Manually Link Design --</option>
              ${this.scopeDesigns.map(d => `<option value="${d.id}" ${overrideId == d.id ? 'selected' : ''}>${d.sku || d.title} (#${d.id})</option>`).join('')}
            </select>
          </td>
        `;
        tbody.appendChild(tr);
      });

      // 3. Designs Without Files (Info only)
      this.matchResult.designsWithoutFiles.slice(0, 30).forEach(df => {
        const tr = document.createElement('tr');
        tr.className = 'preview-row row-no-file';
        tr.style.opacity = '0.75';
        tr.innerHTML = `
          <td style="text-align: center;">
            <span style="color: #999;">-</span>
          </td>
          <td style="width: 60px;">
            <img src="${df.primaryImage || '/public/images/cat_floral.jpg'}" alt="Current" style="width: 48px; height: 48px; object-fit: contain; background: #FAF6F0; border-radius: 6px; border: 1px solid #EEE;" onerror="this.src='/public/images/cat_floral.jpg';">
          </td>
          <td style="text-align: center; color: var(--admin-text-muted); width: 25px;">—</td>
          <td style="width: 60px;">
            <div style="width: 48px; height: 48px; border: 1px dashed #CCC; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; color: #999;">No File</div>
          </td>
          <td>
            <strong>${df.sku || 'ID: ' + df.id}</strong>
            <div style="font-size: 0.78rem; color: #777;">${df.title || ''}</div>
          </td>
          <td><span style="color: #999; font-size: 0.78rem;">No file provided</span></td>
          <td>
            <span class="badge" style="background: #F5F5F5; color: #616161; font-size: 0.74rem;">
              No File in Upload
            </span>
          </td>
          <td><span style="font-size: 0.74rem; color: #999;">Keep Current</span></td>
        `;
        tbody.appendChild(tr);
      });
    }

    toggleRowExclusion(fileName, isChecked) {
      if (isChecked) {
        this.excludedFiles.delete(fileName);
      } else {
        this.excludedFiles.add(fileName);
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
      document.getElementById(`filterTab_${filterType}`)?.classList.add('active');

      const rows = document.querySelectorAll('#bulkReplacePreviewTbody tr');
      rows.forEach(r => {
        if (filterType === 'all') {
          r.style.display = '';
        } else if (filterType === 'will_replace') {
          r.style.display = r.classList.contains('row-will-replace') ? '' : 'none';
        } else if (filterType === 'unmatched') {
          r.style.display = r.classList.contains('row-unmatched') ? '' : 'none';
        } else if (filterType === 'no_file') {
          r.style.display = r.classList.contains('row-no-file') ? '' : 'none';
        }
      });
    }

    // ==========================================
    // STEP 4: CHUNKED UPLOAD & TRANSACTION COMMIT
    // ==========================================
    async proceedToStep4Apply() {
      // Collect items to replace
      const itemsToUpload = [];
      const fileMap = new Map();
      this.uploadedFiles.forEach(f => fileMap.set(f.name, f));

      // 1. Items from automatic match
      this.matchResult.previewList.forEach(item => {
        item.files.forEach(f => {
          if (!this.excludedFiles.has(f.fileName)) {
            const fileObj = fileMap.get(f.fileName);
            if (fileObj) {
              itemsToUpload.push({
                designId: item.designId,
                sku: item.sku,
                title: item.title,
                file: fileObj,
                isPrimary: f.isPrimary,
                imageIndex: f.imageIndex
              });
            }
          }
        });
      });

      // 2. Items from manual overrides
      for (const [fileName, designId] of this.manualOverrides.entries()) {
        const fileObj = fileMap.get(fileName);
        const design = this.scopeDesigns.find(d => d.id === designId);
        if (fileObj && design) {
          itemsToUpload.push({
            designId,
            sku: design.sku,
            title: design.title,
            file: fileObj,
            isPrimary: true,
            imageIndex: 1
          });
        }
      }

      if (itemsToUpload.length === 0) {
        alert('No files are selected for replacement.');
        return;
      }

      if (!confirm(`Are you ready to replace images for ${itemsToUpload.length} design files? A 7-day rollback backup will be created automatically.`)) {
        return;
      }

      this.currentStep = 4;
      this.updateStepView();

      document.getElementById('uploadProgressSection').style.display = 'block';
      document.getElementById('uploadReportSection').style.display = 'none';

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

      try {
        // Parallel worker pool: 3 simultaneous requests
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
              // Pair processed file with design item
              data.files.forEach((pfile, idx) => {
                const originalItem = chunkItems[idx];
                uploadedProcessedItems.push({
                  designId: originalItem.designId,
                  sku: originalItem.sku,
                  title: originalItem.title,
                  originalName: pfile.originalName,
                  publicUrl: pfile.publicUrl,
                  thumbUrl: pfile.thumbUrl,
                  fileSize: pfile.fileSize,
                  checksum: pfile.checksum,
                  isPrimary: originalItem.isPrimary,
                  imageIndex: originalItem.imageIndex
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

        // All chunks uploaded! Now commit in DB inside transactions
        if (progressStatus) progressStatus.textContent = 'Saving images to database & applying watermarks in transactions...';
        if (progressBar) progressBar.style.width = '90%';
        if (progressPercent) progressPercent.textContent = '90%';

        const mode = document.querySelector('input[name="bulkReplaceMode"]:checked')?.value || 'replace_primary';
        const catSelect = document.getElementById('bulkReplaceCategorySelect');
        const catName = (catSelect && catSelect.selectedOptions[0]) ? catSelect.selectedOptions[0].textContent : 'Catalog';

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
            scopeSummary: `Replaced ${uploadedProcessedItems.length} designs in ${catName}`,
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

        // Display Final Report
        document.getElementById('uploadProgressSection').style.display = 'none';
        document.getElementById('uploadReportSection').style.display = 'block';

        document.getElementById('reportCountReplaced').textContent = commitData.replacedCount;
        document.getElementById('reportCountSkipped').textContent = commitData.skippedCount || 0;
        document.getElementById('reportCountFailed').textContent = commitData.failedCount || 0;

        const csvBtn = document.getElementById('bulkReplaceDownloadCsvBtn');
        if (csvBtn) {
          csvBtn.href = `/admin/designs/bulk-replace/export-csv/${commitData.logId}`;
        }

        const undoBtn = document.getElementById('bulkReplaceUndoBtn');
        if (undoBtn) {
          undoBtn.style.display = 'inline-flex';
          undoBtn.onclick = () => this.undoCurrentReplace(commitData.logId);
        }
      } catch (err) {
        this.isUploading = false;
        alert('Upload Error: ' + err.message);
        if (progressStatus) progressStatus.textContent = 'Error: ' + err.message;
      }
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
      if (!confirm(`Are you sure you want to undo this bulk image replace (Batch #${logId})? This will restore all affected products to their previous images.`)) {
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

  // Instantiate and expose globally
  document.addEventListener('DOMContentLoaded', () => {
    window.bulkImageReplaceInstance = new BulkImageReplace();
  });

  window.openBulkReplaceImagesModal = function () {
    if (window.bulkImageReplaceInstance) {
      window.bulkImageReplaceInstance.openModal();
    }
  };

  window.closeBulkReplaceImagesModal = function () {
    if (window.bulkImageReplaceInstance) {
      window.bulkImageReplaceInstance.closeModal();
    }
  };
})();
