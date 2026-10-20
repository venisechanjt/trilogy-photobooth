/*
 * Layouts, frame geometries and themes (templates).
 *
 * All sizes are in pixels at 300 DPI:
 *   - strips (3 cuts / 4 cuts) are 2x6 inch  = 600 x 1800
 *   - 4R is 4x6 inch                         = 1200 x 1800
 * Strips are printed two side by side on a 4R sheet (cut down the middle).
 */

const DPI = 300;

// Photo windows always take the shape of the photos (aspect = width / height), so photos are never cropped.
// The block of photos is centred in the space above the footer.
function stack(count, { W, H, margin, top, gap, footer }, aspect) {
  const availH = H - top - footer;
  const w = Math.min(W - margin * 2, ((availH - gap * (count - 1)) / count) * aspect);
  const h = w / aspect;
  const y0 = top + (availH - (count * h + gap * (count - 1))) / 2;
  return Array.from({ length: count }, (_, i) => ({ x: (W - w) / 2, y: y0 + i * (h + gap), w, h }));
}

function grid(cols, rows, { W, H, margin, top, gap, footer }, aspect) {
  const availH = H - top - footer;
  const cellW = (W - margin * 2 - gap * (cols - 1)) / cols;
  const cellH = (availH - gap * (rows - 1)) / rows;
  const w = Math.min(cellW, cellH * aspect);
  const h = w / aspect;
  const x0 = (W - (cols * w + gap * (cols - 1))) / 2;
  const y0 = top + (availH - (rows * h + gap * (rows - 1))) / 2;
  const slots = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      slots.push({ x: x0 + c * (w + gap), y: y0 + r * (h + gap), w, h });
    }
  }
  return slots;
}

const STRIP = { W: 600, H: 1800, margin: 36, top: 40, gap: 24, footer: 240 };
const FOUR_R = { W: 1200, H: 1800, margin: 60, top: 60, gap: 30, footer: 260 };

// A geometry decides how many photos a frame holds and how they are arranged.
// build(aspect, size) returns the photo windows; themes may change size.footer.
const GEOMETRIES = {
  strip3: { id: 'strip3', name: '3 Cuts', layout: 'strip3', size: STRIP, count: 3, build: (a, sz) => stack(3, sz, a) },
  strip4: { id: 'strip4', name: '4 Cuts', layout: 'strip4', size: STRIP, count: 4, build: (a, sz) => stack(4, sz, a) },
  '4r-single': { id: '4r-single', name: 'Single', layout: '4r', size: FOUR_R, count: 1, build: (a, sz) => stack(1, { ...sz, margin: 70, top: 70 }, a) },
  '4r-duo': { id: '4r-duo', name: 'Duo', layout: '4r', size: FOUR_R, count: 2, build: (a, sz) => stack(2, { ...sz, gap: 40 }, a) },
  '4r-trio': { id: '4r-trio', name: 'Trio', layout: '4r', size: FOUR_R, count: 3, build: (a, sz) => stack(3, { ...sz, gap: 36 }, a) },
  '4r-quad': { id: '4r-quad', name: 'Grid of 4', layout: '4r', size: FOUR_R, count: 4, build: (a, sz) => grid(2, 2, sz, a) },
  '4r-six': { id: '4r-six', name: 'Grid of 6', layout: '4r', size: FOUR_R, count: 6, build: (a, sz) => grid(2, 3, sz, a) },
  '4r-eight': { id: '4r-eight', name: 'Grid of 8', layout: '4r', size: FOUR_R, count: 8, build: (a, sz) => grid(2, 4, sz, a) },
};

// Shape of the camera's photos; updated by the app once the camera starts. 4:3 until then.
let photoAspect = 4 / 3;
function setPhotoAspect(a) {
  if (a > 0 && isFinite(a)) photoAspect = a;
}

