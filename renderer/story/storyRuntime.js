/**
 * storyRuntime.js
 *
 * The script inlined into every generated story deck: scene navigation,
 * reveal and count-up animation, donuts, the cash value chart, the
 * client's tap-to-answer questions, and Send / Copy answers.
 *
 * It is product-agnostic. Everything client- or product-specific comes
 * from the deck's own JSON block (<script id="story-data">) and from the
 * markup's data-* attributes, so adding a product never touches this file.
 *
 * Written as a plain function and serialised with Function.prototype
 * .toString(), so it stays real, lintable JavaScript in this repo.
 */

'use strict';

/* eslint-disable no-var */
function storyRuntime() {
  var cfg = JSON.parse(document.getElementById('story-data').textContent);
  var slides = [].slice.call(document.querySelectorAll('.slide'));
  var deck = document.getElementById('deck');
  var progress = document.getElementById('progress');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var index = 0;

  slides.forEach(function () { progress.appendChild(document.createElement('span')); });

  function prepLines(root) {
    root.querySelectorAll('.brand-mark .ring, .ecg path, .settled .check path, .done path, .cond-art .ln, .scene-art .ln').forEach(function (p) {
      p.setAttribute('pathLength', '1200');
      p.style.strokeDasharray = '1200';
    });
  }
  prepLines(document);

  // People grid: 20 figures, cfg.peopleOn of them lit.
  (function people() {
    var g = document.getElementById('peopleGrid');
    if (!g) return;
    var lit = [0, 2, 4, 6, 8, 11, 13, 15, 17, 19, 1, 3, 5, 7, 9, 10, 12, 14, 16, 18].slice(0, cfg.peopleOn || 9);
    var out = '';
    for (var i = 0; i < 20; i++) {
      var x = 26 + (i % 10) * 52, y = Math.floor(i / 10) * 60;
      out += '<g class="p' + (lit.indexOf(i) >= 0 ? ' on' : '') + '" style="animation-delay:' + (0.2 + i * 0.05).toFixed(2) + 's"><circle cx="' + x + '" cy="' + (y + 14) + '" r="9"/><path d="M' + (x - 15) + ' ' + (y + 52) + ' q15 -36 30 0z"/></g>';
    }
    g.innerHTML = out;
  })();

  // Donuts: each .donut animates its own segments when its scene opens.
  var C = 2 * Math.PI * 88;
  [].forEach.call(document.querySelectorAll('.donut .seg'), function (s) {
    s.style.strokeDasharray = (Number(s.dataset.frac) * C) + ' ' + C;
    s.style.strokeDashoffset = String(-Number(s.dataset.start) * C);
  });
  function sweepDonut(slide) {
    if (reduce || !slide.animate) return;
    [].forEach.call(slide.querySelectorAll('.donut .seg'), function (s, i) {
      if (!s.animate) return;
      s.animate([{ strokeDasharray: '0 ' + C }, { strokeDasharray: (Number(s.dataset.frac) * C) + ' ' + C }],
        { duration: 1300, delay: 300 + i * 250, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' });
    });
  }

  function countUp(slide) {
    if (reduce) return;
    [].forEach.call(slide.querySelectorAll('[data-count]'), function (el) {
      var end = Number(el.dataset.count);
      var prefix = el.dataset.prefix || '';
      var suffix = el.dataset.suffix || '';
      var small = el.querySelector('small');
      var tail = small ? small.outerHTML : '';
      var finalVal = prefix + end.toLocaleString('en-MY') + suffix + tail;
      var start = performance.now();
      var dur = 1400;
      function tick(now) {
        var p = Math.min(1, (now - start) / dur);
        el.innerHTML = prefix + Math.round(end * (1 - Math.pow(1 - p, 3))).toLocaleString('en-MY') + suffix + tail;
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
      // Safety net: some browsers pause rAF in background tabs.
      setTimeout(function () { el.innerHTML = finalVal; }, dur + 250);
    });
  }

  // Cash value chart from the quotation's own illustration table.
  (function drawChart() {
    var svg = document.getElementById('growth');
    var sv = cfg.cashValue;
    if (!svg || !sv || !sv.points || sv.points.length < 2) return;
    var W = 640, H = 300, L = 74, R = 16, T = 28, B = 34;
    var pts = sv.points;
    var a0 = pts[0][0], a1 = pts[pts.length - 1][0];
    var peak = 0;
    pts.forEach(function (r) { peak = Math.max(peak, r[1], r[2]); });
    var step = Math.pow(10, Math.floor(Math.log10(Math.max(peak, 1))));
    var max = Math.ceil(peak / step) * step;
    if (max / step < 3) { step = step / 2; max = Math.ceil(peak / step) * step; }
    var x = function (age) { return L + (age - a0) / Math.max(1, a1 - a0) * (W - L - R); };
    var y = function (v) { return T + (1 - v / max) * (H - T - B); };
    var label = function (v) { return v >= 1000000 ? 'RM' + (v / 1000000).toLocaleString('en-MY') + 'm' : v >= 1000 ? 'RM' + (v / 1000).toLocaleString('en-MY') + 'k' : v ? 'RM' + v : '0'; };
    var out = '';
    for (var v = 0; v <= max + 1; v += step) {
      out += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="axis" x="' + (L - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + label(v) + '</text>';
    }
    var ticks = 6;
    for (var t = 0; t <= ticks; t++) {
      var age = Math.round(a0 + (a1 - a0) * t / ticks);
      out += '<text class="axis" x="' + x(age) + '" y="' + (H - 10) + '" text-anchor="middle">' + sv.axisLabel + ' ' + age + '</text>';
    }
    var path = function (i) { return pts.map(function (r, k) { return (k ? 'L' : 'M') + x(r[0]).toFixed(1) + ' ' + y(r[i]).toFixed(1); }).join(' '); };
    out += '<path class="areaY" d="' + path(2) + ' L' + x(a1) + ' ' + y(0) + ' L' + x(a0) + ' ' + y(0) + 'Z"/>';
    out += '<path class="lineY" pathLength="1200" stroke-dasharray="1200" d="' + path(2) + '"/>';
    out += '<path class="lineX" pathLength="1200" stroke-dasharray="1200" d="' + path(1) + '"/>';
    (sv.peaks || []).forEach(function (pk) {
      out += '<circle class="peak" cx="' + x(pk[0]) + '" cy="' + y(pk[1]) + '" r="6"/><text class="peak-t" x="' + x(pk[0]) + '" y="' + (y(pk[1]) - 12) + '" text-anchor="middle">RM' + Number(pk[1]).toLocaleString('en-MY') + '</text>';
    });
    svg.innerHTML = out;
  })();

  // ---------- Answers ----------
  // Every .chips group is one question: data-group is its key, data-label
  // its line in the summary, data-multi lets the client pick several, and
  // a chip with data-alone ("None yet") clears the others and vice versa.
  var chosen = {};
  var order = [];
  var labels = {};
  var sayText = {};
  [].forEach.call(document.querySelectorAll('.chips[data-group]'), function (grp) {
    var key = grp.dataset.group;
    chosen[key] = grp.dataset.multi === 'true' ? [] : '';
    order.push(key);
    labels[key] = grp.dataset.label || key;
    [].forEach.call(grp.querySelectorAll('.chip[data-text]'), function (c) { sayText[c.dataset.val] = c.dataset.text; });
  });
  var limitInput = document.getElementById('mcLimit');
  var limitBox = document.getElementById('limitBox');
  if (limitInput) { chosen.mcLimit = ''; labels.mcLimit = 'Medical card limit'; }

  function list(v) { return Array.isArray(v) ? v : (v ? [v] : []); }
  function hasCard() {
    var ex = document.querySelector('.chips[data-group="ex"]');
    return !!ex && !!ex.querySelector('.chip[data-card][aria-pressed="true"]');
  }
  function summaryLines() {
    var out = [];
    order.forEach(function (key) {
      var vals = list(chosen[key]);
      if (vals.length) out.push(labels[key] + ': ' + vals.join(', '));
      if (key === 'ex' && limitInput && hasCard() && chosen.mcLimit) out.push('Medical card limit: RM' + Number(chosen.mcLimit).toLocaleString('en-MY'));
    });
    return out;
  }
  function renderSaid() {
    var txt = '';
    var pri = list(chosen.pri);
    if (pri.length) txt += 'You said what matters most: <b>' + pri.map(function (v) { return sayText[v] || v; }).join(', ') + '</b>.';
    if (chosen.bud) txt += (txt ? ' ' : '') + 'Comfortable monthly amount: <b>' + chosen.bud + '</b>.';
    [].forEach.call(document.querySelectorAll('[data-said]'), function (el) { el.innerHTML = txt || el.dataset.said; });
    var lines = summaryLines();
    var box = document.getElementById('sendSummary');
    if (box) box.textContent = lines.length ? 'For ' + cfg.client + '\n' + lines.join('\n') : 'No answers yet. Tap your answers on the earlier screens.';
    if (limitBox) limitBox.hidden = !hasCard();
  }

  [].forEach.call(document.querySelectorAll('.chips[data-group]'), function (grp) {
    var multi = grp.dataset.multi === 'true';
    var key = grp.dataset.group;
    grp.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      e.stopPropagation();
      var on = chip.getAttribute('aria-pressed') !== 'true';
      [].forEach.call(grp.querySelectorAll('.chip'), function (c) {
        if (!multi || (on && (c.hasAttribute('data-alone') !== chip.hasAttribute('data-alone')))) c.setAttribute('aria-pressed', 'false');
      });
      chip.setAttribute('aria-pressed', String(on));
      var sel = [].map.call(grp.querySelectorAll('.chip[aria-pressed="true"]'), function (c) { return c.dataset.val; });
      chosen[key] = multi ? sel : (sel[0] || '');
      renderSaid();
    });
  });
  if (limitInput) limitInput.addEventListener('input', function () { chosen.mcLimit = limitInput.value.replace(/[^\d]/g, '').slice(0, 9); renderSaid(); });

  // ---------- Send / Copy ----------
  var sendBtn = document.getElementById('sendBtn');
  var sendStatus = document.getElementById('sendStatus');
  function setStatus(msg, kind) { sendStatus.textContent = msg; sendStatus.className = 'send-status' + (kind ? ' ' + kind : ''); }

  if (sendBtn) sendBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    var lines = summaryLines();
    if (!lines.length) { setStatus('Nothing to send yet. Tap some answers on the earlier screens first.', 'warn'); return; }
    var answers = {};
    Object.keys(chosen).forEach(function (k) {
      if (k === 'mcLimit' && !hasCard()) return;
      var v = chosen[k];
      if (Array.isArray(v) ? v.length : v) answers[k] = v;
    });
    sendBtn.disabled = true;
    setStatus('Sending…');
    fetch(cfg.portal, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, credentials: 'omit', body: JSON.stringify({ client: cfg.client, source: cfg.source, agentCode: cfg.agentFormCode || undefined, vbId: cfg.vbId || undefined, answers: answers, summary: lines }) })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, status: res.status, data: data }; }); })
      .then(function (r) {
        if (r.ok && r.data.success) { setStatus('Sent to ' + cfg.agentShort + '. Thank you!', 'ok'); sendBtn.textContent = 'Send updated answers'; }
        else if (r.status === 400 && r.data.error) setStatus(r.data.error, 'warn');
        else setStatus('Could not send right now. Tap Copy answers, then paste them to ' + cfg.agentShort + ' on WhatsApp.', 'warn');
      })
      .catch(function () { setStatus('Could not send right now. Tap Copy answers, then paste them to ' + cfg.agentShort + ' on WhatsApp.', 'warn'); })
      .then(function () { sendBtn.disabled = false; });
  });

  var copyBtn = document.getElementById('copyBtn');
  if (copyBtn) copyBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    var lines = summaryLines();
    var text = 'For ' + cfg.client + '\n' + (lines.length ? lines.join('\n') : 'No answers yet');
    var fallback = function () {
      var r = document.createRange();
      r.selectNodeContents(document.getElementById('sendSummary'));
      var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      setStatus('Answers selected. Copy them with your keyboard or the share menu.', '');
    };
    try {
      navigator.clipboard.writeText(text).then(function () { setStatus('Answers copied.', 'ok'); }, fallback);
    } catch (err) { fallback(); }
  });

  // ---------- Detail sheets ----------
  var sheet = document.getElementById('sheet');
  var sheetBg = document.getElementById('sheetBg');
  var sheetBody = document.getElementById('sheetBody');
  var lastFocus = null;
  function openSheet(id, from) {
    var tpl = document.getElementById(id);
    if (!tpl) return;
    sheetBody.innerHTML = '';
    sheetBody.appendChild(tpl.content.cloneNode(true));
    lastFocus = from || null;
    sheet.hidden = false; sheetBg.hidden = false;
    sheet.scrollTop = 0;
    document.getElementById('sheetX').focus();
  }
  function closeSheet() {
    if (sheet.hidden) return;
    sheet.hidden = true; sheetBg.hidden = true; sheetBody.innerHTML = '';
    if (lastFocus) lastFocus.focus();
  }
  [].forEach.call(document.querySelectorAll('[data-sheet]'), function (b) {
    b.addEventListener('click', function (e) { e.stopPropagation(); openSheet('sheet-' + b.dataset.sheet, b); });
  });
  document.getElementById('sheetX').addEventListener('click', function (e) { e.stopPropagation(); closeSheet(); });
  sheetBg.addEventListener('click', function (e) { e.stopPropagation(); closeSheet(); });
  sheet.addEventListener('click', function (e) { e.stopPropagation(); });

  // ---------- Presenter notes (agent preview only; stripped for clients) ----------
  var panel = document.getElementById('notesPanel');
  var notesBody = document.getElementById('notesBody');
  var notesBtn = document.getElementById('notesBtn');
  function renderNotes() {
    var n = slides[index].querySelector('.notes');
    notesBody.innerHTML = n ? n.innerHTML : '<p>No notes for this screen.</p>';
  }
  function toggleNotes() {
    if (!panel || !notesBtn) return;
    panel.hidden = !panel.hidden;
    notesBtn.setAttribute('aria-pressed', String(!panel.hidden));
    renderNotes();
  }
  if (notesBtn) notesBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleNotes(); });
  if (panel) panel.addEventListener('click', function (e) { e.stopPropagation(); });

  function show(i) {
    index = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach(function (s, k) {
      s.classList.toggle('is-active', k === index);
      s.classList.toggle('is-past', k < index);
    });
    var cur = slides[index];
    countUp(cur);
    if (cur.querySelector('.donut')) sweepDonut(cur);
    [].forEach.call(progress.children, function (p, k) { p.classList.toggle('on', k <= index); });
    document.getElementById('counter').textContent = (index + 1) + ' / ' + slides.length;
    document.getElementById('prev').disabled = index === 0;
    document.getElementById('next').disabled = index === slides.length - 1;
    document.getElementById('chrome').classList.toggle('night-chrome', cur.classList.contains('night'));
    document.getElementById('ribbon').hidden = index > 0;
    if (panel && !panel.hidden) renderNotes();
  }

  var INTERACTIVE = 'button, a, input, label, .chips, .form-card, .send-box, .sheet, .sheet-bg, .cmp-wrap';
  document.getElementById('prev').addEventListener('click', function (e) { e.stopPropagation(); show(index - 1); });
  document.getElementById('next').addEventListener('click', function (e) { e.stopPropagation(); show(index + 1); });
  deck.addEventListener('click', function (e) {
    if (e.target.closest(INTERACTIVE) || !sheet.hidden) return;
    show(e.clientX < window.innerWidth * 0.3 ? index - 1 : index + 1);
  });
  document.addEventListener('keydown', function (e) {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (e.key === 'Escape') { closeSheet(); return; }
    if (!sheet.hidden) return;
    if (['ArrowRight', 'PageDown', ' '].indexOf(e.key) >= 0) { e.preventDefault(); show(index + 1); }
    if (['ArrowLeft', 'PageUp'].indexOf(e.key) >= 0) { e.preventDefault(); show(index - 1); }
    if (e.key === 'n' || e.key === 'N') toggleNotes();
  });
  var sx = null;
  deck.addEventListener('touchstart', function (e) { sx = e.target.closest(INTERACTIVE) || !sheet.hidden ? null : e.touches[0].clientX; }, { passive: true });
  deck.addEventListener('touchend', function (e) {
    if (sx == null) return;
    var dx = e.changedTouches[0].clientX - sx;
    sx = null;
    if (Math.abs(dx) > 50) { e.preventDefault(); show(index + (dx < 0 ? 1 : -1)); }
  });

  renderSaid();
  show(0);
}

const STORY_RUNTIME_JS = `(${storyRuntime.toString()})();`;

module.exports = { STORY_RUNTIME_JS };
