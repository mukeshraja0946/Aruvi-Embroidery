const storageService = require('../services/storageService');

module.exports = {
  initStorage: () => storageService.initStorageDirs(),
  validateStorageConfiguration: () => storageService.validateStorageConfiguration(),
  getUploadsDir: () => storageService.getUploadsDir(),
  getPrivateUploadsDir: () => storageService.getPrivateUploadsDir(),
  getPreviewsDir: () => storageService.getPreviewsDir(),
  getDesignsDir: () => storageService.getDesignsDir(),
  resolveFilePath: (filePath, returnTargetIfMissing = false) => storageService.resolveFilePath(filePath, returnTargetIfMissing),
  fileExists: (filePath) => storageService.fileExists(filePath),
  fileExistsAsync: (filePath) => storageService.fileExistsAsync(filePath),
  resolveBrandAsset: (type, candidateUrl) => storageService.resolveBrandAsset(type, candidateUrl),
  getWebPath: (filename, type = 'previews') => `/public/uploads/${type}/${require('path').basename(filename)}`,
  defaultUploadsDir: require('path').join(__dirname, '../public/uploads'),
  getStorageDriver: () => storageService.getDriver(),
  uploadToCloudinary: (filePath, customPublicId) => storageService.uploadToCloudinary(filePath, customPublicId),
  uploadToS3OrR2: (filePath, destFilename) => storageService.savePrivateFile(filePath, destFilename),
  savePublicFile: (file, originalName, mimeType) => storageService.savePublicFile(file, originalName, mimeType),
  savePrivateFile: (file, originalName, mimeType, designId = null) => storageService.savePrivateFile(file, originalName, mimeType, designId),
  getThumbsDir: () => storageService.getThumbsDir(),
  buildPublicUrl: (keyOrPath) => storageService.buildPublicUrl(keyOrPath),
  buildThumbnailUrl: (keyOrPath) => storageService.buildThumbnailUrl(keyOrPath),
  generateThumbnail: (source, filename) => storageService.generateThumbnail(source, filename),
  storageService
};