const LAYOUTS = {
  strip3: { id: 'strip3', name: '3 Cuts', blurb: '2×6" photo strip · 3 photos', geometries: ['strip3'], strip: true },
  strip4: { id: 'strip4', name: '4 Cuts', blurb: '2×6" photo strip · 4 photos', geometries: ['strip4'], strip: true },
  '4r': {
    id: '4r',
    name: '4R',
    blurb: '4×6" photo · pick a frame first',
    geometries: ['4r-single', '4r-duo', '4r-trio', '4r-quad', '4r-six', '4r-eight'],
    strip: false,
  },
};

// ---------- drawing helpers ----------

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}

function pattern(ctx, W, H, step, draw) {
  for (let y = -step; y < H + step; y += step) {
    for (let x = -step; x < W + step; x += step) {
      const offset = (Math.round(y / step) % 2) * (step / 2);
      draw(x + offset, y);
    }
  }
}

function heart(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.3);
  ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
  ctx.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
  ctx.fill();
}

function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? r * 0.45 : r;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
}

/*
 * THEMES (templates)
 *   background(ctx, W, H, geo)  draws behind the photos
 *   foreground(ctx, W, H, geo)  draws on top of the photos (optional)
 *   radius                      corner radius of photo windows
 *   border                      { color, width } around each photo (optional)
 *   text / accent               caption colours
 *   overlay                     optional PNG per layout id, drawn on top of everything.
 *                               Use this for artwork made in Canva/Photoshop: export a PNG at
 *                               600x1800 (strips) or 1200x1800 (4R) with transparent photo windows
 *                               that line up with the slots (they follow the camera's shape, so design
 *                               for the camera you will use at the event), put it in /public/frames/ and add e.g.
 *                               overlay: { strip4: 'frames/my-wedding-4cut.png' }
 *                               Set caption: false if your artwork already has text on it.
 */
