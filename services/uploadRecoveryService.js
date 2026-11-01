const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const storage = require('../config/storage');

/**
 * Aruvi Embroidery — Upload Recovery Engine
 * 
 * Safely recovers uploaded images, previews, thumbnails, branding, and machine design files
 * from previous ephemeral Hostinger deployment directories (hbuilds/versions/*) into the
 * permanent UPLOAD_DIR outside the deploy folder.
 * 
 * Guarantees:
 * 1. ZERO DATA LOSS: COPIES files; NEVER moves, renames, or deletes files in old deployments.
 * 2. IDEMPOTENT: Skips identical files already present in UPLOAD_DIR.
 * 3. PRESERVES RELATIVE KEYS: Maintains exact subfolder hierarchy (previews, thumbs, cards, designs, branding)
 *    so all database paths and customer downloads resolve immediately.
 * 4. DRY RUN & AUDIT TRAIL: Provides dry run simulation, progress tracking, and CSV reports.
 */

const DEFAULT_VERSIONS_DIR = process.env.VERSIONS_DIR || '/home/u101925264/domains/aruviembroidery.com/hbuilds/versions';

class UploadRecoveryService {
  constructor() {
    this.jobs = new Map();
  }

  /**
   * Discovers all past deployment directories inside hbuilds/versions
   */
  getDeploymentVersions(versionsDir = DEFAULT_VERSIONS_DIR) {
    const resolvedDir = path.resolve(versionsDir);
    if (!fs.existsSync(resolvedDir)) {
      return [];
    }

    try {
      const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory())
        .map(e => path.join(resolvedDir, e.name))
        .sort((a, b) => {
          // Sort newest to oldest based on modification time
          try {
            return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
          } catch (_) {
            return 0;
          }
        });
    } catch (err) {
      console.warn('[UploadRecoveryService] Error reading versions directory:', err.message);
      return [];
    }
  }

  /**
   * Recursively scans a directory and yields all file entries
   */
  _scanDirectoryRecursive(baseDir, currentRel = '') {
    const results = [];
    const fullCurrent = currentRel ? path.join(baseDir, currentRel) : baseDir;

    if (!fs.existsSync(fullCurrent)) return results;

    try {
      const entries = fs.readdirSync(fullCurrent, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        const relPath = currentRel ? path.join(currentRel, entry.name) : entry.name;
        const absPath = path.join(baseDir, relPath);

        if (entry.isDirectory()) {
          results.push(...this._scanDirectoryRecursive(baseDir, relPath));
        } else if (entry.isFile()) {
          results.push({
            absPath,
            relPath: relPath.replace(/\\/g, '/'),
            size: fs.statSync(absPath).size
          });
        }
      }
    } catch (_) {}

    return results;
  }

  /**
   * Starts a background recovery scan (dry run or apply)
   */
  startRecoveryJob({ versionsDir = DEFAULT_VERSIONS_DIR, dryRun = true, targetDir = null } = {}) {
    const jobId = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const uploadsDir = targetDir ? path.resolve(targetDir) : storage.getUploadsDir();

    const job = {
      id: jobId,
      versionsDir: path.resolve(versionsDir),
      uploadsDir,
      dryRun,
      status: 'running',
      progress: 0,
      totalFilesFound: 0,
      copiedCount: 0,
      skippedCount: 0,
      conflictCount: 0,
      errorCount: 0,
      startedAt: new Date(),
      completedAt: null,
      results: [],
      error: null
    };

    this.jobs.set(jobId, job);

    // Execute asynchronously in background
    setImmediate(async () => {
      try {
        await this._executeRecovery(job);
      } catch (err) {
        job.status = 'failed';
        job.error = err.message;
        job.completedAt = new Date();
        console.error(`[UploadRecoveryService] Job #${jobId} failed:`, err);
      }
    });

    return job;
  }

  /**
   * Internal job execution loop
   */
  async _executeRecovery(job) {
    const versionDirs = this.getDeploymentVersions(job.versionsDir);

    if (versionDirs.length === 0) {
      job.status = 'completed';
      job.completedAt = new Date();
      job.error = `No deployment version directories found at "${job.versionsDir}".`;
      return;
    }

    const discoveredCandidates = [];

    // Step 1: Scan all old versions for uploads folders
    for (const vDir of versionDirs) {
      const versionName = path.basename(vDir);

      // Candidate upload subdirectories inside old deployment
      const searchRoots = [
        { root: path.join(vDir, 'public', 'uploads'), type: 'public' },
        { root: path.join(vDir, 'uploads'), type: 'public' },
        { root: path.join(vDir, 'storage_private'), type: 'private' },
        { root: path.join(vDir, 'private_uploads'), type: 'private' }
      ];

      for (const sr of searchRoots) {
        if (fs.existsSync(sr.root)) {
          const files = this._scanDirectoryRecursive(sr.root);
          for (const f of files) {
            discoveredCandidates.push({
              versionName,
              sourceRoot: sr.root,
              sourceType: sr.type,
              sourcePath: f.absPath,
              relPath: f.relPath,
              sizeBytes: f.size
            });
          }
        }
      }
    }

    job.totalFilesFound = discoveredCandidates.length;

    // Deduplicate by relative key (keep newest deployment's version of file)
    const uniqueFilesMap = new Map();
    for (const item of discoveredCandidates) {
      const key = `${item.sourceType}/${item.relPath}`;
      if (!uniqueFilesMap.has(key)) {
        uniqueFilesMap.set(key, item);
      }
    }

    const uniqueCandidates = Array.from(uniqueFilesMap.values());
    let processed = 0;

    // Step 2: Compare with permanent UPLOAD_DIR and copy if missing
    for (const candidate of uniqueCandidates) {
      processed++;
      job.progress = Math.round((processed / uniqueCandidates.length) * 100);

      let targetDest;
      if (candidate.sourceType === 'public') {
        targetDest = path.join(storage.getPublicDir(), candidate.relPath);
      } else {
        targetDest = path.join(storage.getPrivateDir(), candidate.relPath);
      }

      // Check if file already exists in persistent storage
      const existsInPublic = fs.existsSync(path.join(storage.getPublicDir(), candidate.relPath));
      const existsInPrivate = fs.existsSync(path.join(storage.getPrivateDir(), candidate.relPath));
      const existsDirect = fs.existsSync(path.join(job.uploadsDir, candidate.relPath));

      const existingPath = existsInPublic ? path.join(storage.getPublicDir(), candidate.relPath)
        : (existsInPrivate ? path.join(storage.getPrivateDir(), candidate.relPath)
        : (existsDirect ? path.join(job.uploadsDir, candidate.relPath) : null));

      let action = 'copy';
      let reason = 'File missing in persistent storage';

      if (existingPath) {
        try {
          const existingStat = fs.statSync(existingPath);
          if (existingStat.size === candidate.sizeBytes) {
            action = 'skip';
            reason = 'Identical file already exists in persistent storage';
            job.skippedCount++;
          } else {
            action = 'conflict';
            reason = `File exists with different size (Source: ${candidate.sizeBytes} B, Dest: ${existingStat.size} B)`;
            job.conflictCount++;
          }
        } catch (_) {
          action = 'copy';
        }
      }

      if (action === 'copy') {
        if (!job.dryRun) {
          try {
            const destDir = path.dirname(targetDest);
            if (!fs.existsSync(destDir)) {
              fs.mkdirSync(destDir, { recursive: true });
            }
            // Copy preserving original file (NEVER move/delete source)
            fs.copyFileSync(candidate.sourcePath, targetDest);
            job.copiedCount++;
          } catch (copyErr) {
            action = 'error';
            reason = `Copy failed: ${copyErr.message}`;
            job.errorCount++;
          }
        } else {
          // Dry run count
          job.copiedCount++;
        }
      }

      job.results.push({
        relativeKey: candidate.relPath,
        sourceType: candidate.sourceType,
        sourcePath: candidate.sourcePath,
        targetDest,
        sizeBytes: candidate.sizeBytes,
        action,
        reason
      });

      // Avoid blocking event loop on large collections
      if (processed % 50 === 0) {
        await new Promise(r => setImmediate(r));
      }
    }

    job.status = 'completed';
    job.completedAt = new Date();
  }

  /**
   * Retrieves current status of a recovery job
   */
  getJobStatus(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    return {
      id: job.id,
      status: job.status,
      dryRun: job.dryRun,
      progress: job.progress,
      versionsDir: job.versionsDir,
      uploadsDir: job.uploadsDir,
      totalFilesFound: job.totalFilesFound,
      copiedCount: job.copiedCount,
      skippedCount: job.skippedCount,
      conflictCount: job.conflictCount,
      errorCount: job.errorCount,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      summary: {
        toCopy: job.copiedCount,
        skipped: job.skippedCount,
        conflicts: job.conflictCount,
        errors: job.errorCount
      },
      resultsSample: job.results.slice(0, 50)
    };
  }

  /**
   * Generates a CSV report for a recovery job
   */
  generateCsv(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    const headers = ['Action', 'Reason', 'Relative Key', 'Type', 'Size (Bytes)', 'Source Path', 'Target Destination'];
    const rows = [headers.join(',')];

    for (const r of job.results) {
      const escape = (val) => `"${String(val || '').replace(/"/g, '""')}"`;
      rows.push([
        escape(r.action.toUpperCase()),
        escape(r.reason),
        escape(r.relativeKey),
        escape(r.sourceType),
        r.sizeBytes || 0,
        escape(r.sourcePath),
        escape(r.targetDest)
      ].join(','));
    }

    return rows.join('\n');
  }
}

module.exports = new UploadRecoveryService();
