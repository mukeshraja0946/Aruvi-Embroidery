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

const AdmZip = require('adm-zip');

sampleFiles.forEach(file => {
  const filePath = path.join(uploadDir, file);
  // Create or overwrite sample files to ensure valid ZIP structure
  try {
    const zip = new AdmZip();
    const baseName = file.replace('.zip', '');
    zip.addFile(`${baseName}.dst`, Buffer.from(`ARUVI EMBROIDERY DST MACHINE FILE DATA - ${file}`));
    zip.addFile(`${baseName}.pes`, Buffer.from(`ARUVI EMBROIDERY PES MACHINE FILE DATA - ${file}`));
    zip.addFile(`${baseName}.jef`, Buffer.from(`ARUVI EMBROIDERY JEF MACHINE FILE DATA - ${file}`));
    zip.addFile(`${baseName}.exp`, Buffer.from(`ARUVI EMBROIDERY EXP MACHINE FILE DATA - ${file}`));
    zip.writeZip(filePath);
    console.log(`Created valid binary ZIP package: ${file}`);
  } catch (e) {
    console.error(`Error creating sample zip ${file}:`, e.message);
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
