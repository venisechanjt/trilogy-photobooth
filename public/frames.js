/*
 * Frames: the booth's own frame artwork (from public/frames/ in the repo, or uploaded in settings).
 *
 * Every frame is an image with photo windows in it. The windows are found automatically
 * (white boxes, or see-through areas in a PNG), and photos are cropped to fill them.
 *
 * Print sizes at 300 DPI:
 *   - strips (3 cuts / 4 cuts) are 2x6 inch = 600 x 1800, printed two side by side on a 4R sheet
 *   - 4R is 4x6 inch                        = 1200 x 1800
 */

const DPI = 300;

const LAYOUTS = {
  strip3: { id: 'strip3', name: '3 Cuts', blurb: '2×6" photo strip · 3 photos', strip: true, size: { W: 600, H: 1800 } },
  strip4: { id: 'strip4', name: '4 Cuts', blurb: '2×6" photo strip · 4 photos', strip: true, size: { W: 600, H: 1800 } },
  '4r': { id: '4r', name: '4R', blurb: '4×6" photo · pick a frame first', strip: false, size: { W: 1200, H: 1800 } },
};

// Loaded frames: { id, name, layout, count, slots (fractions of the frame size), overlay (frame with see-through windows), url, source, uploadId }
const FRAMES = [];

const getFrame = (id) => FRAMES.find((f) => f.id === id) || null;
const framesFor = (layout) => FRAMES.filter((f) => f.layout === layout);

function addFrame(frame) {
  removeFrame(frame.id);
  FRAMES.push({ ...frame, count: frame.slots.length });
}

function removeFrame(id) {
  const i = FRAMES.findIndex((f) => f.id === id);
  if (i >= 0) FRAMES.splice(i, 1);
}

// Photo windows of a frame in pixels at print size.
function frameSlots(frame) {
  const { W, H } = LAYOUTS[frame.layout].size;
  return frame.slots.map((r) => ({ x: r.x * W, y: r.y * H, w: r.w * W, h: r.h * H }));
}

// Shape (width / height) of a frame's first photo window, for the camera guide.
function frameSlotAspect(id) {
  const frame = getFrame(id);
  if (!frame) return null;
  const s = frameSlots(frame)[0];
  return s.w / s.h;
}

// Draws a source (canvas/image) into a slot, filling it ("object-fit: cover").
function drawCover(ctx, src, slot) {
  const scale = Math.max(slot.w / src.width, slot.h / src.height);
  const cw = slot.w / scale;
  const ch = slot.h / scale;
  ctx.drawImage(src, (src.width - cw) / 2, (src.height - ch) / 2, cw, ch, slot.x, slot.y, slot.w, slot.h);
}

/*
 * Renders a frame with photos onto a canvas.
 *   photos: canvases/images in window order (missing ones show as numbered placeholders)
 *   opts.scale: output scale (1 = print resolution)
 * The frame artwork is the top layer: photos go underneath, showing through its (see-through) windows.
 */
