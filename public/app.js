(() => {
  const { GEOMETRIES, LAYOUTS, THEMES, renderFrame, renderPrintSheet } = window.Frames;
  const TOTAL_SHOTS = 8;
  const $ = (sel) => document.querySelector(sel);

  // ---------- settings (stored on this device for the operator) ----------
  const DEFAULT_SETTINGS = { eventName: 'trilogy', printer: '', timer: 3, mode: 'auto', maxCopies: 10, mirror: true, cameraId: '' };
  const TIMERS = [0, 3, 5];
  let settings = { ...DEFAULT_SETTINGS };
  try {
    settings = { ...settings, ...JSON.parse(localStorage.getItem('photobooth-settings') || '{}') };
  } catch {}
  if (!TIMERS.includes(settings.timer)) settings.timer = DEFAULT_SETTINGS.timer;
  if (!['auto', 'manual'].includes(settings.mode)) settings.mode = DEFAULT_SETTINGS.mode;
  // a 0s timer only makes sense when the guest presses the button for every photo
  if (settings.mode === 'auto' && settings.timer === 0) settings.timer = DEFAULT_SETTINGS.timer;
  if (settings.photoAspect) Frames.setPhotoAspect(settings.photoAspect);
  document.documentElement.style.setProperty('--photo-aspect', settings.photoAspect || 4 / 3);
  const saveSettings = () => {
    try {
      localStorage.setItem('photobooth-settings', JSON.stringify(settings));
    } catch {}
  };

  let server = null; // /api/status response, null if the page is opened without the server

  // ---------- session state ----------
  const state = {
    layout: null, // 'strip3' | 'strip4' | '4r'
    geometry: null, // key of GEOMETRIES
    theme: THEMES[0].id,
    shots: Array(TOTAL_SHOTS).fill(null), // canvases
    selection: [], // indexes into shots, in slot order
    copies: 1,
  };

  const need = () => GEOMETRIES[state.geometry].count;
  const isStrip = () => LAYOUTS[state.layout].strip;
  const frameOpts = () => ({ caption: settings.eventName });
  const selectedPhotos = () => state.selection.map((i) => state.shots[i]);

  // ---------- navigation ----------
  let current = 'layout';
  function go(screen) {
    if (screen !== 'camera') stopShootLoop();
    if (screen !== 'done') window.FX?.clear();
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${screen}`));
    current = screen;
    const order = ['layout', 'frame', 'camera', 'select', 'print', 'done'];
    document.querySelectorAll('#steps li').forEach((li) => {
      const idx = order.indexOf(li.dataset.step);
      li.classList.toggle('active', li.dataset.step === screen);
      li.classList.toggle('passed', idx < order.indexOf(screen));
    });
    document.body.classList.toggle('is-4r', state.layout === '4r');

    if (screen === 'camera') enterCamera();
    else stopCamera();
    if (screen === 'frame') renderFrameScreen();
    if (screen === 'select') renderSelectScreen();
    if (screen === 'print') renderPrintScreen();
    if (screen === 'layout') resetSession();
  }
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));

  function resetSession() {
    state.layout = null;
    state.geometry = null;
    state.theme = THEMES[0].id;
    state.shots = Array(TOTAL_SHOTS).fill(null);
    state.selection = [];
    state.copies = 1;
    $('#email').value = '';
    $('#print-status').textContent = '';
    clearInterval(restartTimer);
  }

  // ---------- 1. layout ----------
  async function buildLayoutCards() {
    const wrap = $('#layout-cards');
    wrap.innerHTML = '';
    for (const layout of Object.values(LAYOUTS)) {
      const card = document.createElement('button');
      card.className = 'layout-card';
      const canvas = document.createElement('canvas');
      const geoId = layout.id === '4r' ? '4r-quad' : layout.geometries[0];
      await renderFrame(canvas, geoId, { strip3: 'trilogy-cream', strip4: 'trilogy-red', '4r': 'trilogy-forest' }[layout.id], [], { ...frameOpts(), scale: 0.18 });
      card.innerHTML = `<div class="thumb"></div><h2>${layout.name}</h2><p>${layout.blurb}</p>`;
      card.querySelector('.thumb').appendChild(canvas);
      card.addEventListener('click', () => chooseLayout(layout.id));
      wrap.appendChild(card);
    }
  }

  function chooseLayout(id) {
    state.layout = id;
    state.geometry = LAYOUTS[id].geometries[0];
    if (id === '4r') {
      state.geometry = '4r-quad';
      go('frame');
    } else {
      go('camera');
    }
  }

  // ---------- theme swatches (shared by frame + select screens) ----------
  function buildThemeList(container, onPick) {
    container.innerHTML = '';
    THEMES.forEach((t) => {
      const b = document.createElement('button');
      b.className = 'theme-chip';
      b.dataset.theme = t.id;
      b.innerHTML = `<span class="swatch" style="background:${t.swatch}"></span>${t.name}`;
      b.addEventListener('click', () => {
        state.theme = t.id;
        onPick();
      });
      container.appendChild(b);
    });
  }
  const markTheme = (container) =>
    container.querySelectorAll('.theme-chip').forEach((b) => b.classList.toggle('active', b.dataset.theme === state.theme));

  // ---------- 2. frame (4R) ----------
  function renderFrameScreen() {
    const list = $('#geo-list');
    list.innerHTML = '';
    LAYOUTS['4r'].geometries.forEach((id) => {
      const g = GEOMETRIES[id];
      const b = document.createElement('button');
      b.className = 'geo-chip' + (id === state.geometry ? ' active' : '');
      const c = document.createElement('canvas');
      renderFrame(c, id, 'trilogy-cream', [], { scale: 0.05, caption: false });
      b.appendChild(c);
      b.insertAdjacentHTML('beforeend', `<span>${g.name}<small>${g.count} photo${g.count > 1 ? 's' : ''}</small></span>`);
      b.addEventListener('click', () => {
        state.geometry = id;
        state.selection = state.selection.slice(0, need());
        renderFrameScreen();
      });
      list.appendChild(b);
    });
    buildThemeList($('#frame-theme-list'), renderFrameScreen);
    markTheme($('#frame-theme-list'));
    renderFrame($('#frame-preview'), state.geometry, state.theme, selectedPhotos(), { ...frameOpts(), scale: 0.5 });
  }

  $('#frame-next').addEventListener('click', () => {
    // coming back from "change frame" with photos already taken
    go(state.shots.every(Boolean) ? 'select' : 'camera');
  });

  // ---------- 3. camera ----------
  let stream = null;
  let shooting = false;
  let shootToken = 0;
  const video = $('#video');

  async function listCameras() {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const sel = $('#camera-select');
    sel.innerHTML = devices.map((d, i) => `<option value="${d.deviceId}">${d.label || `Camera ${i + 1}`}</option>`).join('');
    const activeId = stream && stream.getVideoTracks()[0]?.getSettings().deviceId;
    if (activeId) sel.value = activeId;
  }

  async function startCamera() {
    stopCamera();
    $('#cam-error').hidden = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      return showCamError('This browser cannot access a camera. Open the booth at http://localhost (or over HTTPS) in Chrome or Edge.');
    }
    const video_ = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    if (settings.cameraId) video_.deviceId = { exact: settings.cameraId };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: video_, audio: false });
    } catch (err) {
      if (settings.cameraId) {
        // the saved camera was unplugged, fall back to any camera
        settings.cameraId = '';
        saveSettings();
        return startCamera();
      }
      return showCamError(`Couldn't start the camera (${err.name}). Check that it's connected and that camera permission is allowed.`);
    }
    video.srcObject = stream;
    await listCameras();
  }

  function stopCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  function showCamError(msg) {
    const el = $('#cam-error');
    el.textContent = msg;
    el.hidden = false;
  }

  // photos are used uncropped, so frames adapt to the camera's shape
  video.addEventListener('loadedmetadata', () => {
    const aspect = video.videoWidth / video.videoHeight;
    $('#viewfinder').style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    document.documentElement.style.setProperty('--photo-aspect', aspect);
    Frames.setPhotoAspect(aspect);
    settings.photoAspect = aspect;
    saveSettings();
  });

  $('#camera-select').addEventListener('change', (e) => {
    settings.cameraId = e.target.value;
    saveSettings();
    startCamera();
  });

  function enterCamera() {
    document.body.classList.toggle('mirror', settings.mirror);
    renderShots();
    startCamera();
  }

  function renderShots() {
    const wrap = $('#shots');
    wrap.innerHTML = '';
    state.shots.forEach((shot, i) => {
      const b = document.createElement('button');
      b.className = 'shot' + (shot ? ' filled' : '');
      b.title = shot ? 'Tap to retake this photo' : '';
      if (shot) {
        const img = new Image();
        img.src = shot.thumb;
        b.appendChild(img);
        b.insertAdjacentHTML('beforeend', '<span class="retake">↺</span>');
      } else {
        b.textContent = i + 1;
      }
      b.addEventListener('click', () => shot && !shooting && retakeOne(i));
      wrap.appendChild(b);
    });
    const count = state.shots.filter(Boolean).length;
    $('#shot-count').textContent = count;
    const done = count === TOTAL_SHOTS;
    const manual = settings.mode === 'manual';
    $('#camera-next').disabled = !done || shooting;
    $('#start-shoot').hidden = done || shooting;
    $('#retake-all').hidden = !done || shooting;
    if (manual) $('#start-shoot').textContent = '📸 Take photo';
    else $('#start-shoot').textContent = count > 0 ? 'Continue ▶' : 'Start ▶';
    $('#camera-hint').textContent = done
      ? 'All 8 done! Tap any photo to retake it, or carry on.'
      : manual
        ? 'Tap the button (or press the space bar) for each photo. Tap a photo afterwards to retake it.'
        : `The booth takes all 8 photos in a row${settings.timer ? `, ${settings.timer}s apart` : ''}. Tap a photo afterwards to retake it.`;
    document.querySelectorAll('#mode-select button').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === settings.mode);
      b.disabled = shooting;
    });
    document.querySelectorAll('#timer-select button').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.timer) === settings.timer);
      b.hidden = !manual && b.dataset.timer === '0';
      b.disabled = shooting;
    });
  }

  document.querySelectorAll('#mode-select button').forEach((b) =>
    b.addEventListener('click', () => {
      settings.mode = b.dataset.mode;
      if (settings.mode === 'auto' && settings.timer === 0) settings.timer = 3;
      saveSettings();
      renderShots();
    })
  );
  document.querySelectorAll('#timer-select button').forEach((b) =>
    b.addEventListener('click', () => {
      settings.timer = Number(b.dataset.timer);
      saveSettings();
      renderShots();
    })
  );

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function countdown(token) {
    const el = $('#countdown');
    for (let n = settings.timer; n > 0; n--) {
      if (token !== shootToken) return false;
      el.textContent = n;
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
      await wait(1000);
    }
    el.textContent = '';
    return token === shootToken;
  }

  function capture() {
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    const ctx = c.getContext('2d');
    if (settings.mirror) {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    const t = document.createElement('canvas');
    t.width = 240;
    t.height = Math.round((240 * c.height) / c.width);
    t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    c.thumb = t.toDataURL('image/jpeg', 0.8);
    const flash = $('#flash');
    flash.classList.remove('go');
    void flash.offsetWidth;
    flash.classList.add('go');
    return c;
  }

  async function shootSequence(indexes) {
    if (shooting) return;
    if (!stream || !video.videoWidth) return showCamError('Camera is not ready yet.');
    const token = ++shootToken;
    shooting = true;
    renderShots();
    for (const i of indexes) {
      if (!(await countdown(token))) break;
      state.shots[i] = capture();
      renderShots();
      await wait(600);
    }
    if (token === shootToken) shooting = false;
    renderShots();
  }

  function stopShootLoop() {
    shootToken++;
    shooting = false;
    $('#countdown').textContent = '';
  }

  function retakeOne(i) {
    // a retaken photo keeps its place in the selection
    shootSequence([i]);
  }

  $('#start-shoot').addEventListener('click', () => {
    const missing = state.shots.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
    shootSequence(settings.mode === 'manual' ? missing.slice(0, 1) : missing);
  });
  // space bar (or a presentation clicker) works as the shutter button
  document.addEventListener('keydown', (e) => {
    if (current !== 'camera' || !['Space', 'PageDown', 'ArrowRight'].includes(e.code)) return;
    if (e.target.closest('input, select, textarea')) return;
    e.preventDefault();
    if (!$('#start-shoot').hidden) $('#start-shoot').click();
  });
  $('#retake-all').addEventListener('click', () => {
    state.shots = Array(TOTAL_SHOTS).fill(null);
    state.selection = [];
    if (settings.mode === 'manual') renderShots();
    else shootSequence([...Array(TOTAL_SHOTS).keys()]);
  });
  $('#camera-back').addEventListener('click', () => go(state.layout === '4r' ? 'frame' : 'layout'));
  $('#camera-next').addEventListener('click', () => go('select'));

  // ---------- 4. select + style ----------
  let previewQueued = false;
  function updateSelectPreview() {
    if (previewQueued) return;
    previewQueued = true;
    requestAnimationFrame(async () => {
      previewQueued = false;
      await renderFrame($('#select-preview'), state.geometry, state.theme, selectedPhotos(), { ...frameOpts(), scale: 0.5 });
    });
  }

  function renderSelectScreen() {
    $('#need-count').textContent = need();
    const grid = $('#pick-grid');
    grid.innerHTML = '';
    state.shots.forEach((shot, i) => {
      const b = document.createElement('button');
      const pos = state.selection.indexOf(i);
      b.className = 'pick' + (pos >= 0 ? ' selected' : '');
      const img = new Image();
      img.src = shot.thumb;
      b.appendChild(img);
      if (pos >= 0) b.insertAdjacentHTML('beforeend', `<span class="badge">${pos + 1}</span>`);
      b.addEventListener('click', () => togglePick(i, b));
      grid.appendChild(b);
    });
    const full = state.selection.length === need();
    grid.classList.toggle('full', full);
    $('#picked-count').textContent = `(${state.selection.length}/${need()})`;
    $('#select-next').disabled = !full;
    buildThemeList($('#select-theme-list'), renderSelectScreen);
    markTheme($('#select-theme-list'));
    updateSelectPreview();
  }

  function togglePick(i, el) {
    const pos = state.selection.indexOf(i);
    if (pos >= 0) {
      state.selection.splice(pos, 1);
    } else if (state.selection.length < need()) {
      state.selection.push(i);
    } else {
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
      toast(`You can pick ${need()} photos. Tap a selected one to swap it out.`);
      return;
    }
    renderSelectScreen();
  }

  $('#clear-pick').addEventListener('click', () => {
    state.selection = [];
    renderSelectScreen();
  });
  $('#change-frame').addEventListener('click', () => go('frame'));
  $('#select-next').addEventListener('click', () => go('print'));

  // ---------- 5. print ----------
  let finalFrame = null;
  let finalSheet = null;

  async function renderPrintScreen() {
    finalFrame = await renderFrame(document.createElement('canvas'), state.geometry, state.theme, selectedPhotos(), frameOpts());
    finalSheet = renderPrintSheet(finalFrame, isStrip());
    const prev = $('#print-preview');
    prev.width = finalSheet.width / 2;
    prev.height = finalSheet.height / 2;
    prev.getContext('2d').drawImage(finalSheet, 0, 0, prev.width, prev.height);
    $('#sheet-note').textContent = isStrip() ? 'Each print is a 4R sheet with 2 strips — cut down the middle.' : '4R (4×6") print';
    $('#print-status').textContent = '';
    $('#print-status').className = 'status';
    updateQty();
  }

  const maxCopies = () => Math.min(settings.maxCopies, server?.maxCopies || Infinity);
  function updateQty() {
    state.copies = Math.max(1, Math.min(maxCopies(), state.copies));
    $('#qty').textContent = state.copies;
    $('#qty-minus').disabled = state.copies <= 1;
    $('#qty-plus').disabled = state.copies >= maxCopies();
    $('#qty-note').textContent = isStrip() ? `= ${state.copies * 2} strips` : '';
  }
  $('#qty-minus').addEventListener('click', () => {
    state.copies--;
    updateQty();
  });
  $('#qty-plus').addEventListener('click', () => {
    state.copies++;
    updateQty();
  });

  async function postJSON(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function scaledJpeg(canvas, maxSide = 1600) {
    const s = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
    const c = document.createElement('canvas');
    c.width = Math.round(canvas.width * s);
    c.height = Math.round(canvas.height * s);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.9);
  }

  function setStatus(msg, kind = '') {
    const el = $('#print-status');
    el.textContent = msg;
    el.className = `status ${kind}`;
  }

  async function finish({ print }) {
    const email = $('#email').value.trim();
    if (!print && !email) {
      $('#email').focus();
      return setStatus('Enter your email address to get a digital copy.', 'error');
    }
    if (email && !$('#email').checkValidity()) {
      $('#email').focus();
      return setStatus('That email address doesn’t look right.', 'error');
    }
    const buttons = document.querySelectorAll('#screen-print button');
    buttons.forEach((b) => (b.disabled = true));
    setStatus(print ? `Sending ${state.copies} print${state.copies > 1 ? 's' : ''} to the printer…` : 'Sending email…', 'busy');

    const frameData = finalFrame.toDataURL('image/jpeg', 0.95);
    const jobs = [];
    if (print) {
      jobs.push(
        postJSON('/api/print', { image: finalSheet.toDataURL('image/jpeg', 0.95), copies: state.copies, printer: settings.printer })
          .then((r) => ({ type: 'print', ok: true, r }))
          .catch((e) => ({ type: 'print', ok: false, e }))
      );
    } else {
      postJSON('/api/save', { image: frameData }).catch(() => {});
    }
    if (email) {
      jobs.push(
        postJSON('/api/email', { email, image: frameData, photos: selectedPhotos().map((p) => scaledJpeg(p)) })
          .then((r) => ({ type: 'email', ok: true, r }))
          .catch((e) => ({ type: 'email', ok: false, e }))
      );
    }
    const results = await Promise.all(jobs);
    buttons.forEach((b) => (b.disabled = false));
    updateQty();

    const printRes = results.find((r) => r.type === 'print');
    const emailRes = results.find((r) => r.type === 'email');
    const problems = [];
    if (printRes && !printRes.ok) problems.push(`Printing failed: ${printRes.e.message}`);
    if (emailRes && !emailRes.ok) problems.push(`Email failed: ${emailRes.e.message}`);

    if (printRes && !printRes.ok) {
      setStatus(problems.join(' · '), 'error');
      showBrowserPrintFallback();
      return;
    }
    if (emailRes && !emailRes.ok && !printRes) {
      return setStatus(problems.join(' · '), 'error');
    }

    const lines = [];
    if (printRes) lines.push(`${state.copies} print${state.copies > 1 ? 's' : ''} ${printRes.r.dryRun ? 'saved (test mode, printer not used)' : 'on the way'}.`);
    if (emailRes?.ok) lines.push(`A digital copy was sent to ${email}.`);
    if (emailRes && !emailRes.ok) lines.push(`We couldn't send the email (${emailRes.e.message}). Please ask the booth staff.`);
    showDone(printRes ? 'Your photos are printing!' : 'Check your inbox!', lines.join(' '));
  }

  // If the server can't print, let the browser print dialog do it (one page per copy).
  function showBrowserPrintFallback() {
    if ($('#browser-print')) return;
    const b = document.createElement('button');
    b.id = 'browser-print';
    b.className = 'btn ghost small';
    b.textContent = 'Try the browser print dialog instead';
    b.addEventListener('click', browserPrint);
    $('#print-status').after(b);
  }

  function browserPrint() {
    const area = $('#print-area');
    const url = finalSheet.toDataURL('image/jpeg', 0.95);
    area.innerHTML = Array.from({ length: state.copies }, () => `<img src="${url}" alt="">`).join('');
    const imgs = [...area.querySelectorAll('img')];
    Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => (i.onload = r))))).then(() => {
      window.print();
      area.innerHTML = '';
    });
  }

  $('#print-btn').addEventListener('click', () => {
    if (!server) return browserPrint();
    finish({ print: true });
  });
  $('#email-only-btn').addEventListener('click', () => finish({ print: false }));
  $('#download-btn').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = finalFrame.toDataURL('image/jpeg', 0.95);
    a.download = `photobooth-${Date.now()}.jpg`;
    a.click();
  });

  // ---------- 6. done ----------
  let restartTimer = null;
  function showDone(title, detail) {
    $('#done-title').textContent = title;
    $('#done-detail').textContent = detail;
    go('done');
    window.FX?.confetti();
    let left = 30;
    const tick = () => ($('#restart-timer').textContent = `Starting over in ${left}s`);
    tick();
    clearInterval(restartTimer);
    restartTimer = setInterval(() => {
      left--;
      tick();
      if (left <= 0) go('layout');
    }, 1000);
  }
  $('#restart').addEventListener('click', () => go('layout'));

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    let el = $('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---------- settings dialog ----------
  async function openSettings() {
    $('#set-event').value = settings.eventName;
    $('#set-max').value = settings.maxCopies;
    $('#set-mirror').checked = settings.mirror;
    const sel = $('#set-printer');
    sel.innerHTML = '<option value="">System default</option>';
    if (server) {
      $('#server-info').textContent = `Print mode: ${server.printMode} · Email ${server.emailConfigured ? 'configured' : 'NOT configured'} · ${server.platform}`;
      try {
        const res = await fetch('/api/printers');
        const { printers = [], default: def } = await res.json();
        printers.forEach((p) => sel.insertAdjacentHTML('beforeend', `<option value="${p}">${p}${p === def ? ' (default)' : ''}</option>`));
      } catch {}
    } else {
      $('#server-info').textContent = 'Server not running — printing will use the browser dialog and email is unavailable. Run "npm start".';
    }
    sel.value = settings.printer;
    $('#settings').showModal();
  }
  $('#settings-btn').addEventListener('click', openSettings);
  $('#settings-save').addEventListener('click', () => {
    settings.eventName = $('#set-event').value.trim() || DEFAULT_SETTINGS.eventName;
    settings.printer = $('#set-printer').value;
    settings.maxCopies = Math.max(1, Math.min(50, parseInt($('#set-max').value, 10) || 10));
    settings.mirror = $('#set-mirror').checked;
    saveSettings();
    applyBranding();
    buildLayoutCards();
  });

  function applyBranding() {
    $('#brand-name').textContent = settings.eventName;
    document.title = settings.eventName;
  }

  // ---------- boot ----------
  async function boot() {
    applyBranding();
    try {
      const res = await fetch('/api/status');
      if (res.ok) server = await res.json();
    } catch {}
    await document.fonts.ready.catch(() => {});
    await Promise.all(['800 40px Archivo', '500 20px "Roboto Condensed"', 'italic 700 40px "Cormorant Garamond"', 'italic 600 40px "Cormorant Garamond"'].map((f) => document.fonts.load(f))).catch(() => {});
    buildLayoutCards();
  }
  boot();
})();
