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
      { 'Field Name': 'Selling Price', 'Required': 'YES', 'Description': 'Discounted selling price (number, e.g. 49). Must be <= Original Price.' },
      { 'Field Name': 'Available Formats', 'Required': 'NO', 'Description': 'Embroidery formats included (default: DST, PES, JEF, EXP).' },
      { 'Field Name': 'Description', 'Required': 'NO', 'Description': 'Full description displayed on customer product page.' },
      { 'Field Name': 'Tags', 'Required': 'NO', 'Description': 'Comma-separated keywords for search.' },
      { 'Field Name': 'Status', 'Required': 'NO', 'Description': '"Active" or "Draft" (default: Active).' },
      { 'Field Name': 'Preview Image Filename', 'Required': 'RECOMMENDED', 'Description': 'Exact filename of preview photo (e.g. AED 1.png). Supports spaces.' },
      { 'Field Name': 'Machine ZIP Filename', 'Required': 'RECOMMENDED', 'Description': 'Exact filename of machine ZIP (e.g. AED 1.zip). Supports spaces.' }
    ];

    const wb = XLSX.utils.book_new();
    const wsData = XLSX.utils.json_to_sheet(exampleRows);
    const wsInstructions = XLSX.utils.json_to_sheet(instructionRows);

    XLSX.utils.book_append_sheet(wb, wsData, 'Design Products');
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Helper to normalize keys for flexible alias matching (removes all non-alphanumeric chars)
   */
  normalizeKey(key) {
    return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Stemming helper for flexible category matching (e.g. "Blouse" = "Blouse Designs")
   */
  stemCategory(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/\b(designs?|collections?)\b/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  /**
   * Flexible category matcher
   */
  matchCategoryFlexibly(rawCatName, existingCategories) {
    if (!rawCatName || !rawCatName.trim()) return null;
    const raw = rawCatName.trim();
    const lower = raw.toLowerCase();
    const normInput = lower.replace(/[^a-z0-9]/g, '');
    const stemmedInput = this.stemCategory(raw);

    // 1. Exact name or slug match
    for (const c of existingCategories) {
      if (c.name.toLowerCase() === lower || (c.slug && c.slug.toLowerCase() === lower)) {
        return c;
      }
    }

    // 2. Alphanumeric normalized match
    for (const c of existingCategories) {
      const normName = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normSlug = (c.slug || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normName === normInput || normSlug === normInput) {
        return c;
      }
    }

    // 3. Stemmed match stripping 'design(s)', 'collection(s)'
    if (stemmedInput.length >= 3) {
      for (const c of existingCategories) {
        const stemmedCat = this.stemCategory(c.name);
        if (stemmedCat === stemmedInput) return c;
        if (stemmedCat.startsWith(stemmedInput) || stemmedInput.startsWith(stemmedCat)) return c;
      }
    }

    return null;
  }

  /**
   * Step 1: Safely parse spreadsheet (.xlsx, .csv, .xls) and validate every row.
   * Creates an import_jobs draft record and rows in import_job_items.
   */
  async parseSpreadsheetFile(filePath, originalFilename, userId = null) {
    if (!db.isConnected()) await db.initPool();

    const ext = path.extname(originalFilename || '').toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
      throw new Error('Invalid file format. Please upload an Excel (.xlsx, .xls) or CSV (.csv) spreadsheet.');
    }

    let fileBuffer;
    try {
      fileBuffer = fs.readFileSync(filePath);
    } catch (readErr) {
      throw new Error(`Failed to read uploaded file: ${readErr.message}`);
    }

    let workbook;
    try {
      workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
    } catch (parseErr) {
      throw new Error(`Failed to read spreadsheet: ${parseErr.message}. Ensure the file is not corrupted or password-protected.`);
    }

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('The uploaded spreadsheet contains no sheets.');
    }

    // Pick first non-empty sheet
    let targetSheetName = workbook.SheetNames[0];
    let rawRows = [];
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', blankrows: false });
      if (rows && rows.length > 0) {
        targetSheetName = name;
        rawRows = rows;
        break;
      }
    }

    if (!rawRows || rawRows.length === 0) {
      throw new Error('Spreadsheet appears to be empty or contains no data rows.');
    }

    // Inspect headers on first row
    const foundHeaders = Object.keys(rawRows[0] || {}).map(h => String(h).trim()).filter(Boolean);

    const findMatchingHeader = (aliases) => {
      for (const alias of aliases) {
        const normAlias = this.normalizeKey(alias);
        for (const h of foundHeaders) {
          if (this.normalizeKey(h) === normAlias) {
            return h;
          }
        }
      }
      return null;
    };

    // 1. Column Alias Definitions
    const titleAliases = ['design name', 'name', 'title', 'design title', 'product name', 'design'];
    const mrpAliases = ['mrp', 'original price', 'mrp / original price', 'mrp/original price', 'original price mrp', 'original price (mrp)', 'regular price', 'mrp price', 'original price inr'];
    const sellingAliases = ['selling price', 'price', 'sale price', 'offer price', 'final price', 'discounted price', 'final selling price'];
    const skuAliases = ['sku', 'design code', 'design code / sku', 'design code/sku', 'code', 'product code', 'design sku'];
    const categoryAliases = ['category', 'category name', 'category slug', 'cat'];
    const formatsAliases = ['available formats', 'formats', 'format', 'file formats', 'file format'];
    const descAliases = ['description', 'details', 'about', 'design description', 'desc'];
    const tagsAliases = ['tags', 'keywords', 'tag'];
    const statusAliases = ['status', 'active', 'is active', 'state'];
    const previewImageAliases = ['preview image filename', 'preview image', 'image filename', 'image', 'preview file', 'image name', 'photo filename'];
    const machineZipAliases = ['machine zip filename', 'machine file', 'zip filename', 'machine zip', 'zip file', 'embroidery file', 'file filename'];

    // 2. Validate Required Columns: Design Name, MRP, Selling Price
    const hasTitle = Boolean(findMatchingHeader(titleAliases));
    const hasMrp = Boolean(findMatchingHeader(mrpAliases));
    const hasSelling = Boolean(findMatchingHeader(sellingAliases));

    const missingRequired = [];
    if (!hasTitle) missingRequired.push('Design Name');
    if (!hasMrp) missingRequired.push('MRP (Original Price)');
    if (!hasSelling) missingRequired.push('Selling Price');

    if (missingRequired.length > 0) {
      throw new Error(`Missing required column(s): ${missingRequired.join(', ')}. Found columns in your spreadsheet: [${foundHeaders.join(', ')}]. Please ensure your file includes Design Name, MRP, and Selling Price.`);
    }

    // 3. Rating & Review Count Detection (Ignore per requirement 4)
    const hasRating = Boolean(findMatchingHeader(['rating', 'average rating', 'ratings', 'stars']));
    const hasReviewCount = Boolean(findMatchingHeader(['review count', 'reviews count', 'reviews', 'number of reviews']));
    const ratingsIgnored = hasRating || hasReviewCount;

    // Load existing SKUs and Categories from DB
    const existingSkuRows = await db.query('SELECT sku FROM designs WHERE sku IS NOT NULL');
    const existingDbSkus = new Set(existingSkuRows.map(r => this.normalizeKey(r.sku)));
    const existingCategories = await Category.getAll();

    const batchId = crypto.randomBytes(16).toString('hex');
    const seenBatchSkus = new Set();
    const distinctCategoriesMap = new Map();

    let validCount = 0;
    let errorCount = 0;
    let duplicateCount = 0;

    const validatedItems = [];

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rowNum = i + 2; // Row number in spreadsheet (row 1 is header)

      // Value extractor using alias priority
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

      const title = getVal(titleAliases);
      const sku = getVal(skuAliases);
      const categoryName = getVal(categoryAliases);
      const mrpRaw = getVal(mrpAliases);
      const sellingRaw = getVal(sellingAliases);
      const formats = getVal(formatsAliases) || 'DST, PES, JEF, EXP';
      const description = getVal(descAliases);
      const tags = getVal(tagsAliases);
      const statusRaw = getVal(statusAliases) || 'Active';
      const previewImgRaw = getVal(previewImageAliases);
      const machineZipRaw = getVal(machineZipAliases);

      // Skip completely blank rows
      if (!title && !sku && !mrpRaw && !sellingRaw && !categoryName) {
        continue;
      }

      // Track distinct categories for preview mapping
      if (categoryName) {
        if (!distinctCategoriesMap.has(categoryName)) {
          const matched = this.matchCategoryFlexibly(categoryName, existingCategories);
          distinctCategoriesMap.set(categoryName, {
            spreadsheetCategory: categoryName,
            matchedCategoryId: matched ? matched.id : null,
            matchedCategoryName: matched ? matched.name : null,
            isMatched: Boolean(matched)
          });
        }
      }

      const errors = [];
      let isDuplicate = false;

      // Validation 1: Title
      if (!title) {
        errors.push('Missing required "Design Name".');
      }

      // Validation 2: MRP
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
      } else {
        errors.push('Missing required "Selling Price".');
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

      const status = (statusRaw.toLowerCase().includes('draft') || statusRaw === '0' || statusRaw.toLowerCase() === 'inactive') ? 'Draft' : 'Active';

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
        rowNo: rowNum,
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
      throw new Error('No valid rows found in spreadsheet. Please verify file content.');
    }

    // Create job record in database
    const jobRes = await db.query(`
      INSERT INTO \`import_jobs\` 
        (\`batch_id\`, \`status\`, \`total_rows\`, \`valid_rows\`, \`error_rows\`, \`duplicate_rows\`, \`spreadsheet_filename\`, \`created_by\`)
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

    // Insert items in batches of 200 using mysql2 VALUES ? bulk array placeholder
    const insertBatchSize = 200;
    for (let b = 0; b < validatedItems.length; b += insertBatchSize) {
      const slice = validatedItems.slice(b, b + insertBatchSize);
      const rows = slice.map(it => [
        jobId,
        it.rowNo,
        it.sku,
        it.title,
        it.categoryName,
        it.price,
        it.salePrice,
        it.formats,
        it.description,
        it.tags,
        it.status,
        it.imageFilename,
        it.fileFilename,
        it.validationStatus,
        it.validationError
      ]);

      await db.query(`
        INSERT INTO \`import_job_items\` 
          (\`job_id\`, \`row_no\`, \`sku\`, \`title\`, \`category_name\`, \`price\`, \`sale_price\`, \`formats\`, \`description\`, \`tags\`, \`status\`, \`image_filename\`, \`file_filename\`, \`validation_status\`, \`validation_error\`)
        VALUES ?
      `, [rows]);
    }

    return {
      batchId,
      jobId,
      sheetName: targetSheetName,
      totalRows: validatedItems.length,
      validRows: validCount,
      errorRows: errorCount,
      duplicateRows: duplicateCount,
      categoriesFound: Array.from(distinctCategoriesMap.values()),
      existingCategories: existingCategories.map(c => ({ id: c.id, name: c.name, slug: c.slug })),
      ratingsIgnored,
      ratingsIgnoredNote: ratingsIgnored ? 'Note: "Rating" and "Review Count" columns were ignored. Customer ratings & reviews are calculated exclusively from verified customer feedback.' : null,
      preview: validatedItems.slice(0, 105).map(it => ({
        rowNo: it.rowNo,
        rowNumber: it.rowNo,
        sku: it.sku,
        title: it.title,
        price: it.price,
        salePrice: it.salePrice,
        categoryName: it.categoryName,
        image_filename: it.imageFilename,
        file_filename: it.fileFilename,
        isDuplicate: it.validationStatus === 'duplicate',
        error: it.validationError
      }))
    };
  }

  /**
   * Step 2: Upload assets in small batches (5-10 files), matching by exact filename or SKU to import_job_items.
   */
  async processAssetBatch(batchId, files) {
    if (!db.isConnected()) await db.initPool();

    const [job] = await db.query('SELECT * FROM `import_jobs` WHERE `batch_id` = ?', [batchId]);
    if (!job) {
      throw new Error('Import session not found or expired.');
    }

    const items = await db.query(
      'SELECT `id`, `sku`, `title`, `row_no`, `image_filename`, `file_filename` FROM `import_job_items` WHERE `job_id` = ?',
      [job.id]
    );

    let matchedImages = 0;
    let matchedFiles = 0;
    const uploadedAssetResults = [];

    const allowedImg = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.svg'];
    const allowedMachine = ['.zip', '.dst', '.pes', '.jef', '.exp', '.rar', '.7z'];

    for (const file of files) {
      const rawExt = path.extname(file.originalname || '');
      const ext = rawExt.toLowerCase();
      const uploadOrigName = file.originalname.trim();
      const uploadBase = (rawExt ? uploadOrigName.slice(0, -rawExt.length) : uploadOrigName).trim();
      const normUploadBase = this.normalizeKey(uploadBase);
      const numericId = /^\d+$/.test(uploadBase) ? parseInt(uploadBase, 10) : null;
      const aedMatch = uploadBase.match(/^AED[\s\-_]*0*(\d+)$/i);
      const aedNum = aedMatch ? parseInt(aedMatch[1], 10) : null;

      const isImage = allowedImg.includes(ext);
      const isMachine = allowedMachine.includes(ext);

      if (!isImage && !isMachine) {
        uploadedAssetResults.push({ filename: file.originalname, status: 'unsupported_extension' });
        continue;
      }

      if (isImage) {
        // Save to persistent public preview storage
        const savedUrl = await storage.savePublicFile(file.path, file.originalname, file.mimetype);

        // Robust multi-tier matching for preview image:
        // 1. Exact or case-insensitive image_filename
        // 2. Base filename without extension
        // 3. Normalized key of image_filename
        // 4. SKU match
        // 5. Title match
        // 6. Row number or AED sequence match
        let matchedItem = items.find(it => {
          if (it.image_filename) {
            const targetOrig = it.image_filename.trim();
            const targetRawExt = path.extname(targetOrig);
            const targetBase = (targetRawExt ? targetOrig.slice(0, -targetRawExt.length) : targetOrig).trim();
            if (targetOrig.toLowerCase() === uploadOrigName.toLowerCase()) return true;
            if (targetBase.toLowerCase() === uploadBase.toLowerCase()) return true;
            if (this.normalizeKey(targetBase) === normUploadBase) return true;
          }
          if (it.sku && this.normalizeKey(it.sku) === normUploadBase) return true;
          if (it.title && this.normalizeKey(it.title) === normUploadBase) return true;
          if (numericId !== null && it.row_no === numericId) return true;
          if (aedNum !== null && (it.row_no === aedNum || this.normalizeKey(it.sku) === `aed${aedNum}`)) return true;
          return false;
        });

        if (matchedItem) {
          await db.query(
            'UPDATE `import_job_items` SET `image_stored_url` = ?, `image_matched` = 1, `image_filename` = ? WHERE `id` = ?',
            [savedUrl, file.originalname, matchedItem.id]
          );
          matchedItem.image_matched = 1;
          matchedImages++;
          uploadedAssetResults.push({ filename: file.originalname, status: 'matched', type: 'image', sku: matchedItem.sku, rowNo: matchedItem.row_no });
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

        // Robust multi-tier matching for machine file:
        // 1. Exact or case-insensitive file_filename
        // 2. Base filename without extension
        // 3. Normalized key of file_filename
        // 4. SKU match
        // 5. Title match
        // 6. Row number or AED sequence match
        let matchedItem = items.find(it => {
          if (it.file_filename) {
            const targetOrig = it.file_filename.trim();
            const targetRawExt = path.extname(targetOrig);
            const targetBase = (targetRawExt ? targetOrig.slice(0, -targetRawExt.length) : targetOrig).trim();
            if (targetOrig.toLowerCase() === uploadOrigName.toLowerCase()) return true;
            if (targetBase.toLowerCase() === uploadBase.toLowerCase()) return true;
            if (this.normalizeKey(targetBase) === normUploadBase) return true;
          }
          if (it.sku && this.normalizeKey(it.sku) === normUploadBase) return true;
          if (it.title && this.normalizeKey(it.title) === normUploadBase) return true;
          if (numericId !== null && it.row_no === numericId) return true;
          if (aedNum !== null && (it.row_no === aedNum || this.normalizeKey(it.sku) === `aed${aedNum}`)) return true;
          return false;
        });

        if (matchedItem) {
          await db.query(
            'UPDATE `import_job_items` SET `file_stored_path` = ?, `file_matched` = 1, `file_filename` = ? WHERE `id` = ?',
            [savedPath, file.originalname, matchedItem.id]
          );
          matchedItem.file_matched = 1;
          matchedFiles++;
          uploadedAssetResults.push({ filename: file.originalname, status: 'matched', type: 'machine', sku: matchedItem.sku, rowNo: matchedItem.row_no });
        } else {
          uploadedAssetResults.push({ filename: file.originalname, status: 'unmatched', type: 'machine' });
        }
      }
    }

    // Return updated match counts for this job
    const [matchCounts] = await db.query(`
      SELECT 
        COUNT(CASE WHEN \`image_matched\` = 1 THEN 1 END) AS total_matched_images,
        COUNT(CASE WHEN \`file_matched\` = 1 THEN 1 END) AS total_matched_files,
        COUNT(*) AS total_items
      FROM \`import_job_items\` 
      WHERE \`job_id\` = ?
    `, [job.id]);

    const totalItems = matchCounts.total_items || 1;
    const totalMatchedImg = matchCounts.total_matched_images || 0;
    const totalMatchedFil = matchCounts.total_matched_files || 0;

    return {
      success: true,
      batchId,
      uploadedCount: files.length,
      matchedImages,
      matchedFiles,
      totalMatchedImages: totalMatchedImg,
      totalMatchedFiles: totalMatchedFil,
      missingImages: Math.max(0, totalItems - totalMatchedImg),
      missingFiles: Math.max(0, totalItems - totalMatchedFil),
      totalItems,
      results: uploadedAssetResults
    };
  }

  /**
   * Step 3: Start background execution of the import.
   */
  async startImportJob(batchId, { updateExisting = false, skipErrors = true, categoryMappings = {} } = {}) {
    if (!db.isConnected()) await db.initPool();

    const [job] = await db.query('SELECT * FROM `import_jobs` WHERE `batch_id` = ?', [batchId]);
    if (!job) throw new Error('Import job not found.');

    if (job.status === 'processing') {
      return { success: true, message: 'Import is already in progress.', jobId: job.id };
    }

    await db.query(
      "UPDATE `import_jobs` SET `status` = 'processing', `update_existing` = ? WHERE `id` = ?",
      [updateExisting ? 1 : 0, job.id]
    );

    // Run in background detached
    setImmediate(() => {
      this.executeImportJob(job.id, { updateExisting, skipErrors, categoryMappings }).catch(err => {
        console.error(`[IMPORT JOB #${job.id} CRITICAL ERROR]:`, err);
      });
    });

    return { success: true, message: 'Import started in background.', jobId: job.id, batchId };
  }

  /**
   * Background Execution Worker for the Import Job
   */
  async executeImportJob(jobId, { updateExisting, skipErrors, categoryMappings = {} }) {
    console.log(`[BULK IMPORT] Executing Import Job #${jobId}...`);

    let importedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const errorLogs = [];

    try {
      const items = await db.query('SELECT * FROM `import_job_items` WHERE `job_id` = ? ORDER BY `row_no` ASC', [jobId]);
      const categories = await Category.getAll();
      const categoryMap = new Map();
      categories.forEach(c => categoryMap.set(this.normalizeKey(c.name), c.id));

      for (const item of items) {
        // Skip invalid rows if skipErrors is checked
        if (item.validation_status === 'error' && skipErrors) {
          skippedCount++;
          await db.query("UPDATE `import_job_items` SET `import_status` = 'skipped', `import_message` = ? WHERE `id` = ?", [item.validation_error, item.id]);
          continue;
        }

        // Handle duplicates
        if (item.validation_status === 'duplicate' && !updateExisting) {
          skippedCount++;
          const reason = 'Skipped: SKU already exists in catalog and "Update existing designs" was not checked.';
          await db.query("UPDATE `import_job_items` SET `import_status` = 'skipped', `import_message` = ? WHERE `id` = ?", [reason, item.id]);
          continue;
        }

        try {
          // 1. Resolve or create Category
          let categoryId = null;
          if (item.category_name) {
            // Check explicit mapping from UI
            if (categoryMappings && categoryMappings[item.category_name] && categoryMappings[item.category_name] !== '__NEW__') {
              categoryId = parseInt(categoryMappings[item.category_name], 10);
            } else {
              // Flexible match against existing categories
              const matched = this.matchCategoryFlexibly(item.category_name, categories);
              if (matched) {
                categoryId = matched.id;
              } else {
                // Check if category already exists in DB by slug or name before inserting
                const newSlug = item.category_name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                const [existingCat] = await db.query('SELECT `id`, `name` FROM `categories` WHERE `name` = ? OR `slug` = ? LIMIT 1', [item.category_name, newSlug]);
                if (existingCat) {
                  categoryId = existingCat.id;
                } else {
                  categoryId = await Category.create({
                    name: item.category_name,
                    slug: newSlug,
                    display_order: 0
                  });
                  categories.push({ id: categoryId, name: item.category_name, slug: newSlug });
                  categoryMap.set(this.normalizeKey(item.category_name), categoryId);
                }
              }
            }
          }

          // 2. Resolve SKU & Slug
          let finalSku = item.sku;
          if (!finalSku) {
            finalSku = await Design.getNextSkuForCategory(categoryId);
          }

          let existingDesign = null;
          if (db.isConnected()) {
            const [ex] = await db.query('SELECT `id`, `slug` FROM `designs` WHERE `sku` = ? LIMIT 1', [finalSku]);
            existingDesign = ex || null;
          }

          let targetDesignId = null;

          const finalSalePrice = (item.sale_price !== undefined && item.sale_price !== null && item.sale_price !== '') 
            ? item.sale_price 
            : (item.salePrice !== undefined && item.salePrice !== null && item.salePrice !== '' ? item.salePrice : null);

          if (existingDesign && updateExisting) {
            // Update existing product (Never overwrite ratings or reviews)
            targetDesignId = existingDesign.id;
            await Design.update(targetDesignId, {
              title: item.title,
              price: item.price,
              sale_price: finalSalePrice,
              category_id: categoryId,
              formats: item.formats,
              description: item.description,
              tags: item.tags,
              is_active: item.status === 'Active' ? 1 : 0,
              import_image_filename: item.image_filename || null,
              import_zip_filename: item.file_filename || null
            });
          } else {
            // Create new design product
            const finalSlug = await Design.generateUniqueSlug(item.title);
            targetDesignId = await Design.create({
              title: item.title,
              sku: finalSku,
              slug: finalSlug,
              price: item.price,
              sale_price: finalSalePrice,
              category_id: categoryId,
              formats: item.formats,
              description: item.description,
              tags: item.tags,
              is_active: item.status === 'Active' ? 1 : 0,
              download_count: 0, // strictly 0
              import_image_filename: item.image_filename || null,
              import_zip_filename: item.file_filename || null
            });
          }

          // 3. Attach matched image (creates design_images & preview design_files + thumbnail)
          if (item.image_stored_url) {
            await Design.replacePrimaryImage(targetDesignId, item.image_stored_url, item.image_filename, 0);
          }

          // 4. Attach matched machine design file
          if (item.file_stored_path) {
            const fileExt = path.extname(item.file_filename || '').replace('.', '').toUpperCase() || 'ZIP';
            await db.query('DELETE FROM `design_files` WHERE `design_id` = ? AND `is_preview` = 0', [targetDesignId]);
            await db.query(
              'INSERT INTO `design_files` (`design_id`, `file_name`, `file_path`, `file_format`, `is_preview`) VALUES (?, ?, ?, ?, 0)',
              [targetDesignId, item.file_filename || `${finalSku}.zip`, item.file_stored_path, fileExt]
            );
          }

          importedCount++;
          await db.query(
            "UPDATE `import_job_items` SET `import_status` = 'imported', `imported_design_id` = ?, `import_message` = 'Imported successfully' WHERE `id` = ?",
            [targetDesignId, item.id]
          );

        } catch (rowErr) {
          failedCount++;
          errorLogs.push({ rowNo: item.row_no || item.row_number, rowNumber: item.row_no || item.row_number, sku: item.sku, title: item.title, error: rowErr.message });
          await db.query(
            "UPDATE `import_job_items` SET `import_status` = 'failed', `import_message` = ? WHERE `id` = ?",
            [rowErr.message, item.id]
          );
        }

        // Live progress update on import_jobs
        await db.query(
          'UPDATE `import_jobs` SET `imported_count` = ?, `skipped_count` = ?, `failed_count` = ? WHERE `id` = ?',
          [importedCount, skippedCount, failedCount, jobId]
        );
      }

      await db.query(
        "UPDATE `import_jobs` SET `status` = 'completed', `completed_at` = NOW(), `error_log` = ? WHERE `id` = ?",
        [JSON.stringify(errorLogs), jobId]
      );
      console.log(`[BULK IMPORT FINISHED] Job #${jobId}: ${importedCount} imported, ${skippedCount} skipped, ${failedCount} failed.`);

    } catch (jobErr) {
      console.error(`[BULK IMPORT JOB FAILED] Job #${jobId}:`, jobErr);
      await db.query(
        "UPDATE `import_jobs` SET `status` = 'failed', `completed_at` = NOW(), `error_log` = ? WHERE `id` = ?",
        [JSON.stringify([{ error: jobErr.message }]), jobId]
      );
    }
  }

  /**
   * Retrieves live job status and progress.
   */
  async getJobStatus(batchId) {
    if (!db.isConnected()) await db.initPool();

    const [job] = await db.query('SELECT * FROM `import_jobs` WHERE `batch_id` = ?', [batchId]);
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

    const [job] = await db.query('SELECT * FROM `import_jobs` WHERE `batch_id` = ?', [batchId]);
    if (!job) throw new Error('Import job not found.');

    if (job.status === 'rolled_back') {
      return { success: true, message: 'This import has already been rolled back.' };
    }

    const items = await db.query(
      "SELECT `imported_design_id` FROM `import_job_items` WHERE `job_id` = ? AND `import_status` = 'imported' AND `imported_design_id` IS NOT NULL",
      [job.id]
    );

    let removedCount = 0;
    for (const it of items) {
      if (it.imported_design_id) {
        await db.query('DELETE FROM `design_images` WHERE `design_id` = ?', [it.imported_design_id]);
        await db.query('DELETE FROM `design_files` WHERE `design_id` = ?', [it.imported_design_id]);
        await db.query('DELETE FROM `designs` WHERE `id` = ?', [it.imported_design_id]);
        removedCount++;
      }
    }

    await db.query("UPDATE `import_jobs` SET `status` = 'rolled_back' WHERE `id` = ?", [job.id]);
    await db.query("UPDATE `import_job_items` SET `import_status` = 'skipped', `import_message` = 'Rolled back' WHERE `job_id` = ?", [job.id]);

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

    const [job] = await db.query('SELECT `id`, `batch_id` FROM `import_jobs` WHERE `batch_id` = ?', [batchId]);
    if (!job) throw new Error('Job not found.');

    const failedItems = await db.query(
      "SELECT `row_no`, `sku`, `title`, `import_status`, `validation_error`, `import_message` FROM `import_job_items` WHERE `job_id` = ? AND (`import_status` IN ('skipped', 'failed') OR `validation_status` = 'error')",
      [job.id]
    );

    const headers = ['Row Number', 'SKU', 'Title', 'Import Status', 'Reason / Error'];
    const rows = [headers.join(',')];

    for (const it of failedItems) {
      const row = [
        it.row_no || it.row_number,
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
