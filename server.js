require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');

const execFileP = promisify(execFile);

const PORT = Number(process.env.PORT) || 3000;
// "system" sends jobs to the OS printer, "dry" only saves the PDF (for testing without a printer)
const PRINT_MODE = process.argv.includes('--dry') ? 'dry' : (process.env.PRINT_MODE || 'system').toLowerCase();
const DEFAULT_PRINTER = process.env.PRINTER_NAME || '';
// CUPS media name used on macOS / Linux. 4x6in = 288x432pt
const PRINT_MEDIA = process.env.PRINT_MEDIA || 'w288h432';
const MAX_COPIES = Number(process.env.MAX_COPIES) || 10;
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, 'output'));

// Photos guests chose to share on the booth wall (delete files here to remove them from the wall)
const WALL_DIR = path.join(OUTPUT_DIR, 'wall');
const WALL_LIMIT = Number(process.env.WALL_LIMIT) || 300;

fs.mkdirSync(WALL_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '60mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/wall', express.static(WALL_DIR, { maxAge: '1d' }));

// ---------- helpers ----------

function dataUrlToBuffer(dataUrl) {
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('Invalid image data');
  return { buffer: Buffer.from(match[2], 'base64'), ext: match[1] === 'png' ? 'png' : 'jpg' };
}

function sessionId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`;
}

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

async function sendToPrinter(pdfPath, copies, printer) {
  if (process.platform === 'win32') {
    const { print } = require('pdf-to-printer');
    await print(pdfPath, { printer: printer || undefined, copies, scale: 'fit' });
    return;
  }
  const args = ['-n', String(copies), '-o', 'fit-to-page'];
  if (PRINT_MEDIA) args.push('-o', `media=${PRINT_MEDIA}`);
  if (printer) args.push('-d', printer);
  args.push(pdfPath);
  await execFileP('lp', args);
}

function mailer() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: String(process.env.SMTP_SECURE) === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

// ---------- routes ----------

app.get('/api/status', async (req, res) => {
  res.json({
    printMode: PRINT_MODE,
    platform: process.platform,
    emailConfigured: Boolean(mailer()),
    maxCopies: MAX_COPIES,
    defaultPrinter: DEFAULT_PRINTER || null,
  });
});

app.get('/api/printers', async (req, res) => {
  try {
    res.json(await listPrinters());
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post('/api/print', async (req, res) => {
  try {
    const { image, copies, printer } = req.body;
    const n = Math.max(1, Math.min(MAX_COPIES, parseInt(copies, 10) || 1));
    const { buffer } = dataUrlToBuffer(image);
    const id = sessionId();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const pdfPath = path.join(OUTPUT_DIR, `print-${id}.pdf`);
    await buildPdf(buffer, pdfPath);

    if (PRINT_MODE === 'dry') {
      console.log(`[dry-run] would print ${n} copies of ${pdfPath}`);
      return res.json({ ok: true, dryRun: true, copies: n, file: path.basename(pdfPath) });
    }

    await sendToPrinter(pdfPath, n, printer || DEFAULT_PRINTER);
    console.log(`Printed ${n} copies of ${pdfPath} on ${printer || DEFAULT_PRINTER || 'default printer'}`);
    res.json({ ok: true, copies: n, file: path.basename(pdfPath) });
  } catch (err) {
    console.error('Print failed:', err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post('/api/email', async (req, res) => {
  try {
    const { email, image, photos = [] } = req.body;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    const transport = mailer();
    if (!transport) {
      return res.status(503).json({ error: 'Email is not configured on this photobooth (see .env)' });
    }

    const main = dataUrlToBuffer(image);
    const attachments = [{ filename: `photobooth.${main.ext}`, content: main.buffer }];
    photos.slice(0, 8).forEach((p, i) => {
      const { buffer, ext } = dataUrlToBuffer(p);
      attachments.push({ filename: `photo-${i + 1}.${ext}`, content: buffer });
    });

    const eventName = process.env.EVENT_NAME || 'our photobooth';
    await transport.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: email,
      subject: process.env.MAIL_SUBJECT || 'Your photobooth pictures 📸',
      text: `Thanks for visiting ${eventName}! Your photos are attached.`,
      html: `<p>Thanks for visiting <b>${eventName}</b>! 📸</p><p>Your photos are attached to this email.</p>`,
      attachments,
    });
    console.log(`Emailed photos to ${email}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Email failed:', err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Keeps a copy of every finished strip for the operator.
app.post('/api/save', (req, res) => {
  try {
    const { buffer, ext } = dataUrlToBuffer(req.body.image);
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const file = path.join(OUTPUT_DIR, `photo-${sessionId()}.${ext}`);
    fs.writeFileSync(file, buffer);
    res.json({ ok: true, file: path.basename(file) });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// ---------- booth wall ----------

app.get('/api/wall', (req, res) => {
  fs.mkdirSync(WALL_DIR, { recursive: true });
  const photos = fs
    .readdirSync(WALL_DIR)
    .filter((f) => /^\d+-[a-z0-9]+\.jpg$/.test(f))
    .sort()
    .reverse()
    .slice(0, WALL_LIMIT)
    .map((f) => {
      const id = f.replace('.jpg', '');
      const hasThumb = fs.existsSync(path.join(WALL_DIR, `${id}-thumb.jpg`));
      return { id, url: `/wall/${f}`, thumb: `/wall/${hasThumb ? `${id}-thumb.jpg` : f}`, createdAt: Number(id.split('-')[0]) };
    });
  res.json({ photos, total: photos.length });
});

app.post('/api/wall', (req, res) => {
  try {
    const full = dataUrlToBuffer(req.body.image);
    const thumb = req.body.thumb ? dataUrlToBuffer(req.body.thumb) : null;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    fs.mkdirSync(WALL_DIR, { recursive: true });
    fs.writeFileSync(path.join(WALL_DIR, `${id}.jpg`), full.buffer);
    if (thumb) fs.writeFileSync(path.join(WALL_DIR, `${id}-thumb.jpg`), thumb.buffer);
    res.json({ ok: true, id });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// Clears the wall by moving its photos into output/wall-archive/<date-time>/, so nothing is lost.
app.post('/api/wall/clear', (req, res) => {
  try {
    fs.mkdirSync(WALL_DIR, { recursive: true });
    const files = fs.readdirSync(WALL_DIR).filter((f) => f.endsWith('.jpg'));
    if (!files.length) return res.json({ ok: true, cleared: 0 });
    const archive = path.join(OUTPUT_DIR, 'wall-archive', sessionId());
    fs.mkdirSync(archive, { recursive: true });
    files.forEach((f) => fs.renameSync(path.join(WALL_DIR, f), path.join(archive, f)));
    const cleared = files.filter((f) => !f.endsWith('-thumb.jpg')).length;
    console.log(`Booth wall cleared: ${cleared} photos moved to ${archive}`);
    const rel = path.relative(__dirname, archive);
    res.json({ ok: true, cleared, archive: rel.startsWith('..') ? archive : rel });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`📸 Photobooth running at http://localhost:${PORT}`);
  console.log(`   Print mode: ${PRINT_MODE}${PRINT_MODE === 'dry' ? ' (PDFs saved, nothing printed)' : ''}`);
  console.log(`   Email: ${mailer() ? 'configured' : 'not configured (set SMTP_* in .env)'}`);
  console.log(`   Output folder: ${OUTPUT_DIR}`);
  if (os.platform() !== 'win32') console.log(`   CUPS media: ${PRINT_MEDIA}`);
});
