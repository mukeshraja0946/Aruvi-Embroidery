const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

// 1. Scan all migrations to know what migrations currently create or alter
const migrationsDir = path.join(projectRoot, 'migrations');
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter(f => /^\d+.*\.sql$/i.test(f))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

console.log('=== MIGRATION FILES IN REPOSITORY ===');
migrationFiles.forEach(f => console.log('  ' + f));

// Parse tables and columns created/added in migrations
const migrationSchema = {}; // table -> Set of columns

function recordColumn(table, col) {
  const cleanTable = table.toLowerCase().replace(/[`"']/g, '').trim();
  const cleanCol = col.toLowerCase().replace(/[`"']/g, '').trim();
  if (!cleanTable || !cleanCol) return;
  if (!migrationSchema[cleanTable]) migrationSchema[cleanTable] = new Set();
  migrationSchema[cleanTable].add(cleanCol);
}

for (const f of migrationFiles) {
  const content = fs.readFileSync(path.join(migrationsDir, f), 'utf8');

  // CREATE TABLE
  const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`\w]+)\s*\(([\s\S]*?)\)\s*ENGINE/gi;
  let tMatch;
  while ((tMatch = tableRegex.exec(content)) !== null) {
    const table = tMatch[1];
    const body = tMatch[2];
    const lines = body.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('--') || trimmed.startsWith('/*')) continue;
      if (/^(PRIMARY\s+KEY|KEY|INDEX|UNIQUE|FOREIGN\s+KEY|CONSTRAINT)/i.test(trimmed)) continue;
      const colMatch = trimmed.match(/^[`"]?([a-zA-Z0-9_]+)[`"]?\s+/);
      if (colMatch) {
        recordColumn(table, colMatch[1]);
      }
    }
  }

  // ALTER TABLE ADD COLUMN
  const alterRegex = /ALTER\s+TABLE\s+[`"]?([a-zA-Z0-9_]+)[`"]?\s+ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([a-zA-Z0-9_]+)[`"]?/gi;
  let aMatch;
  while ((aMatch = alterRegex.exec(content)) !== null) {
    recordColumn(aMatch[1], aMatch[2]);
  }

  // Dynamic SQL ALTER TABLE with information_schema check (e.g. in migration 002, 010, 015)
  const infoSchemaRegex = /table_name\s*=\s*'([^']+)'\s+AND\s+column_name\s*=\s*'([^']+)'/gi;
  let isMatch;
  while ((isMatch = infoSchemaRegex.exec(content)) !== null) {
    recordColumn(isMatch[1], isMatch[2]);
  }
}

console.log('\n=== TABLES AND COLUMNS DEFINED IN MIGRATIONS ===');
for (const [table, cols] of Object.entries(migrationSchema).sort()) {
  console.log(`Table: ${table} (${cols.size} columns)`);
  console.log('  ' + Array.from(cols).sort().join(', '));
}

// 2. Scan Codebase for Table & Column Usages
const codeSchema = {}; // table -> Set of columns

function recordCodeUsage(table, col) {
  const cleanTable = table.toLowerCase().replace(/[`"']/g, '').trim();
  const cleanCol = col.toLowerCase().replace(/[`"']/g, '').trim();
  if (!cleanTable || !cleanCol) return;
  // Ignore SQL keywords or alias artifacts
  if (['where', 'select', 'set', 'from', 'inner', 'left', 'join', 'as', 'on', 'group', 'order', 'by', 'limit', 'offset', 'and', 'or', 'null', 'default'].includes(cleanCol)) return;
  if (!codeSchema[cleanTable]) codeSchema[cleanTable] = new Set();
  codeSchema[cleanTable].add(cleanCol);
}

function scanDir(dir) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    if (['node_modules', '.git', 'public', 'migrations'].includes(item)) continue;
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      scanDir(full);
    } else if (item.endsWith('.js')) {
      scanJsFile(full);
    }
  }
}

