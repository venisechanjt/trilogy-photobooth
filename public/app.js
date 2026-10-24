(() => {
  const { LAYOUTS, FRAMES, getFrame, framesFor, renderFrame, renderPrintSheet } = window.Frames;
  const TOTAL_SHOTS = 8;
  const $ = (sel) => document.querySelector(sel);

  // ---------- settings (stored on this device for the operator) ----------
  const DEFAULT_SETTINGS = { eventName: 'trilogy', printer: '', timer: 3, mode: 'auto', maxCopies: 10, mirror: true, cameraId: '', printDialog: false };
  const TIMERS = [0, 3, 5];
  let settings = { ...DEFAULT_SETTINGS };
  try {
    settings = { ...settings, ...JSON.parse(localStorage.getItem('photobooth-settings') || '{}') };
  } catch {}
  if (!TIMERS.includes(settings.timer)) settings.timer = DEFAULT_SETTINGS.timer;
  if (!['auto', 'manual'].includes(settings.mode)) settings.mode = DEFAULT_SETTINGS.mode;
  // a 0s timer only makes sense when the guest presses the button for every photo
  if (settings.mode === 'auto' && settings.timer === 0) settings.timer = DEFAULT_SETTINGS.timer;
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
    frame: null, // id of the chosen frame (see Frames.FRAMES)
    shots: Array(TOTAL_SHOTS).fill(null), // canvases
    selection: [], // indexes into shots, in slot order
    copies: 1,
  };

  const need = () => getFrame(state.frame)?.count || 0;
  const isStrip = () => LAYOUTS[state.layout].strip;
  const selectedPhotos = () => state.selection.map((i) => state.shots[i]);

  // ---------- navigation ----------
  let current = 'home';
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
    document.body.classList.toggle('on-home', screen === 'home');
    clearInterval(wallTimer);
    if (screen === 'home') {
      resetSession();
      loadWall();
      wallTimer = setInterval(loadWall, 15000);
    }
    window.scrollTo(0, 0);

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
    state.frame = null;
    state.shots = Array(TOTAL_SHOTS).fill(null);
    state.selection = [];
    state.copies = 1;
    state.savedStrip = null;
    state.wallStrip = null;
    renderShots();
    $('#pick-grid').innerHTML = '';
    $('#wall-consent').checked = true;
    $('#email').value = '';
    $('#print-status').textContent = '';
    clearInterval(restartTimer);
  }

  // ---------- 1. layout ----------
  // Only layouts that have at least one frame are offered.
  function buildLayoutCards() {
    const wrap = $('#layout-cards');
    wrap.innerHTML = '';
    const layouts = Object.values(LAYOUTS).filter((l) => framesFor(l.id).length);
    $('#no-frames').hidden = layouts.length > 0;
    layouts.forEach((layout) => {
      const card = document.createElement('button');
      card.className = 'layout-card';
      card.innerHTML = `<div class="thumb"></div><h2>${layout.name}</h2><p>${layout.blurb}</p>`;
      card.querySelector('.thumb').appendChild(renderFrame(document.createElement('canvas'), framesFor(layout.id)[0].id, [], { scale: 0.18 }));
      card.addEventListener('click', () => chooseLayout(layout.id));
      wrap.appendChild(card);
    });
  }

  function chooseLayout(id) {
    state.layout = id;
    state.frame = framesFor(id)[0].id;
    go(id === '4r' ? 'frame' : 'camera');
  }

  // ---------- frame choices (4R frame screen + pick screen) ----------
  // The pick screen offers frames with the same number of photos; the 4R frame screen offers every
  // 4R frame, and picking one sets how many photos the guest chooses.
  const framesToOffer = (anyCount = false) => framesFor(state.layout).filter((f) => anyCount || f.count === need());

  function ensureFrame() {
    if (!getFrame(state.frame)) state.frame = framesFor(state.layout)[0]?.id || null;
  }

  function buildFrameList(container, onPick, anyCount = false) {
    container.innerHTML = '';
    framesToOffer(anyCount).forEach((f) => {
      const b = document.createElement('button');
      b.className = 'frame-chip' + (f.id === state.frame ? ' active' : '');
      b.appendChild(renderFrame(document.createElement('canvas'), f.id, [], { scale: f.layout === '4r' ? 0.05 : 0.07 }));
      b.insertAdjacentHTML('beforeend', `<span><b></b><small>${f.count} photo${f.count > 1 ? 's' : ''}</small></span>`);
      b.querySelector('b').textContent = f.name;
      b.addEventListener('click', () => {
        state.frame = f.id;
        state.selection = state.selection.slice(0, need());
        onPick();
      });
      container.appendChild(b);
    });
  }

  // ---------- 2. frame (4R) ----------
  function renderFrameScreen() {
    ensureFrame();
    buildFrameList($('#frame-list'), renderFrameScreen, true);
    renderFrame($('#frame-preview'), state.frame, selectedPhotos(), { scale: 0.5 });
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

  // 4R windows adapt to the camera's shape; strips use the fixed template windows
  video.addEventListener('loadedmetadata', () => {
    const aspect = video.videoWidth / video.videoHeight;
    $('#viewfinder').style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    document.documentElement.style.setProperty('--photo-aspect', aspect);
    settings.photoAspect = aspect;
    saveSettings();
    positionGuide();
  });

  // Dashed box showing the part of the picture that fits the chosen frame's photo windows.
  function positionGuide() {
    const guide = $('#guide');
    const slotAspect = state.frame && Frames.frameSlotAspect(state.frame);
    if (!slotAspect || !video.videoWidth) return (guide.style.display = 'none');
    const camAspect = video.videoWidth / video.videoHeight;
    let w = 100;
    let h = 100;
    if (slotAspect < camAspect) w = (slotAspect / camAspect) * 100;
    else h = (camAspect / slotAspect) * 100;
    Object.assign(guide.style, { display: 'block', width: `${w}%`, height: `${h}%`, left: `${(100 - w) / 2}%`, top: `${(100 - h) / 2}%` });
  }

  $('#camera-select').addEventListener('change', (e) => {
    settings.cameraId = e.target.value;
    saveSettings();
    startCamera();
  });

  function enterCamera() {
    document.body.classList.toggle('mirror', settings.mirror);
    renderShots();
    positionGuide();
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
      renderFrame($('#select-preview'), state.frame, selectedPhotos(), { scale: 0.5 });
    });
  }

  function renderSelectScreen() {
    ensureFrame();
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
    buildFrameList($('#select-frame-list'), renderSelectScreen);
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
    finalFrame = renderFrame(document.createElement('canvas'), state.frame, selectedPhotos());
    finalSheet = renderPrintSheet(finalFrame, isStrip());
    const prev = $('#print-preview');
    prev.width = finalSheet.width / 2;
    prev.height = finalSheet.height / 2;
    prev.getContext('2d').drawImage(finalSheet, 0, 0, prev.width, prev.height);
    $('#sheet-note').textContent = isStrip() ? 'Each print is a 4R sheet with 2 strips — cut down the middle.' : '4R (4×6") print';
    $('#print-status').textContent = '';
    $('#print-status').className = 'status';
    $('#test-mode-note').hidden = server?.printMode !== 'dry' || settings.printDialog;
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

  // headers for settings actions: the server checks the PIN the settings were unlocked with
  const adminHeaders = () => (adminPin ? { 'x-admin-pin': adminPin } : {});

  async function postJSON(url, body, method = 'POST') {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...adminHeaders() }, body: JSON.stringify(body) });
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
    // also download the ready-to-print 4R sheet (to the laptop's Downloads folder); done straight away,
    // while the tap still counts as the user's own action, so the browser doesn't block it
    if (print) downloadSheet();
    const buttons = document.querySelectorAll('#screen-print button');
    buttons.forEach((b) => (b.disabled = true));
    setStatus(print ? `Sending ${state.copies} print${state.copies > 1 ? 's' : ''} to the printer…` : 'Sending email…', 'busy');

    const frameData = finalFrame.toDataURL('image/jpeg', 0.95);
    const jobs = [];
    if (print && settings.printDialog) {
      // operator chose to see the print settings window (printer, paper size…) for every print
      jobs.push(browserPrint().then(() => ({ type: 'print', ok: true, r: { dialog: true } })));
    } else if (print) {
      jobs.push(
        postJSON('/api/print', { image: finalSheet.toDataURL('image/jpeg', 0.95), copies: state.copies, printer: settings.printer })
          .then((r) => ({ type: 'print', ok: true, r }))
          .catch((e) => ({ type: 'print', ok: false, e }))
      );
    }
    // keep each finished photostrip once, as the 4R sheet (strips doubled side by side, ready for 4x6 paper);
    // a retry after a failed print doesn't save it again
    if (state.savedStrip !== finalFrame) {
      state.savedStrip = finalFrame;
      postJSON('/api/save', { image: finalSheet.toDataURL('image/jpeg', 0.95) }).catch(() => (state.savedStrip = null));
    }
    if ($('#wall-consent').checked && state.wallStrip !== finalFrame) {
      state.wallStrip = finalFrame;
      postJSON('/api/wall', { image: frameData, thumb: scaledJpeg(finalFrame, 700) }).catch(() => (state.wallStrip = null));
    }
    if (email) {
      jobs.push(
        postJSON('/api/email', { email, event: settings.eventName, image: frameData, photos: state.shots.filter(Boolean).map((p) => scaledJpeg(p)) })
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
    if (state.wallStrip) lines.push('Your photostrip is pinned on the booth wall.');
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

  function downloadSheet() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const name = (settings.eventName || 'photobooth').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'photobooth';
    const a = document.createElement('a');
    a.href = finalSheet.toDataURL('image/jpeg', 0.95);
    a.download = `${name}-4R-${stamp}.jpg`;
    a.click();
  }

  // Opens the print window (one 4x6 page per copy); resolves when the window is closed.
  async function browserPrint() {
    const area = $('#print-area');
    const url = finalSheet.toDataURL('image/jpeg', 0.95);
    area.innerHTML = Array.from({ length: state.copies }, () => `<img src="${url}" alt="">`).join('');
    const imgs = [...area.querySelectorAll('img')];
    await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => (i.onload = r)))));
    window.print();
    area.innerHTML = '';
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
    // the session is over: drop the individual photos right away (the privacy note promises this)
    state.shots = Array(TOTAL_SHOTS).fill(null);
    state.selection = [];
    renderShots(); // also removes the thumbnails from the (hidden) camera screen
    $('#pick-grid').innerHTML = '';
    window.FX?.confetti();
    let left = 30;
    const tick = () => ($('#restart-timer').textContent = `Starting over in ${left}s`);
    tick();
    clearInterval(restartTimer);
    restartTimer = setInterval(() => {
      left--;
      tick();
      if (left <= 0) go('home');
    }, 1000);
  }
  $('#restart').addEventListener('click', () => go('home'));

  // If a guest walks away mid-session, go home after 3 minutes without a touch so their photos are cleared.
  const IDLE_MS = 3 * 60 * 1000;
  let lastActivity = Date.now();
  ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => (lastActivity = Date.now()), true));
  setInterval(() => {
    const midSession = ['layout', 'frame', 'camera', 'select', 'print'].includes(current);
    if (midSession && !shooting && !document.querySelector('dialog[open]') && Date.now() - lastActivity > IDLE_MS) go('home');
  }, 10000);
  // the logo in the top bar always leads home; check first if a guest is partway through a session
  $('#brand-home').addEventListener('click', () => {
    if (current === 'home') return;
    const inProgress = ['camera', 'select', 'print'].includes(current) && state.shots.some(Boolean);
    if (inProgress && !confirm('Go back to the home page? The photos from this session will be lost.')) return;
    go('home');
  });

  // ---------- home + booth wall ----------
  let wallTimer = null;
  let wallIds = null;
  $('#start-btn').addEventListener('click', () => go('layout'));
  $('#wall-link').addEventListener('click', (e) => {
    e.preventDefault();
    $('#wall').scrollIntoView({ behavior: 'smooth' });
  });

  // a stable little tilt per photo, so the wall looks hand-pinned
  function tiltFor(id) {
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return ((Math.abs(h) % 90) / 10 - 4.5).toFixed(1);
  }

  async function loadWall() {
    const grid = $('#wall-grid');
    if (!server) {
      $('#wall-count').textContent = 'The booth wall needs the photobooth server running (npm start).';
      return;
    }
    let photos;
    try {
      ({ photos } = await (await fetch('/api/wall')).json());
    } catch {
      return;
    }
    const firstLoad = wallIds === null;
    const known = wallIds || new Set();
    if (!firstLoad && photos.length === known.size && photos.every((p) => known.has(p.id))) return;

    grid.innerHTML = '';
    photos.forEach((p, i) => {
      const card = document.createElement('button');
      card.className = 'wall-card' + (!firstLoad && !known.has(p.id) ? ' fresh' : '');
      card.style.setProperty('--tilt', `${tiltFor(p.id)}deg`);
      card.style.setProperty('--delay', `${Math.min(i, 20) * 40}ms`);
      card.innerHTML = `<span class="clip" aria-hidden="true"></span><img loading="lazy" alt="Photo strip from the booth" src="${p.thumb}">`;
      card.addEventListener('click', () => openLightbox(p));
      grid.appendChild(card);
    });
    wallIds = new Set(photos.map((p) => p.id));
    $('#wall-empty').hidden = photos.length > 0;
    $('#wall-count').textContent = photos.length ? `${photos.length} photo${photos.length > 1 ? 's' : ''} and counting` : '';
  }

  function openLightbox(p) {
    $('#lightbox-img').src = p.url;
    $('#lightbox-date').textContent = new Date(p.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    $('#lightbox').showModal();
  }
  $('#lightbox').addEventListener('click', (e) => {
    if (e.target.id === 'lightbox') $('#lightbox').close();
  });


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
    $('#set-print-dialog').checked = settings.printDialog;
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
    resetClearWall();
    refreshWallAdmin();
    renderFrameAdmin();
    $('#frame-upload-status').textContent = '';
    $('#email-admin-state').textContent = !server
      ? 'Needs the server running.'
      : server.emailConfigured
        ? 'Set up. Send yourself a test to check it.'
        : 'Not set up yet. Run "npm run setup-email" in PowerShell, then restart the booth.';
    $('#test-email-status').textContent = '';
    $('#test-print-status').textContent = '';
    loadEmailTemplate();
    $('#settings').showModal();
  }

  $('#test-email-btn').addEventListener('click', async () => {
    const input = $('#test-email');
    const status = $('#test-email-status');
    if (!input.value.trim() || !input.checkValidity()) {
      status.textContent = 'Enter the address to send the test to.';
      return input.focus();
    }
    const btn = $('#test-email-btn');
    btn.disabled = true;
    status.textContent = 'Sending…';
    try {
      // the test uses the template as it is on screen, with a sample photostrip attached
      if (templateChanged()) await saveEmailTemplate();
      const sampleFrame = framesFor('strip3')[0] || FRAMES[0];
      const sample = sampleFrame && renderFrame(document.createElement('canvas'), sampleFrame.id, []);
      await postJSON('/api/email/test', { to: input.value.trim(), event: settings.eventName, image: sample ? sample.toDataURL('image/jpeg', 0.9) : undefined });
      status.textContent = `✓ Sent to ${input.value.trim()}. Check the inbox (and spam).`;
    } catch (err) {
      status.textContent = `✗ ${err.message}`;
    }
    btn.disabled = false;
  });

  // prints a 4x6 calibration page on the printer currently picked in the list (saved or not)
  $('#test-print-btn').addEventListener('click', async () => {
    const status = $('#test-print-status');
    if (!server) return (status.textContent = 'Printing needs the server running (npm start).');
    const btn = $('#test-print-btn');
    btn.disabled = true;
    status.textContent = 'Sending the test page…';
    try {
      const r = await postJSON('/api/print/test', { printer: $('#set-printer').value });
      status.textContent = r.dryRun
        ? `Test mode: nothing printed. The page was saved as ${r.file}. Start the booth with npm start to print.`
        : '✓ Sent. Check the page: the green border should be about 3 mm from every edge.';
    } catch (err) {
      status.textContent = `✗ ${err.message}`;
    }
    btn.disabled = false;
  });

  // ---------- email template ----------
  let savedTemplate = null;
  const templateFromForm = () => ({ subject: $('#tpl-subject').value, body: $('#tpl-body').value, attachPhotos: $('#tpl-photos').checked });
  const templateChanged = () => savedTemplate && JSON.stringify(templateFromForm()) !== JSON.stringify(savedTemplate);

  function fillTemplateForm(t) {
    $('#tpl-subject').value = t.subject;
    $('#tpl-body').value = t.body;
    $('#tpl-photos').checked = Boolean(t.attachPhotos);
  }
  async function loadEmailTemplate() {
    $('#tpl-status').textContent = '';
    if (!server) return;
    try {
      savedTemplate = await (await fetch('/api/email/template')).json();
      fillTemplateForm(savedTemplate);
    } catch {}
  }
  async function saveEmailTemplate() {
    const { template } = await postJSON('/api/email/template', templateFromForm(), 'PUT');
    savedTemplate = template;
    fillTemplateForm(template);
  }
  $('#tpl-save').addEventListener('click', async () => {
    try {
      await saveEmailTemplate();
      $('#tpl-status').textContent = '✓ Template saved. Guests get it from now on.';
    } catch (err) {
      $('#tpl-status').textContent = `✗ ${err.message}`;
    }
  });
  $('#tpl-reset').addEventListener('click', async () => {
    try {
      fillTemplateForm(await (await fetch('/api/email/template?default=1')).json());
      $('#tpl-status').textContent = 'Default text restored. Tap “Save template” to keep it.';
    } catch {}
  });

  // ---------- uploaded frames ----------
  const LAYOUT_LABEL = { strip3: '3 cuts', strip4: '4 cuts', '4r': '4R' };
  const loadImg = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That file isn’t an image the browser can open.'));
      img.src = src;
    });
  const readAsDataUrl = (file) =>
    new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(file);
    });

  // Loads the permanent frames (public/frames/ in the repo) and the ones uploaded in settings.
  let frameProblems = [];
  async function loadFrames() {
    if (!server) return;
    try {
      const { frames = [], repo = [] } = await (await fetch('/api/frames')).json();
      const [repoImages, uploadImages] = await Promise.all([
        Promise.all(repo.map((r) => loadImg(r.url).catch(() => null))),
        Promise.all(frames.map((f) => loadImg(f.url).catch(() => null))),
      ]);
      FRAMES.splice(0);
      frameProblems = [];
      // every frame is scanned on load: this finds its photo windows and prepares the see-through top layer
      const add = (img, label, info) => {
        if (!img) return frameProblems.push(`${label}: couldn’t be opened`);
        try {
          const found = Frames.detectFrameWindows(img);
          Frames.addFrame({ ...info, layout: found.layout, slots: found.slots, overlay: found.overlay });
        } catch (err) {
          frameProblems.push(`${label}: ${err.message}`);
        }
      };
      repo.forEach((r, i) => add(repoImages[i], r.file, { id: `repo:${r.file}`, name: r.name, url: r.url, source: 'repo' }));
      frames.forEach((f, i) => add(uploadImages[i], f.name, { id: `upload:${f.id}`, uploadId: f.id, name: f.name, url: f.url, source: 'upload' }));
    } catch {}
  }

  async function refreshFrames() {
    await loadFrames();
    renderFrameAdmin();
    buildLayoutCards();
  }

  function renderFrameAdmin() {
    const list = $('#frame-admin-list');
    list.innerHTML = FRAMES.length ? '' : '<span class="hint">No frames yet.</span>';
    FRAMES.forEach((f) => {
      const row = document.createElement('div');
      row.className = 'frame-row';
      row.innerHTML = `<img src="${f.url}" alt=""><span><b></b><small>${LAYOUT_LABEL[f.layout]} · ${f.count} photo${f.count > 1 ? 's' : ''}</small></span>`;
      row.querySelector('b').textContent = f.name;
      if (f.source === 'repo') {
        row.insertAdjacentHTML('beforeend', '<span class="frame-tag" title="Saved in the GitHub repo (public/frames)">Permanent</span>');
      } else {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn ghost small danger';
        del.textContent = 'Remove';
        let armed = null;
        del.addEventListener('click', async () => {
          if (!armed) {
            del.classList.add('armed');
            del.textContent = 'Tap again';
            armed = setTimeout(() => {
              armed = null;
              del.classList.remove('armed');
              del.textContent = 'Remove';
            }, 4000);
            return;
          }
          clearTimeout(armed);
          del.disabled = true;
          await fetch(`/api/frames/${f.uploadId}`, { method: 'DELETE', headers: adminHeaders() }).catch(() => {});
          refreshFrames();
        });
        row.appendChild(del);
      }
      list.appendChild(row);
    });
    frameProblems.forEach((msg) => {
      const note = document.createElement('small');
      note.className = 'frame-problem';
      note.textContent = `⚠ ${msg}`;
      list.appendChild(note);
    });
  }

  $('#frame-upload').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    const status = $('#frame-upload-status');
    if (!server) {
      status.textContent = 'Uploading frames needs the server running (npm start).';
      return;
    }
    const lines = [];
    for (const file of files) {
      const name = file.name.replace(/\.[^.]+$/, '');
      status.textContent = `Reading ${file.name}…`;
      try {
        const url = URL.createObjectURL(file);
        const img = await loadImg(url);
        const found = Frames.detectFrameWindows(img);
        let image;
        if (/^image\/(png|jpeg)$/.test(file.type)) {
          image = await readAsDataUrl(file);
        } else {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          image = c.toDataURL('image/png');
        }
        URL.revokeObjectURL(url);
        const { overlay, ...windows } = found; // the server only needs where the windows are
        await postJSON('/api/frames', { name, image, ...windows });
        lines.push(`✓ ${name}: ${LAYOUT_LABEL[found.layout]}, ${found.slots.length} photo windows found`);
      } catch (err) {
        lines.push(`✗ ${file.name}: ${err.message}`);
      }
    }
    await refreshFrames();
    status.textContent = lines.join('\n');
  });

  // ---------- clear booth wall (two taps; photos are archived, not deleted) ----------
  let wallAdminCount = 0;
  let clearArmTimer = null;
  async function refreshWallAdmin() {
    const btn = $('#clear-wall');
    if (!server) {
      $('#wall-admin-count').textContent = 'Needs the server running.';
      btn.disabled = true;
      return;
    }
    try {
      const { total } = await (await fetch('/api/wall')).json();
      wallAdminCount = total;
      $('#wall-admin-count').textContent = `${total} photo${total === 1 ? '' : 's'} on the wall`;
      btn.disabled = total === 0;
    } catch {
      $('#wall-admin-count').textContent = 'Couldn’t read the wall.';
    }
  }
  function resetClearWall() {
    clearTimeout(clearArmTimer);
    const btn = $('#clear-wall');
    btn.classList.remove('armed');
    btn.textContent = 'Clear booth wall';
    $('#clear-wall-status').textContent = '';
  }
  $('#clear-wall').addEventListener('click', async () => {
    const btn = $('#clear-wall');
    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed');
      btn.textContent = `Tap again to clear ${wallAdminCount} photo${wallAdminCount === 1 ? '' : 's'}`;
      clearArmTimer = setTimeout(resetClearWall, 4000);
      return;
    }
    clearTimeout(clearArmTimer);
    btn.disabled = true;
    try {
      const { cleared, archive } = await postJSON('/api/wall/clear', {});
      resetClearWall();
      $('#clear-wall-status').textContent = cleared
        ? `Cleared ${cleared} photo${cleared === 1 ? '' : 's'}. They're saved in ${archive}.`
        : 'The wall was already empty.';
      wallIds = null;
      if (current === 'home') loadWall();
    } catch (err) {
      resetClearWall();
      $('#clear-wall-status').textContent = `Couldn't clear the wall: ${err.message}`;
    }
    refreshWallAdmin();
  });
  $('#settings-btn').addEventListener('click', () => (server?.pinRequired && adminPin === null ? openPinPad() : openSettings()));
  // lock again whenever the settings close
  $('#settings').addEventListener('close', () => (adminPin = null));

  // ---------- settings PIN pad ----------
  let adminPin = null;
  let pinEntry = '';
  let pinBusy = false;
  function renderPinDots() {
    const len = server?.pinLength || 4;
    $('#pin-dots').innerHTML = Array.from({ length: len }, (_, i) => `<span class="${i < pinEntry.length ? 'on' : ''}"></span>`).join('');
  }
  function openPinPad() {
    pinEntry = '';
    $('#pin-status').textContent = '';
    renderPinDots();
    $('#pin-dialog').showModal();
  }
  async function pinKey(key) {
    if (pinBusy) return;
    if (key === 'cancel') return $('#pin-dialog').close();
    if (key === 'back') pinEntry = pinEntry.slice(0, -1);
    else if (/^\d$/.test(key) && pinEntry.length < (server?.pinLength || 8)) pinEntry += key;
    renderPinDots();
    if (pinEntry.length !== server?.pinLength) return;
    pinBusy = true;
    try {
      await postJSON('/api/admin/unlock', { pin: pinEntry });
      adminPin = pinEntry;
      $('#pin-dialog').close();
      openSettings();
    } catch (err) {
      $('#pin-status').textContent = err.message;
      const dots = $('#pin-dots');
      dots.classList.remove('shake');
      void dots.offsetWidth;
      dots.classList.add('shake');
      pinEntry = '';
      renderPinDots();
    }
    pinBusy = false;
  }
  document.querySelectorAll('#pin-dialog [data-key]').forEach((b) => b.addEventListener('click', () => pinKey(b.dataset.key)));
  $('#pin-dialog').addEventListener('keydown', (e) => {
    if (/^\d$/.test(e.key)) pinKey(e.key);
    else if (e.key === 'Backspace') pinKey('back');
    else return;
    e.preventDefault();
  });
  $('#settings-save').addEventListener('click', () => {
    settings.eventName = $('#set-event').value.trim() || DEFAULT_SETTINGS.eventName;
    settings.printer = $('#set-printer').value;
    settings.maxCopies = Math.max(1, Math.min(50, parseInt($('#set-max').value, 10) || 10));
    settings.mirror = $('#set-mirror').checked;
    settings.printDialog = $('#set-print-dialog').checked;
    saveSettings();
    applyBranding();
    buildLayoutCards();
  });

  function applyBranding() {
    $('#brand-name').textContent = settings.eventName;
    $('#hero-name').textContent = settings.eventName;
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
    await loadFrames();
    buildLayoutCards();
    go('home');
  }
  boot();
})();