const THEMES = [
  {
    id: 'trilogy-red',
    name: 'Trilogy Red',
    swatch: '#ad0d1a',
    text: '#fffaf3',
    accent: '#fffaf3',
    radius: 0,
    tagline: 'friendship is the key!',
    footer: { strip: 330, '4r': 300 },
    background(ctx, W, H) {
      ctx.fillStyle = '#ad0d1a';
      ctx.fillRect(0, 0, W, H);
    },
    // italic serif wordmark + tagline, as on the Trilogy strip artwork
    caption(ctx, W, H, geo, title) {
      const bottom = Math.max(...geo.slots.map((s) => s.y + s.h));
      const cy = (bottom + H) / 2;
      const big = W < 800 ? 110 : 150;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = this.text;
      fitFont(ctx, title, W - 60, 'italic 700', big, "'Cormorant Garamond', Georgia, serif");
      ctx.fillText(title, W / 2, cy - big * 0.02);
      fitFont(ctx, this.tagline, W - 60, 'italic 600', big * 0.4, "'Cormorant Garamond', Georgia, serif");
      ctx.fillText(this.tagline, W / 2, cy + big * 0.62);
    },
  },
  {
    id: 'trilogy-cream',
    name: 'Trilogy Cream',
    swatch: '#fffaf3',
    text: '#273f2d',
    accent: '#b5885e',
    radius: 4,
    border: { color: '#273f2d', width: 3 },
    background(ctx, W, H) {
      ctx.fillStyle = '#fffaf3';
      ctx.fillRect(0, 0, W, H);
    },
  },
  {
    id: 'trilogy-forest',
    name: 'Trilogy Forest',
    swatch: '#273f2d',
    text: '#fffaf3',
    accent: '#c8b89f',
    radius: 4,
    border: { color: '#c8b89f', width: 3 },
    background(ctx, W, H) {
      ctx.fillStyle = '#273f2d';
      ctx.fillRect(0, 0, W, H);
    },
  },
  {
    id: 'classic',
    name: 'Classic White',
    swatch: '#ffffff',
    text: '#1d1d1f',
    accent: '#8a8a8e',
    radius: 6,
    background(ctx, W, H) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    swatch: '#15151a',
    text: '#f5e6b8',
    accent: '#c9a54c',
    radius: 4,
    border: { color: '#c9a54c', width: 4 },
    background(ctx, W, H) {
      ctx.fillStyle = '#15151a';
      ctx.fillRect(0, 0, W, H);
    },
  },
  {
    id: 'pink',
    name: 'Pastel Hearts',
    swatch: '#ffd3df',
    text: '#c2185b',
    accent: '#e91e63',
    radius: 18,
    border: { color: '#ffffff', width: 10 },
    background(ctx, W, H) {
      ctx.fillStyle = '#ffd3df';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      pattern(ctx, W, H, 90, (x, y) => heart(ctx, x, y, 34));
    },
  },
  {
    id: 'film',
    name: 'Film Strip',
    swatch: '#000000',
    text: '#ffffff',
    accent: '#ffb300',
    radius: 0,
    background(ctx, W, H, geo) {
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, W, H);
      const margin = geo.size.margin;
      const hw = margin * 0.42;
      const hh = hw * 1.4;
      ctx.fillStyle = '#f2f2f2';
      for (let y = 20; y < H - hh; y += hh * 2.2) {
        roundRect(ctx, (margin - hw) / 2, y, hw, hh, 4);
        ctx.fill();
        roundRect(ctx, W - margin + (margin - hw) / 2, y, hw, hh, 4);
        ctx.fill();
      }
    },
  },
  {
    id: 'polka',
    name: 'Sky Polka',
    swatch: '#a8d8ff',
    text: '#1565c0',
    accent: '#ffffff',
    radius: 14,
    border: { color: '#ffffff', width: 8 },
    background(ctx, W, H) {
      ctx.fillStyle = '#a8d8ff';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      pattern(ctx, W, H, 70, (x, y) => {
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.fill();
      });
    },
  },
  {
    id: 'sunset',
    name: 'Sunset Party',
    swatch: 'linear-gradient(160deg,#ff9a3c,#ff3d77,#7b2ff7)',
    text: '#ffffff',
    accent: '#ffe066',
    radius: 10,
    background(ctx, W, H) {
      const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
      g.addColorStop(0, '#ff9a3c');
      g.addColorStop(0.5, '#ff3d77');
      g.addColorStop(1, '#7b2ff7');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    },
    foreground(ctx, W, H, geo) {
      ctx.fillStyle = '#ffe066';
      const s = geo.size.margin;
      star(ctx, s * 0.5, s * 0.5, s * 0.3);
      star(ctx, W - s * 0.5, H - geo.size.footer - s * 0.1, s * 0.25);
    },
  },
  {
    id: 'checker',
    name: 'Mint Checker',
    swatch: 'repeating-conic-gradient(#bff0d8 0 25%, #e8fff3 0 50%) 0 0/16px 16px',
    text: '#0b6b47',
    accent: '#14a06a',
    radius: 12,
    border: { color: '#0b6b47', width: 5 },
    background(ctx, W, H) {
      const s = 50;
      for (let y = 0; y < H; y += s) {
        for (let x = 0; x < W; x += s) {
          ctx.fillStyle = (x / s + y / s) % 2 ? '#bff0d8' : '#e8fff3';
          ctx.fillRect(x, y, s, s);
        }
      }
    },
  },
];

function fitFont(ctx, text, maxW, style, size, family) {
  ctx.font = `${style} ${size}px ${family}`;
  while (ctx.measureText(text).width > maxW && size > 12) {
    size -= 2;
    ctx.font = `${style} ${size}px ${family}`;
  }
  return size;
}

const imageCache = new Map();
function loadImage(src) {
  if (!imageCache.has(src)) {
    imageCache.set(
      src,
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      })
    );
  }
  return imageCache.get(src);
}

// Draws a source (canvas/image) into a slot without cropping it ("object-fit: contain").
// Slots already have the photo's shape, so normally the photo fills the slot exactly.
function drawContain(ctx, src, slot) {
  const scale = Math.min(slot.w / src.width, slot.h / src.height);
  const w = src.width * scale;
  const h = src.height * scale;
  ctx.drawImage(src, slot.x + (slot.w - w) / 2, slot.y + (slot.h - h) / 2, w, h);
}

