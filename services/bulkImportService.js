const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const AdmZip = require('adm-zip');

const db = require('../config/db');
const storage = require('../config/storage');
const Design = require('../models/Design');
const Category = require('../models/Category');

class BulkImportService {
  /**
   * Generates a clean Excel template with 'Design Products' data sheet + 'Instructions' guide.
   */
  generateTemplateWorkbook() {
    const exampleRows = [
      {
        'Design Name': 'Rose Bridal Blouse Motif',
        'SKU': 'AED-BLO-01',
        'Category': 'Blouse Designs',
        'Original Price MRP': 120,
        'Selling Price': 49,
        'Available Formats': 'DST, PES, JEF, EXP',
        'Description': 'Intricate rose floral embroidery design file for bridal blouses with zari border.',
        'Tags': 'rose, blouse, bridal, zari',
        'Status': 'Active',
        'Preview Image Filename': 'AED-BLO-01.jpg',
        'Machine ZIP Filename': 'AED-BLO-01.zip'
      },
      {
        'Design Name': 'Peacock Temple Border',
        'SKU': 'AED-BOR-02',
        'Category': 'Border Designs',
        'Original Price MRP': 150,
        'Selling Price': 59,
        'Available Formats': 'DST, PES, JEF',
        'Description': 'Traditional peacock temple neck border embroidery file for sarees.',
        'Tags': 'peacock, temple, border, saree',
        'Status': 'Active',
        'Preview Image Filename': 'AED-BOR-02.jpg',
        'Machine ZIP Filename': 'AED-BOR-02.zip'
      }
    ];

    const instructionRows = [
      { 'Field Name': 'Design Name', 'Required': 'YES', 'Description': 'Name/Title of the embroidery design product.' },
      { 'Field Name': 'SKU', 'Required': 'NO (Auto-assigned if empty)', 'Description': 'Unique Design Code (e.g. AED-BLO-01). Used to match asset filenames.' },
      { 'Field Name': 'Category', 'Required': 'NO', 'Description': 'Name of category (e.g. Blouse Designs, Floral, Borders). Auto-created if new.' },
      { 'Field Name': 'Original Price MRP', 'Required': 'YES', 'Description': 'MRP / List price in INR (number, e.g. 120).' },
      { 'Field Name': 'Selling Price', 'Required': 'NO', 'Description': 'Discounted selling price (number, e.g. 49). Must be <= Original Price.' },
      { 'Field Name': 'Available Formats', 'Required': 'NO', 'Description': 'Embroidery formats included (default: DST, PES, JEF, EXP).' },
      { 'Field Name': 'Description', 'Required': 'NO', 'Description': 'Full description displayed on customer product page.' },
      { 'Field Name': 'Tags', 'Required': 'NO', 'Description': 'Comma-separated keywords for search.' },
      { 'Field Name': 'Status', 'Required': 'NO', 'Description': '"Active" or "Draft" (default: Active).' },
      { 'Field Name': 'Asset Naming Rule', 'Required': 'RECOMMENDED', 'Description': 'Name photos like AED-BLO-01.jpg and machine files like AED-BLO-01.zip. The system auto-matches them!' }
    ];

    const wb = XLSX.utils.book_new();
    const wsData = XLSX.utils.json_to_sheet(exampleRows);
    const wsInstructions = XLSX.utils.json_to_sheet(instructionRows);

    XLSX.utils.book_append_sheet(wb, wsData, 'Design Products');
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Helper to normalize keys for flexible alias matching
   */
  normalizeKey(key) {
    return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Step 1: Safely parse spreadsheet (.xlsx, .csv, .xls) and validate every row.
   * Creates an import_jobs draft record and rows in import_job_items.
   */
  async parseSpreadsheetFile(filePath, originalFilename, userId = null) {
    if (!db.isConnected()) await db.initPool();

    const ext = path.extname(originalFilename).toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
      throw new Error('Invalid file format. Please upload an Excel (.xlsx, .xls) or CSV (.csv) spreadsheet.');
    }

    const fileBuffer = fs.readFileSync(filePath);
    let workbook;
    try {
      workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
    } catch (parseErr) {
      throw new Error(`Failed to read spreadsheet: ${parseErr.message}. Ensure the file is not password-protected.`);
    }

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('The uploaded spreadsheet contains no sheets.');
    }

    // Pick first sheet
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '', blankrows: false });

    if (!rawRows || rawRows.length === 0) {
      throw new Error('Spreadsheet appears to be empty or contains no data rows.');
    }

    // Load existing SKUs and Categories from DB
    const existingSkuRows = await db.query('SELECT sku FROM designs WHERE sku IS NOT NULL');
    const existingDbSkus = new Set(existingSkuRows.map(r => this.normalizeKey(r.sku)));

    const batchId = crypto.randomBytes(16).toString('hex');
    const seenBatchSkus = new Set();

    let validCount = 0;
    let errorCount = 0;
    let duplicateCount = 0;

    const validatedItems = [];

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rowNum = i + 2; // Row number in spreadsheet (1 is header)

      // Alias getter
      const getVal = (aliases) => {
        for (const alias of aliases) {
          const normAlias = this.normalizeKey(alias);
          for (const rowKey of Object.keys(row)) {
            if (this.normalizeKey(rowKey) === normAlias) {
              const val = row[rowKey];
              return val !== undefined && val !== null ? String(val).trim() : '';
            }
          }
        }
        return '';
      };

      const title = getVal(['Design Name', 'Title', 'Product Name', 'Name', 'Design']);
      const sku = getVal(['SKU', 'Design Code / SKU', 'Design Code', 'Code']);
      const categoryName = getVal(['Category', 'Category Name', 'Cat']);
      const mrpRaw = getVal(['Original Price MRP', 'MRP / Original Price', 'MRP', 'Original Price', 'Price']);
      const sellingRaw = getVal(['Selling Price', 'Final Selling Price', 'Sale Price', 'Discounted Price']);
      const formats = getVal(['Available Formats', 'Formats', 'Format']) || 'DST, PES, JEF, EXP';
      const description = getVal(['Description', 'Desc']);
      const tags = getVal(['Tags', 'Tag', 'Keywords']);
      const statusRaw = getVal(['Status', 'Is Active']) || 'Active';
      const previewImgRaw = getVal(['Preview Image Filename', 'Preview Image', 'Image Filename', 'Image']);
      const machineZipRaw = getVal(['Machine ZIP Filename', 'Machine File', 'ZIP Filename', 'File']);

      // Skip completely empty rows
      if (!title && !sku && !mrpRaw && !categoryName) {
        continue;
      }

      const errors = [];
      let isDuplicate = false;

      // Validation 1: Title
      if (!title) {
        errors.push('Missing required "Design Name".');
      }

      // Validation 2: MRP / Price
      let mrp = parseFloat(mrpRaw);
      if (!mrpRaw || isNaN(mrp) || mrp < 0) {
        errors.push('Invalid "Original Price MRP" (must be a valid number >= 0).');
        mrp = 0;
      }

      // Validation 3: Selling Price
      let sellingPrice = null;
      if (sellingRaw !== '') {
        sellingPrice = parseFloat(sellingRaw);
        if (isNaN(sellingPrice) || sellingPrice < 0) {
          errors.push('"Selling Price" must be a valid number >= 0.');
          sellingPrice = null;
        } else if (sellingPrice > mrp) {
          errors.push(`"Selling Price" (₹${sellingPrice}) cannot exceed Original MRP (₹${mrp}).`);
        }
      }

      // Validation 4: SKU checks
      const normSku = this.normalizeKey(sku);
      if (normSku) {
        if (seenBatchSkus.has(normSku)) {
          errors.push(`Duplicate SKU "${sku}" repeated multiple times within this spreadsheet.`);
          isDuplicate = true;
        } else {
          seenBatchSkus.add(normSku);
        }

        if (existingDbSkus.has(normSku)) {
          isDuplicate = true;
        }
      }

      const status = statusRaw.toLowerCase().includes('draft') || statusRaw === '0' || statusRaw.toLowerCase() === 'inactive' ? 'Draft' : 'Active';

      let validationStatus = 'valid';
      if (errors.length > 0) {
        validationStatus = 'error';
        errorCount++;
      } else if (isDuplicate) {
        validationStatus = 'duplicate';
        duplicateCount++;
      } else {
        validCount++;
      }

      validatedItems.push({
        rowNumber: rowNum,
        sku: sku || null,
        title,
        categoryName: categoryName || 'Uncategorized',
        price: mrp,
        salePrice: sellingPrice,
        formats,
        description,
        tags,
        status,
        imageFilename: previewImgRaw || (sku ? `${sku}.jpg` : null),
        fileFilename: machineZipRaw || (sku ? `${sku}.zip` : null),
        validationStatus,
        validationError: errors.join(' ') || (isDuplicate ? `SKU "${sku}" already exists in store catalog.` : null)
      });
    }

    if (validatedItems.length === 0) {
      throw new Error('No valid design data found in the spreadsheet. Please verify columns match the template.');
    }

    // Create job in database
    const jobRes = await db.query(`
      INSERT INTO import_jobs 
        (batch_id, status, total_rows, valid_rows, error_rows, duplicate_rows, spreadsheet_filename, created_by)
      VALUES (?, 'draft', ?, ?, ?, ?, ?, ?)
    `, [
      batchId,
      validatedItems.length,
      validCount,
      errorCount,
      duplicateCount,
      path.basename(originalFilename),
      userId
    ]);
    const jobId = jobRes.insertId;

    // Insert items in batches of 200
    const insertBatchSize = 200;
    for (let b = 0; b < validatedItems.length; b += insertBatchSize) {
      const slice = validatedItems.slice(b, b + insertBatchSize);
      const valPlaceholders = slice.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const params = [];
      for (const it of slice) {
        params.push(
          jobId, it.rowNumber, it.sku, it.title, it.categoryName,
          it.price, it.salePrice, it.formats, it.description, it.tags,
          it.status, it.imageFilename, it.fileFilename,
          it.validationStatus, it.validationError
        );
      }
      await db.query(`
        INSERT INTO import_job_items 
          (job_id, row_number, sku, title, category_name, price, sale_price, formats, description, tags, status, image_filename, file_filename, validation_status, validation_error)
        VALUES ${valPlaceholders}
      `, params);
    }

    return {
      batchId,
      jobId,
      totalRows: validatedItems.length,
      validCount,
      errorCount,
      duplicateCount,
      previewRows: validatedItems.slice(0, 100)
    };
  }

  /**
   * Step 2: Upload assets in small batches (5-10 files), matching by SKU/filename to import_job_items.
   */
  async processAssetBatch(batchId, files) {
    if (!db.isConnected()) await db.initPool();

    const [job] = await db.query('SELECT * FROM import_jobs WHERE batch_id = ?', [batchId]);
    if (!job) {
      throw new Error('Import session not found or expired.');
    }

    const items = await db.query('SELECT id, sku, image_filename, file_filename FROM import_job_items WHERE job_id = ?', [job.id]);

    let matchedImages = 0;
    let matchedFiles = 0;
    const uploadedAssetResults = [];

    const allowedImg = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];
    const allowedMachine = ['.zip', '.dst', '.pes', '.jef', '.exp', '.rar'];

    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      const baseNameWithoutExt = path.basename(file.originalname, ext).trim();
      const normBase = this.normalizeKey(baseNameWithoutExt);

      let isImage = allowedImg.includes(ext);
      let isMachine = allowedMachine.includes(ext);

      if (!isImage && !isMachine) {
        uploadedAssetResults.push({ filename: file.originalname, status: 'unsupported_extension' });
        continue;
      }

      if (isImage) {
        // Save to persistent public preview storage
        const savedUrl = await storage.savePublicFile(file.path, file.originalname, file.mimetype);

        // Find matching item by SKU or image_filename
        let matchedItem = items.find(it => {
          if (it.image_filename && this.normalizeKey(path.basename(it.image_filename, path.extname(it.image_filename))) === normBase) return true;
          if (it.sku && this.normalizeKey(it.sku) === normBase) return true;
          return false;
        });

        if (matchedItem) {
          await db.query(
            'UPDATE import_job_items SET image_stored_url = ?, image_matched = 1, image_filename = ? WHERE id = ?',
            [savedUrl, file.originalname, matchedItem.id]
          );
          matchedItem.image_matched = 1;
          matchedImages++;
          uploadedAssetResults.push({ filename: file.originalname, status: 'matched', type: 'image', sku: matchedItem.sku });
        } else {
          uploadedAssetResults.push({ filename: file.originalname, status: 'unmatched', type: 'image' });
        }
      } else if (isMachine) {
        // Safe inspection against Zip Slip
        if (ext === '.zip') {
          try {
            const testZip = new AdmZip(file.path);
            const entries = testZip.getEntries();
            for (const entry of entries) {
              if (entry.entryName.includes('..') || entry.entryName.startsWith('/')) {
                throw new Error('Potential zip-slip path traversal detected in archive.');
              }
            }
          } catch (zipErr) {
            uploadedAssetResults.push({ filename: file.originalname, status: 'invalid_zip', error: zipErr.message });
            continue;
          }
        }

        // Save to private persistent design storage
        const savedPath = await storage.savePrivateFile(file.path, file.originalname, file.mimetype);

        let matchedItem = items.find(it => {
          if (it.file_filename && this.normalizeKey(path.basename(it.file_filename, path.extname(it.file_filename))) === normBase) return true;
          if (it.sku && this.normalizeKey(it.sku) === normBase) return true;
          return false;
        });

        if (matchedItem) {
          await db.query(
            'UPDATE import_job_items SET file_stored_path = ?, file_matched = 1, file_filename = ? WHERE id = ?',
            [savedPath, file.originalname, matchedItem.id]
          );
          matchedItem.file_matched = 1;
          matchedFiles++;
          uploadedAssetResults.push({ filename: file.originalname, status: 'matched', type: 'machine', sku: matchedItem.sku });
        } else {
          uploadedAssetResults.push({ filename: file.originalname, status: 'unmatched', type: 'machine' });
        }
      }
    }

    // Return updated match counts for this job
    const [matchCounts] = await db.query(`
      SELECT 
        COUNT(CASE WHEN image_matched = 1 THEN 1 END) AS total_matched_images,
        COUNT(CASE WHEN file_matched = 1 THEN 1 END) AS total_matched_files,
        COUNT(*) AS total_items
      FROM import_job_items 
      WHERE job_id = ?
    `, [job.id]);

    return {
      success: true,
      batchId,
      uploadedCount: files.length,
      matchedImages,
      matchedFiles,
      totalMatchedImages: matchCounts.total_matched_images,
      totalMatchedFiles: matchCounts.total_matched_files,
      totalItems: matchCounts.total_items,
      results: uploadedAssetResults
    };
  }

  /**
   * Step 3: Start background execution of the import.
   */
  async startImportJob(batchId, { updateExisting = false, skipErrors = true }) {
    if (!db.isConnected()) await db.initPool();

    const [job] = await db.query('SELECT * FROM import_jobs WHERE batch_id = ?', [batchId]);
    if (!job) throw new Error('Import job not found.');

    if (job.status === 'processing') {
      return { success: true, message: 'Import is already in progress.', jobId: job.id };
    }

    await db.query(
      "UPDATE import_jobs SET status = 'processing', update_existing = ? WHERE id = ?",
      [updateExisting ? 1 : 0, job.id]
    );

    // Run in background detached
    setImmediate(() => {
      this.executeImportJob(job.id, { updateExisting, skipErrors }).catch(err => {
        console.error(`[IMPORT JOB #${job.id} CRITICAL ERROR]:`, err);
      });
    });

    return { success: true, message: 'Import started in background.', jobId: job.id, batchId };
  }

  /**
   * Background Execution Worker for the Import Job
   */
  async executeImportJob(jobId, { updateExisting, skipErrors }) {
    console.log(`[BULK IMPORT] Executing Import Job #${jobId}...`);

    let importedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const errorLogs = [];

    try {
      const items = await db.query('SELECT * FROM import_job_items WHERE job_id = ? ORDER BY row_number ASC', [jobId]);
      const categories = await Category.getAll();
      const categoryMap = new Map();
      categories.forEach(c => categoryMap.set(this.normalizeKey(c.name), c.id));

      for (const item of items) {
        // Skip invalid rows if skipErrors is checked
        if (item.validation_status === 'error' && skipErrors) {
          skippedCount++;
          await db.query("UPDATE import_job_items SET import_status = 'skipped', import_message = ? WHERE id = ?", [item.validation_error, item.id]);
          continue;
        }

        // Handle duplicates
        if (item.validation_status === 'duplicate' && !updateExisting) {
          skippedCount++;
          const reason = 'Skipped: SKU already exists in catalog and "Update existing designs" was not checked.';
          await db.query("UPDATE import_job_items SET import_status = 'skipped', import_message = ? WHERE id = ?", [reason, item.id]);
          continue;
        }

        try {
          // 1. Resolve or create Category
          let categoryId = null;
          if (item.category_name) {
            const normCat = this.normalizeKey(item.category_name);
            if (categoryMap.has(normCat)) {
              categoryId = categoryMap.get(normCat);
            } else {
              const newSlug = item.category_name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
              categoryId = await Category.create({
                name: item.category_name,
                slug: newSlug,
                display_order: 0
              });
              categoryMap.set(normCat, categoryId);
            }
          }

          // 2. Resolve SKU & Slug
          let finalSku = item.sku;
          if (!finalSku) {
            finalSku = await Design.getNextSkuForCategory(categoryId);
          }

          let existingDesign = null;
          if (db.isConnected()) {
            const [ex] = await db.query('SELECT id, slug FROM designs WHERE sku = ? LIMIT 1', [finalSku]);
            existingDesign = ex || null;
          }

          let targetDesignId = null;

          if (existingDesign && updateExisting) {
            // Update existing product
            targetDesignId = existingDesign.id;
            await Design.update(targetDesignId, {
              title: item.title,
              price: item.price,
              sale_price: item.salePrice,
              category_id: categoryId,
              formats: item.formats,
              description: item.description,
              tags: item.tags,
              is_active: item.status === 'Active' ? 1 : 0
            });
          } else {
            // Create new design product
            const finalSlug = await Design.generateUniqueSlug(item.title);
            targetDesignId = await Design.create({
              title: item.title,
              sku: finalSku,
              slug: finalSlug,
              price: item.price,
              sale_price: item.salePrice,
              category_id: categoryId,
              formats: item.formats,
              description: item.description,
              tags: item.tags,
              is_active: item.status === 'Active' ? 1 : 0,
              download_count: 0 // strictly 0
            });
          }

          // 3. Attach matched image
          if (item.image_stored_url) {
            await db.query('UPDATE design_images SET is_primary = 0 WHERE design_id = ?', [targetDesignId]);
            await db.query(
              'INSERT INTO design_images (design_id, image_url, is_primary, display_order) VALUES (?, ?, 1, 0)',
              [targetDesignId, item.image_stored_url]
            );
          }

          // 4. Attach matched machine design file
          if (item.file_stored_path) {
            const fileExt = path.extname(item.file_filename || '').replace('.', '').toUpperCase() || 'ZIP';
            await db.query('DELETE FROM design_files WHERE design_id = ? AND is_preview = 0', [targetDesignId]);
            await db.query(
              'INSERT INTO design_files (design_id, file_name, file_path, file_format, is_preview) VALUES (?, ?, ?, ?, 0)',
              [targetDesignId, item.file_filename || `${finalSku}.zip`, item.file_stored_path, fileExt]
            );
          }

          importedCount++;
          await db.query(
            "UPDATE import_job_items SET import_status = 'imported', imported_design_id = ?, import_message = 'Imported successfully' WHERE id = ?",
            [targetDesignId, item.id]
          );

        } catch (rowErr) {
          failedCount++;
          errorLogs.push({ rowNumber: item.row_number, sku: item.sku, title: item.title, error: rowErr.message });
          await db.query(
            "UPDATE import_job_items SET import_status = 'failed', import_message = ? WHERE id = ?",
            [rowErr.message, item.id]
          );
        }

        // Live progress update on import_jobs
        await db.query(
          'UPDATE import_jobs SET imported_count = ?, skipped_count = ?, failed_count = ? WHERE id = ?',
          [importedCount, skippedCount, failedCount, jobId]
        );
      }

      await db.query(
        "UPDATE import_jobs SET status = 'completed', completed_at = NOW(), error_log = ? WHERE id = ?",
        [JSON.stringify(errorLogs), jobId]
      );
      console.log(`[BULK IMPORT FINISHED] Job #${jobId}: ${importedCount} imported, ${skippedCount} skipped, ${failedCount} failed.`);

    } catch (jobErr) {
      console.error(`[BULK IMPORT JOB FAILED] Job #${jobId}:`, jobErr);
      await db.query(
        "UPDATE import_jobs SET status = 'failed', completed_at = NOW(), error_log = ? WHERE id = ?",
        [JSON.stringify([{ error: jobErr.message }]), jobId]
      );
    }
  }

  /**
   * Retrieves live job status and progress.
   */
  async getJobStatus(batchId) {
    if (!db.isConnected()) await db.initPool();

    const [job] = await db.query('SELECT * FROM import_jobs WHERE batch_id = ?', [batchId]);
    if (!job) return null;

    const total = job.total_rows || 1;
    const progress = Math.min(100, Math.round(((job.imported_count + job.skipped_count + job.failed_count) / total) * 100));

    return {
      batchId: job.batch_id,
      jobId: job.id,
      status: job.status,
      totalRows: job.total_rows,
      validRows: job.valid_rows,
      errorRows: job.error_rows,
      duplicateRows: job.duplicate_rows,
      importedCount: job.imported_count,
      skippedCount: job.skipped_count,
      failedCount: job.failed_count,
      progressPercent: progress,
      completedAt: job.completed_at
    };
  }

  /**
   * Rollback: removes all designs created by a specific import job.
   */
  async rollbackImportJob(batchId) {
    if (!db.isConnected()) await db.initPool();

    const [job] = await db.query('SELECT * FROM import_jobs WHERE batch_id = ?', [batchId]);
    if (!job) throw new Error('Import job not found.');

    if (job.status === 'rolled_back') {
      return { success: true, message: 'This import has already been rolled back.' };
    }

    const items = await db.query(
      "SELECT imported_design_id FROM import_job_items WHERE job_id = ? AND import_status = 'imported' AND imported_design_id IS NOT NULL",
      [job.id]
    );

    let removedCount = 0;
    for (const it of items) {
      if (it.imported_design_id) {
        await db.query('DELETE FROM design_images WHERE design_id = ?', [it.imported_design_id]);
        await db.query('DELETE FROM design_files WHERE design_id = ?', [it.imported_design_id]);
        await db.query('DELETE FROM designs WHERE id = ?', [it.imported_design_id]);
        removedCount++;
      }
    }

    await db.query("UPDATE import_jobs SET status = 'rolled_back' WHERE id = ?", [job.id]);
    await db.query("UPDATE import_job_items SET import_status = 'skipped', import_message = 'Rolled back' WHERE job_id = ?", [job.id]);

    return {
      success: true,
      message: `Successfully rolled back import job: removed ${removedCount} designs from the catalog.`,
      removedCount
    };
  }

  /**
   * Generates error report CSV for a completed job.
   */
  async generateErrorReportCsv(batchId) {
    if (!db.isConnected()) await db.initPool();

    const [job] = await db.query('SELECT id, batch_id FROM import_jobs WHERE batch_id = ?', [batchId]);
    if (!job) throw new Error('Job not found.');

    const failedItems = await db.query(
      "SELECT row_number, sku, title, import_status, validation_error, import_message FROM import_job_items WHERE job_id = ? AND (import_status IN ('skipped', 'failed') OR validation_status = 'error')",
      [job.id]
    );

    const headers = ['Row Number', 'SKU', 'Title', 'Import Status', 'Reason / Error'];
    const rows = [headers.join(',')];

    for (const it of failedItems) {
      const row = [
        it.row_number,
        `"${String(it.sku || '').replace(/"/g, '""')}"`,
        `"${String(it.title || '').replace(/"/g, '""')}"`,
        it.import_status,
        `"${String(it.import_message || it.validation_error || 'Error').replace(/"/g, '""')}"`
      ];
      rows.push(row.join(','));
    }

    return rows.join('\r\n');
  }
}

module.exports = new BulkImportService();
