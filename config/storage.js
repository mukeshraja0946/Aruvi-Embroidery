const storageService = require('../services/storageService');

const storageFacade = {
  initStorage: () => storageService.initStorageDirs(),
  initStorageDirs: () => storageService.initStorageDirs(),
  validateStorageConfiguration: () => storageService.validateStorageConfiguration(),
  getStorageStatus: () => storageService.getStorageStatus(),
  isUploadBlocked: () => storageService.isUploadBlocked(),
  isPathInsideRepoOrHbuilds: (targetPath) => storageService.isPathInsideRepoOrHbuilds(targetPath),
  resetLocationCache: () => storageService.resetLocationCache(),
  getUploadsDir: () => storageService.getUploadsDir(),
  getPublicDir: () => storageService.getPublicDir(),
  getPrivateDir: () => storageService.getPrivateDir(),
  getPrivateUploadsDir: () => storageService.getPrivateDir(),
  getPreviewsDir: () => storageService.getPreviewsDir(),
  getCardsDir: () => storageService.getCardsDir(),
  getThumbsDir: () => storageService.getThumbsDir(),
  getBrandingDir: () => storageService.getBrandingDir(),
  getBannersDir: () => storageService.getBannersDir(),
  getCategoriesDir: () => storageService.getCategoriesDir(),
  getDesignsDir: () => storageService.getDesignsDir(),
  getOriginalsDir: () => storageService.getOriginalsDir(),
  getCustomRequestsDir: () => storageService.getCustomRequestsDir(),
  getBackupsDir: () => storageService.getBackupsDir(),
  getMimeType: (filename) => storageService.getMimeType(filename),
  retireFile: (fileUrl) => storageService.retireFile(fileUrl),
  resolveFilePath: (filePath, returnTargetIfMissing = false) => storageService.resolveFilePath(filePath, returnTargetIfMissing),
  fileExists: (filePath) => storageService.fileExists(filePath),
  fileExistsAsync: (filePath) => storageService.fileExistsAsync(filePath),
  resolveBrandAsset: (type, candidateUrl) => storageService.resolveBrandAsset(type, candidateUrl),
  getWebPath: (filename, type = 'previews') => `/public/uploads/${type}/${require('path').basename(filename)}`,
  defaultUploadsDir: require('path').join(__dirname, '../public/uploads'),
  getStorageDriver: () => storageService.getDriver(),
  getDriver: () => storageService.getDriver(),
  uploadToCloudinary: (filePath, customPublicId) => storageService.uploadToCloudinary(filePath, customPublicId),
  uploadToS3OrR2: (filePath, destFilename) => storageService.savePrivateFile(filePath, destFilename),
  savePublicFile: (file, originalName, mimeType, subFolder = 'previews') => storageService.savePublicFile(file, originalName, mimeType, subFolder),
  saveBrandingFile: (file, originalName, mimeType) => storageService.saveBrandingFile(file, originalName, mimeType),
  saveCustomRequestFile: (file, originalName, mimeType) => storageService.saveCustomRequestFile(file, originalName, mimeType),
  savePrivateFile: (file, originalName, mimeType, designId = null) => storageService.savePrivateFile(file, originalName, mimeType, designId),
  saveOriginalFile: (file, originalName, mimeType) => storageService.saveOriginalFile(file, originalName, mimeType),
  serveOriginalFile: (res, filePath, customFilename = null, explicitMime = null) => storageService.serveOriginalFile(res, filePath, customFilename, explicitMime),
  detectImageMime: (filePath) => storageService.detectImageMime(filePath),
  buildPublicUrl: (keyOrPath) => storageService.buildPublicUrl(keyOrPath),
  buildThumbnailUrl: (keyOrPath) => storageService.buildThumbnailUrl(keyOrPath),
  generateThumbnail: (source, filename) => storageService.generateThumbnail(source, filename),
  storageService
};

// Resilient Proxy: guarantees any method on storageService is directly callable via config/storage
module.exports = new Proxy(storageFacade, {
  get(target, prop, receiver) {
    if (prop in target) {
      return Reflect.get(target, prop, receiver);
    }
    if (typeof storageService[prop] === 'function') {
      return storageService[prop].bind(storageService);
    }
    return storageService[prop];
  }
});
