const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const AdmZip = require('adm-zip');

const db = require('../config/db');
const Design = require('../models/Design');
const Category = require('../models/Category');
const ActivityLog = require('../models/ActivityLog');

function normalizeCodeKey(str) {
  if (!str) return '';
  const clean = String(str).toLowerCase().replace(/[^a-z0-9]/g, '');
  const m = clean.match(/^([a-z]+)0*(\d+)$/);
  if (m) {
    return `${m[1]}${parseInt(m[2], 10)}`;
  }
  return clean;
}

class BulkDesignDetailsService {
  /**
   * Returns clean structured text for templates and notes
   */
  getSampleTemplateText() {
    return [
      '================================================================================',
      'ARUVI EMBROIDERY STUDIO - BULK DESIGN DETAILS TEMPLATE',
      '================================================================================',
      'INSTRUCTIONS & RULES:',
      '1. Each design record begins with "Design Code / SKU:".',
      '2. Separate multiple design entries with "---" on a single line.',
      '3. Blank or omitted fields will leave existing database values UNCHANGED.',
      '4. To explicitly erase or clear a field, enter [CLEAR].',
      '5. Stitch counts should be non-negative whole numbers (e.g. 12500, 8200).',
      '================================================================================',
      '',
      'Design Code / SKU: AED-BLO-01',
      'Design Name: Rose Bloom Design',
      'Category: Blouse Designs',
      'Front Stitch Count: 12500',
      'Back Stitch Count: 8200',
      'Sleeve Stitch Count: 4500',
      'Description: Floral embroidery design with matching front, back, and sleeve patterns.',
      '',
      '---',
      '',
      'Design Code / SKU: AED-BOR-02',
      'Design Name: Peacock Border Motif',
      'Category: Border Designs',
      'Front Stitch Count: 9400',
      'Back Stitch Count: 6100',
      'Sleeve Stitch Count: 3200',
      'Description: Intricate peacock border pattern suitable for sarees and lehengas.'
    ].join('\n');
  }

  /**
   * Generates Plain Text (.txt) Template
   */
  generateTemplateText() {
    return Buffer.from(this.getSampleTemplateText(), 'utf-8');
  }

