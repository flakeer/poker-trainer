
/* Visual effects layer: ripples, confetti, ambient home background. Never touches game state. */
(function () {
  'use strict';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Ambient floating suits behind the home screen
  var home = document.getElementById('home');
  if (home && !reduce) {
    var amb = document.createElement('div'); amb.className = 'ambient';
    var suits = ['♠', '♥', '♦', '♣'];
    for (var i = 0; i < 16; i++) {
      var s = document.createElement('span');
      s.textContent = suits[i % 4];
      s.style.left = (Math.random() * 96) + '%';
      s.style.fontSize = (22 + Math.random() * 54) + 'px';
      s.style.animationDuration = (16 + Math.random() * 22) + 's';
      s.style.animationDelay = (-Math.random() * 30) + 's';
      amb.appendChild(s);
    }
    home.insertBefore(amb, home.firstChild);
  }

  // Button ripple (delegated, so it works on buttons the game re-renders)
  document.addEventListener('pointerdown', function (e) {
    var b = e.target.closest && e.target.closest('button');
    if (!b || b.disabled || reduce) return;
    var r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2, sp = document.createElement('span');
    sp.className = 'ripple';
    sp.style.width = sp.style.height = d + 'px';
    sp.style.left = (e.clientX - r.left - d / 2) + 'px';
    sp.style.top = (e.clientY - r.top - d / 2) + 'px';
    b.appendChild(sp);
    setTimeout(function () { sp.remove(); }, 600);
  }, { passive: true });

  // Confetti burst for winners
  var COL = ['#ffc83d', '#19e3ff', '#ff3da6', '#2cff9a', '#a78bfa', '#ffffff'];
  function burst(x, y, n, power) {
    if (reduce || !Element.prototype.animate) return;
    for (var i = 0; i < n; i++) {
      var p = document.createElement('div'); p.className = 'confetti';
      p.style.left = x + 'px'; p.style.top = y + 'px';
      p.style.background = COL[(Math.random() * COL.length) | 0];
      document.body.appendChild(p);
      var ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1, v = (0.45 + Math.random() * 0.7) * power;
      var dx = Math.cos(ang) * v, dy = Math.sin(ang) * v, rot = (Math.random() - 0.5) * 900, dur = 1300 + Math.random() * 900;
      var a = p.animate([
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: 'translate(' + dx * 0.6 + 'px,' + (dy * 0.6 - 30) + 'px) rotate(' + rot * 0.5 + 'deg)', opacity: 1, offset: 0.4 },
        { transform: 'translate(' + dx + 'px,' + (dy + 260) + 'px) rotate(' + rot + 'deg)', opacity: 0 }
      ], { duration: dur, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' });
      a.onfinish = (function (el) { return function () { el.remove(); }; })(p);
    }
  }
  var fired = false, ring = document.getElementById('ring');
  if (ring) new MutationObserver(function () {
    var wins = ring.querySelectorAll('.seat.win');
    if (!wins.length) { fired = false; return; }
    if (fired) return;
    fired = true;
    if (window.PokerSFX) PokerSFX.play('sweep', { delay: 0.5 });
    wins.forEach(function (w) {
      var r = w.getBoundingClientRect(), mine = w.classList.contains('me');
      burst(r.left + r.width / 2, r.top + r.height / 3, mine ? 70 : 20, mine ? 520 : 240);
    });
  }).observe(ring, { childList: true });

  // ---- layout: side panels (coach + review on the left) vs classic ----
  (function () {
    var KEY = 'poker.layout', mq = window.matchMedia('(min-width:820px)'), body = document.body, side = null;
    var $ = function (id) { return document.getElementById(id); };
    var coach = $('coach'), mist = $('mist'), review = $('review'), tbl = $('table'), clockbar = $('clockbar'), btn = $('layoutbtn');
    var pref = function () { try { return localStorage.getItem(KEY) || 'side'; } catch (e) { return 'side'; } };
    function build() {
      side = document.createElement('aside'); side.id = 'side';
      side.innerHTML = '<section class="sidep" id="coachpanel"><h4>🎓 Coach</h4><div class="sidebody"></div></section>' +
        '<section class="sidep" id="reviewpanel"><h4>📋 Hand review</h4><div class="sidebody"></div></section>';
    }
    function apply() {
      var on = mq.matches && pref() === 'side', has = body.classList.contains('side');
      if (on && !has) {
        if (!side) build();
        side.querySelector('#coachpanel .sidebody').append(coach, mist);
        side.querySelector('#reviewpanel .sidebody').append(review);
        body.insertBefore(side, document.querySelector('header'));
        body.classList.add('side');
      } else if (!on && has) {
        body.classList.remove('side');
        tbl.appendChild(review);
        body.insertBefore(coach, clockbar); body.insertBefore(mist, clockbar);
        side.remove();
      }
      if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (btn) btn.onclick = function () { try { localStorage.setItem(KEY, pref() === 'side' ? 'classic' : 'side'); } catch (e) {} apply(); };
    if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply);
    apply();
  })();

  // ---- sound hooks for UI ----
  var S = window.PokerSFX;
  if (S) {
    // button clicks (table action buttons already make their own sounds)
    document.addEventListener('pointerdown', function (e) {
      var b = e.target.closest && e.target.closest('button');
      if (!b || b.disabled || b.id === 'sfx' || b.closest('#controls')) return;
      S.play(b.id === 'deal' ? 'shuffle' : 'click');
    }, { passive: true });
    // soft tick when hovering menu cards
    document.addEventListener('pointerover', function (e) {
      var c = e.target.closest && e.target.closest('.mcard');
      if (c && !c.contains(e.relatedTarget)) S.play('tick');
    }, { passive: true });
    // level-up, badge and streak jingles, driven by the toast text
    var toastEl = document.getElementById('toast');
    if (toastEl) new MutationObserver(function () {
      var t = toastEl.textContent || '';
      if (!toastEl.classList.contains('show') || !t) return;
      if (t.indexOf('⬆️') >= 0) S.play('levelup');
      else if (t.indexOf('🏅') >= 0 || t.indexOf('🧭') >= 0) S.play('badge');
      else if (t.indexOf('Not enough') >= 0) S.play('error');
    }).observe(toastEl, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }
})();
