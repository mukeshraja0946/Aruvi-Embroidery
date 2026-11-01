/**
 * Safe Image Processor Helper (Sharp wrapper)
 * 
 * Hostinger Business Plan Memory & Process Protections:
 * 1. Lazy loading inside try/catch so native module failure never crashes the server on boot.
 * 2. sharp.cache(false) - disables libvips internal memory buffer cache.
 * 3. sharp.concurrency(1) - restricts CPU threads to 1 to prevent hitting host CPU/RAM throttling.
 * 4. Graceful fallback when sharp is unavailable.
 */

let sharpInstance = null;
let sharpAvailable = null;
let sharpLoadError = null;

function getSharp() {
  if (sharpAvailable === false) {
    return null;
  }
  if (sharpInstance) {
    return sharpInstance;
  }

  try {
    const sharp = require('sharp');
    // Disable libvips memory buffer caching (critical for 512MB RAM Hostinger limits)
    sharp.cache(false);
    // Limit concurrency to 1 thread to prevent thread explosion under load
    sharp.concurrency(1);

    sharpInstance = sharp;
    sharpAvailable = true;
    return sharpInstance;
  } catch (err) {
    sharpAvailable = false;
    sharpLoadError = err.message;
    console.warn(`[ImageProcessor Warning] Native 'sharp' module is unavailable (${err.message}). Image processing will operate in fallback mode.`);
    return null;
  }
}

function isSharpAvailable() {
  if (sharpAvailable === null) {
    getSharp();
  }
  return sharpAvailable === true;
}

function getSharpStatus() {
  const available = isSharpAvailable();
  return {
    available,
    mode: available ? 'Native (libvips)' : 'Fallback (raw passthrough)',
    error: sharpLoadError,
    cacheDisabled: true,
    concurrency: 1
  };
}

module.exports = {
  getSharp,
  isSharpAvailable,
  getSharpStatus
};