  /**
   * Generates Word Document (.docx) Template
   */
  generateTemplateDocx() {
    const zip = new AdmZip();
    const contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>';

    const relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>';

    const escapeXml = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    const text = this.getSampleTemplateText();
    const lines = text.split('\n');
    const paragraphs = lines.map(line => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`).join('');

    const docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body>' + paragraphs + '</w:body>' +
      '</w:document>';

    zip.addFile('[Content_Types].xml', Buffer.from(contentTypesXml, 'utf8'));
    zip.addFile('_rels/.rels', Buffer.from(relsXml, 'utf8'));
    zip.addFile('word/document.xml', Buffer.from(docXml, 'utf8'));

    return zip.toBuffer();
  }

  /**
   * Generates Text-based PDF (.pdf) Template
   */
  generateTemplatePdf() {
    const escapePdfText = (str) => {
      return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    };

    const text = this.getSampleTemplateText();
    const lines = text.split('\n');
    let streamContent = 'BT\n/F1 9 Tf\n13 TL\n45 790 Td\n';
    lines.forEach((line, idx) => {
      if (idx === 0) {
        streamContent += `(${escapePdfText(line)}) Tj\n`;
      } else {
        streamContent += `T* (${escapePdfText(line)}) Tj\n`;
      }
    });
    streamContent += 'ET\n';

    const streamLength = Buffer.byteLength(streamContent, 'utf8');

    let pdf = '%PDF-1.4\n';
    const offsets = [];

    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';

    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';

    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n';

    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `4 0 obj\n<< /Length ${streamLength} >>\nstream\n${streamContent}endstream\nendobj\n`;

    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n';

    const startXref = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 6\n0000000000 65535 f \n`;
    for (const off of offsets) {
      pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;

    return Buffer.from(pdf, 'binary');
  }

  /**
   * Helper to extract text from a PDF buffer (compatible with both pdf-parse v1 and v2)
   */
  async extractPdfText(buffer) {
    if (typeof pdfParse === 'function') {
      const data = await pdfParse(buffer);
      return (data && data.text) ? data.text.trim() : '';
    } else if (pdfParse && pdfParse.PDFParse) {
      const parser = new pdfParse.PDFParse({ data: buffer });
      const res = await parser.getText();
      if (typeof parser.destroy === 'function') await parser.destroy();
      return (res && res.text) ? res.text.trim() : (typeof res === 'string' ? res.trim() : '');
    }
    throw new Error('PDF parsing library is unavailable.');
  }

  /**
   * Generates a clean Excel template with 'Design Details' sheet + 'Instructions' guide.
   */
  generateTemplateWorkbook() {
    const exampleRows = [
      {
        'Design Code / SKU': 'AED-BLO-01',
        'Design Name': 'Rose Bloom Design',
        'Category': 'Blouse Designs',
        'Front Stitch Count': 12500,
        'Back Stitch Count': 8200,
        'Sleeve Stitch Count': 4500,
        'Description': 'Floral embroidery design with matching front, back, and sleeve patterns.'
      },
      {
        'Design Code / SKU': 'AED-BOR-02',
        'Design Name': 'Peacock Border Motif',
        'Category': 'Border Designs',
        'Front Stitch Count': 9400,
        'Back Stitch Count': 6100,
        'Sleeve Stitch Count': 3200,
        'Description': 'Intricate peacock border pattern suitable for sarees and lehengas.'
      }
    ];

    const instructionRows = [
      { 'Column': 'Design Code / SKU', 'Required': 'YES', 'Rule / Note': 'Unique Design Code / SKU (e.g. AED-BLO-01). Used to match the existing product.' },
      { 'Column': 'Design Name', 'Required': 'NO', 'Rule / Note': 'Optional design title. Leave blank to leave existing design name unchanged.' },
      { 'Column': 'Category', 'Required': 'NO', 'Rule / Note': 'Category name (e.g. Blouse Designs, Floral, Borders). Must match an existing category.' },
      { 'Column': 'Front Stitch Count', 'Required': 'NO', 'Rule / Note': 'Whole number >= 0 (e.g. 12500). Non-negative integers only.' },
      { 'Column': 'Back Stitch Count', 'Required': 'NO', 'Rule / Note': 'Whole number >= 0 (e.g. 8200). Non-negative integers only.' },
      { 'Column': 'Sleeve Stitch Count', 'Required': 'NO', 'Rule / Note': 'Whole number >= 0 (e.g. 4500). Non-negative integers only.' },
      { 'Column': 'Description', 'Required': 'NO', 'Rule / Note': 'Detailed product description. Multi-line text and paragraphs supported.' },
      { 'Column': 'BLANK CELLS', 'Required': '-', 'Rule / Note': 'Leaving a cell empty leaves the existing database value UNCHANGED.' },
      { 'Column': 'CLEARING A FIELD', 'Required': '-', 'Rule / Note': 'Type [CLEAR] in any field to explicitly erase/remove the existing value.' }
    ];

    const wb = XLSX.utils.book_new();
    const wsData = XLSX.utils.json_to_sheet(exampleRows);
    const wsInstructions = XLSX.utils.json_to_sheet(instructionRows);

    // Set auto column widths for neat display
    wsData['!cols'] = [
      { wch: 20 }, // SKU
      { wch: 26 }, // Name
      { wch: 20 }, // Category
      { wch: 20 }, // Front Stitch Count
      { wch: 20 }, // Back Stitch Count
      { wch: 22 }, // Sleeve Stitch Count
      { wch: 60 }  // Description
    ];

    wsInstructions['!cols'] = [
      { wch: 24 },
      { wch: 12 },
      { wch: 65 }
    ];

    XLSX.utils.book_append_sheet(wb, wsData, 'Design Details');
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Helper to clean and normalize a key for flexible header matching
   */
  normalizeHeader(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Helper to check if a value is an explicit clear keyword
   */
  isClearKeyword(val) {
    if (val === null || val === undefined) return false;
    const clean = String(val).trim().toUpperCase();
    return ['[CLEAR]', '__CLEAR__', 'CLEAR', '[EMPTY]', '__EMPTY__'].includes(clean);
  }

  /**
   * Helper to validate a stitch count value as non-negative integer or null
   */
  validateStitch(val, fieldName) {
    if (val === undefined || val === null || String(val).trim() === '') {
      return { valid: true, value: undefined }; // untouched
    }
    if (this.isClearKeyword(val)) {
      return { valid: true, value: null, isClear: true };
    }
    const clean = String(val).replace(/,/g, '').replace(/stitches|pts/gi, '').trim();
    if (!/^\d+$/.test(clean)) {
      return { valid: false, error: `${fieldName} must be a non-negative whole number (e.g. 12500). Got: "${val}"` };
    }
    const num = parseInt(clean, 10);
    if (num < 0) {
      return { valid: false, error: `${fieldName} must be non-negative. Got: "${val}"` };
    }
    return { valid: true, value: num };
  }

  /**
   * Category matcher matching exact, lowercase, or stemmed category names
   */
  matchCategory(rawCatName, existingCategories) {
    if (!rawCatName || !String(rawCatName).trim()) return null;
    const raw = String(rawCatName).trim();
    const lower = raw.toLowerCase();
    const normInput = lower.replace(/[^a-z0-9]/g, '');

    // 1. Exact or lowercase match
    for (const c of existingCategories) {
      if (c.name.toLowerCase() === lower || (c.slug && c.slug.toLowerCase() === lower)) {
        return c;
      }
    }

    // 2. Alphanumeric match
    for (const c of existingCategories) {
      const normName = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normSlug = (c.slug || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normName === normInput || normSlug === normInput) {
        return c;
      }
    }

    // 3. Substring / Stemmed match
    for (const c of existingCategories) {
      const normName = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normName.includes(normInput) || normInput.includes(normName)) {
        return c;
      }
    }

    return null;
  }

  /**
   * Main entry point to parse any input source (notes text or file upload)
   */
  async parseRawInput({ file = null, notes = '', clearFieldOption = false }) {
    if (file) {
      const ext = path.extname(file.originalname || '').toLowerCase();
      let buffer = file.buffer;
      if (!buffer && file.path && fs.existsSync(file.path)) {
        buffer = fs.readFileSync(file.path);
      }

      if (!buffer) {
        throw new Error('No uploaded file content received.');
      }

      if (['.xlsx', '.xls'].includes(ext)) {
        return this.parseExcelBuffer(buffer, clearFieldOption);
      } else if (ext === '.txt') {
        const textContent = buffer.toString('utf-8');
        return this.parseStructuredText(textContent, clearFieldOption);
      } else if (ext === '.docx') {
        const result = await mammoth.extractRawText({ buffer });
        if (!result || !result.value || result.value.trim().length === 0) {
          throw new Error('Word document (.docx) does not contain extractable text.');
        }
        return this.parseStructuredText(result.value, clearFieldOption);
      } else if (ext === '.doc') {
        // Legacy Word .doc binary format
        try {
          const result = await mammoth.extractRawText({ buffer });
          if (result && result.value && result.value.trim().length > 10) {
            return this.parseStructuredText(result.value, clearFieldOption);
          }
        } catch (e) {
          // mammoth does not natively support OLE2 binary .doc
        }
        throw new Error('Legacy binary .doc file could not be parsed safely. Please save or export your document as modern Word (.docx), Excel (.xlsx), PDF, or plain text (.txt) and try again.');
      } else if (ext === '.pdf') {
        let extractedText = '';
        try {
          extractedText = await this.extractPdfText(buffer);
        } catch (pdfErr) {
          throw new Error(`Unable to read PDF file: ${pdfErr.message}`);
        }

        // If PDF contains very little or no text (e.g. scanned image pages), report OCR required as requested
        if (!extractedText || extractedText.length < 15) {
          throw new Error('This PDF appears to be a scanned document or image-only PDF. Direct text extraction is not possible. Optical Character Recognition (OCR) is required to import scanned documents. Please upload a text-based PDF, Word, Excel, or TXT file instead.');
        }

        return this.parseStructuredText(extractedText, clearFieldOption);
      } else {
        throw new Error(`Unsupported file format "${ext}". Supported formats: .xlsx, .xls, .docx, .pdf, and .txt.`);
      }
    }

    if (notes && String(notes).trim().length > 0) {
      return this.parseStructuredText(String(notes), clearFieldOption);
    }

    throw new Error('Please provide text notes or upload a file (.xlsx, .xls, .docx, .pdf, .txt) to proceed.');
  }

  /**
   * Parse Excel Workbook
   */
  parseExcelBuffer(buffer, clearFieldOption) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error('The uploaded spreadsheet contains no sheets.');
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
    if (!rows || rows.length === 0) {
      throw new Error('The spreadsheet is empty or has no data rows.');
    }

    const parsedEntries = [];

    rows.forEach((row, idx) => {
      // Find matching keys by normalized header
      let rawSku = null;
      let rawName = null;
      let rawCategory = null;
      let rawFrontStitch = null;
      let rawBackStitch = null;
      let rawSleeveStitch = null;
      let rawDescription = null;

      for (const [key, val] of Object.entries(row)) {
        const normKey = this.normalizeHeader(key);
        if (/^(designcode(sku)?|sku|code|productcode|itemcode)$/.test(normKey)) {
          rawSku = val;
        } else if (/^(designname|name|title|productname)$/.test(normKey)) {
          rawName = val;
        } else if (/^(category|categoryname)$/.test(normKey)) {
          rawCategory = val;
        } else if (/^(front(stitchcount)?|stitchcountfront|frontstitches?|frontstitch)$/.test(normKey)) {
          rawFrontStitch = val;
        } else if (/^(back(stitchcount)?|stitchcountback|backstitches?|backstitch)$/.test(normKey)) {
          rawBackStitch = val;
        } else if (/^(sleeve(stitchcount)?|stitchcountsleeve|sleevestitches?|sleevestitch)$/.test(normKey)) {
          rawSleeveStitch = val;
        } else if (/^(description|detaileddescription|details|notes)$/.test(normKey)) {
          rawDescription = val;
        }
      }

      // Ignore completely empty rows
      if (!rawSku && !rawName && !rawCategory && rawFrontStitch === null && rawBackStitch === null && rawSleeveStitch === null && !rawDescription) {
        return;
      }

      parsedEntries.push({
        entryIndex: idx + 1,
        rawSku: rawSku !== null && rawSku !== undefined ? String(rawSku).trim() : '',
        rawName: rawName !== null && rawName !== undefined ? String(rawName).trim() : undefined,
        rawCategory: rawCategory !== null && rawCategory !== undefined ? String(rawCategory).trim() : undefined,
        rawFrontStitch: rawFrontStitch !== null && rawFrontStitch !== undefined ? String(rawFrontStitch).trim() : undefined,
        rawBackStitch: rawBackStitch !== null && rawBackStitch !== undefined ? String(rawBackStitch).trim() : undefined,
        rawSleeveStitch: rawSleeveStitch !== null && rawSleeveStitch !== undefined ? String(rawSleeveStitch).trim() : undefined,
        rawDescription: rawDescription !== null && rawDescription !== undefined ? String(rawDescription).trim() : undefined
      });
    });

    if (parsedEntries.length === 0) {
      throw new Error('No valid design rows could be identified in the uploaded Excel file. Please ensure column headers match the template.');
    }

    return parsedEntries;
  }

  /**
   * Parse structured text (pasted notes, TXT, DOCX text, text-based PDF)
   */
  parseStructuredText(rawText, clearFieldOption) {
    if (!rawText || !rawText.trim()) {
      throw new Error('No text content available to parse.');
    }

    // Normalize newlines
    const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Split entries by explicit divider line or lookahead for Design Code/SKU:
    let chunks = [];
    const dividerRegex = /(?:^|\n)\s*(?:---|===|\*\*\*|___+)\s*(?:\n|$)/g;
    if (dividerRegex.test(normalized)) {
      chunks = normalized.split(dividerRegex).map(c => c.trim()).filter(Boolean);
    } else {
      // Split on occurrences of "Design Code:" or "SKU:" at the start of a line
      const lookaheadRegex = /(?:^|\n)(?=\s*(?:Design\s*Code(?:\s*\/\s*SKU)?|SKU)\s*:)/gi;
      const splitChunks = normalized.split(lookaheadRegex).map(c => c.trim()).filter(Boolean);
      if (splitChunks.length > 0) {
        chunks = splitChunks;
      } else {
        chunks = [normalized.trim()];
      }
    }

    const parsedEntries = [];

    chunks.forEach((chunk, idx) => {
      if (!chunk.trim()) return;

      let rawSku = '';
      let rawName = undefined;
      let rawCategory = undefined;
      let rawFrontStitch = undefined;
      let rawBackStitch = undefined;
      let rawSleeveStitch = undefined;
      let rawDescription = undefined;

      // Extract SKU
      const skuMatch = chunk.match(/(?:^|\n)\s*(?:Design\s*Code(?:\s*\/\s*SKU)?|SKU|Product\s*Code|Item\s*Code)\s*:\s*([^\n\r]+)/i);
      if (skuMatch) rawSku = skuMatch[1].trim();

      // Extract Name
      const nameMatch = chunk.match(/(?:^|\n)\s*(?:Design\s*Name|Title|Name|Product\s*Name)\s*:\s*([^\n\r]+)/i);
      if (nameMatch) rawName = nameMatch[1].trim();

      // Extract Category
      const catMatch = chunk.match(/(?:^|\n)\s*(?:Category(?:\s*Name)?)\s*:\s*([^\n\r]+)/i);
      if (catMatch) rawCategory = catMatch[1].trim();

      // Extract Front Stitch Count (e.g. "Front Stitch Count: 12500" or "- Front: 12,500 stitches" or "Front: 12500")
      const frontMatch = chunk.match(/(?:^|\n)\s*(?:Front\s*Stitch\s*Count|Stitch\s*Count\s*[-–—:]\s*Front|Front\s*Stitches?|[-*•]?\s*Front)\s*:\s*([^\n\r]+)/i);
      if (frontMatch) rawFrontStitch = frontMatch[1].trim();

      // Extract Back Stitch Count
      const backMatch = chunk.match(/(?:^|\n)\s*(?:Back\s*Stitch\s*Count|Stitch\s*Count\s*[-–—:]\s*Back|Back\s*Stitches?|[-*•]?\s*Back)\s*:\s*([^\n\r]+)/i);
      if (backMatch) rawBackStitch = backMatch[1].trim();

      // Extract Sleeve Stitch Count
      const sleeveMatch = chunk.match(/(?:^|\n)\s*(?:Sleeve\s*Stitch\s*Count|Stitch\s*Count\s*[-–—:]\s*Sleeve|Sleeve\s*Stitches?|[-*•]?\s*Sleeve)\s*:\s*([^\n\r]+)/i);
      if (sleeveMatch) rawSleeveStitch = sleeveMatch[1].trim();

      // Extract Description (everything after "Description:" until the end of entry)
      const descMatch = chunk.match(/(?:^|\n)\s*(?:Detailed\s*Description|Description|Details)\s*:\s*([\s\S]*)$/i);
      if (descMatch) {
        rawDescription = descMatch[1].trim();
      }

      parsedEntries.push({
        entryIndex: idx + 1,
        rawSku,
        rawName,
        rawCategory,
        rawFrontStitch,
        rawBackStitch,
        rawSleeveStitch,
        rawDescription
      });
    });

    if (parsedEntries.length === 0) {
      throw new Error('No structured design entries could be parsed from the text. Please follow the format:\nDesign Code: AED-BLO-01\nDesign Name: Rose Bloom\nFront Stitch Count: 12500\n...');
    }

    return parsedEntries;
  }

  /**
   * Builds the preview table comparing database values vs proposed values
   */
  async buildPreview(parsedEntries, clearFieldOption = false) {
    const { list, map: skuMap } = await Design.getAllMapBySku();
    const categories = await Category.getAll();

    // Auxiliary normalized maps for flexible matching
    const normSkuMap = new Map();
    const idMap = new Map();
    const titleMap = new Map();

    for (const d of (list || [])) {
      if (d.id) {
        idMap.set(String(d.id), d);
      }
      if (d.sku) {
        const sNorm = String(d.sku).replace(/[^a-z0-9]/gi, '').toLowerCase();
        const sCode = normalizeCodeKey(d.sku);
        if (!normSkuMap.has(sNorm)) normSkuMap.set(sNorm, d);
        if (!normSkuMap.has(sCode)) normSkuMap.set(sCode, d);
      }
      if (d.title) {
        const tNorm = String(d.title).replace(/[^a-z0-9]/gi, '').toLowerCase();
        const tCode = normalizeCodeKey(d.title);
        if (!titleMap.has(tNorm)) titleMap.set(tNorm, d);
        if (!titleMap.has(tCode)) titleMap.set(tCode, d);
      }
    }

    const items = [];
    let readyCount = 0;
    let noChangeCount = 0;
    let unmatchedCount = 0;
    let invalidCount = 0;

    for (const entry of parsedEntries) {
      const { entryIndex, rawSku, rawName, rawCategory, rawFrontStitch, rawBackStitch, rawSleeveStitch, rawDescription } = entry;

      const errors = [];
      const warnings = [];
      const changes = [];

      // 1. Check SKU presence
      if ((!rawSku || !rawSku.trim()) && (!rawName || !rawName.trim())) {
        errors.push('Missing Design Code / SKU or Design Name. A SKU or Name is required to match products.');
      }

      // 2. Lookup existing design in DB (Priority: Exact SKU -> Normalized SKU -> Product ID -> Title)
      const cleanSku = (rawSku || '').trim().toUpperCase();
      let existingDesign = cleanSku ? skuMap.get(cleanSku) : null;

      if (!existingDesign && rawSku) {
        const rawNorm = String(rawSku).replace(/[^a-z0-9]/gi, '').toLowerCase();
        const rawCode = normalizeCodeKey(rawSku);

        // 2b. Normalized alphanumeric SKU match
        existingDesign = normSkuMap.get(rawNorm) || normSkuMap.get(rawCode);

        // 2c. Product ID match (e.g. "1", "#1", "ID: 1")
        if (!existingDesign) {
          const digitsMatch = String(rawSku).match(/^(?:id[-_\s:]*)?(\d+)$/i) || String(rawSku).match(/^[\[#](\d+)[\]]?$/);
          if (digitsMatch) {
            existingDesign = idMap.get(digitsMatch[1]);
          }
        }

        // 2d. Exact/Normalized Title match using rawSku
        if (!existingDesign) {
          existingDesign = titleMap.get(rawNorm) || titleMap.get(rawCode);
        }

        // 2e. AED number prefix to ID fallback (e.g. "AED 1" -> ID 1)
        if (!existingDesign) {
          const aedNumMatch = String(rawSku).match(/^AED[\s\-_]*0*(\d+)$/i);
          if (aedNumMatch && idMap.has(aedNumMatch[1])) {
            existingDesign = idMap.get(aedNumMatch[1]);
          }
        }
      }

      // 2e. Fallback: match by rawName if SKU was missing or didn't match
      if (!existingDesign && rawName && !rawSku) {
        const nameNorm = String(rawName).replace(/[^a-z0-9]/gi, '').toLowerCase();
        const nameCode = normalizeCodeKey(rawName);
        existingDesign = titleMap.get(nameNorm) || titleMap.get(nameCode);
      }

      if (!existingDesign && rawSku) {
        errors.push(`SKU "${rawSku}" does not match any existing design in catalog.`);
      } else if (!existingDesign && rawName) {
        errors.push(`Design "${rawName}" does not match any existing design in catalog.`);
      }

      // Existing values snapshot
      const existing = existingDesign ? {
        id: existingDesign.id,
        sku: existingDesign.sku,
        title: existingDesign.title,
        category_id: existingDesign.category_id,
        category_name: existingDesign.category_name || 'Unassigned',
        stitch_count_front: existingDesign.stitch_count_front,
        stitch_count_back: existingDesign.stitch_count_back,
        stitch_count_sleeve: existingDesign.stitch_count_sleeve,
        description: existingDesign.description || ''
      } : {
        id: null,
        sku: rawSku,
        title: 'Unmatched',
        category_id: null,
        category_name: '—',
        stitch_count_front: null,
        stitch_count_back: null,
        stitch_count_sleeve: null,
        description: ''
      };

      const proposed = {
        title: existing.title,
        category_id: existing.category_id,
        category_name: existing.category_name,
        stitch_count_front: existing.stitch_count_front,
        stitch_count_back: existing.stitch_count_back,
        stitch_count_sleeve: existing.stitch_count_sleeve,
        description: existing.description
      };

      // 3. Process Design Name
      if (rawName !== undefined && rawName !== '') {
        if (this.isClearKeyword(rawName) || (clearFieldOption && rawName === '[CLEAR]')) {
          errors.push('Design Name cannot be cleared or set to empty.');
        } else if (rawName !== existing.title) {
          proposed.title = rawName;
          changes.push('Design Name');
        }
      }

      // 4. Process Category
      if (rawCategory !== undefined && rawCategory !== '') {
        if (this.isClearKeyword(rawCategory) || (clearFieldOption && rawCategory === '[CLEAR]')) {
          if (existing.category_id !== null) {
            proposed.category_id = null;
            proposed.category_name = 'Unassigned';
            changes.push('Category');
          }
        } else {
          const matchedCat = this.matchCategory(rawCategory, categories);
          if (!matchedCat) {
            warnings.push(`Category "${rawCategory}" does not exist in database.`);
          } else if (matchedCat.id !== existing.category_id) {
            proposed.category_id = matchedCat.id;
            proposed.category_name = matchedCat.name;
            changes.push('Category');
          }
        }
      }

      // 5. Process Front Stitch Count
      const frontRes = this.validateStitch(rawFrontStitch, 'Front Stitch Count');
      if (!frontRes.valid) {
        errors.push(frontRes.error);
      } else if (frontRes.value !== undefined) {
        const targetVal = frontRes.value;
        if (targetVal !== existing.stitch_count_front) {
          proposed.stitch_count_front = targetVal;
          changes.push('Front Stitch Count');
        }
      }

      // 6. Process Back Stitch Count
      const backRes = this.validateStitch(rawBackStitch, 'Back Stitch Count');
      if (!backRes.valid) {
        errors.push(backRes.error);
      } else if (backRes.value !== undefined) {
        const targetVal = backRes.value;
        if (targetVal !== existing.stitch_count_back) {
          proposed.stitch_count_back = targetVal;
          changes.push('Back Stitch Count');
        }
      }

      // 7. Process Sleeve Stitch Count
      const sleeveRes = this.validateStitch(rawSleeveStitch, 'Sleeve Stitch Count');
      if (!sleeveRes.valid) {
        errors.push(sleeveRes.error);
      } else if (sleeveRes.value !== undefined) {
        const targetVal = sleeveRes.value;
        if (targetVal !== existing.stitch_count_sleeve) {
          proposed.stitch_count_sleeve = targetVal;
          changes.push('Sleeve Stitch Count');
        }
      }

      // 8. Process Description
      if (rawDescription !== undefined && rawDescription !== '') {
        if (this.isClearKeyword(rawDescription) || (clearFieldOption && rawDescription === '[CLEAR]')) {
          if (existing.description) {
            proposed.description = null;
            changes.push('Description');
          }
        } else {
          const cleanDesc = String(rawDescription).trim();
          if (cleanDesc !== (existing.description || '').trim()) {
            proposed.description = cleanDesc;
            changes.push('Description');
          }
        }
      }

      // Calculate proposed Total Stitch Count (Front + Back + Sleeve)
      const effFront = proposed.stitch_count_front !== undefined ? proposed.stitch_count_front : existing.stitch_count_front;
      const effBack = proposed.stitch_count_back !== undefined ? proposed.stitch_count_back : existing.stitch_count_back;
      const effSleeve = proposed.stitch_count_sleeve !== undefined ? proposed.stitch_count_sleeve : existing.stitch_count_sleeve;
      if (effFront !== null && effFront !== undefined && effBack !== null && effBack !== undefined && effSleeve !== null && effSleeve !== undefined) {
        proposed.stitch_count = Number(effFront) + Number(effBack) + Number(effSleeve);
      } else {
        proposed.stitch_count = null;
      }

      // Determine Status
      let status = 'ready';
      if (errors.length > 0) {
        if (!existingDesign) {
          status = 'unmatched';
          unmatchedCount++;
        } else {
          status = 'invalid';
          invalidCount++;
        }
      } else if (changes.length === 0) {
        status = 'no_change';
        noChangeCount++;
      } else {
        status = 'ready';
        readyCount++;
      }

      items.push({
        rowNumber: entryIndex,
        sku: rawSku || '—',
        designId: existing.id,
        designTitle: existing.title,
        existing,
        proposed,
        changes,
        hasChanges: changes.length > 0,
        errors,
        warnings,
        status
      });
    }

    return {
      items,
      total: items.length,
      readyCount,
      noChangeCount,
      unmatchedCount,
      invalidCount,
      canConfirm: readyCount > 0
    };
  }

  /**
   * Executes confirmed updates safely
   */
  async applyBulkUpdate(items, req = null) {
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('No items provided for update confirmation.');
    }

    let updatedCount = 0;
    let skippedCount = 0;
    let unmatchedCount = 0;
    let failedCount = 0;
    const failedRows = [];

    for (const item of items) {
      // Only process valid rows that have changes and are matched
      if (item.status === 'unmatched') {
        unmatchedCount++;
        failedRows.push({
          row: item.rowNumber,
          sku: item.sku,
          reason: 'Unmatched: SKU does not exist in catalog.'
        });
        continue;
      }

      if (item.status === 'invalid' || (item.errors && item.errors.length > 0)) {
        failedCount++;
        failedRows.push({
          row: item.rowNumber,
          sku: item.sku,
          reason: `Validation Error: ${(item.errors || []).join('; ')}`
        });
        continue;
      }

      if (item.status === 'no_change' || !item.hasChanges || !item.changes || item.changes.length === 0) {
        skippedCount++;
        continue;
      }

      try {
        const updatePayload = {};
        if (item.changes.includes('Design Name') && item.proposed.title) {
          updatePayload.title = item.proposed.title;
        }
        if (item.changes.includes('Category')) {
          updatePayload.category_id = item.proposed.category_id;
        }
        if (item.changes.includes('Front Stitch Count')) {
          updatePayload.stitch_count_front = item.proposed.stitch_count_front;
        }
        if (item.changes.includes('Back Stitch Count')) {
          updatePayload.stitch_count_back = item.proposed.stitch_count_back;
        }
        if (item.changes.includes('Sleeve Stitch Count')) {
          updatePayload.stitch_count_sleeve = item.proposed.stitch_count_sleeve;
        }
        if (item.changes.includes('Description')) {
          updatePayload.description = item.proposed.description;
        }

        // Keep total stitch count synchronized when all three components exist
        const f = updatePayload.stitch_count_front !== undefined ? updatePayload.stitch_count_front : item.existing.stitch_count_front;
        const b = updatePayload.stitch_count_back !== undefined ? updatePayload.stitch_count_back : item.existing.stitch_count_back;
        const s = updatePayload.stitch_count_sleeve !== undefined ? updatePayload.stitch_count_sleeve : item.existing.stitch_count_sleeve;
        if (f !== null && f !== undefined && b !== null && b !== undefined && s !== null && s !== undefined) {
          updatePayload.stitch_count = Number(f) + Number(b) + Number(s);
        } else {
          updatePayload.stitch_count = null;
        }

        await Design.update(item.designId, updatePayload);
        updatedCount++;
      } catch (updateErr) {
        failedCount++;
        failedRows.push({
          row: item.rowNumber,
          sku: item.sku,
          reason: `Database error: ${updateErr.message}`
        });
      }
    }

    // Log Activity
    if (req && updatedCount > 0) {
      try {
        await ActivityLog.logFromReq(
          req,
          'bulk_details_update',
          'design',
          null,
          `Bulk updated details for ${updatedCount} design(s). Skipped: ${skippedCount}, Unmatched: ${unmatchedCount}, Failed: ${failedCount}.`
        );
      } catch (logErr) {
        console.warn('[ActivityLog Error in bulk details]:', logErr.message);
      }
    }

    return {
      success: true,
      updatedCount,
      skippedCount,
      unmatchedCount,
      failedCount,
      failedRows
    };
  }

  /**
   * Generates downloadable CSV / Excel Error Report for failed rows
   */
  generateErrorReport(failedRows) {
    const reportData = (failedRows || []).map(r => ({
      'Row Number': r.row || '—',
      'Design Code / SKU': r.sku || '—',
      'Failure Reason': r.reason || 'Unknown error'
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(reportData.length > 0 ? reportData : [{ 'Message': 'No failed rows. All records processed cleanly.' }]);
    ws['!cols'] = [{ wch: 15 }, { wch: 25 }, { wch: 70 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Failed Rows Report');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }
}

module.exports = new BulkDesignDetailsService();