function scanJsFile(filePath) {
  if (filePath.includes(path.sep + 'test')) return;
  const content = fs.readFileSync(filePath, 'utf8');

  // INSERT INTO <table> (<cols>)
  const insertRegex = /INSERT\s+INTO\s+[`"]?([a-zA-Z0-9_]+)[`"]?\s*\(([^)]+)\)/gi;
  let iMatch;
  while ((iMatch = insertRegex.exec(content)) !== null) {
    const table = iMatch[1];
    const cols = iMatch[2].split(',');
    for (const c of cols) {
      const colName = c.trim().replace(/[`"']/g, '').split(/\s+/)[0];
      recordCodeUsage(table, colName);
    }
  }

  // UPDATE <table> SET <col>=?, <col>=?
  const updateRegex = /UPDATE\s+[`"]?([a-zA-Z0-9_]+)[`"]?\s+SET\s+([\s\S]+?)(?:WHERE|$)/gi;
  let uMatch;
  while ((uMatch = updateRegex.exec(content)) !== null) {
    const table = uMatch[1];
    const setBody = uMatch[2];
    const setParts = setBody.split(',');
    for (const part of setParts) {
      const colMatch = part.trim().match(/^[`"]?([a-zA-Z0-9_]+)[`"]?\s*=/);
      if (colMatch) {
        recordCodeUsage(table, colMatch[1]);
      }
    }
  }

  // Dynamic updates (e.g. updateFields.push('stitch_count_front=?'))
  const pushRegex = /updateFields\.push\(\s*['"`]([a-zA-Z0-9_]+)\s*=\s*\?/gi;
  let pMatch;
  while ((pMatch = pushRegex.exec(content)) !== null) {
    recordCodeUsage('designs', pMatch[1]);
  }

  // Model object mappings & selects: check Design.js fields
  if (filePath.endsWith('Design.js')) {
    const designCols = [
      'id', 'title', 'sku', 'slug', 'description', 'short_description', 'price', 'sale_price',
      'category_id', 'sub_category', 'hoop_size', 'stitch_count', 'stitch_count_front',
      'stitch_count_back', 'stitch_count_sleeve', 'dimensions', 'formats', 'is_featured',
      'is_trending', 'is_active', 'download_count', 'tags', 'total_sales', 'average_rating',
      'reviews_count', 'import_image_filename', 'import_zip_filename', 'created_at', 'updated_at'
    ];
    designCols.forEach(c => recordCodeUsage('designs', c));
  }

  if (filePath.endsWith('Category.js')) {
    ['id', 'name', 'slug', 'description', 'image_url', 'display_order', 'is_active', 'created_at'].forEach(c => recordCodeUsage('categories', c));
  }

  if (filePath.endsWith('User.js')) {
    ['id', 'full_name', 'email', 'password_hash', 'phone', 'address', 'profile_picture', 'role', 'is_active', 'reset_token', 'reset_expires', 'created_at', 'updated_at'].forEach(c => recordCodeUsage('users', c));
  }

  if (filePath.endsWith('Order.js')) {
    ['id', 'order_number', 'user_id', 'guest_email', 'guest_name', 'guest_phone', 'shipping_address', 'city', 'state', 'pincode', 'payment_method', 'total_amount', 'discount_amount', 'final_amount', 'coupon_code', 'status', 'razorpay_order_id', 'razorpay_payment_id', 'payment_gateway', 'cashfree_order_id', 'cashfree_payment_id', 'created_at', 'updated_at'].forEach(c => recordCodeUsage('orders', c));
    ['id', 'order_id', 'design_id', 'quantity', 'price_at_purchase', 'mrp', 'discount_amount', 'created_at'].forEach(c => recordCodeUsage('order_items', c));
  }

  if (filePath.endsWith('bulkImportService.js') || filePath.endsWith('importJobs.js')) {
    ['id', 'batch_id', 'status', 'total_rows', 'valid_rows', 'error_rows', 'duplicate_rows', 'imported_count', 'skipped_count', 'failed_count', 'update_existing', 'spreadsheet_filename', 'created_at', 'completed_at'].forEach(c => recordCodeUsage('import_jobs', c));
    ['id', 'job_id', 'row_no', 'sku', 'title', 'category_name', 'price', 'sale_price', 'formats', 'image_filename', 'image_stored_url', 'file_filename', 'file_stored_path', 'validation_status', 'import_status', 'error_message'].forEach(c => recordCodeUsage('import_job_items', c));
  }

  if (filePath.endsWith('bulkPriceService.js')) {
    ['id', 'batch_id', 'update_type', 'value', 'affected_rows', 'criteria', 'admin_id', 'created_at'].forEach(c => recordCodeUsage('price_update_logs', c));
  }
}

scanDir(projectRoot);

console.log('\n=== TABLES AND COLUMNS USED IN CODE ===');
for (const [table, cols] of Object.entries(codeSchema).sort()) {
  console.log(`Table: ${table} (${cols.size} columns)`);
  console.log('  ' + Array.from(cols).sort().join(', '));
}

console.log('\n=== COMPARING CODE VS MIGRATIONS (FINDING GAPS) ===');
let foundMissing = false;
for (const [table, cols] of Object.entries(codeSchema)) {
  const migCols = migrationSchema[table];
  if (!migCols) {
    console.log(`❌ TABLE MISSING FROM MIGRATIONS: "${table}"!`);
    foundMissing = true;
    continue;
  }
  for (const col of cols) {
    if (!migCols.has(col)) {
      console.log(`❌ COLUMN MISSING FROM MIGRATIONS: ${table}.${col}`);
      foundMissing = true;
    }
  }
}
if (!foundMissing) {
  console.log('✅ All code columns are referenced somewhere in the migrations files!');
}
