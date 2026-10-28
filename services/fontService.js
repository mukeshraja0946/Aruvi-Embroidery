const fs = require('fs');
const path = require('path');

const FONTS_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const PUBLIC_FONTS_DIR = path.join(__dirname, '..', 'public', 'assets', 'fonts');

const fontPaths = {
  poppinsRegular: path.join(FONTS_DIR, 'Poppins-Regular.ttf'),
  poppinsBold: path.join(FONTS_DIR, 'Poppins-Bold.ttf'),
  liberationRegular: path.join(FONTS_DIR, 'LiberationSans-Regular.ttf'),
  liberationBold: path.join(FONTS_DIR, 'LiberationSans-Bold.ttf')
};

const fontBase64Cache = new Map();

class FontService {
  getFontPath(fontName) {
    if (fontPaths[fontName] && fs.existsSync(fontPaths[fontName])) {
      return fontPaths[fontName];
    }
    const publicCandidate = path.join(PUBLIC_FONTS_DIR, `${fontName}.ttf`);
    if (fs.existsSync(publicCandidate)) return publicCandidate;
    const directCandidate = path.join(FONTS_DIR, `${fontName}.ttf`);
    if (fs.existsSync(directCandidate)) return directCandidate;
    return null;
  }

  getFontBuffer(fontName) {
    const p = this.getFontPath(fontName);
    if (!p) return null;
    return fs.readFileSync(p);
  }

  getFontBase64(fontName) {
    if (fontBase64Cache.has(fontName)) {
      return fontBase64Cache.get(fontName);
    }
    const buf = this.getFontBuffer(fontName);
    if (!buf) return '';
    const b64 = buf.toString('base64');
    fontBase64Cache.set(fontName, b64);
    return b64;
  }

  /**
   * Generates SVG <style> block with embedded @font-face definition.
   * Enables librsvg on server environments (like Hostinger) to render
   * exact font glyphs without requiring OS-level font installations.
   */
  getSvgFontFaces() {
    const poppinsRegB64 = this.getFontBase64('poppinsRegular');
    const poppinsBoldB64 = this.getFontBase64('poppinsBold');
    let styles = '';
    if (poppinsRegB64) {
      styles += `
        @font-face {
          font-family: 'Poppins';
          font-weight: 400;
          font-style: normal;
          src: url('data:font/truetype;charset=utf-8;base64,${poppinsRegB64}') format('truetype');
        }
      `;
    }
    if (poppinsBoldB64) {
      styles += `
        @font-face {
          font-family: 'Poppins';
          font-weight: 700;
          font-style: normal;
          src: url('data:font/truetype;charset=utf-8;base64,${poppinsBoldB64}') format('truetype');
        }
      `;
    }
    return styles;
  }
}

module.exports = new FontService();
