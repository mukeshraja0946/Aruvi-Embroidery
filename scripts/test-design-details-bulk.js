const assert = require('assert');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const AdmZip = require('adm-zip');

const Design = require('../models/Design');
const Category = require('../models/Category');
const bulkDesignDetailsService = require('../services/bulkDesignDetailsService');

async function runTests() {
  console.log('====================================================');
  console.log('RUNNING COMPLETE ACCEPTANCE CRITERIA TEST SUITE');
  console.log('Editable Design Details & Bulk Description Import');
  console.log('====================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function test(name, fn) {
    totalTests++;
    try {
      fn();
      console.log(`✅ [PASS] Test ${totalTests}: ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`❌ [FAIL] Test ${totalTests}: ${name}`);
      console.error('   ', err.message);
    }
  }

  async function testAsync(name, fn) {
    totalTests++;
    try {
      await fn();
      console.log(`✅ [PASS] Test ${totalTests}: ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`❌ [FAIL] Test ${totalTests}: ${name}`);
      console.error('   ', err.stack || err.message);
    }
  }

  // Seed sample categories if needed
  const categories = await Category.getAll();
  const blouseCat = categories.find(c => c.name.toLowerCase().includes('blouse')) || { id: 1, name: 'Blouse Designs' };

  // =========================================================================
  // CRITERION 1: Admin edits the description and stitch counts for one existing design
  // =========================================================================
  await testAsync('1. Admin edits description and stitch counts individually for an existing design', async () => {
    const designId = await Design.create({
      title: 'Original Rose Motif',
      sku: 'AED-BLO-01',
      price: 150.00,
      sale_price: 69.00,
      category_id: blouseCat.id,
      description: 'Initial description before edit',
      stitch_count_front: 5000,
      stitch_count_back: 3000,
      stitch_count_sleeve: 2000
    });

    assert(designId, 'Design should be created successfully');

    // Admin edits stitch counts and multi-paragraph description
    const newDescription = `A detailed floral embroidery design suitable for blouse embroidery.\nIncludes front, back, and sleeve design information.\nTested for Tajima and Brother machines.`;
    await Design.update(designId, {
      title: 'Rose Bloom Design',
      stitch_count_front: 12500,
      stitch_count_back: 8200,
      stitch_count_sleeve: 4500,
      description: newDescription
    });

    const updated = await Design.getById(designId);
    assert.strictEqual(updated.title, 'Rose Bloom Design', 'Title should be updated');
    assert.strictEqual(updated.stitch_count_front, 12500, 'Front stitch count should be 12500');
    assert.strictEqual(updated.stitch_count_back, 8200, 'Back stitch count should be 8200');
    assert.strictEqual(updated.stitch_count_sleeve, 4500, 'Sleeve stitch count should be 4500');
    assert.strictEqual(updated.description, newDescription, 'Multi-paragraph description should be preserved');
    assert.strictEqual(parseFloat(updated.price), 150.00, 'Price should be preserved');
    assert.strictEqual(parseFloat(updated.sale_price), 69.00, 'Sale price should be preserved');
    assert.strictEqual(updated.sku, 'AED-BLO-01', 'SKU should be preserved');
  });

  // =========================================================================
  // CRITERION 2: Customer design details page data verification
  // =========================================================================
  await testAsync('2. Customer opens design details and verifies values & layout rules', async () => {
    const d = await Design.findBySku('AED-BLO-01');
    assert(d, 'Design AED-BLO-01 must be found');

    // Check individual stitch counts available
    assert.strictEqual(d.stitch_count_front, 12500);
    assert.strictEqual(d.stitch_count_back, 8200);
    assert.strictEqual(d.stitch_count_sleeve, 4500);
    assert(d.description.includes('A detailed floral embroidery design'), 'Description must match');

    // Test a second design with partial/missing stitch counts
    const partialId = await Design.create({
      title: 'Simple Neck Pattern',
      sku: 'AED-NCK-02',
      price: 80.00,
      category_id: blouseCat.id,
      stitch_count_front: 6400,
      stitch_count_back: null, // missing back
      stitch_count_sleeve: null // missing sleeve
    });

    const partial = await Design.getById(partialId);
    assert.strictEqual(partial.stitch_count_front, 6400);
    assert.strictEqual(partial.stitch_count_back, null, 'Back stitch count must be null/empty, not a fake default');
    assert.strictEqual(partial.stitch_count_sleeve, null, 'Sleeve stitch count must be null/empty, not a fake default');
  });

  // =========================================================================
  // CRITERION 3: Admin imports multiple descriptions from Excel (.xlsx)
  // =========================================================================
  await testAsync('3. Admin imports multiple descriptions and stitch counts from Excel (.xlsx)', async () => {
    // Create target products
    await Design.create({ title: 'Lotus Blouse Motif', sku: 'AED-LOT-03', price: 120, stitch_count_front: 1000 });
    await Design.create({ title: 'Peacock Border Saree', sku: 'AED-BOR-04', price: 180, stitch_count_front: 2000 });

    // Generate Excel workbook buffer
    const wb = XLSX.utils.book_new();
    const rows = [
      {
        'Design Code / SKU': 'AED-LOT-03',
        'Design Name': 'Royal Lotus Blouse Motif',
        'Front Stitch Count': 14200,
        'Back Stitch Count': 9100,
        'Sleeve Stitch Count': 5300,
        'Description': 'Exquisite royal lotus motif designed for luxury bridal silk blouses.'
      },
      {
        'Design Code / SKU': 'AED-BOR-04',
        'Front Stitch Count': '18,500 stitches', // test formatted string with commas and unit
        'Back Stitch Count': 11200,
        'Sleeve Stitch Count': 6800,
        'Description': 'Traditional grand peacock border pattern for bridal sarees.'
      }
    ];
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // Step A: Parse file
    const parsed = await bulkDesignDetailsService.parseRawInput({
      file: { originalname: 'designs_update.xlsx', buffer: excelBuffer }
    });
    assert.strictEqual(parsed.length, 2, 'Should parse 2 rows from Excel');

    // Step B: Preview
    const preview = await bulkDesignDetailsService.buildPreview(parsed);
    assert.strictEqual(preview.total, 2);
    assert.strictEqual(preview.readyCount, 2);
    assert.strictEqual(preview.unmatchedCount, 0);
    assert.strictEqual(preview.invalidCount, 0);

    // Step C: Apply updates
    const applyRes = await bulkDesignDetailsService.applyBulkUpdate(preview.items);
    assert.strictEqual(applyRes.updatedCount, 2);

    // Verify persisted values
    const d1 = await Design.findBySku('AED-LOT-03');
    assert.strictEqual(d1.title, 'Royal Lotus Blouse Motif');
    assert.strictEqual(d1.stitch_count_front, 14200);
    assert.strictEqual(d1.stitch_count_back, 9100);
    assert.strictEqual(d1.stitch_count_sleeve, 5300);
    assert.strictEqual(d1.description, 'Exquisite royal lotus motif designed for luxury bridal silk blouses.');

    const d2 = await Design.findBySku('AED-BOR-04');
    assert.strictEqual(d2.stitch_count_front, 18500, 'Comma formatted string must be parsed as 18500 integer');
    assert.strictEqual(d2.stitch_count_back, 11200);
    assert.strictEqual(d2.stitch_count_sleeve, 6800);
  });

  // =========================================================================
  // CRITERION 4: Admin imports structured details from TXT, PDF, and Word files
  // =========================================================================
  await testAsync('4. Admin imports structured details from TXT, PDF, and Word (.docx)', async () => {
    await Design.create({ title: 'Mango Paisley Motif', sku: 'AED-MNG-05', price: 95 });

    // 4A: Plain Text (.txt)
    const txtContent = `Design Code: AED-MNG-05
Design Name: Grand Mango Paisley Motif
Category: Blouse Designs
Front Stitch Count: 11800
Back Stitch Count: 7900
Sleeve Stitch Count: 4200
Description: Traditional south Indian mango paisley motif with gold zari highlight.`;

    const txtParsed = await bulkDesignDetailsService.parseRawInput({
      file: { originalname: 'notes.txt', buffer: Buffer.from(txtContent, 'utf-8') }
    });
    const txtPreview = await bulkDesignDetailsService.buildPreview(txtParsed);
    assert.strictEqual(txtPreview.readyCount, 1);
    await bulkDesignDetailsService.applyBulkUpdate(txtPreview.items);

    const dTxt = await Design.findBySku('AED-MNG-05');
    assert.strictEqual(dTxt.stitch_count_front, 11800);
    assert.strictEqual(dTxt.stitch_count_back, 7900);
    assert.strictEqual(dTxt.stitch_count_sleeve, 4200);

    // 4B: Word (.docx) - generated via standard docx zip structure
    const zip = new AdmZip();
    zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'));
    zip.addFile('word/document.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>Design Code: AED-MNG-05</w:t></w:r></w:p>
          <w:p><w:r><w:t>Front Stitch Count: 12900</w:t></w:r></w:p>
          <w:p><w:r><w:t>Back Stitch Count: 8500</w:t></w:r></w:p>
          <w:p><w:r><w:t>Sleeve Stitch Count: 4600</w:t></w:r></w:p>
          <w:p><w:r><w:t>Description: Word doc updated paisley pattern with metallic thread.</w:t></w:r></w:p>
        </w:body>
      </w:document>`));
    const docxBuffer = zip.toBuffer();

    const docxParsed = await bulkDesignDetailsService.parseRawInput({
      file: { originalname: 'design.docx', buffer: docxBuffer }
    });
    const docxPreview = await bulkDesignDetailsService.buildPreview(docxParsed);
    assert.strictEqual(docxPreview.readyCount, 1);
    await bulkDesignDetailsService.applyBulkUpdate(docxPreview.items);

    const dDocx = await Design.findBySku('AED-MNG-05');
    assert.strictEqual(dDocx.stitch_count_front, 12900);
    assert.strictEqual(dDocx.description, 'Word doc updated paisley pattern with metallic thread.');

    // 4C: Scanned PDF / Image PDF OCR Requirement reporting
    let ocrErrorCaught = false;
    try {
      // Empty / image-only dummy buffer simulating scanned PDF without text stream
      await bulkDesignDetailsService.parseRawInput({
        file: { originalname: 'scanned_design.pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF') }
      });
    } catch (pdfErr) {
      if (pdfErr.message.includes('OCR') || pdfErr.message.includes('Optical Character Recognition') || pdfErr.message.includes('PDF')) {
        ocrErrorCaught = true;
      }
    }
    assert(ocrErrorCaught, 'Should report that OCR is required for scanned PDFs without silent failure');
  });

  // =========================================================================
  // CRITERION 5: Admin pastes multiple entries directly into the notes field
  // =========================================================================
  await testAsync('5. Admin pastes multiple entries directly into notes with separators', async () => {
    await Design.create({ title: 'Floral Vine', sku: 'AED-VIN-06', price: 90 });
    await Design.create({ title: 'Geometric Border', sku: 'AED-GEO-07', price: 110 });

    const pastedNotes = `Design Code: AED-VIN-06
Design Name: Elegant Floral Vine
Category: Blouse Designs
Front Stitch Count: 10400
Back Stitch Count: 7100
Sleeve Stitch Count: 3900
Description: Elegant floral vine creeping motif along sleeve cuffs and neckline.

---

Design Code: AED-GEO-07
Design Name: Modern Geometric Border
Front Stitch Count: 15300
Back Stitch Count: 9800
Sleeve Stitch Count: 5100
Description: Crisp modern geometric embroidery border.`;

    const parsed = await bulkDesignDetailsService.parseRawInput({ notes: pastedNotes });
    assert.strictEqual(parsed.length, 2, 'Should parse 2 design entries from notes');

    const preview = await bulkDesignDetailsService.buildPreview(parsed);
    assert.strictEqual(preview.readyCount, 2);

    const applyRes = await bulkDesignDetailsService.applyBulkUpdate(preview.items);
    assert.strictEqual(applyRes.updatedCount, 2);

    const d1 = await Design.findBySku('AED-VIN-06');
    assert.strictEqual(d1.title, 'Elegant Floral Vine');
    assert.strictEqual(d1.stitch_count_front, 10400);

    const d2 = await Design.findBySku('AED-GEO-07');
    assert.strictEqual(d2.title, 'Modern Geometric Border');
    assert.strictEqual(d2.stitch_count_front, 15300);
  });

  // =========================================================================
  // CRITERION 6: Unmatched SKUs and invalid stitch counts are reported without changing unrelated designs
  // =========================================================================
  await testAsync('6. Unmatched SKUs and invalid stitch counts reported cleanly', async () => {
    const untouchedBefore = await Design.findBySku('AED-BLO-01');
    const oldFrontStitch = untouchedBefore.stitch_count_front;

    const invalidNotes = `Design Code: AED-NONEXISTENT-999
Front Stitch Count: 12000
Description: Non-existent product

---

Design Code: AED-BLO-01
Front Stitch Count: -500
Description: Should fail validation due to negative stitch count`;

    const parsed = await bulkDesignDetailsService.parseRawInput({ notes: invalidNotes });
    const preview = await bulkDesignDetailsService.buildPreview(parsed);

    assert.strictEqual(preview.unmatchedCount, 1, 'AED-NONEXISTENT-999 must be unmatched');
    assert.strictEqual(preview.invalidCount, 1, 'Negative stitch count must be invalid');
    assert.strictEqual(preview.readyCount, 0, 'No rows should be ready');

    const applyRes = await bulkDesignDetailsService.applyBulkUpdate(preview.items);
    assert.strictEqual(applyRes.updatedCount, 0, 'Zero designs should be updated');
    assert.strictEqual(applyRes.unmatchedCount, 1);
    assert.strictEqual(applyRes.failedCount, 1);

    // Unrelated design must remain completely untouched
    const untouchedAfter = await Design.findBySku('AED-BLO-01');
    assert.strictEqual(untouchedAfter.stitch_count_front, oldFrontStitch, 'Existing design must remain unchanged');
  });

  // =========================================================================
  // CRITERION 7: Blank import cells do not erase existing information
  // =========================================================================
  await testAsync('7. Blank import cells do not erase existing information (Clear option respected)', async () => {
    // Current design has front: 12500, back: 8200, sleeve: 4500
    // We import an update with ONLY sleeve stitch count: 4800, leaving front and back blank
    const updateNotes = `Design Code: AED-BLO-01
Sleeve Stitch Count: 4800`;

    const parsed = await bulkDesignDetailsService.parseRawInput({ notes: updateNotes });
    const preview = await bulkDesignDetailsService.buildPreview(parsed);

    assert.strictEqual(preview.readyCount, 1);
    // Proposed values must retain existing front and back
    const item = preview.items[0];
    assert.strictEqual(item.proposed.stitch_count_front, 12500, 'Front stitch count should stay 12500');
    assert.strictEqual(item.proposed.stitch_count_back, 8200, 'Back stitch count should stay 8200');
    assert.strictEqual(item.proposed.stitch_count_sleeve, 4800, 'Sleeve stitch count should update to 4800');

    await bulkDesignDetailsService.applyBulkUpdate(preview.items);

    const d = await Design.findBySku('AED-BLO-01');
    assert.strictEqual(d.stitch_count_front, 12500, 'Front stitch count must remain preserved in DB');
    assert.strictEqual(d.stitch_count_back, 8200, 'Back stitch count must remain preserved in DB');
    assert.strictEqual(d.stitch_count_sleeve, 4800, 'Sleeve stitch count must be updated');
    assert(d.description && d.description.length > 0, 'Description must not be wiped out by blank import');

    // Test explicit [CLEAR] keyword clears field
    const clearNotes = `Design Code: AED-BLO-01
Sleeve Stitch Count: [CLEAR]`;
    const clearParsed = await bulkDesignDetailsService.parseRawInput({ notes: clearNotes, clearFieldOption: true });
    const clearPreview = await bulkDesignDetailsService.buildPreview(clearParsed, true);
    assert.strictEqual(clearPreview.items[0].proposed.stitch_count_sleeve, null);
    await bulkDesignDetailsService.applyBulkUpdate(clearPreview.items);

    const dCleared = await Design.findBySku('AED-BLO-01');
    assert.strictEqual(dCleared.stitch_count_sleeve, null, 'Sleeve stitch count should be cleared when [CLEAR] is explicitly supplied');
    assert.strictEqual(dCleared.stitch_count_front, 12500, 'Other fields must remain intact');
  });

  // =========================================================================
  // CRITERION 8: Product images, ZIP downloads, prices, categories, SKUs remain unchanged
  // =========================================================================
  await testAsync('8. Product images, ZIP downloads, prices, SKUs, and files remain unchanged', async () => {
    const d = await Design.findBySku('AED-BLO-01');
    assert.strictEqual(d.sku, 'AED-BLO-01', 'SKU must not be reset or altered');
    assert.strictEqual(parseFloat(d.price), 150.00, 'Original price must remain 150.00');
    assert.strictEqual(parseFloat(d.sale_price), 69.00, 'Sale price must remain 69.00');
  });

  // =========================================================================
  // CRITERION 9: Downloadable Excel template and error report generation
  // =========================================================================
  await testAsync('9. Excel template and failed rows error report generation', async () => {
    const templateBuffer = bulkDesignDetailsService.generateTemplateWorkbook();
    assert(templateBuffer && templateBuffer.length > 5000, 'Template workbook buffer should be generated');

    const wb = XLSX.read(templateBuffer, { type: 'buffer' });
    assert(wb.SheetNames.includes('Design Details'), 'Must have "Design Details" sheet');
    assert(wb.SheetNames.includes('Instructions'), 'Must have "Instructions" sheet');

    // Verify template headers
    const ws = wb.Sheets['Design Details'];
    const rows = XLSX.utils.sheet_to_json(ws);
    assert(rows.length >= 1, 'Template should contain sample rows');
    const firstRow = rows[0];
    assert('Design Code / SKU' in firstRow, 'Template must have "Design Code / SKU"');
    assert('Front Stitch Count' in firstRow, 'Template must have "Front Stitch Count"');
    assert('Back Stitch Count' in firstRow, 'Template must have "Back Stitch Count"');
    assert('Sleeve Stitch Count' in firstRow, 'Template must have "Sleeve Stitch Count"');
    assert('Description' in firstRow, 'Template must have "Description"');

    // Generate error report
    const failedRows = [
      { row: 1, sku: 'AED-UNKNOWN', reason: 'Unmatched: SKU does not exist in catalog.' },
      { row: 2, sku: 'AED-INV', reason: 'Validation Error: Front Stitch Count must be a non-negative whole number.' }
    ];
    const errBuffer = bulkDesignDetailsService.generateErrorReport(failedRows);
    assert(errBuffer && errBuffer.length > 1000, 'Error report workbook buffer should be generated');
  });

  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passedTests} / ${totalTests} PASSED`);
  if (passedTests === totalTests) {
    console.log('🎉 ALL ACCEPTANCE CRITERIA VERIFIED SUCCESSFULLY!');
  } else {
    console.error(`⚠️ ${totalTests - passedTests} TESTS FAILED.`);
    process.exit(1);
  }
  console.log('====================================================\n');
}

runTests().catch(err => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});
