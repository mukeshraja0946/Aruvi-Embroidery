/**
 * Aruvi Embroidery — Unified Enterprise Chunked Upload Engine
 * 
 * Reusable upload engine for:
 * 1. Bulk Restore / Re-upload Images
 * 2. Bulk Replace Files by Category
 * 3. Bulk Import Asset Step
 * 
 * Architectural Highlights:
 * - 1 MB chunk slicing (file.slice) via application/octet-stream (bypasses WAF/ModSecurity multipart blocks)
 * - Maximum 2 parallel streams to eliminate Hostinger thread pool saturation
 * - Resumable with exponential backoff (1s, 3s, 8s)
 * - Auto-pauses on 5 consecutive same-code failures with Resume/Cancel controls
 * - Admin session keep-alive ping every 4 minutes (prevents session drop)
 * - Preflight health check before upload commences
 * - Never truncates errors: tap/click to expand full HTTP status, stage, reference ID & suggested action
 * - "Copy error details" & "Download error report (CSV)"
 * - Optional client-side image compression for preview images > 2 MB (never touches ZIPs)
 */

(function (window) {
  'use strict';

  const CHUNK_SIZE = 1024 * 1024; // 1 MB per chunk
  const MAX_CONCURRENCY = 2; // Up to 2 parallel streams
  const RETRY_DELAYS = [1000, 3000, 8000]; // 1s, 3s, 8s backoff
  const CONSECUTIVE_FAIL_LIMIT = 5; // Auto-pause threshold
  const KEEP_ALIVE_INTERVAL = 4 * 60 * 1000; // 4 minutes

  class ChunkUploader {
    constructor(options = {}) {
      this.options = Object.assign({
        uploadType: 'bulk-restore', // 'bulk-restore' | 'bulk-replace' | 'import-asset' | 'zip'
        initEndpoint: '/admin/api/upload/init',
        chunkEndpoint: '/admin/api/upload/chunk',
        completeEndpoint: '/admin/api/upload/complete',
        healthEndpoint: '/admin/api/upload/test-health',
        keepAliveEndpoint: '/admin/api/keep-alive',
        csrfEndpoint: '/admin/api/csrf-token',
        onProgress: null,
        onItemStatusChange: null,
        onPaused: null,
        onResumed: null,
        onFinished: null,
        onError: null
      }, options);

      this.items = [];
      this.isUploading = false;
      this.isPaused = false;
      this.isCancelled = false;
      this.activeWorkers = 0;
      this.queue = [];
      this.currentJobPromise = null;
      this.keepAliveTimer = null;
      this.consecutiveFailures = { count: 0, code: null, reason: '' };
      this.csrfToken = this.getCsrfToken();
      this.activeAbortControllers = new Set();
    }

    getCsrfToken() {
      if (window.CSRF_TOKEN) return window.CSRF_TOKEN;
      const meta = document.querySelector('meta[name="csrf-token"]');
      if (meta && meta.getAttribute('content')) return meta.getAttribute('content');
      const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
      if (match) return decodeURIComponent(match[1]);
      return '';
    }

    async refreshCsrfToken() {
      try {
        const res = await fetch(this.options.csrfEndpoint, {
          headers: { 'Accept': 'application/json' }
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.csrfToken) {
            this.csrfToken = data.csrfToken;
            window.CSRF_TOKEN = data.csrfToken;
            const meta = document.querySelector('meta[name="csrf-token"]');
            if (meta) meta.setAttribute('content', data.csrfToken);
            return data;
          }
        }
      } catch (e) {
        console.warn('[ChunkUploader] CSRF refresh notice:', e.message);
      }
      return { csrfToken: this.csrfToken, isAuthenticated: true };
    }

    startKeepAlive() {
      this.stopKeepAlive();
      this.keepAliveTimer = setInterval(async () => {
        try {
          const res = await fetch(this.options.keepAliveEndpoint, {
            headers: { 'Accept': 'application/json' }
          });
          if (res.status === 401) {
            this.handleSessionExpired();
          }
        } catch (_) {}
      }, KEEP_ALIVE_INTERVAL);
    }

    stopKeepAlive() {
      if (this.keepAliveTimer) {
        clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = null;
      }
    }

    /**
     * Preflight Health Check: Runs route, CSRF, session, and storage permissions probe
     */
    async testHealth() {
      try {
        const token = this.csrfToken || this.getCsrfToken();
        const res = await fetch(this.options.healthEndpoint, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-CSRF-Token': token
          },
          body: JSON.stringify({ _csrf: token })
        });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok && data.success, data, status: res.status };
      } catch (err) {
        return { ok: false, error: err.message, status: 0 };
      }
    }

    /**
     * Compress preview images client-side before chunking (PNG/JPG > 2MB)
     */
    async compressImageIfNeeded(file, enabled = true) {
      if (!enabled) return { file, originalSize: file.size, finalSize: file.size, wasCompressed: false };

      const isZip = /\.(zip|rar|dst|pes|jef|exp|xxx|vp3|hus|sew)$/i.test(file.name || '');
      if (isZip) {
        return { file, originalSize: file.size, finalSize: file.size, wasCompressed: false };
      }

      const isImg = (file.type && file.type.startsWith('image/')) || /\.(png|jpe?g|webp|avif)$/i.test(file.name || '');
      if (!isImg || file.size < 2 * 1024 * 1024) {
        return { file, originalSize: file.size, finalSize: file.size, wasCompressed: false };
      }

      return new Promise((resolve) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(objectUrl);
          let w = img.width;
          let h = img.height;
          const maxDim = 2000;

          if (w <= maxDim && h <= maxDim && file.size < 2.5 * 1024 * 1024) {
            return resolve({ file, originalSize: file.size, finalSize: file.size, wasCompressed: false });
          }

          if (w > h) {
            if (w > maxDim) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            }
          } else {
            if (h > maxDim) {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, w, h);

          const outputFormat = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
          canvas.toBlob((blob) => {
            if (blob && blob.size < file.size) {
              const compressedFile = new File([blob], file.name, { type: outputFormat, lastModified: Date.now() });
              resolve({
                file: compressedFile,
                originalSize: file.size,
                finalSize: compressedFile.size,
                wasCompressed: true
              });
            } else {
              resolve({ file, originalSize: file.size, finalSize: file.size, wasCompressed: false });
            }
          }, outputFormat, 0.85);
        };
        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          resolve({ file, originalSize: file.size, finalSize: file.size, wasCompressed: false });
        };
        img.src = objectUrl;
      });
    }

    /**
     * Initializes file items list
     */
    setFiles(fileList, shouldOptimize = true) {
      this.items = Array.from(fileList).map((file, idx) => ({
        id: idx + 1,
        rawFile: file,
        file: file,
        name: file.name,
        size: file.size,
        formattedSize: this.formatBytes(file.size),
        status: 'pending', // 'pending' | 'optimizing' | 'uploading' | 'assembling' | 'linked' | 'ambiguous' | 'unmatched' | 'failed'
        progressPercent: 0,
        uploadedChunks: 0,
        totalChunks: Math.max(1, Math.ceil(file.size / CHUNK_SIZE)),
        details: 'Pending',
        stage: 'init',
        referenceId: null,
        errorObj: null,
        matchedDesign: null,
        shouldOptimize: shouldOptimize
      }));
      return this.items;
    }

    /**
     * Start Chunked Upload Process
     */
    async start() {
      if (this.isUploading && !this.isPaused) return;

      this.isUploading = true;
      this.isPaused = false;
      this.isCancelled = false;
      this.startKeepAlive();

      // 1. Run Preflight Health Check
      const health = await this.testHealth();
      if (!health.ok) {
        this.isUploading = false;
        this.stopKeepAlive();
        const msg = health.data?.checks?.storageWritable?.error || health.error || `Server health check failed (HTTP ${health.status})`;
        const stage = 'Health Check Stage';
        const action = 'Ensure server storage directory is writable and session is active.';
        
        this.items.forEach(it => {
          it.status = 'failed';
          it.details = `[${stage}] ${msg}`;
          it.stage = stage;
          it.errorObj = { status: health.status, message: msg, stage, suggestedAction: action };
          this.notifyItemChange(it);
        });

        if (this.options.onError) {
          this.options.onError(new Error(msg), { stage, suggestedAction: action });
        }
        return;
      }

      // Populate Queue with pending/failed items
      this.queue = this.items.filter(it => it.status === 'pending' || it.status === 'failed');

      // Launch worker pool (up to MAX_CONCURRENCY parallel workers)
      const workerCount = Math.min(MAX_CONCURRENCY, this.queue.length);
      const workerPromises = [];
      for (let i = 0; i < workerCount; i++) {
        workerPromises.push(this.runFileWorker());
      }

      await Promise.all(workerPromises);
      this.finishUpload();
    }

    async runFileWorker() {
      while (this.queue.length > 0 && !this.isCancelled) {
        if (this.isPaused) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }

        const item = this.queue.shift();
        if (!item) break;

        this.activeWorkers++;
        await this.uploadSingleFile(item);
        this.activeWorkers--;
      }
    }

    async uploadSingleFile(item) {
      if (this.isCancelled) return;

      const controller = new AbortController();
      this.activeAbortControllers.add(controller);

      try {
        // Step A: Client-side compression if image > 2MB
        if (item.shouldOptimize) {
          item.status = 'optimizing';
          item.details = 'Optimizing in browser...';
          this.notifyItemChange(item);
          const compResult = await this.compressImageIfNeeded(item.rawFile, true);
          item.file = compResult.file;
          item.size = compResult.finalSize;
          item.totalChunks = Math.max(1, Math.ceil(item.size / CHUNK_SIZE));
          if (compResult.wasCompressed) {
            item.formattedSize = `${this.formatBytes(compResult.originalSize)} → ${this.formatBytes(compResult.finalSize)}`;
          }
        }

        // Step B: Initialize Upload Session on Server
        item.status = 'uploading';
        item.stage = 'init';
        item.details = 'Initializing session...';
        this.notifyItemChange(item);

        let initData = await this.requestInit(item, controller.signal);
        item.uploadId = initData.uploadId;
        item.referenceId = initData.referenceId;

        // Step C: Upload Chunks (1 MB each via application/octet-stream)
        item.stage = 'chunk';
        const totalChunks = item.totalChunks;

        for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
          if (this.isCancelled) break;
          while (this.isPaused && !this.isCancelled) {
            await new Promise(r => setTimeout(r, 500));
          }

          const start = chunkIdx * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, item.size);
          const chunkBlob = item.file.slice(start, end);

          item.details = `Uploading chunk ${chunkIdx + 1} of ${totalChunks}...`;
          item.progressPercent = Math.round(((chunkIdx) / totalChunks) * 85);
          this.notifyItemChange(item);

          await this.uploadChunkWithRetry(item, chunkIdx, totalChunks, chunkBlob, controller.signal);
          item.uploadedChunks = chunkIdx + 1;
        }

        if (this.isCancelled) return;

        // Step D: Complete Upload & Assemble File
        item.stage = 'complete';
        item.status = 'assembling';
        item.details = 'Assembling & matching design...';
        item.progressPercent = 90;
        this.notifyItemChange(item);

        const completeResult = await this.requestComplete(item, controller.signal);
        item.completeResult = completeResult;
        if (completeResult.file) item.processedFile = completeResult.file;

        // Map status result
        if (completeResult.status === 'linked') {
          item.status = 'linked';
          item.details = `Linked to #${completeResult.designId} (${completeResult.sku || completeResult.title})`;
          item.matchedDesign = completeResult;
          this.recordSuccess();
        } else if (completeResult.status === 'ambiguous') {
          item.status = 'ambiguous';
          item.tempToken = completeResult.tempToken;
          item.candidates = completeResult.candidates || [];
          item.details = 'Multiple candidate designs matched';
          this.recordSuccess();
        } else if (completeResult.status === 'unmatched') {
          item.status = 'unmatched';
          item.tempToken = completeResult.tempToken;
          item.suggestions = completeResult.suggestions || [];
          item.details = completeResult.reason || 'No matching product found';
          this.recordSuccess();
        } else if (completeResult.status === 'failed') {
          item.status = 'failed';
          item.stage = completeResult.stage || 'complete';
          item.details = `[${item.stage}] ${completeResult.error || 'Processing error'}`;
          item.referenceId = completeResult.referenceId;
          item.errorObj = {
            status: completeResult.code || 'FAIL',
            message: completeResult.error,
            stage: item.stage,
            suggestedAction: completeResult.suggestedAction || 'Check file format and database.'
          };
          this.recordFailure(completeResult.code || 500, completeResult.error);
        } else {
          item.status = 'linked';
          item.details = 'Uploaded successfully';
          this.recordSuccess();
        }

        item.progressPercent = 100;
        this.notifyItemChange(item);

      } catch (err) {
        if (this.isCancelled) {
          item.status = 'failed';
          item.details = 'Cancelled by user';
          item.errorObj = { status: 'CANCELLED', message: 'Upload cancelled by user', stage: 'User Action', suggestedAction: 'Re-upload if desired.' };
        } else {
          const status = err.status || (err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
          const stage = err.stage || item.stage || 'Upload Stage';
          const action = err.suggestedAction || 'Check internet connection and server status.';
          item.status = 'failed';
          item.stage = stage;
          item.details = `[${stage}] HTTP ${status}: ${err.message}`;
          item.referenceId = err.referenceId || item.referenceId;
          item.errorObj = {
            status,
            message: err.message,
            stage,
            referenceId: item.referenceId,
            suggestedAction: action,
            filename: item.name
          };
          this.recordFailure(status, err.message);
        }
        this.notifyItemChange(item);
      } finally {
        this.activeAbortControllers.delete(controller);
      }
    }

    /**
     * Sends Session Init Request
     */
    async requestInit(item, signal) {
      const token = this.csrfToken || this.getCsrfToken();
      const res = await fetch(this.options.initEndpoint, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-CSRF-Token': token
        },
        body: JSON.stringify({
          _csrf: token,
          filename: item.name,
          fileSize: item.size,
          totalChunks: item.totalChunks,
          uploadType: this.options.uploadType,
          batchId: this.options.batchId
        }),
        signal
      });

      if (res.status === 401) {
        this.handleSessionExpired();
        const err = new Error('Admin session expired.');
        err.status = 401;
        err.stage = 'Authentication Stage';
        err.suggestedAction = 'Log into Admin in another tab, then click Resume.';
        throw err;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const err = new Error(errData.message || `Init rejected with HTTP ${res.status}`);
        err.status = res.status;
        err.stage = 'Init Stage';
        err.referenceId = errData.referenceId;
        err.suggestedAction = errData.suggestedAction;
        throw err;
      }

      return await res.json();
    }

    /**
     * Uploads individual chunk with 3 exponential backoff retries (1s, 3s, 8s)
     */
    async uploadChunkWithRetry(item, chunkIdx, totalChunks, chunkBlob, signal) {
      let attempt = 0;
      while (attempt <= 3) {
        try {
          let token = this.csrfToken || this.getCsrfToken();
          const res = await fetch(this.options.chunkEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'Accept': 'application/json',
              'X-Upload-Id': item.uploadId,
              'X-Chunk-Index': String(chunkIdx),
              'X-Total-Chunks': String(totalChunks),
              'X-File-Name': encodeURIComponent(item.name),
              'X-File-Size': String(item.size),
              'X-CSRF-Token': token
            },
            body: chunkBlob,
            signal
          });

          // Handle 401 Session Expiry
          if (res.status === 401) {
            this.handleSessionExpired();
            const err = new Error('Admin session expired during chunk upload.');
            err.status = 401;
            err.stage = 'Authentication Stage';
            err.suggestedAction = 'Log into Admin in another tab, then click Resume.';
            throw err;
          }

          // Handle 403 CSRF Expiry: refresh token once and retry chunk
          if (res.status === 403 && attempt === 0) {
            console.warn(`[ChunkUploader] Chunk ${chunkIdx} got 403. Refreshing token...`);
            await this.refreshCsrfToken();
            attempt++;
            continue;
          }

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            const err = new Error(errData.message || `Chunk ${chunkIdx} rejected (HTTP ${res.status})`);
            err.status = res.status;
            err.stage = 'Chunk Upload Stage';
            err.referenceId = errData.referenceId;
            err.suggestedAction = errData.suggestedAction;
            throw err;
          }

          return await res.json();

        } catch (err) {
          if (err.name === 'AbortError' || this.isCancelled || err.status === 401) {
            throw err;
          }

          attempt++;
          if (attempt > 3) {
            err.stage = 'Chunk Upload Stage';
            err.message = `Chunk ${chunkIdx + 1}/${totalChunks} failed after 3 retries: ${err.message}`;
            throw err;
          }

          const delay = RETRY_DELAYS[attempt - 1] || 3000;
          item.details = `Chunk ${chunkIdx + 1} retry ${attempt}/3 in ${Math.round(delay / 1000)}s (${err.message})...`;
          this.notifyItemChange(item);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    /**
     * Sends Complete Request to Assemble File
     */
    async requestComplete(item, signal) {
      const token = this.csrfToken || this.getCsrfToken();
      const res = await fetch(this.options.completeEndpoint, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-CSRF-Token': token
        },
        body: JSON.stringify({
          _csrf: token,
          uploadId: item.uploadId,
          originalName: item.name,
          totalChunks: item.totalChunks,
          uploadType: this.options.uploadType,
          batchId: this.options.batchId,
          confirmed_mappings: window.bulkUploadState?.confirmedMappings || {}
        }),
        signal
      });

      if (res.status === 401) {
        this.handleSessionExpired();
        const err = new Error('Admin session expired.');
        err.status = 401;
        err.stage = 'Authentication Stage';
        err.suggestedAction = 'Log into Admin in another tab, then click Resume.';
        throw err;
      }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const err = new Error(data.message || `Assembly failed (HTTP ${res.status})`);
        err.status = res.status;
        err.stage = data.stage || 'Assembly & Matching Stage';
        err.referenceId = data.referenceId;
        err.suggestedAction = data.suggestedAction;
        throw err;
      }

      return data;
    }

    /**
     * Tracks consecutive failures and triggers auto-pause
     */
    recordFailure(statusCode, reason) {
      if (this.consecutiveFailures.code === statusCode) {
        this.consecutiveFailures.count++;
      } else {
        this.consecutiveFailures = { count: 1, code: statusCode, reason };
      }

      if (this.consecutiveFailures.count >= CONSECUTIVE_FAIL_LIMIT && !this.isPaused) {
        const pauseReason = `5 consecutive files failed with HTTP ${statusCode} (${reason || 'Server error'}). Upload paused to prevent wasting requests.`;
        this.pause(pauseReason);
      }
    }

    recordSuccess() {
      this.consecutiveFailures = { count: 0, code: null, reason: '' };
    }

    handleSessionExpired() {
      this.pause('Admin session expired. Please log in again in another tab and click Resume.');
    }

    pause(reason = 'Upload paused.') {
      this.isPaused = true;
      if (this.options.onPaused) {
        this.options.onPaused(reason);
      }
    }

    resume() {
      this.isPaused = false;
      this.consecutiveFailures = { count: 0, code: null, reason: '' };
      if (this.options.onResumed) {
        this.options.onResumed();
      }
      this.start();
    }

    abort() {
      this.isCancelled = true;
      this.isUploading = false;
      this.isPaused = false;
      this.stopKeepAlive();

      this.activeAbortControllers.forEach(ctrl => {
        try { ctrl.abort(); } catch (_) {}
      });
      this.activeAbortControllers.clear();
      this.queue = [];

      this.items.forEach(it => {
        if (it.status === 'uploading' || it.status === 'pending' || it.status === 'assembling') {
          it.status = 'failed';
          it.details = 'Cancelled by user';
          it.errorObj = { status: 'CANCELLED', message: 'Cancelled by user', stage: 'User Action', suggestedAction: 'Re-upload if desired.' };
          this.notifyItemChange(it);
        }
      });

      this.finishUpload();
    }

    retryFailedFiles() {
      const failedItems = this.items.filter(it => it.status === 'failed');
      if (failedItems.length === 0) return;

      failedItems.forEach(it => {
        it.status = 'pending';
        it.details = 'Queued for retry...';
        it.progressPercent = 0;
        it.uploadedChunks = 0;
        it.errorObj = null;
        this.notifyItemChange(it);
      });

      this.consecutiveFailures = { count: 0, code: null, reason: '' };
      this.start();
    }

    finishUpload() {
      this.isUploading = false;
      this.stopKeepAlive();
      if (this.options.onFinished) {
        this.options.onFinished({
          total: this.items.length,
          linked: this.items.filter(it => it.status === 'linked').length,
          ambiguous: this.items.filter(it => it.status === 'ambiguous').length,
          unmatched: this.items.filter(it => it.status === 'unmatched').length,
          failed: this.items.filter(it => it.status === 'failed').length
        });
      }
    }

    notifyItemChange(item) {
      if (this.options.onItemStatusChange) {
        this.options.onItemStatusChange(item);
      }
      if (this.options.onProgress) {
        const processed = this.items.filter(it => ['linked', 'ambiguous', 'unmatched', 'failed'].includes(it.status)).length;
        this.options.onProgress({
          processed,
          total: this.items.length,
          percent: this.items.length ? Math.round((processed / this.items.length) * 100) : 0
        });
      }
    }

    /**
     * Generates CSV error report blob
     */
    generateErrorReportCsv() {
      const rows = [
        ['Filename', 'Size (Bytes)', 'Formatted Size', 'Status', 'HTTP Code', 'Stage', 'Reference ID', 'Error Message', 'Suggested Action']
      ];

      this.items.forEach(it => {
        const errObj = it.errorObj || {};
        rows.push([
          `"${(it.name || '').replace(/"/g, '""')}"`,
          it.size || 0,
          `"${it.formattedSize || ''}"`,
          `"${it.status || ''}"`,
          `"${errObj.status || ''}"`,
          `"${it.stage || errObj.stage || ''}"`,
          `"${it.referenceId || errObj.referenceId || ''}"`,
          `"${(errObj.message || it.details || '').replace(/"/g, '""')}"`,
          `"${(errObj.suggestedAction || '').replace(/"/g, '""')}"`
        ]);
      });

      return rows.map(r => r.join(',')).join('\r\n');
    }

    downloadErrorReportCsv(filename = `upload_report_${Date.now()}.csv`) {
      const csv = this.generateErrorReportCsv();
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    /**
     * Copies formatted error report details to clipboard
     */
    async copyErrorDetails() {
      const failed = this.items.filter(it => it.status === 'failed');
      if (failed.length === 0) return 'No failed files.';

      const text = failed.map((it, idx) => {
        const err = it.errorObj || {};
        return `[${idx + 1}] File: ${it.name} (${it.formattedSize})\n` +
               `    Status: HTTP ${err.status || 'FAIL'}\n` +
               `    Stage: ${it.stage || err.stage || 'N/A'}\n` +
               `    Ref ID: ${it.referenceId || err.referenceId || 'N/A'}\n` +
               `    Error: ${err.message || it.details}\n` +
               `    Suggested Action: ${err.suggestedAction || 'Check file and re-upload'}`;
      }).join('\n\n');

      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
        return false;
      }
    }

    formatBytes(bytes) {
      if (!bytes || bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return (bytes / Math.pow(k, i)).toFixed(i >= 2 ? 1 : 0) + ' ' + sizes[i];
    }
  }

  window.ChunkUploader = ChunkUploader;
})(window);