/*
 * Renders a frame onto a canvas.
 *   photos: array of canvases/images in slot order (missing entries render as numbered placeholders)
 *   opts.scale: output scale (1 = print resolution)
 *   opts.caption / opts.date: footer text
 */
async function renderFrame(canvas, geometryId, themeId, photos = [], opts = {}) {
  const base = GEOMETRIES[geometryId];
  const first = photos.find(Boolean);
  const theme = THEMES.find((t) => t.id === themeId) || THEMES[0];
  const themeFooter = theme.footer && theme.footer[base.layout === '4r' ? '4r' : 'strip'];
  const size = themeFooter ? { ...base.size, footer: themeFooter } : base.size;
  const geo = { ...base, size, slots: base.build(first ? first.width / first.height : photoAspect, size) };
  const { W, H, footer } = geo.size;
  const scale = opts.scale || 1;
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(scale, scale);

  theme.background(ctx, W, H, geo);

  geo.slots.forEach((slot, i) => {
    const r = theme.radius || 0;
    if (theme.border) {
      const b = theme.border.width;
      ctx.fillStyle = theme.border.color;
      roundRect(ctx, slot.x - b, slot.y - b, slot.w + b * 2, slot.h + b * 2, r + b);
      ctx.fill();
    }
    ctx.save();
    roundRect(ctx, slot.x, slot.y, slot.w, slot.h, r);
    ctx.clip();
    const photo = photos[i];
    if (photo) {
      drawContain(ctx, photo, slot);
    } else {
      ctx.fillStyle = '#d9d9de';
      ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
      ctx.fillStyle = '#9a9aa2';
      ctx.font = `600 ${Math.min(slot.w, slot.h) * 0.32}px 'Roboto Condensed', system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), slot.x + slot.w / 2, slot.y + slot.h / 2);
    }
    ctx.restore();
  });

  if (theme.foreground) theme.foreground(ctx, W, H, geo);

  const overlaySrc = theme.overlay && (theme.overlay[geometryId] || theme.overlay[geo.layout]);
  if (overlaySrc) {
    const img = await loadImage(overlaySrc);
    if (img) ctx.drawImage(img, 0, 0, W, H);
  }

  if (typeof theme.caption === 'function' && opts.caption !== false) {
    theme.caption(ctx, W, H, geo, opts.caption || 'trilogy');
  } else if (theme.caption !== false && opts.caption !== false) {
    const cy = H - footer / 2;
    const title = (opts.caption || 'PHOTOBOOTH').toUpperCase();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.text;
    let size = W < 800 ? 54 : 78;
    ctx.font = `800 ${size}px Archivo, 'Arial Black', system-ui, sans-serif`;
    while (ctx.measureText(title).width > W - 80 && size > 20) {
      size -= 2;
      ctx.font = `800 ${size}px Archivo, 'Arial Black', system-ui, sans-serif`;
    }
    ctx.fillText(title, W / 2, cy - 22);
    ctx.fillStyle = theme.accent;
    ctx.font = `500 ${W < 800 ? 28 : 36}px 'Roboto Condensed', system-ui, sans-serif`;
    ctx.fillText(opts.date || new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }), W / 2, cy + 40);
  }

  ctx.restore();
  return canvas;
}

// The sheet that actually goes to the printer: 4R paper, strips are doubled side by side.
function renderPrintSheet(frameCanvas, isStrip) {
  const sheet = document.createElement('canvas');
  sheet.width = 4 * DPI;
  sheet.height = 6 * DPI;
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  if (isStrip) {
    ctx.drawImage(frameCanvas, 0, 0, sheet.width / 2, sheet.height);
    ctx.drawImage(frameCanvas, sheet.width / 2, 0, sheet.width / 2, sheet.height);
  } else {
    ctx.drawImage(frameCanvas, 0, 0, sheet.width, sheet.height);
  }
  return sheet;
}

window.Frames = { DPI, GEOMETRIES, LAYOUTS, THEMES, renderFrame, renderPrintSheet, setPhotoAspect };
