/*
 * Live results screen. Refreshes every 5 seconds.
 *   ?hide=1  shows only "Votes so far: N" (for the final reveal)
 *
 * The frame list comes from vote.js (loaded first by results.html).
 */
(function () {
  // Apps Script web app URL. Leave empty to use the one in vote.js.
  const API_URL = '';

  const api = API_URL || window.VOTE_API_URL || '';
  const frames = window.VOTE_FRAMES || [];
  const hide = new URLSearchParams(location.search).get('hide') === '1';
  const list = document.getElementById('results');
  const total = document.getElementById('total');
  const status = document.getElementById('status');

  if (hide) {
    list.hidden = true;
    total.classList.add('results-hidden');
  }

  // one row per frame, built once and updated in place so the bars animate
  const rows = {};
  frames.forEach(function (f) {
    const li = document.createElement('li');
    li.className = 'results-row';
    li.innerHTML = '<span class="results-name"><span class="n"></span><small></small></span>' +
      '<span class="results-track" aria-hidden="true"><span class="results-fill"></span></span>' +
      '<span class="results-count"></span>';
    li.querySelector('.n').textContent = f.name;
    li.querySelector('small').textContent = f.cuts;
    list.appendChild(li);
    rows[f.id] = li;
  });

  function render(counts, sum, source) {
    total.textContent = 'Votes so far: ' + sum;
    const max = Math.max.apply(null, frames.map(function (f) { return counts[f.id] || 0; }).concat([0]));
    // most votes first
    frames.slice().sort(function (a, b) { return (counts[b.id] || 0) - (counts[a.id] || 0); }).forEach(function (f) {
      const n = counts[f.id] || 0;
      const pct = sum ? Math.round((n / sum) * 100) : 0;
      const li = rows[f.id];
      const lead = n > 0 && n === max;
      li.classList.toggle('lead', lead);
      li.querySelector('.n').textContent = (lead ? '★ ' : '') + f.name;
      li.querySelector('.results-fill').style.width = (max ? (n / max) * 100 : 0) + '%';
      li.querySelector('.results-count').textContent = n + ' · ' + pct + '%';
      list.appendChild(li);
    });
    status.textContent = source + ' · updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function renderLocal(prefix) {
    const tally = window.VoteStore ? window.VoteStore.get('trilogy-local-tally', {}) : {};
    let sum = 0;
    frames.forEach(function (f) { sum += tally[f.id] || 0; });
    render(tally, sum, prefix);
  }

  function refresh() {
    if (!api) return renderLocal('Showing votes saved on this device');
    window.fetchWithTimeout(api + (api.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), {}, 10000)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || typeof data.total !== 'number') throw new Error('bad data');
        render(data, data.total, 'Live results from the online sheet');
      })
      .catch(function () { renderLocal('Can’t reach the online sheet right now, showing votes saved on this device'); });
  }

  refresh();
  setInterval(refresh, 5000);
})();
