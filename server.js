require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const crypto = require('crypto');
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
// Frame designs uploaded from the settings screen (image + a .json with the photo windows)
const FRAMES_DIR = path.resolve(process.env.FRAMES_DIR || path.join(__dirname, 'custom-frames'));

fs.mkdirSync(WALL_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '60mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/wall', express.static(WALL_DIR, { maxAge: '1d' }));
app.use('/custom-frames', express.static(FRAMES_DIR));

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

// Paths shown to the operator: relative to the project when inside it, otherwise in full.
function displayPath(p) {
  const rel = path.relative(__dirname, p);
  return rel.startsWith('..') ? p : rel;
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
  await withTimeout(execFileP('lp', args), 60000, timeoutMsg);
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

function mailer() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: String(process.env.SMTP_SECURE) === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

// Plain-language explanations for the usual Gmail/SMTP failures.
function friendlyMailError(err) {
  if (err.code === 'EAUTH') return 'The email login was rejected. Check SMTP_USER and the Gmail App Password in .env (run "npm run setup-email").';
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS'].includes(err.code)) return 'Couldn’t reach the email server. Check the internet connection.';
  return String(err.message || err);
}

// ---------- settings PIN ----------
// Set ADMIN_PIN in .env (npm run set-pin). Without it the settings are unlocked.
const ADMIN_PIN = String(process.env.ADMIN_PIN || '').trim();
let failedPins = 0;
let lockedUntil = 0;

function pinMatches(pin) {
  const a = crypto.createHash('sha256').update(String(pin || '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PIN).digest();
  return crypto.timingSafeEqual(a, b);
}

function checkPin(pin) {
  if (!ADMIN_PIN) return { ok: true };
  if (Date.now() < lockedUntil) return { ok: false, status: 429, error: 'Too many wrong tries. Wait a minute and try again.' };
  if (pinMatches(pin)) {
    failedPins = 0;
    return { ok: true };
  }
  failedPins++;
  if (failedPins >= 5) {
    failedPins = 0;
    lockedUntil = Date.now() + 60 * 1000;
  }
  return { ok: false, status: 401, error: 'Wrong PIN' };
}

// Guards the settings actions; the page sends the PIN it was unlocked with.
function requireAdmin(req, res, next) {
  const result = checkPin(req.get('x-admin-pin'));
  if (result.ok) return next();
  res.status(result.status).json({ error: result.error });
}

// ---------- routes ----------

app.get('/api/status', async (req, res) => {
  res.json({
    printMode: PRINT_MODE,
    platform: process.platform,
    emailConfigured: Boolean(mailer()),
    pinRequired: Boolean(ADMIN_PIN),
    pinLength: ADMIN_PIN.length || null,
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
    res.json({ ok: true, copies: n, file: path.basename(pdfPath) });
  } catch (err) {
    console.error('Print failed:', err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Prints the calibration page so the operator can check paper size and margins.
app.post('/api/print/test', requireAdmin, async (req, res) => {
  try {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const pdfPath = path.join(OUTPUT_DIR, `test-page-${sessionId()}.pdf`);
    await buildTestPagePdf(pdfPath);
    if (PRINT_MODE === 'dry') {
      console.log(`[dry-run] test page saved: ${pdfPath}`);
      return res.json({ ok: true, dryRun: true, file: displayPath(pdfPath) });
    }
    await sendToPrinter(pdfPath, 1, req.body.printer || DEFAULT_PRINTER);
    res.json({ ok: true });
  } catch (err) {
    console.error('Test print failed:', err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ---------- email template (edited in settings, saved in email-template.json) ----------

const TEMPLATE_PATH = path.resolve(process.env.EMAIL_TEMPLATE_PATH || path.join(__dirname, 'email-template.json'));
const DEFAULT_TEMPLATE = {
  subject: 'Your {event} photostrip 📸',
  body: 'Hi there!\n\nThanks for stopping by the {event} photobooth. Your photostrip is attached, so you can keep it forever.\n\nSee you again soon,\n{event}',
  attachPhotos: false,
};

function readTemplate() {
  try {
    return { ...DEFAULT_TEMPLATE, ...JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8')) };
  } catch {
    return { ...DEFAULT_TEMPLATE };
  }
}

const escapeHtml = (t) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Fills in {event} and {date} and builds the plain-text and HTML versions of the message.
function buildEmail(template, eventName) {
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const fill = (t) => t.replace(/\{event\}/gi, eventName).replace(/\{date\}/gi, date);
  const text = fill(template.body);
  const html = text
    .split(/\n\s*\n/)
    .map((para) => `<p style="margin:0 0 14px">${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return { subject: fill(template.subject), text, html: `<div style="font-family:Georgia,serif;font-size:16px;line-height:1.5;color:#22352a">${html}</div>` };
}

const eventNameFrom = (req) => String(req.body.event || process.env.EVENT_NAME || 'trilogy').slice(0, 60);
const fileSlug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'photobooth';

app.get('/api/email/template', (req, res) => res.json(req.query.default ? DEFAULT_TEMPLATE : readTemplate()));

app.put('/api/email/template', requireAdmin, (req, res) => {
  const { subject, body, attachPhotos } = req.body;
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 150) return res.status(400).json({ error: 'The subject must be 1–150 characters.' });
  if (typeof body !== 'string' || !body.trim() || body.length > 5000) return res.status(400).json({ error: 'The message must be 1–5000 characters.' });
  const template = { subject: subject.trim(), body: body.replace(/\r\n/g, '\n').trim(), attachPhotos: Boolean(attachPhotos) };
  fs.writeFileSync(TEMPLATE_PATH, JSON.stringify(template, null, 2));
  res.json({ ok: true, template });
});

// Sends the guest their photostrip (plus the individual photos if the template says so).
async function sendPhotoEmail(req, to, { subjectPrefix = '' } = {}) {
  const transport = mailer();
  if (!transport) {
    const err = new Error('Email isn’t set up yet. Run "npm run setup-email", then restart the booth.');
    err.status = 503;
    throw err;
  }
  const template = readTemplate();
  const eventName = eventNameFrom(req);
  const { subject, text, html } = buildEmail(template, eventName);
  const attachments = [];
  if (req.body.image) {
    const strip = dataUrlToBuffer(req.body.image);
    attachments.push({ filename: `${fileSlug(eventName)}-photostrip.${strip.ext}`, content: strip.buffer });
  }
  if (template.attachPhotos) {
    (req.body.photos || []).slice(0, 8).forEach((p, i) => {
      const { buffer, ext } = dataUrlToBuffer(p);
      attachments.push({ filename: `photo-${i + 1}.${ext}`, content: buffer });
    });
  }
  await transport.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject: subjectPrefix + subject, text, html, attachments });
}

const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');

app.post('/api/email', async (req, res) => {
  if (!validEmail(req.body.email)) return res.status(400).json({ error: 'Please enter a valid email address' });
  if (!req.body.image) return res.status(400).json({ error: 'Missing photostrip' });
  try {
    await sendPhotoEmail(req, req.body.email);
    console.log(`Emailed photostrip to ${req.body.email}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Email failed:', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : friendlyMailError(err) });
  }
});

app.post('/api/admin/unlock', (req, res) => {
  const result = checkPin(req.body.pin);
  if (result.ok) return res.json({ ok: true });
  res.status(result.status).json({ error: result.error });
});

// Sends the guest email exactly as guests get it (with a sample strip), so the operator can check it.
app.post('/api/email/test', requireAdmin, async (req, res) => {
  if (!validEmail(req.body.to)) return res.status(400).json({ error: 'Please enter a valid email address' });
  try {
    await sendPhotoEmail(req, req.body.to, { subjectPrefix: '[Test] ' });
    console.log(`Test email sent to ${req.body.to}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Test email failed:', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : friendlyMailError(err) });
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

// ---------- custom frames ----------

const LAYOUT_IDS = ['strip3', 'strip4', '4r'];

function readFrames() {
  if (!fs.existsSync(FRAMES_DIR)) return [];
  return fs
    .readdirSync(FRAMES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(FRAMES_DIR, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.createdAt - b.createdAt);
}

app.get('/api/frames', (req, res) => res.json({ frames: readFrames() }));

app.post('/api/frames', requireAdmin, (req, res) => {
  try {
    const { name, image, layout, slots, windowsTransparent, width, height } = req.body;
    if (!LAYOUT_IDS.includes(layout)) throw new Error('Unknown layout');
    const valid = (n) => typeof n === 'number' && n >= 0 && n <= 1;
    if (!Array.isArray(slots) || !slots.length || slots.length > 8 || !slots.every((s) => [s.x, s.y, s.w, s.h].every(valid))) {
      throw new Error('Invalid photo windows');
    }
    const { buffer, ext } = dataUrlToBuffer(image);
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    fs.mkdirSync(FRAMES_DIR, { recursive: true });
    fs.writeFileSync(path.join(FRAMES_DIR, `${id}.${ext}`), buffer);
    const meta = {
      id,
      name: String(name || 'My frame').slice(0, 40),
      layout,
      slots: slots.map(({ x, y, w, h }) => ({ x, y, w, h })),
      windowsTransparent: Boolean(windowsTransparent),
      width: Number(width) || null,
      height: Number(height) || null,
      url: `/custom-frames/${id}.${ext}`,
      createdAt: Date.now(),
    };
    fs.writeFileSync(path.join(FRAMES_DIR, `${id}.json`), JSON.stringify(meta, null, 2));
    console.log(`Frame added: ${meta.name} (${layout}, ${slots.length} photos)`);
    res.json({ ok: true, frame: meta });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.delete('/api/frames/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  if (!/^[a-z0-9]+$/.test(id)) return res.status(400).json({ error: 'Invalid id' });
  if (!fs.existsSync(FRAMES_DIR)) return res.json({ ok: true });
  fs.readdirSync(FRAMES_DIR)
    .filter((f) => f.startsWith(`${id}.`))
    .forEach((f) => fs.unlinkSync(path.join(FRAMES_DIR, f)));
  res.json({ ok: true });
});

// Clears the wall by moving its photos into output/wall-archive/<date-time>/, so nothing is lost.
app.post('/api/wall/clear', requireAdmin, (req, res) => {
  try {
    fs.mkdirSync(WALL_DIR, { recursive: true });
    const files = fs.readdirSync(WALL_DIR).filter((f) => f.endsWith('.jpg'));
    if (!files.length) return res.json({ ok: true, cleared: 0 });
    const archive = path.join(OUTPUT_DIR, 'wall-archive', sessionId());
    fs.mkdirSync(archive, { recursive: true });
    files.forEach((f) => fs.renameSync(path.join(WALL_DIR, f), path.join(archive, f)));
    const cleared = files.filter((f) => !f.endsWith('-thumb.jpg')).length;
    console.log(`Booth wall cleared: ${cleared} photos moved to ${archive}`);
    res.json({ ok: true, cleared, archive: displayPath(archive) });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`📸 Photobooth running at http://localhost:${PORT}`);
  console.log(`   Print mode: ${PRINT_MODE}${PRINT_MODE === 'dry' ? ' (PDFs saved, nothing printed)' : ''}`);
  console.log(`   Email: ${mailer() ? 'configured' : 'not configured (set SMTP_* in .env)'}`);
  console.log(`   Output folder: ${OUTPUT_DIR}`);
  console.log(`   Settings PIN: ${ADMIN_PIN ? 'on' : 'off (run "npm run set-pin" to add one)'}`);
  if (os.platform() !== 'win32') console.log(`   CUPS media: ${PRINT_MEDIA}`);
});
