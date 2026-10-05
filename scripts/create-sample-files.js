const fs = require('fs');
const path = require('path');

const sampleFiles = [
  'sample_peacock.zip',
  'sample_ganesha.zip',
  'sample_lotus.zip',
  'sample_elephant.zip',
  'sample_floral.zip',
  'sample_radha.zip'
];

const uploadDir = path.join(__dirname, '../public/uploads/designs');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

sampleFiles.forEach(file => {
  const filePath = path.join(uploadDir, file);
  if (!fs.existsSync(filePath)) {
    // Write a small dummy file simulating a ZIP package containing DST, PES, JEF files
    const dummyContent = Buffer.from(`PK\x03\x04 Aruvi Embroidery Digital Design Package - ${file}\nDST, PES, JEF, EXP formats included.`);
    fs.writeFileSync(filePath, dummyContent);
    console.log(`Created sample design file: ${file}`);
  }
});

const previewDir = path.join(__dirname, '../public/uploads/previews');
if (!fs.existsSync(previewDir)) {
  fs.mkdirSync(previewDir, { recursive: true });
}

// Copy logo as default preview images if not present
const logoPath = path.join(__dirname, '../public/images/logo.jpg');
if (fs.existsSync(logoPath)) {
  for (let i = 1; i <= 6; i++) {
    const previewPath = path.join(previewDir, `preview_${i}.jpg`);
    if (!fs.existsSync(previewPath)) {
      fs.copyFileSync(logoPath, previewPath);
    }
  }
}
console.log('Sample design files and previews ready.');