function renderFrame(canvas, frameId, photos = [], opts = {}) {
  const frame = getFrame(frameId);
  if (!frame) throw new Error(`Unknown frame: ${frameId}`);
  const { W, H } = LAYOUTS[frame.layout].size;
  const scale = opts.scale || 1;
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  frameSlots(frame).forEach((slot, i) => {
    const photo = photos[i];
    if (photo) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(slot.x, slot.y, slot.w, slot.h);
      ctx.clip();
      drawCover(ctx, photo, slot);
      ctx.restore();
    } else {
      ctx.fillStyle = '#d9d9de';
      ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
      ctx.fillStyle = '#9a9aa2';
      ctx.font = `600 ${Math.min(slot.w, slot.h) * 0.32}px 'Roboto Condensed', system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), slot.x + slot.w / 2, slot.y + slot.h / 2);
    }
  });

  // the frame is the top layer, over the photos
  ctx.drawImage(frame.overlay, 0, 0, W, H);
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

/*
 * Finds the photo windows in a frame image: areas (any shape) that are see-through (PNG) or one plain light colour.
 * Returns { slots, windowsTransparent, layout, width, height } or throws an Error with a friendly message.
 */
function detectFrameWindows(img) {
  const aspect = img.naturalWidth / img.naturalHeight;
  const isStrip = aspect < 0.45;
  const is4R = aspect > 0.55 && aspect < 0.8;
  if (!isStrip && !is4R) throw new Error('The frame should be a tall 2×6" strip or a portrait 4×6" (4R) image.');
  const maxSide = 2000;
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.round(img.naturalWidth * k);
  const H = Math.round(img.naturalHeight * k);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;

  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 20) clear++;
  const windowsTransparent = clear > W * H * 0.02;
  const mask = new Uint8Array(W * H);
  if (windowsTransparent) {
    for (let p = 0; p < W * H; p++) mask[p] = data[p * 4 + 3] < 20;
  } else {
    // Solid windows: find their colour (the most common light colour that isn't the frame's edge colour),
    // so light-grey windows on a white frame work too.
    const diff = (i, c) => Math.max(Math.abs(data[i] - c[0]), Math.abs(data[i + 1] - c[1]), Math.abs(data[i + 2] - c[2]));
    const count = (map, key) => map.set(key, (map.get(key) || 0) + 1);
    const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1])[0];
    const edgeCounts = new Map();
    for (let x = 0; x < W; x += 2) [x, (H - 1) * W + x].forEach((p) => count(edgeCounts, (data[p * 4] << 16) | (data[p * 4 + 1] << 8) | data[p * 4 + 2]));
    for (let y = 0; y < H; y += 2) [y * W, y * W + W - 1].forEach((p) => count(edgeCounts, (data[p * 4] << 16) | (data[p * 4 + 1] << 8) | data[p * 4 + 2]));
    const e = top(edgeCounts)[0];
    const edge = [e >> 16, (e >> 8) & 255, e & 255];
    const light = new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 200 && Math.min(data[i], data[i + 1], data[i + 2]) >= 200 && diff(i, edge) > 4) count(light, (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
    const best = top(light);
    if (!best) throw new Error('Couldn’t find the photo windows. Make them a plain light colour (like white) that differs from the frame, or see-through in a PNG.');
    const win = [best[0] >> 16, (best[0] >> 8) & 255, best[0] & 255];
    // stay well clear of the frame colour, even when they are close (e.g. #f5f5f5 windows on a #ffffff frame)
    const gap = Math.max(Math.abs(win[0] - edge[0]), Math.abs(win[1] - edge[1]), Math.abs(win[2] - edge[2]));
    const tolerance = Math.min(10, Math.floor((gap - 1) / 2));
    for (let p = 0; p < W * H; p++) mask[p] = data[p * 4 + 3] > 200 && diff(p * 4, win) <= tolerance;
  }

  // connected areas of window pixels; keep the big ones (rectangles, hearts and other shapes)
  const seen = new Int32Array(W * H); // 0 = not visited, otherwise the area's number
  const stack = new Int32Array(W * H);
  const rects = [];
  const windowAreas = new Set();
  let area = 0;
  for (let start = 0; start < W * H; start++) {
    if (!mask[start] || seen[start]) continue;
    area++;
    let top = 0;
    stack[top++] = start;
    seen[start] = area;
    let n = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
    while (top) {
      const p = stack[--top];
      const x = p % W;
      const y = (p - x) / W;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = area; stack[top++] = p - 1; }
      if (x < W - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = area; stack[top++] = p + 1; }
      if (y > 0 && mask[p - W] && !seen[p - W]) { seen[p - W] = area; stack[top++] = p - W; }
      if (y < H - 1 && mask[p + W] && !seen[p + W]) { seen[p + W] = area; stack[top++] = p + W; }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (n > W * H * 0.015 && n / (bw * bh) > 0.5) {
      windowAreas.add(area);
      // grow by 1px so the photo also covers the soft (anti-aliased) edge of the window
      const gx = Math.max(0, x0 - 1);
      const gy = Math.max(0, y0 - 1);
      rects.push({ x: gx / W, y: gy / H, w: (Math.min(W, x1 + 2) - gx) / W, h: (Math.min(H, y1 + 2) - gy) / H });
    }
  }
  if (!rects.length) {
    throw new Error('Couldn’t find the photo windows. Make them a plain light colour (like white) that differs from the frame, or see-through in a PNG.');
  }
  // reading order: top to bottom, then left to right
  rects.sort((a, b) => (Math.abs(a.y - b.y) < 0.02 ? a.x - b.x : a.y - b.y));

  const n = rects.length;
  let layout;
  if (isStrip) {
    if (n !== 3 && n !== 4) throw new Error(`Found ${n} photo windows. Strip frames need 3 or 4.`);
    layout = n === 3 ? 'strip3' : 'strip4';
  } else {
    if (n < 1 || n > 8) throw new Error(`Found ${n} photo windows. 4R frames need between 1 and 8.`);
    layout = '4r';
  }
  // The frame is always drawn on top of the photos, so solid (white) windows are made see-through,
  // together with their 1px soft edge (the photos are grown by the same 1px).
  const overlay = document.createElement('canvas');
  overlay.width = W;
  overlay.height = H;
  const octx = overlay.getContext('2d');
  octx.drawImage(img, 0, 0, W, H);
  if (!windowsTransparent) {
    const od = octx.getImageData(0, 0, W, H);
    const inWindow = (q) => windowAreas.has(seen[q]);
    for (let p = 0; p < W * H; p++) {
      const x = p % W;
      if (inWindow(p) || (x > 0 && inWindow(p - 1)) || (x < W - 1 && inWindow(p + 1)) || (p >= W && inWindow(p - W)) || (p < W * (H - 1) && inWindow(p + W))) {
        od.data[p * 4 + 3] = 0;
      }
    }
    octx.putImageData(od, 0, 0);
  }

  return { slots: rects, windowsTransparent, overlay, layout, width: img.naturalWidth, height: img.naturalHeight };
}

window.Frames = { DPI, LAYOUTS, FRAMES, getFrame, framesFor, addFrame, removeFrame, frameSlotAspect, renderFrame, renderPrintSheet, detectFrameWindows };
