/*
 * "Vote for your favourite frame" page.
 *
 * API_URL: paste the Apps Script web app URL here (see VOTING_SETUP.md).
 * Leave it empty to keep votes on this device only (handy for one kiosk tablet).
 *
 * FRAMES: the frames from public/frames/, with small previews in public/vote-thumbs/.
 * The ids must match FRAME_IDS in apps-script/Code.gs.
 */
const API_URL = '';

const FRAMES = [
  { id: '3c-green', name: 'Green', cuts: '3 cuts', thumb: 'vote-thumbs/3c-green.jpg' },
  { id: '3c-sweet-treats-brown', name: 'Sweet Treats Brown', cuts: '3 cuts', thumb: 'vote-thumbs/3c-sweet-treats-brown.jpg' },
  { id: '3c-blue', name: 'Blue', cuts: '3 cuts', thumb: 'vote-thumbs/3c-blue.jpg' },
  { id: '3c-camera-light-blue', name: 'Camera Light Blue', cuts: '3 cuts', thumb: 'vote-thumbs/3c-camera-light-blue.jpg' },
  { id: '3c-red-hearts', name: 'Red Hearts', cuts: '3 cuts', thumb: 'vote-thumbs/3c-red-hearts.jpg' },
  { id: '3c-white', name: 'White', cuts: '3 cuts', thumb: 'vote-thumbs/3c-white.jpg' },
  { id: '4c-white', name: 'White', cuts: '4 cuts', thumb: 'vote-thumbs/4c-white.jpg' },
  { id: '4c-green', name: 'Green', cuts: '4 cuts', thumb: 'vote-thumbs/4c-green.jpg' },
  { id: '4c-brown-bear', name: 'Brown Bear', cuts: '4 cuts', thumb: 'vote-thumbs/4c-brown-bear.jpg' },
  { id: '4c-light-green', name: 'Light Green', cuts: '4 cuts', thumb: 'vote-thumbs/4c-light-green.jpg' },
  { id: '4c-dark-green', name: 'Dark Green', cuts: '4 cuts', thumb: 'vote-thumbs/4c-dark-green.jpg' },
  { id: '4c-red-hearts', name: 'Red Hearts', cuts: '4 cuts', thumb: 'vote-thumbs/4c-red-hearts.jpg' },
];

// shared with results.js
window.VOTE_API_URL = API_URL;
window.VOTE_FRAMES = FRAMES;

/*
 * Local storage (stays on this device, never sent):
 *   trilogy-voted         "1" once this phone has voted
 *   trilogy-local-tally   { frameId: count } votes kept on this device (no backend / offline)
 *   trilogy-pending       [frameId, ...] votes that couldn't be sent yet, retried later
 */
const VoteStore = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  },
  addLocal(id) {
    const tally = VoteStore.get('trilogy-local-tally', {});
    tally[id] = (tally[id] || 0) + 1;
    VoteStore.set('trilogy-local-tally', tally);
  },
};
window.VoteStore = VoteStore;

// fetch with a timeout, for slow Wi-Fi
function fetchWithTimeout(url, options, ms) {
  return new Promise(function (resolve, reject) {
    const timer = setTimeout(function () { reject(new Error('timeout')); }, ms);
    fetch(url, options).then(
      function (r) { clearTimeout(timer); resolve(r); },
      function (err) { clearTimeout(timer); reject(err); }
    );
  });
}
window.fetchWithTimeout = fetchWithTimeout;

// Sends one vote. text/plain avoids a CORS preflight, which Apps Script can't answer.
function sendVote(frameId) {
  return fetchWithTimeout(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ frameId: frameId }),
  }, 15000)
    .then(function (r) { return r.json(); })
    .then(function (data) { if (!data || !data.ok) throw new Error((data && data.error) || 'not saved'); });
}

