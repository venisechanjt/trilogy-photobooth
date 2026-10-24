// Printing: builds the 4x6in PDFs and sends them to the computer's printer. Used by the booth (server.js)
// and by "npm run print-check".
require('dotenv').config();

const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const PDFDocument = require('pdfkit');

const execFileP = promisify(execFile);
// CUPS media name used on macOS / Linux. 4x6in = 288x432pt
const PRINT_MEDIA = process.env.PRINT_MEDIA || 'w288h432';

// Builds a 4x6in PDF with the image filling the page (rotated if it is landscape).
function buildPdf(imageBuffer, filePath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [288, 432], margin: 0, autoFirstPage: false });
    const out = fs.createWriteStream(filePath);
    doc.pipe(out);
    const img = doc.openImage(imageBuffer);
    const landscape = img.width > img.height;
    doc.addPage({ size: [288, 432], margin: 0, layout: landscape ? 'landscape' : 'portrait' });
    const pageW = landscape ? 432 : 288;
    const pageH = landscape ? 288 : 432;
    doc.image(img, 0, 0, { width: pageW, height: pageH });
    doc.end();
    out.on('finish', resolve);
    out.on('error', reject);
  });
}

async function listPrinters() {
  if (process.platform === 'win32') {
    const { getPrinters, getDefaultPrinter } = require('pdf-to-printer');
    const [printers, def] = await Promise.all([getPrinters(), getDefaultPrinter().catch(() => null)]);
    return { printers: printers.map((p) => p.name), default: def ? def.name : null };
  }
  const [{ stdout: list }, def] = await Promise.all([
    execFileP('lpstat', ['-e']).catch(() => ({ stdout: '' })),
    execFileP('lpstat', ['-d']).catch(() => ({ stdout: '' })),
  ]);
  const printers = list.split('\n').map((s) => s.trim()).filter(Boolean);
  const defMatch = /:\s*(\S+)\s*$/.exec(def.stdout.trim());
  return { printers, default: defMatch ? defMatch[1] : null };
}

// Gives up after a minute so a switched-off or stuck printer can't freeze the booth.
function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)))]).finally(() =>
    clearTimeout(timer)
  );
}

async function sendToPrinter(pdfPath, copies, printer) {
  const timeoutMsg = 'The printer didn’t respond within a minute. Check that it’s on, has paper, and is the right printer in ⚙️ settings.';
  console.log(`Printing ${copies} cop${copies === 1 ? 'y' : 'ies'} on ${printer || 'the default printer'}: ${pdfPath}`);
  if (process.platform === 'win32') {
    const { print } = require('pdf-to-printer');
    await withTimeout(print(pdfPath, { printer: printer || undefined, copies, scale: 'fit' }), 60000, timeoutMsg);
    return;
  }
  const args = ['-n', String(copies), '-o', 'fit-to-page'];
  if (PRINT_MEDIA) args.push('-o', `media=${PRINT_MEDIA}`);
  if (printer) args.push('-d', printer);
  args.push(pdfPath);
  try {
    await withTimeout(execFileP('lp', args), 60000, timeoutMsg);
  } catch (err) {
    const msg = `${err.stderr || ''} ${err.message || ''}`;
    if (/no default destination/i.test(msg)) {
      throw new Error('No printer is set up. Add the printer in System Settings → Printers & Scanners, then choose it in ⚙️ → Printer.');
    }
    if (/does not exist|unknown destination/i.test(msg)) {
      throw new Error(`The printer “${printer}” isn’t available. Check it’s connected, or choose another printer in ⚙️.`);
    }
    if (/media|page ?size/i.test(msg)) {
      throw new Error('The printer doesn’t accept the 4×6 paper setting. Run "npm run printer-sizes" in Terminal, then restart the booth.');
    }
    throw err;
  }
}

// A 4x6in calibration page: a border 1/8in from the edge, size labels, colour patches and the strip cut line.
function buildTestPagePdf(filePath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [288, 432], margin: 0 });
    const out = fs.createWriteStream(filePath);
    doc.pipe(out);
    const inset = 9; // 1/8 inch
    doc.lineWidth(1.5).strokeColor('#273f2d').rect(inset, inset, 288 - inset * 2, 432 - inset * 2).stroke();
    // strip cut marks at the top and bottom edges
    doc.lineWidth(0.75).strokeColor('#999').dash(3, { space: 3 });
    doc.moveTo(144, 16).lineTo(144, 50).stroke();
    doc.moveTo(144, 382).lineTo(144, 416).stroke();
    doc.undash();
    [[0, 0], [288, 0], [0, 432], [288, 432]].forEach(([x, y]) => {
      const dx = x ? -1 : 1;
      const dy = y ? -1 : 1;
      doc.lineWidth(1).strokeColor('#b8452c').moveTo(x, y + dy * 24).lineTo(x, y).lineTo(x + dx * 24, y).stroke();
    });
    doc.fillColor('#273f2d').fontSize(18).text('Photobooth test print', 0, 60, { width: 288, align: 'center' });
    doc.fontSize(10).fillColor('#5d6648')
      .text('This page is 4 × 6 in (10 × 15 cm).', 0, 90, { width: 288, align: 'center' })
      .text('Check:', 34, 130)
      .text('• The green border is about 3 mm from every edge.', 34, 146, { width: 220 })
      .text('• The red corner marks touch the paper corners (or are just cut off if printing borderless).', 34, 172, { width: 220 })
      .text('• Strip prints are cut between the dashed marks at the top and bottom.', 34, 210, { width: 220 });
    const colours = ['#273f2d', '#734121', '#b5885e', '#727c57', '#c8b89f', '#af0d19', '#1565c0', '#000000'];
    colours.forEach((c, i) => doc.rect(34 + (i % 4) * 56, 260 + Math.floor(i / 4) * 40, 48, 32).fill(c));
    doc.fillColor('#5d6648').fontSize(8).text(new Date().toLocaleString('en-GB'), 0, 356, { width: 288, align: 'center' });
    doc.end();
    out.on('finish', resolve);
    out.on('error', reject);
  });
}

module.exports = { PRINT_MEDIA, buildPdf, listPrinters, sendToPrinter, buildTestPagePdf };