(function () {
  const app = document.getElementById('vote-app');
  if (!app) return; // loaded by results.html just for the frame list

  const params = new URLSearchParams(location.search);
  const kiosk = params.get('kiosk') === '1';
  const $ = function (sel) { return document.querySelector(sel); };
  const screens = { pick: $('#screen-pick'), confirm: $('#screen-confirm'), thanks: $('#screen-thanks'), done: $('#screen-done') };
  const grid = $('#frame-grid');
  const submitBtn = $('#submit-btn');
  const live = $('#live');
  let selected = null;
  let resetTimer = null;

  const frameLabel = function (f) { return f.name + ' (' + f.cuts + ')'; };

  function show(name, focusEl) {
    Object.keys(screens).forEach(function (k) { screens[k].hidden = k !== name; });
    window.scrollTo(0, 0);
    if (focusEl) focusEl.focus();
  }

  function announce(text) {
    live.textContent = '';
    setTimeout(function () { live.textContent = text; }, 50);
  }

  let toastTimer = null;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 4000);
  }

  function setStatus() {
    const pending = VoteStore.get('trilogy-pending', []).length;
    let text;
    if (!API_URL) text = 'Votes are saved on this device.';
    else if (pending) text = 'Votes are saved online. ' + pending + ' saved on this device, sending when the connection is back.';
    else text = 'Votes are saved online.';
    if (kiosk) text += ' Kiosk mode.';
    $('#status').textContent = text;
  }

  // ---------- frame cards ----------
  FRAMES.forEach(function (f) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vote-card';
    b.setAttribute('aria-pressed', 'false');
    b.dataset.id = f.id;
    b.innerHTML =
      '<span class="vote-thumb"><img loading="lazy" width="200" height="600" alt=""></span>' +
      '<span class="vote-label"><span class="vote-name"></span><span class="vote-cuts"></span>' +
      '<span class="vote-check" aria-hidden="true">✓ Selected</span></span>';
    b.querySelector('img').src = f.thumb;
    b.querySelector('img').alt = f.name + ' photo strip frame, ' + f.cuts;
    b.querySelector('.vote-name').textContent = f.name;
    b.querySelector('.vote-cuts').textContent = f.cuts;
    b.addEventListener('click', function () { select(f.id); });
    grid.appendChild(b);
  });

  function select(id) {
    selected = id;
    grid.querySelectorAll('.vote-card').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.id === id));
    });
    const f = FRAMES.find(function (x) { return x.id === id; });
    submitBtn.disabled = !f;
    $('#selected-note').textContent = f ? 'Selected: ' + frameLabel(f) : 'Tap a frame to choose it.';
  }

  // ---------- confirm ----------
  submitBtn.addEventListener('click', function () {
    const f = FRAMES.find(function (x) { return x.id === selected; });
    if (!f) return;
    $('#confirm-img').src = f.thumb;
    $('#confirm-img').alt = f.name + ' photo strip frame, ' + f.cuts;
    $('#confirm-name').textContent = frameLabel(f);
    show('confirm', $('#confirm-title'));
  });

  $('#back-btn').addEventListener('click', function () {
    show('pick');
    const card = grid.querySelector('[aria-pressed="true"]');
    if (card) card.focus();
  });

  $('#yes-btn').addEventListener('click', function () {
    const btn = this;
    btn.disabled = true;
    btn.textContent = 'Sending…';
    const done = function (savedLocally) {
      btn.disabled = false;
      btn.textContent = 'Yes, submit my vote';
      if (!kiosk) VoteStore.set('trilogy-voted', '1');
      setStatus();
      show('thanks', $('#thanks-title'));
      announce('Vote submitted');
      if (savedLocally && API_URL) toast('No connection right now, so your vote is saved on this device and will be sent later.');
      if (kiosk) startKioskReset();
    };
    if (!API_URL) {
      VoteStore.addLocal(selected);
      return done(true);
    }
    sendVote(selected).then(function () { done(false); flushPending(); }, function () {
      VoteStore.addLocal(selected);
      const pending = VoteStore.get('trilogy-pending', []);
      pending.push(selected);
      VoteStore.set('trilogy-pending', pending);
      done(true);
    });
  });

  // ---------- kiosk: back to the start after 4 seconds ----------
  function startKioskReset() {
    let n = 4;
    const note = $('#kiosk-note');
    note.hidden = false;
    note.textContent = 'Next vote in ' + n + '…';
    clearInterval(resetTimer);
    resetTimer = setInterval(function () {
      n--;
      if (n > 0) {
        note.textContent = 'Next vote in ' + n + '…';
        return;
      }
      clearInterval(resetTimer);
      note.hidden = true;
      select(null);
      show('pick', $('#pick-title'));
    }, 1000);
  }

  // ---------- retry votes that couldn't be sent ----------
  let flushing = false;
  function flushPending() {
    if (!API_URL || flushing) return;
    const pending = VoteStore.get('trilogy-pending', []);
    if (!pending.length) return;
    flushing = true;
    sendVote(pending[0]).then(function () {
      const rest = VoteStore.get('trilogy-pending', []);
      rest.shift();
      VoteStore.set('trilogy-pending', rest);
      flushing = false;
      setStatus();
      flushPending();
    }, function () { flushing = false; });
  }

  // ---------- start ----------
  if (kiosk) document.body.classList.add('kiosk');
  setStatus();
  select(null);
  if (!kiosk && VoteStore.get('trilogy-voted', null)) show('done');
  else show('pick');
  flushPending();
  setInterval(flushPending, 30000);
  window.addEventListener('online', flushPending);
})();
