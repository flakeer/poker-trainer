
/* UI + placeholder opponents (simple bots; the Master AI replaces them in Step 5). */
(function () {
  'use strict';
  const E = window.PokerEngine, Q = window.PokerEquity;
  const $ = (id) => document.getElementById(id);
  const SUIT = ['♣', '♦', '♥', '♠'], RANK = '23456789TJQKA';
  const HUMAN = 0;
  const Rv = window.PokerReview, Vx = window.PokerVex, SFX = window.PokerSFX, AI = window.PokerAI, Tr = window.PokerTrainer, St = window.PokerStats, svc = Q.createEquityService();
  let decisions = [], lastReview = null, toastTimer = null, bots = {}, table = null, timer = null, advice = null, advKey = '', advSeq = 0, feedback = '', setRaise = null;

  const COLORS = ['#19e3ff', '#ff3da6', '#ffc83d', '#2cff9a', '#a78bfa', '#ff8a3d'];
  let seen = new Set(), seenHand = -1, dealCount = 0, lastPing = '';

  function chipsEl(amount) {
    const d = document.createElement('div'), n = Math.min(6, 1 + Math.floor(Math.sqrt(amount / 10)));
    d.className = 'chips t' + (amount < 50 ? 1 : amount < 200 ? 2 : 3);
    for (let i = 0; i < n; i++) { const c = document.createElement('i'); c.style.setProperty('--k', i); d.appendChild(c); }
    return d;
  }
  // Only cards that are new on screen animate (dealt = slide in, revealed = flip).
  function cardEl(c, big, key, idx) {
    const d = document.createElement('div'), up = c !== null && c !== undefined;
    d.className = 'card' + (big ? ' big' : '');
    if (!up) d.classList.add('back');
    else { const s = (c / 13) | 0; if (s === 1 || s === 2) d.classList.add('red'); d.innerHTML = '<b>' + (RANK[c % 13] === 'T' ? '10' : RANK[c % 13]) + '</b><i>' + SUIT[s] + '</i>'; }
    const k = key + (up ? ':f' + c : ':b');
    if (!seen.has(k)) {
      const flip = up && seen.has(key + ':b');
      seen.add(k); d.classList.add(flip ? 'flip' : 'deal'); d.style.setProperty('--i', idx || 0);
      SFX.play(flip ? 'flip' : 'deal', { delay: flip ? 0 : Math.min(dealCount++ * 0.07, 0.6) });
    }
    return d;
  }
  function cardsEl(list, big, kp) { const w = document.createElement('div'); w.className = 'cards'; list.forEach((c, i) => w.appendChild(cardEl(c, big, kp + ':' + i, i))); return w; }

  function lastAction(v, id) {
    const h = v.history.filter((e) => e.seat === id && e.type !== 'sb' && e.type !== 'bb').pop();
    if (!h || v.street === 'idle') return '';
    return h.type === 'fold' ? 'Fold' : h.type === 'check' ? 'Check' : h.type === 'call' ? 'Call ' + h.amount : (h.type === 'bet' ? 'Bet ' : 'Raise to ') + h.to + (h.allIn ? ' (all-in)' : '');
  }

  // Seats sit on an oval; you are always at the bottom.
  function seatPos(id, n) { const a = (90 + (((id - HUMAN) % n) + n) % n * 360 / n) * Math.PI / 180; return { x: 50 + 43 * Math.cos(a), y: 49 + 38 * Math.sin(a) }; }

  function seatEl(p, v, n, winners) {
    const d = document.createElement('div'), pos = seatPos(p.id, n), me = p.isMe && !spectate;
    d.className = 'seat' + (me ? ' me' : '') + (v.toAct === p.id ? ' act' : '') + (p.folded ? ' fold' : '') + (winners.has(p.id) ? ' win' : '');
    d.style.left = pos.x + '%'; d.style.top = pos.y + '%'; d.style.setProperty('--c', COLORS[p.id % 6]);
    if (p.inHand && (!p.folded || me)) d.appendChild(cardsEl(me ? v.myCards : (p.holeCards || [null, null]), me, v.handNumber + ':' + p.id));
    const av = document.createElement('div'); av.className = 'av'; av.textContent = me ? 'YOU' : p.name[0];
    if (p.isButton) { const b = document.createElement('em'); b.className = 'btn'; b.textContent = 'D'; av.appendChild(b); }
    const pill = document.createElement('div'); pill.className = 'pill';
    pill.innerHTML = '<span class="nm">' + p.name + (p.position ? ' · ' + p.position : '') + '</span><span class="st">' + p.stack + '</span>';
    d.appendChild(av); d.appendChild(pill);
    const act = p.bet ? '' : lastAction(v, p.id);
    if (act) { const l = document.createElement('div'); l.className = 'lb'; l.textContent = act; d.appendChild(l); }
    return d;
  }

  let potShown = 0;
  const REDUCE = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function tweenNum(el, a, b) { const t0 = performance.now(); (function f(t) { const k = Math.min(1, (t - t0) / 350); el.textContent = Math.round(a + (b - a) * k); if (k < 1) requestAnimationFrame(f); })(t0); }
  function render() {
    const v = table.getPlayerView(HUMAN), n = v.players.length;
    if (spectate) v.players.forEach((p) => { if (p.inHand) p.holeCards = table._seats[p.id].holeCards.slice(); });
    if (v.handNumber !== seenHand) { seen = new Set(); seenHand = v.handNumber; potShown = 0; }
    const R = $('table').getBoundingClientRect(), fresh = (k) => (seen.has(k) ? false : (seen.add(k), true));
    dealCount = 0;
    const pk = v.handNumber + ':' + v.street + ':' + v.history.length;
    const newTurn = v.isMyTurn && !spectate && pk !== lastPing;
    if (newTurn) { lastPing = pk; SFX.play('turn'); }
    const ring = $('ring'), bets = $('bets'), board = $('board'), pot = $('pot');
    ring.innerHTML = ''; bets.innerHTML = ''; board.innerHTML = ''; pot.innerHTML = '';
    const winners = new Set(v.result ? v.result.pots.reduce((a, p) => a.concat(p.winners), []) : []);
    v.players.forEach((p) => {
      ring.appendChild(seatEl(p, v, n, winners));
      if (p.bet) {
        const pos = seatPos(p.id, n), b = document.createElement('div'), t = document.createElement('span');
        const bx = pos.x + (50 - pos.x) * 0.4, by = pos.y + (49 - pos.y) * 0.4, isNew = fresh('bet:' + p.id + ':' + v.street + ':' + p.bet);
        b.className = 'bet' + (isNew ? ' in' : ''); b.style.left = bx + '%'; b.style.top = by + '%';
        if (isNew) { b.style.setProperty('--fx', ((pos.x - bx) / 100 * R.width) + 'px'); b.style.setProperty('--fy', ((pos.y - by) / 100 * R.height) + 'px'); }
        t.textContent = p.bet; b.appendChild(chipsEl(p.bet)); b.appendChild(t); bets.appendChild(b);
      }
    });
    v.board.forEach((c, i) => board.appendChild(cardEl(c, true, v.handNumber + ':b:' + i, i < 3 ? i : 0)));
    const amount = v.street === 'idle' ? 0 : (v.pot || (v.result ? v.result.pots.reduce((a, p) => a + p.amount, 0) : 0));
    if (amount) { const l = document.createElement('span'); l.textContent = 'POT'; pot.appendChild(chipsEl(amount)); pot.appendChild(l); const pn = document.createElement('b'); pot.appendChild(pn);
      if (potShown !== amount && !REDUCE) tweenNum(pn, potShown, amount); else pn.textContent = amount;
      potShown = amount; }
    const bump = amount && !v.result && fresh('pot:' + amount);
    pot.className = v.result ? 'sweep' : bump ? 'bump' : '';
    if (v.result && winners.size && fresh('win:' + v.handNumber)) {
      const wp = seatPos([...winners][0], n);
      pot.style.setProperty('--sx', ((wp.x - 50) / 100 * R.width) + 'px'); pot.style.setProperty('--sy', ((wp.y - 49) / 100 * R.height) + 'px');
      winners.forEach((id) => { const q = seatPos(id, n), f = document.createElement('div'); f.className = 'float'; f.textContent = '+' + v.result.winnings[id]; f.style.left = q.x + '%'; f.style.top = q.y + '%'; f.onanimationend = () => f.remove(); $('table').appendChild(f); });
    }
    $('msg').textContent = v.result ? resultText(v) : '';
    controls(v);
    clock(v);
    $('controls').classList.toggle('enter', newTurn);
    coach(v);
  }

  // ---- Gauntlet shot clock: 10 seconds per decision; no time means check if free, otherwise fold ----
  const CLK_MS = 10000;
  let clk = null, clkKey = '';
  function clockStop() { if (clk) { clearInterval(clk); clk = null; } clkKey = ''; $('clockbar').hidden = true; }
  function clock(v) {
    if ($('mode').value !== 'master' || spectate || !v.isMyTurn) { clockStop(); return; }
    const key = v.handNumber + ':' + v.street + ':' + v.history.length;
    if (key === clkKey) return;
    clockStop(); clkKey = key;
    const bar = $('clockbar'), fill = bar.querySelector('i'), txt = bar.querySelector('span'), t0 = Date.now(), mine = table;
    let lastSec = 99;
    bar.hidden = false; bar.classList.remove('low');
    clk = setInterval(() => {
      if (table !== mine || table.toAct !== HUMAN) { clockStop(); return; }
      const left = Math.max(0, CLK_MS - (Date.now() - t0)), s = Math.ceil(left / 1000);
      fill.style.width = (left / CLK_MS * 100) + '%'; txt.textContent = s + 's';
      bar.classList.toggle('low', s <= 3);
      if (s <= 3 && s > 0 && s !== lastSec) SFX.play('beep');
      lastSec = s;
      if (left <= 0) {
        const L = table.getPlayerView(HUMAN).legal, free = !!(L && L.canCheck);
        clockStop(); SFX.play('timeup');
        toast('⏱ Time is up: auto-' + (free ? 'check' : 'fold'));
        act(free ? { type: 'check' } : { type: 'fold' });
      }
    }, 100);
  }

  function resultText(v) {
    const r = v.result, names = (id) => (id === HUMAN ? 'You' : v.players[id].name);
    const top = r.pots[0], w = top.winners.map(names).join(' & ');
    const verb = top.winners.length === 1 && top.winners[0] === HUMAN ? ' win ' : ' wins ';
    const amt = top.winners.length > 1 ? 'split the pot' : verb.trim() + ' ' + r.winnings[top.winners[0]];
    return w + (r.showdown && top.handName ? ' (' + top.handName + ') ' : ' ') + amt;
  }

  function controls(v) {
    if (spectate) { const c = $('controls'); c.innerHTML = ''; const m = document.createElement('div'); m.className = 'wait'; m.textContent = '👀 Spectating: the AIs are playing. Use the speed button to change the pace.'; c.appendChild(m); return; }
    const c = $('controls'); c.innerHTML = ''; setRaise = null;
    const btn = (t, f, cls) => { const b = document.createElement('button'); b.textContent = t; if (cls) b.className = cls; b.onclick = f; c.appendChild(b); return b; };
    if (v.street === 'idle' || v.street === 'complete') {
      if (table._seats[HUMAN].stack <= 0) btn('Rebuy ' + table.opts.startingStack, () => { const s = table.opts.startingStack; if (practice) { table.rebuy(HUMAN); sess.rebuys++; next(); return; } if (bank.coins < s) { toast('Not enough coins in your bank to rebuy.'); return; } bank.coins -= s; table.rebuy(HUMAN); bank.inPlay = stackNow(); saveBank(); sess.rebuys++; next(); }, 'go');
      else btn('Deal next hand', next, 'go');
      return;
    }
    if (!v.isMyTurn) { c.textContent = 'Waiting for opponents…'; return; }
    const L = v.legal;
    btn('Fold', () => act({ type: 'fold' }), 'b-fold');
    if (L.canCheck) btn('Check', () => act({ type: 'check' }), 'b-call'); else btn('Call ' + L.callAmount + (L.callAmount < L.toCall ? ' (all-in)' : ''), () => act({ type: 'call' }), 'b-call');
    if (L.canRaise) {
      const row = document.createElement('div'); row.className = 'raise';
      const rng = document.createElement('input'); rng.type = 'range'; rng.min = L.minRaiseTo; rng.max = L.maxRaiseTo; rng.value = L.minRaiseTo; rng.setAttribute('aria-label', 'Raise amount');
      const num = document.createElement('input'); num.type = 'number'; num.min = L.minRaiseTo; num.max = L.maxRaiseTo; num.value = L.minRaiseTo;
      const set = (x) => { x = Math.max(L.minRaiseTo, Math.min(L.maxRaiseTo, Math.round(x) || L.minRaiseTo)); rng.value = num.value = x; go.textContent = (L.isBet ? 'Bet ' : 'Raise to ') + x + (x === L.maxRaiseTo ? ' (all-in)' : ''); };
      rng.oninput = () => set(+rng.value); num.onchange = () => set(+num.value);
      const go = document.createElement('button'); go.className = 'go b-raise'; go.onclick = () => act({ type: 'raise', amount: +num.value });
      row.append(rng, num);
      [['½ pot', 0.5], ['Pot', 1]].forEach(([t, f]) => { const b = document.createElement('button'); b.textContent = t; b.onclick = () => set(v.currentBet + f * (v.pot + v.toCall)); row.appendChild(b); });
      const ai = document.createElement('button'); ai.textContent = 'All-in'; ai.onclick = () => set(L.maxRaiseTo); row.appendChild(ai);
      row.appendChild(go); c.appendChild(row); set(L.minRaiseTo); setRaise = set;
    }
  }

  // ---- Coach: advice is shown BEFORE you act; your move is judged afterwards ----
  let lastView = null, lastBuzz = '', spectate = false, practice = false, specTimer = null, seatKinds = [];
  const freshSess = () => ({ well: 0, badbeat: 0, lucky: 0, mistake: 0, evLost: 0, rebuys: 0, t0: Date.now() });
  let sess = freshSess();
  function coach(v) {
    const box = $('coach'), off = master();
    lastView = v;
    const bz = v.handNumber + ':' + v.street + ':' + v.history.length;
    if (v.isMyTurn && !spectate && bz !== lastBuzz) { lastBuzz = bz; if (navigator.vibrate && $('home').hidden) navigator.vibrate(40); }
    $('coach').hidden = $('mist').hidden = $('coachlbl').hidden = $('chartbtn').hidden = off;
    if (off) return; // Master AI mode: no hints, no coaching, no tracking
    if (!v.isMyTurn) { advice = null; advKey = ''; advSeq++; box.innerHTML = ''; stats(box, feedback); return; }
    const key = v.handNumber + ':' + v.street + ':' + v.history.length;
    if (key === advKey) { if (advice) paint(); return; }
    advKey = key; advice = null; const seq = ++advSeq;
    box.textContent = $('coachmode').value === 'off' ? '' : 'Coach is thinking…';
    Tr.advise(v, svc).then((a) => { if (seq !== advSeq) return; a.viewKey = key; advice = a; paint(); }).catch(() => { box.textContent = ''; });
  }
  function paint() {
    const box = $('coach'), mode = $('coachmode').value, a = advice; box.innerHTML = '';
    const add = (cls, t) => { const d = document.createElement('div'); d.className = cls; d.textContent = t; box.appendChild(d); };
    if (mode === 'full') { add('rec', '😈 ' + a.label + ' — ' + Vx.advice(a, a.viewKey).head + (a.close ? ' (close call)' : '')); add('why', a.reason); }
    if (mode !== 'off') add('nums', a.numbers);
    stats(box, '');
    const btns = Array.from($('controls').querySelectorAll('button'));
    btns.forEach((b) => b.classList.remove('rec'));
    if (mode !== 'full') return;
    const pick = a.action === 'raise' ? btns.find((b) => b.classList.contains('go')) : btns.find((b) => b.textContent.split(' ')[0].toLowerCase() === a.action);
    if (pick) pick.classList.add('rec');
    if (a.action === 'raise' && setRaise) setRaise(a.amount);
  }
  function stats(box, fb) {
    const s = St.summary(), d = document.createElement('div'); d.className = 'stat';
    const hh = St.hands(), tot = hh.well + hh.badbeat + hh.lucky + hh.mistake;
    d.textContent = (fb ? fb + '  |  ' : '') + (tot ? '✅' + hh.well + ' 🎲' + hh.badbeat + ' 🍀' + hh.lucky + ' ❌' + hh.mistake + ' (≈' + hh.evLost + ' chips lost to mistakes)  |  ' : '') + (s.n ? 'Followed coach ' + s.pct + '% of ' + s.n + ' decisions' + (s.topLeak ? ' · most common leak: ' + s.topLeak : '') : 'No coached decisions yet');
    box.appendChild(d);
    const rec = St.recent(8);
    $('mlist').textContent = rec.length ? rec.map((m) => 'Hand ' + m.hand + ' ' + m.street + ': ' + m.cards + (m.board ? ' | ' + m.board : '') + ' — coach ' + m.advised + ', you ' + m.played + ' (' + m.note + ')').join('\n') : 'Nothing yet.';
  }

  // ---- End-of-hand review (never during a hand, so it cannot be a hint) ----
  function toast(t) {
    const el = $('toast'); el.textContent = t; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
  }
  function showReview(rev) {
    const box = $('review'), line = Vx.verdictLine(rev), add = (tag, cls, t, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = t; (parent || box).appendChild(e); return e; };
    box.innerHTML = ''; box.className = 'v-' + rev.verdict; box.hidden = false;
    add('h3', '', line.emoji + ' ' + line.title);
    add('p', 'vx', line.body);
    if (rev.hindsight) add('div', 'hind', rev.hindsight);
    if (rev.xpGain) add('div', 'xpline', '+' + rev.xpGain + ' XP · Level ' + lvlOf(rw.xp));
    add('div', 'net', 'Hand #' + rev.handNumber + ' · ' + (rev.net > 0 ? 'you won +' + rev.net : rev.net < 0 ? 'you lost ' + rev.net : 'broke even') + (rev.evLost ? ' · mistakes cost about ' + Math.round(rev.evLost) + ' chips on average' : ''));
    const ul = add('ul', '', '');
    rev.rows.forEach((r) => add('li', r.severity === 'ok' ? 'good' : 'bad', Vx.rowLine(r) + (r.cards ? '   [' + r.cards + (r.board ? ' | ' + r.board : '') + ']' : ''), ul));
    if (rev.opp.length) add('div', 'opp', 'Showdown: ' + rev.opp.map((o) => o.name + ' ' + o.cards + ' (' + o.hand + ')').join(' · ') + (rev.mine ? ' · you: ' + rev.mine : ''));
    const row = add('div', 'row', ''), nx = add('button', 'go', 'Next hand', row), cl = add('button', '', 'Close', row);
    nx.onclick = () => { box.hidden = true; if ((table.isHandOver() || table.street === 'idle') && table._seats[HUMAN].stack > 0) next(); else render(); };
    cl.onclick = () => { box.hidden = true; };
  }
  function finishReview() {
    if (!practice) lbRecord(); // practice hands never reach the leaderboard
    if (spectate) { clearTimeout(specTimer); specTimer = setTimeout(() => { if (spectate && table) next(); }, Math.round(2600 * spd() / 1.2)); return; }
    if (!practice) { bank.inPlay = stackNow(); saveBank(); }
    saveTable();
    const tbl = table, r = table.handRecords[table.handRecords.length - 1], mine = decisions;
    if (!r || r.startStacks[HUMAN] === undefined || !mine.length) return;
    const v = table.getPlayerView(HUMAN), res = v.result, hs = res ? res.hands : {};
    const opp = Object.keys(hs).filter((id) => +id !== HUMAN).map((id) => ({ name: v.players[id].name, cards: E.cardsToString(hs[id].cards), hand: hs[id].name }));
    const out = { net: r.endStacks[HUMAN] - r.startStacks[HUMAN], folded: r.actions.some((e) => e.seat === HUMAN && e.type === 'fold'), bb: table.bigBlind, opp: opp, mine: hs[HUMAN] ? hs[HUMAN].name : null, handNumber: r.handNumber };
    Promise.all(mine.map((d) => d.p)).then((advs) => {
      if (tbl !== table) return;
      const ds = mine.map((d, i) => advs[i] ? { street: d.street, cards: d.cards, board: d.board, played: d.played, advice: advs[i] } : null).filter(Boolean);
      if (!ds.length) return;
      const rev = Rv.build(ds, out);
      rev.hindsight = Rv.hindsight(ds, { me: HUMAN, myCards: v.myCards, board: v.board, hands: hs, names: Object.fromEntries(Object.keys(v.players).map((id) => [id, v.players[id].name])) }, E);
      rewardHand(rev, ds);
      if (!practice) hist.hands.unshift({ tb: cur && cur.id, h: rev.handNumber, cards: E.cardsToString(v.myCards), board: E.cardsToString(v.board), net: rev.net, verdict: rev.verdict, rows: rev.rows.map((r2) => Vx.rowLine(r2)), hind: rev.hindsight || '', opp: opp.map((o) => o.name + ' ' + o.cards + ' (' + o.hand + ')').join(' · ') }); hist.hands.length = Math.min(hist.hands.length, 200); save(HK, hist);
      St.recordHand(rev); sess[rev.verdict] = (sess[rev.verdict] || 0) + 1; sess.evLost += rev.evLost || 0; Vx.react(rev); lastReview = rev; $('revbtn').disabled = false;
      const mode = $('vexmode').value;
      if (mode === 'off') return;
      if (mode === 'every' || rev.verdict !== 'well' || rev.hindsight) showReview(rev); else toast('✅ ' + Vx.verdictLine(rev).title + ' — ' + Vx.verdictLine(rev).body);
      render();
    }).catch(() => {});
  }

  function act(a) {
    const adv = !master() && advice && advice.viewKey === advKey ? advice : null, pv = table.getPlayerView(HUMAN);
    const dec = { street: pv.street, cards: E.cardsToString(pv.myCards), board: E.cardsToString(pv.board), played: a, p: adv ? Promise.resolve(adv) : Tr.advise(pv, svc).catch(() => null) };
    decisions.push(dec); // before table.act: the hand-end event fires inside it
    const r = table.act(HUMAN, a);
    if (!r.ok) { decisions.pop(); $('msg').textContent = r.error; return; }
    feedback = '';
    if (adv && !master()) {
      const j = Tr.compare(adv, a);
      St.record({ hand: pv.handNumber, street: pv.street, cards: E.cardsToString(pv.myCards), board: E.cardsToString(pv.board), advised: adv.label, played: a.type + (a.amount ? ' ' + a.amount : ''), severity: j.severity, note: j.note });
      feedback = Vx.feedback(j, adv.label, pv.handNumber + pv.street);
    }
    schedule(); render();
  }

  // ---- opponents: Master AI bots (each reads only its own player view) ----
  const master = () => $('mode').value === 'master' || $('mode').value === 'spectate';
  function botMove(id) {
    const v = table.getPlayerView(id);
    let r = { ok: false };
    try { r = table.act(id, bots[id].decide(v)); } catch (e) { /* fall through to the safe move */ }
    if (!r.ok) table.act(id, v.legal && v.legal.canCheck ? { type: 'check' } : { type: 'fold' });
  }

  const SPD = { relaxed: 2.2, normal: 1.2, fast: 0.6 }, SPI = { relaxed: '🐢', normal: '🚶', fast: '🐇' }, SPN = { relaxed: 'Relaxed', normal: 'Normal', fast: 'Fast' };
  const spd = () => SPD[$('speed').value] || 1.2;
  const updSpeed = () => { $('speedbtn').textContent = SPI[$('speed').value] || '🚶'; };
  function schedule() {
    clearTimeout(timer);
    if (!table || table.isHandOver() || table.street === 'idle') return;
    if ((table.toAct !== HUMAN || spectate) && table.toAct !== null) {
      const who = table.toAct, ms = Math.round((bots[who] ? bots[who].thinkMs(table.getPlayerView(who)) : 700) * (!spectate && table.getPlayerView(HUMAN).players[HUMAN].folded ? Math.min(spd(), 0.8) : spd()));
      timer = setTimeout(() => {
        const id = table.toAct; if (id === null || (id === HUMAN && !spectate)) return;
        botMove(id);
        schedule(); render();
      }, ms);
    }
  }

  function next() {
    table._seats.forEach((s) => { if ((s.id !== HUMAN || spectate) && s.stack <= 0) table.rebuy(s.id); });
    $('review').hidden = true;
    if (!table.startHand()) { $('msg').textContent = 'Not enough players with chips.'; return; }
    render(); schedule();
  }

  function newGame() {
    clearTimeout(timer);
    const wasPractice = practice; // Trainer is a practice table: no bank coins in or out
    spectate = $('mode').value === 'spectate'; practice = !spectate && $('mode').value === 'trainer'; clearTimeout(specTimer);
    if (table) { saveTable(); bank.coins += wasPractice ? 0 : stackNow(); }
    const buyIn = +$('stack').value || 1000;
    if (practice) { bank.inPlay = 0; saveBank(); } else if (!spectate) { bank.coins -= buyIn; bank.inPlay = buyIn; saveBank(); }
    const n = +$('seats').value, kinds = AI.assign(spectate ? n : n - 1); seatKinds = kinds;
    table = new E.Table({ numSeats: n, smallBlind: 5, bigBlind: 10, startingStack: +$('stack').value || 1000, humanSeat: HUMAN, names: [spectate ? 'Zed' : 'You'].concat(AI.NAMES) });
    cur = (spectate || practice) ? null : { id: Date.now(), t: Date.now(), mode: $('mode').value, n: n, buyIn: buyIn, hands: 0, net: 0 }; if (cur) hist.tables.unshift(cur); hist.tables.length = Math.min(hist.tables.length, 50); save(HK, hist);
    bots = {};
    for (let i = spectate ? 0 : 1; i < n; i++) bots[i] = AI.createBot({ personality: kinds[spectate ? i : i - 1] });
    table.on((type, d) => { // sound effects for everyone's actions, and your win or loss
      if (type === 'handStart') SFX.play('shuffle');
      else if (type === 'action') {
        if (d.type === 'fold') SFX.play('fold');
        else if (d.type === 'check') SFX.play('check');
        else if (d.allIn) SFX.play('allin');
        else if (d.type === 'raise' || d.type === 'bet') SFX.play('raise');
        else SFX.play('chip', { n: 2 });
      } else if (type === 'handEnd') {
        const r = table.handRecords[table.handRecords.length - 1];
        if (r && r.startStacks[HUMAN] !== undefined) {
          const net = r.endStacks[HUMAN] - r.startStacks[HUMAN];
          if (net > 0) SFX.play('win', { big: net >= 20 * table.bigBlind });
          else if (net <= -20 * table.bigBlind) SFX.play('lose');
        }
      }
    });
    table.on((type) => { if (type === 'handStart') { decisions = []; } else if (type === 'handEnd') finishReview(); });
    table.on((type) => { // anti-rollback: chips already committed to a hand are gone if you refresh or close the tab mid-hand
      if (!spectate && !practice && (type === 'handStart' || type === 'action' || type === 'street')) { bank.inPlay = stackNow(); saveBank(); }
    });
    table.on((type) => { // each bot studies the finished hand (public information only)
      if (type !== 'handEnd') return;
      for (const id in bots) { const bv = table.getPlayerView(+id); if (bv.players[+id].inHand) bots[id].endHand(bv); }
    });
    sess = freshSess();
    advice = null; advKey = ''; advSeq++; feedback = ''; decisions = []; lastReview = null; $('revbtn').disabled = true; Vx.resetStreak(); $('review').innerHTML = '';
    next();
  }

  const syncSnd = () => { $('sfx').textContent = SFX.isMuted() ? '🔇' : '🔊'; $('vol').value = Math.round(SFX.getVolume() * 100); };
  $('sfx').onclick = () => { SFX.unlock(); SFX.toggle(); syncSnd(); SFX.play('chip', { n: 2 }); };
  $('vol').oninput = () => SFX.setVolume($('vol').value / 100);
  $('vol').onchange = () => SFX.play('chip', { n: 2 });
  syncSnd();
  $('revbtn').onclick = () => { if (lastReview) showReview(lastReview); };
  $('mode').onchange = () => { advice = null; advKey = ''; advSeq++; feedback = ''; if (table) render(); };
  $('coachmode').onchange = () => { if (table) render(); };
  $('newgame').onclick = () => { if (affordable()) newGame(); else toast('Not enough coins for a new buy-in. Leave the table to cash out first.'); }; $('seats').onchange = newGame;

  // ---- bank & history (saved on this device) ----
  const BK = 'poker.bank', HK = 'poker.hist', today = () => new Date().toISOString().slice(0, 10), fmt = (n) => Math.round(n).toLocaleString();
  const load = (k, d) => { try { return Object.assign(d, JSON.parse(localStorage.getItem(k) || '{}')); } catch (e) { return d; } };
  const save = (k, o) => { try { localStorage.setItem(k, JSON.stringify(o)); } catch (e) {} };
  let homeMode = null, bank = load(BK, { coins: 10000, inPlay: 0, refill: '' }), hist = load(HK, { tables: [], hands: [] }), cur = null, bankNote = '';
  const saveBank = () => save(BK, bank);
  const stackNow = () => (table && !spectate ? table._seats[HUMAN].stack : 0);
  const affordable = () => $('mode').value === 'spectate' || $('mode').value === 'trainer' || bank.coins + stackNow() >= (+$('stack').value || 1000);
  if (bank.inPlay > 0 && !window.__pokerLocked) { bank.coins += bank.inPlay; bankNote = 'Cashed out your last table: ' + fmt(bank.inPlay) + ' coins back in the bank. '; bank.inPlay = 0; saveBank(); }
  function updBank() {
    if (window.__pokerLocked) return;
    if (bank.coins < 500 && bank.refill !== today()) { bank.coins = 2000; bank.refill = today(); bankNote += 'Free daily refill: 2,000 coins.'; saveBank(); }
    $('bankn').textContent = '🏦 Bank: ' + fmt(bank.coins) + ' coins';
    $('bankmsg').textContent = bankNote || (bank.coins < 500 && !freeMode() ? 'Not enough for a table. A free refill comes tomorrow. Trainer and Spectate are still free.' : ''); bankNote = '';
    applyAfford();
  }
  // Trainer (practice) and Spectate never touch the bank, so they are always playable
  const freeMode = () => { const m = homeMode || $('mode').value; return m === 'trainer' || m === 'spectate'; };
  function applyAfford() {
    const s = $('stack'), free = freeMode(), practiceHome = (homeMode || $('mode').value) === 'trainer';
    Array.from(s.options).forEach((o) => { if (!o.dataset.t) o.dataset.t = o.textContent; o.textContent = practiceHome ? o.dataset.t.replace('coins', 'chips') : o.dataset.t; o.disabled = !free && +o.value > bank.coins; });
    if (s.selectedOptions[0] && s.selectedOptions[0].disabled) { const ok = Array.from(s.options).filter((o) => !o.disabled).pop(); if (ok) s.value = ok.value; }
    if (s.parentNode.firstChild && s.parentNode.firstChild.nodeType === 3) s.parentNode.firstChild.nodeValue = practiceHome ? 'Practice chips ' : 'Buy-in ';
    $('deal').disabled = !free && bank.coins < 500;
  }
  function saveTable() {
    if (!cur || !table) return;
    cur.hands = table.handRecords.filter((r) => r.startStacks[HUMAN] !== undefined).length; cur.net = stackNow() - cur.buyIn * (1 + sess.rebuys); save(HK, hist);
  }
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function showHistory() {
    const sg = (x) => (x > 0 ? '+' : '') + fmt(x), cl = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : ''), VE = { well: '✅', badbeat: '🎲', lucky: '🍀', mistake: '❌' };
    $('hbody').innerHTML = hist.tables.length ? hist.tables.map((t) => {
      const hs = hist.hands.filter((h) => h.tb === t.id);
      return '<details class="ht"><summary><b>' + new Date(t.t).toLocaleDateString() + '</b> ' + (t.mode === 'master' ? 'Gauntlet' : 'Trainer') + ' · ' + t.n + ' players · ' + t.hands + ' hands <b class="' + cl(t.net) + '">' + sg(t.net) + '</b></summary>' +
        (hs.length ? hs.map((h) => '<details class="hh"><summary>' + (VE[h.verdict] || '') + ' ' + esc(h.cards) + (h.board ? ' | ' + esc(h.board) : '') + ' <b class="' + cl(h.net) + '">' + sg(h.net) + '</b></summary><ul>' + h.rows.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul>' + (h.hind ? '<div class="hind">' + esc(h.hind) + '</div>' : '') + (h.opp ? '<small>Showdown: ' + esc(h.opp) + '</small>' : '') + '</details>').join('') : '<small>No saved hands for this table.</small>') + '</details>';
    }).join('') : '<p class="tag">No tables yet. Play a hand and it will show up here.</p>';
    $('histpop').hidden = false;
  }

  // ---- rewards: XP, levels, daily streak, badges (rewarding good decisions, not just chips) ----
  const XK = 'poker.xp', rwMsgs = [];
  let rw = load(XK, { xp: 0, badges: {}, streak: 0, best: 0, day: '', run: 0, hands: 0, cnt: { pre: 0, fold: 0, call: 0, bet: 0 }, road: {}, solo: 0 });
  const BADGES = [['first', '🎯', 'First Steps', 'Finish your first reviewed hand'], ['roll', '🔟', 'On a Roll', '10 good decisions in a row'], ['sfold', '🛡️', 'Smart Fold', 'Fold a hand that would have lost'], ['process', '🧠', 'Right Process', 'Play a hand well and still lose to bad luck'], ['clean', '✅', 'Clean Win', 'Play a hand well and win it'], ['green', '📈', 'In the Green', 'Leave a table up 500+ coins'], ['streak3', '🔥', 'Three-Day Streak', 'Play 3 days in a row'], ['century', '💯', 'Century', 'Review 100 hands'], ['roller', '💰', 'High Roller', 'Grow your bank to 20,000 coins']];
  const lvlOf = (xp) => Math.floor(Math.sqrt(xp / 100)) + 1, lvlStart = (l) => 100 * (l - 1) * (l - 1);
  function award(id) { if (rw.badges[id]) return; rw.badges[id] = Date.now(); rwMsgs.push('🏅 Badge: ' + BADGES.find((x) => x[0] === id)[2]); }
  function addXp(n) { const a = lvlOf(rw.xp); rw.xp += n; if (lvlOf(rw.xp) > a) rwMsgs.push('⬆️ Level ' + lvlOf(rw.xp) + '!'); }
  function flushRw() { save(XK, rw); if (rwMsgs.length) { toast(rwMsgs.join('  ·  ')); rwMsgs.length = 0; } }
  function rewardHand(rev, ds) {
    const tk = today(), yd = new Date(Date.now() - 864e5).toISOString().slice(0, 10), h = rev.hindsight || '';
    if (rw.day !== tk) { rw.streak = rw.day === yd ? rw.streak + 1 : 1; rw.best = Math.max(rw.best, rw.streak); rw.day = tk; if (rw.streak > 1) { addXp(20); rwMsgs.push('🔥 ' + rw.streak + '-day streak +20 XP'); } if (rw.streak >= 3) award('streak3'); }
    const smart = /Good fold/.test(h) && /would have lost/.test(h);
    let gain = rev.rows.filter((r) => r.severity === 'ok').length * 5 + (rev.verdict === 'well' ? 15 : rev.verdict === 'badbeat' ? 10 : 0) + (smart ? 10 : 0);
    rev.rows.forEach((r) => { rw.run = r.severity === 'ok' ? rw.run + 1 : 0; if (rw.run >= 10) award('roll'); });
    rw.hands++; award('first'); if (rw.hands >= 100) award('century'); if (smart) award('sfold');
    if (rev.verdict === 'badbeat') award('process'); if (rev.verdict === 'well' && rev.net > 0) award('clean'); if (bank.coins + (practice ? 0 : stackNow()) >= 20000) award('roller');
    ds.forEach((d, i) => { if (!rev.rows[i] || rev.rows[i].severity !== 'ok') return; const t = d.played.type, post = d.street !== 'preflop'; if (!post) rw.cnt.pre++; if (t === 'fold') rw.cnt.fold++; if (post && t === 'call') rw.cnt.call++; if (post && (t === 'bet' || t === 'raise')) rw.cnt.bet++; });
    addXp(gain); rev.xpGain = gain; checkRoad(); flushRw();
  }
  // ---- learning roadmap: lessons + questions where YOU decide first, then see the reasoning ----
  const R2 = (a, b) => a + Math.floor(Math.random() * (b - a + 1)), pick = (a) => a[R2(0, a.length - 1)], shuf = (a) => a.slice().sort(() => Math.random() - 0.5);
  const mcs = (q, good, bad, why) => { const o = shuf([good].concat(bad)); return { type: 'mc', q: q, opts: o, ans: o.indexOf(good), why: why }; };
  const bet0 = (P) => Math.max(5, Math.round(P * pick([0.25, 0.33, 0.5, 0.75, 1]) / 5) * 5);
  function qPot() { const P = R2(4, 20) * 10, B = bet0(P), r = B / (P + 2 * B) * 100; return { type: 'num', q: 'The pot is ' + P + ' before your opponent bets ' + B + '. You must call ' + B + '. What chance of winning (in %) do you need to break even?', ans: r, tol: 3, why: 'After the bet the pot is ' + (P + B) + '. You pay ' + B + ' to win ' + (P + B) + ', so you need ' + B + ' ÷ (' + (P + B) + ' + ' + B + ') = ' + r.toFixed(1) + '%.' }; }
  function qCall(rich) {
    let P, B, r, e; do { P = R2(4, 20) * 10; B = bet0(P); r = B / (P + 2 * B) * 100; e = R2(8, 60); } while (Math.abs(e - r) < (rich ? 7 : 6));
    const call = e > r, pos = pick(['the button (you act last after the flop)', 'the big blind (you act first after the flop)']), sty = pick(['a tight player, so a strong range', 'a loose player, so a wide range']), draw = Math.random() < 0.5;
    const ctx = rich ? 'You are on ' + pos + '. The bettor is ' + sty + '. ' + (draw ? 'You have a draw, and this player often checks the next street. ' : '') : '';
    return { type: 'cof', q: ctx + 'The pot is ' + P + ' before the bet. Your opponent bets ' + B + '. You estimate you win about ' + e + '% against their range. Call or fold?', ans: call ? 'CALL' : 'FOLD',
      why: 'Price: ' + B + ' ÷ (' + (P + B) + ' + ' + B + ') = ' + r.toFixed(1) + '% needed. Your equity is ' + e + '%, which is ' + (call ? 'above' : 'below') + ' that, so the math says ' + (call ? 'CALL' : 'FOLD') + '.' + (rich ? ' Position: ' + (pos.indexOf('last') > 0 ? 'acting last helps you use your equity.' : 'acting first makes it harder to use thin edges.') + (draw ? ' A free card is possible, but the opponent can bet again, so count it only as a possible bonus, never as a guarantee.' : '') : '') };
  }
  function qEq() {
    const d = []; while (d.length < 5) { const c = R2(0, 51); if (d.indexOf(c) < 0) d.push(c); }
    const eq = window.PokerEquity.estimateEquity({ hero: d.slice(0, 2), board: d.slice(2), opponents: 1, iterations: 1500 }).equity * 100;
    return { type: 'num', slider: true, q: 'Your hand: ' + E.cardsToString(d.slice(0, 2)) + '. Flop: ' + E.cardsToString(d.slice(2)) + '. Against one random hand, about how often do you win? Make your guess, then lock it in.', ans: eq, tol: 10, why: 'Estimated equity is about ' + eq.toFixed(0) + '%. Pairs and draws on the flop are worth more than they look, and unpaired low cards less. Guesses within 10 points count as correct.' };
  }
  function qEv() {
    const good = Math.random() < 0.5, r = R2(15, 35), e = good ? r + R2(8, 20) : r - R2(8, 14), won = Math.random() < 0.5;
    return mcs('You called needing ' + r + '% and had about ' + e + '% to win. The hand ' + (won ? 'won' : 'lost') + '. Was the DECISION good?', good ? 'Good decision' : 'Bad decision', [good ? 'Bad decision' : 'Good decision'],
      (good ? 'Your equity was above the ' + r + '% needed, so the call makes money over many hands. ' + (won ? 'It also won, but the result is not the reason it was good.' : 'Losing this one is variance, not a mistake.') : 'Your equity was below the ' + r + '% needed, so the call loses money over many hands. ' + (won ? 'You won this time, but the original decision was still bad.' : 'It lost, and the decision was bad too.')));
  }
  const outsQ = [['a flush draw (9 outs) on the flop, two cards to come', '36%', ['18%', '9%', '50%'], 'Rule of 4: 9 × 4 = 36%.'], ['an open-ended straight draw (8 outs) on the turn, one card to come', '16%', ['32%', '8%', '40%'], 'Rule of 2: 8 × 2 = 16%.'], ['a flush draw (9 outs) on the turn, one card to come', '18%', ['36%', '9%', '27%'], 'Rule of 2: 9 × 2 = 18%.']];
  const qOut = () => { const o = pick(outsQ); return mcs('You have ' + o[0] + '. About how often do you hit?', o[1], o[2], o[3]); };
  // ---- levels 8-12: generated questions and pools (each retry draws a fresh set) ----
  const draw = (pool, n) => shuf(pool).slice(0, n).map((f) => f());
  function qBluff() {
    const P = R2(4, 20) * 10, B = bet0(P), r = B / (P + B) * 100;
    return { type: 'num', q: "The pot is " + P + ". You bet " + B + " as a pure bluff: if your opponent calls, you lose. How often (in %) must they fold for the bluff to break even?", ans: r, tol: 3,
      why: "You risk " + B + " to win " + P + ". Break-even fold rate = " + B + " ÷ (" + P + " + " + B + ") = " + r.toFixed(1) + "%. If they fold more often than that, the bluff makes money." };
  }
  function qBluffEv() {
    let P, B, r, f; do { P = R2(4, 20) * 10; B = bet0(P); r = B / (P + B) * 100; f = R2(10, 75); } while (Math.abs(f - r) < 8);
    const ok = f > r;
    return mcs("The pot is " + P + ". You bluff " + B + " (you lose if called). You think your opponent folds about " + f + "% of the time. Is the bluff profitable?", ok ? "Yes, profitable" : "No, not profitable", [ok ? "No, not profitable" : "Yes, profitable"],
      "Needed fold rate = " + B + " ÷ (" + P + " + " + B + ") = " + r.toFixed(1) + "%. They fold " + f + "%, which is " + (ok ? "above" : "below") + " that, so the bluff " + (ok ? "makes" : "loses") + " money over time.");
  }
  const pool8 = [
    () => mcs("You bet because you think WORSE hands will call. What kind of bet is this?", "A value bet", ["A bluff", "A semi-bluff", "A pot-control check"], "A value bet wants a call from a worse hand. A bluff wants a better hand to fold."),
    () => mcs("Which is the best example of a value bet on the river?", "Top pair with a strong kicker, when weaker pairs and weaker aces can call", ["Third pair, hoping better hands fold", "Ace-high with no pair, hoping they call", "Nothing at all, hoping they fold"], "Ask: what worse hand calls me? With top pair and a strong kicker, plenty of worse hands do. The other bets only get called by better hands, or are bluffs."),
    () => mcs("You have a flush draw on the flop and you bet. You can win if they fold, or later if you hit. What is this bet called?", "A semi-bluff", ["A pure value bet", "A pure bluff", "A pot-control check"], "A bluff with a draw has two ways to win, which makes it better than a pure bluff."),
    () => mcs("Against which opponent is a bluff most likely to work?", "A tight player who folds when they miss", ["A calling station who rarely folds", "A player who has shown a lot of strength", "A player who already put in most of their stack"], "A bluff only makes money if the opponent folds often enough. Tight players who miss fold a lot. Stations and committed players do not."),
    () => mcs("You think any hand that calls your bet is better than yours, and only better hands would call. What should you do?", "Check: the bet has no value", ["Bet bigger", "Bluff with a smaller bet", "Go all-in"], "A bet should either get worse hands to call or better hands to fold. If it does neither, checking is better."),
    () => mcs("Why is betting usually better than only checking and calling?", "You can win when they fold AND when you have the best hand", ["Betting is free", "Opponents always fold", "It hides your hand"], "Checking and calling only wins at showdown. Betting adds a second way to win: making them fold.")
  ];
  const dryB = ["K♠ 7♦ 2♣", "A♣ 8♦ 3♠", "Q♦ 6♠ 2♥", "K♥ 5♣ 2♦"], wetB = ["J♥ T♥ 9♠", "8♠ 7♠ 6♦", "T♦ 9♦ 8♥", "Q♣ J♣ T♠"];
  const qTexture = () => { const w = pick(wetB), d = shuf(dryB).slice(0, 2); return mcs("Which flop is the WETTEST (the most possible draws)?", w, d, "Connected cards and two of one suit make many straight and flush draws, so " + w + " is wet. " + d[0] + " has few draws, so it is dry."); };
  const AIR = "Air (no pair, no draw)", cats = [["A♠ K♦", "K♣ 7♦ 2♠", "Strong made hand", "Top pair with the best kicker is a strong hand on a dry board."], ["T♠ T♦", "9♣ 4♥ 2♠", "Strong made hand", "An overpair (a pair higher than every board card) is strong."], ["9♥ 8♥", "K♥ 5♥ 2♠", "Drawing hand", "Four hearts with more cards to come: a flush draw. You have no pair yet."], ["7♣ 2♦", "K♠ Q♥ 5♦", AIR, "No pair and no draw: nothing that wins at showdown."], ["Q♣ 6♦", "Q♠ 9♥ 3♣", "Medium-strength hand", "Top pair with a weak kicker is often best, but it loses to better queens, so you do not want a huge pot."]];
  const qCat = () => { const c = pick(cats), all = ["Strong made hand", "Drawing hand", "Medium-strength hand", AIR]; return mcs("You hold " + c[0] + ". The flop is " + c[1] + ". How would you classify your hand?", c[2], all.filter((x) => x !== c[2]), c[3] + " Strong hands bet for value, medium hands control the pot, draws semi-bluff or call at the right price, and air usually gives up."); };
  const pool9 = [
    () => mcs("You raised before the flop and one player called. The flop is dry. Why is a continuation bet (c-bet) often good here?", "As the preflop raiser you have more strong hands, and they miss the flop most of the time", ["A c-bet always makes money", "It gives them a free card", "The pot is too small to matter"], "The raiser usually hits dry flops harder, and most hands miss them, so a bet often wins the pot right away."),
    () => mcs("You have a strong hand on a wet board. Which bet size makes more sense?", "A larger bet, so draws pay a bad price", ["A tiny bet so they keep drawing", "Always check to trick them", "All-in every time"], "On wet boards many hands have draws. A bigger bet makes those draws pay a price that is too high."),
    () => mcs("Four players see the flop and you have no pair and no draw. What is usually best?", "Give up: someone likely has something", ["Bluff, since more players means more folds", "Bet the pot to protect your hand", "Raise anyone who bets"], "The more players in the pot, the more likely one of them has a hand that calls. Bluffs work best against one or two opponents."),
    () => mcs("What does pot control mean?", "Keeping the pot small with a medium-strength hand by checking or calling", ["Betting the pot with every hand", "Folding every hand", "Raising to protect all your hands"], "Medium hands win small pots and lose big ones, so you do not want to build a large pot with them."),
    () => mcs("Why should you plan the turn and river before you bet the flop?", "A flop bet commits chips, and later streets may force you to bet or fold more", ["Betting is free", "Later streets never matter", "You can take a bet back if you change your mind"], "Each bet makes the pot bigger and the next decision harder. Have a plan before you start."),
    () => mcs("You have a flush draw on the flop and your opponent bets. What should you check first?", "Whether the price is lower than your chance to hit", ["Whether you feel lucky", "Whether the board is dry", "Whether you are on the button"], "A draw is a pot odds question: compare the price of the call with your chance to complete the hand.")
  ];
  const pool10 = [
    () => mcs("Which description fits a calling station?", "Calls too often and rarely folds", ["Folds to almost every bet", "Raises every hand", "Only plays aces"], "A calling station pays off too much, so value bets work well against them."),
    () => mcs("A very tight player who has barely bet all night suddenly raises big. Their hand is most likely…", "Very strong", ["A bluff", "Random", "Weak"], "Tight players raise with strong hands, so a raise from them deserves respect."),
    () => mcs("Against a calling station, the best change is…", "Value bet more and bluff less", ["Bluff much more", "Fold every hand", "Make tiny bets with strong hands"], "They call too much, so your good hands get paid and your bluffs do not work."),
    () => mcs("Against a very tight player, which play often makes money?", "Raising to steal the blinds from late position", ["Calling every raise they make", "Bluffing when they show strength", "Never raising"], "Tight players fold a lot, so blind steals work. When they show strength, believe them."),
    () => mcs("Loose-aggressive describes a player who…", "Plays many hands and bets and raises a lot", ["Plays few hands and rarely bets", "Calls a lot but rarely raises", "Never bluffs"], "Loose means many hands. Aggressive means bets and raises. Together: lots of pressure with wide ranges."),
    () => mcs("You saw one player bluff once. Should you now call them down every time?", "No: one hand is too small a sample", ["Yes, they always bluff", "Yes, but only with aces", "No, they never bluff again"], "Reads come from patterns over many hands. One hand is not a pattern."),
    () => mcs("A normally passive player starts betting big on the river. What is the most reasonable read?", "They often have a strong hand", ["They are surely bluffing", "Their bets mean nothing", "They have nothing"], "Passive players mostly call. When one bets big, it usually means real strength."),
    () => mcs("Why is it useful to notice how many hands a player plays before the flop?", "It shows how wide or narrow their range is", ["It shows their next card", "It shows how much money they have", "It does not matter"], "A player who plays few hands has a strong range, and one who plays many has a weak, wide range. That changes how much their bets mean."),
    () => mcs("A loose-aggressive player keeps betting the flop. Which approach is sensible?", "Stay patient: call with solid hands and let them bluff", ["Fold everything", "Bluff back every time", "Assume they always have the best hand"], "They bluff more than most players, so solid hands can call and collect. Fancy plays against them are rarely needed."),
    () => mcs("Which is better evidence for a read on a player?", "A habit you saw several times", ["One surprising hand", "How confident the player looks", "A feeling you have"], "Reads should come from repeated behavior, not one hand or a hunch.")
  ];
  function qSetMine() {
    const C = pick([20, 30, 40, 50]), rich = Math.random() < 0.5, S = rich ? C * R2(20, 30) : C * R2(3, 6), pair = pick(["2♠ 2♦", "4♣ 4♥", "6♦ 6♠", "3♥ 3♣"]), x = S / C;
    return { type: 'cof', q: "You hold " + pair + ". An opponent raises and you can call " + C + " before the flop. Your effective stack is " + S + " (" + x + " times the call). You only win a big pot if you flop a set, about 12% of the time. Call or fold?", ans: rich ? 'CALL' : 'FOLD',
      why: rich ? "You have " + x + " times the call behind, well above the 10 to 15 times rule of thumb. When the set arrives you can win a big stack, so the 12% chance pays off. Call." : "You have only " + x + " times the call behind. Even when you flop a set there is not enough extra money to win, so the 12% chance does not pay off. Fold." };
  }
  const pool11 = [
    () => mcs("Which situation has the BEST implied odds?", "A small pair, deep stacks, and a set that would be well hidden", ["Short stacks, so little money is left to win", "A draw whose card makes the board obviously scary", "A hand that needs to bluff to win"], "Implied odds need two things: lots of money behind and an opponent who cannot tell you hit."),
    () => mcs("You hold A♣ 5♣ and flop a pair of aces on A♦ 9♠ 4♥ against a player who raised before the flop. Why is it risky to build a big pot?", "A better ace (like A-K or A-Q) beats you, and you can lose a lot", ["It has no showdown value", "Aces cannot win", "The flush draw is too strong"], "That is reverse implied odds: you made a pair, but the hands that beat you will win a big pot from you."),
    () => mcs("What are reverse implied odds?", "Extra money you can LOSE when you make a hand that is not the best", ["Extra money you win when you hit your draw", "The odds of hitting a set", "The price of a call"], "Some made hands (weak aces, low flushes, the bottom of a straight) cost you a lot when someone has better."),
    () => mcs("Pot odds say you are a little short for a call, but you have a hidden hand and a deep stack behind. What can make the call profitable?", "Implied odds: the extra money you win later when you hit", ["Reverse implied odds", "A bigger bluff", "Nothing: pot odds are all that matter"], "Pot odds only count the current pot. If you will win more later when you hit, the call can still make money."),
    () => mcs("Why do implied odds shrink when stacks are short?", "There is little extra money left to win when you hit", ["Your outs disappear", "The pot gets smaller", "Opponents always fold"], "Implied odds come from the money still behind. With short stacks there is not much of it."),
    () => mcs("You call with a flush draw and the flush card arrives, but the board is now very scary. What should you remember about implied odds?", "Opponents may stop paying, so do not count on winning a big pot every time", ["They are guaranteed, so call anything", "They only matter for pairs", "They make your outs bigger"], "Implied odds are a bonus, not a promise. Smart opponents slow down when the board gets scary.")
  ];
  function qSpr() {
    const P = pick([50, 60, 80, 100]), S = P * pick([2, 3, 5, 8, 10, 12]), spr = S / P, right = String(spr);
    const bad = Array.from(new Set([String(spr * 2), String(+(spr / 2).toFixed(1)), String(+(P / S).toFixed(2)), String(spr + 3)])).filter((x) => x !== right).slice(0, 3);
    return mcs("On the flop the pot is " + P + " and the effective stacks are " + S + ". What is the stack-to-pot ratio (SPR)?", right, bad, "SPR = effective stack ÷ pot = " + S + " ÷ " + P + " = " + spr + ". A low SPR (about 3 or less) means one pair can be strong enough to commit. A high SPR (about 10 or more) means you want something stronger.");
  }
  const pool12 = [
    () => mcs("You lost money over your last 50 hands. What does that say about your skill?", "Very little: 50 hands is too small a sample", ["You are a bad player", "You should change your whole strategy", "The game must be rigged"], "Poker has big swings. Judge your decisions, and look at results only over thousands of hands."),
    () => mcs("You just lost a big pot to a lucky river and feel angry. What is the best move?", "Take a short break, then return to your normal strategy", ["Raise more to win it back", "Play every hand", "Call the next big bet to prove a point"], "Playing angry is tilt. The cards have no memory, so the next hand is a fresh start."),
    () => mcs("Which situation needs the STRONGEST hand to put all your chips in?", "Very deep stacks compared to the pot (high SPR)", ["Very short stacks compared to the pot (low SPR)", "A pot where you act last", "Any pot on the river"], "With a high SPR you are risking a lot to win a little, so one pair is rarely enough."),
    () => mcs("You notice one opponent folds to almost every river bet. What is a good adjustment?", "Bluff the river against them more often", ["Value bet thinner against them", "Never bet the river", "Call all their river bets"], "If someone folds too much, bluffs make money. Exploit the habit you actually saw."),
    () => mcs("Why not exploit every opponent as hard as possible from the first hand?", "Your read can be wrong, and a strong opponent can exploit you back", ["Exploiting is not allowed", "It never works", "Reads are always perfect"], "Start with a solid strategy and move away from it only when you have real evidence."),
    () => mcs("A solid default strategy (like the one the coach teaches) is useful because…", "It works fairly well against unknown opponents, and you adjust once you see their habits", ["It beats every opponent", "You never need to think", "It guarantees profit"], "A good default is your starting point. Adjustments come from what you observe."),
    () => mcs("With a low SPR (stacks small compared to the pot), a hand like top pair is…", "Often strong enough to commit", ["Never good enough", "Only good as a bluff", "Worth folding"], "When there is little behind, one pair is often good enough to get all the chips in.")
  ];
  const L = (id, t, lessons, qs) => ({ id: id, t: t, lessons: lessons, qs: qs });
  const LEVELS = [
    L('L1', 'Hold’em fundamentals', [['How a hand flows', 'Each player gets 2 private cards (hole cards). Five shared community cards come out in steps: the flop (3 cards), the turn (1), the river (1). There is betting before the flop (preflop) and after each step. If more than one player is left after the river, it is a showdown: cards are shown and the best 5-card hand wins the pot.'], ['Blinds and actions', 'Blinds are forced bets from the two seats left of the button, so there is always something to win. On your turn you can check (no bet to match), bet, call (match a bet), raise (bet more) or fold (give up the hand).'], ['Hand rankings', 'From best to worst: straight flush, four of a kind, full house, flush, straight, three of a kind, two pair, one pair, high card.']],
      () => [mcs('How many community cards are showing after the flop?', '3', ['2', '4', '5'], 'The flop is 3 cards. The turn adds 1 and the river adds 1.'), mcs('Which hand is strongest?', 'Flush', ['Straight', 'Three of a kind', 'Two pair'], 'A flush beats a straight, three of a kind and two pair.'), mcs('When can you check?', 'Only when there is no bet to match', ['Any time', 'Only on the river', 'Only as the big blind'], 'Checking means betting nothing, so it only works when nobody has bet.'), mcs('What happens at showdown?', 'Players show cards and the best 5-card hand wins', ['The dealer picks a winner', 'Everyone gets chips back', 'The biggest bettor wins'], 'Showdown is where hands are compared.'), mcs('Which is better?', 'Full house', ['Flush', 'Straight', 'Two pair'], 'A full house beats a flush.')]),
    L('L2', 'Position', [['The seats', 'The button (dealer) acts last after the flop. The small and big blind sit left of it and post forced bets. Early position acts first before the flop, then middle position, then late position (cutoff and button).'], ['Why position matters', 'Acting later gives you information: you see what everyone does before you decide. With the same cards, you can play more hands from late position, because you will often act last after the flop and avoid awkward spots acting first.']],
      () => [mcs('Which seat acts last after the flop?', 'The button', ['Small blind', 'Big blind', 'Early position'], 'The button acts last on every street after the flop.'), mcs('Why is acting later an advantage?', 'You see what others do first', ['You get extra cards', 'You pay lower blinds', 'The dealer helps you'], 'Information is the whole advantage of position.'), mcs('You hold K-9 offsuit. Where is it easier to play?', 'The button: you act later with more information', ['Early position: you decide first', 'No difference', 'K-9 is always a fold'], 'Same cards, better situation. Late position makes marginal hands more playable.'), mcs('Who posts the blinds?', 'The two seats left of the button', ['The button and cutoff', 'Everyone equally', 'The last winner'], 'Blinds rotate with the button.'), mcs('Which group acts first before the flop?', 'Early position', ['Late position', 'The button', 'The cutoff'], 'Early position acts first, so it has the least information.')]),
    L('L3', 'Starting hands and ranges', [['What makes a hand strong', 'Pairs, high cards (A, K, Q), suited cards (same suit) and connected cards (close in rank) win more often. A-K suited is far stronger than 7-2 offsuit.'], ['Position changes the bar', 'From early seats many players still act after you, so you need stronger hands. From the button fewer players act after you, so more hands are playable. The hand did not change, the situation did.'], ['What is a range?', 'You cannot know an opponent’s cards, but you can guess the set of hands they would play this way. That set is their range. A tight player raising early has a strong range (big pairs, big aces). A loose player raising from the button has a wide one. Your hand is judged against their range, not one hand.']],
      () => [mcs('Why can you play more hands on the button than from early position?', 'Fewer players act after you and you have more information', ['The cards are luckier', 'Blinds are cheaper', 'Raising is free'], 'Position, not the cards, is what changed.'), mcs('A tight player raises from early position. Their range is likely…', 'Strong hands: big pairs and big aces', ['Any two cards', 'Only small cards', 'Only suited cards'], 'Tight players enter the pot with strong hands only.'), mcs('Which hand is generally stronger?', 'A-K suited', ['7-2 offsuit', '9-4 offsuit', '8-3 suited'], 'High cards plus suited beats weak scattered cards.'), mcs('What does “range” mean?', 'All hands a player could have, given how they played', ['The chips a player has', 'The distance between seats', 'Your best 5 cards'], 'You think in sets of hands, not one exact hand.'), mcs('A loose player raises from the button. Their range is…', 'Wider, with more weak hands', ['Narrower than a tight early raise', 'Only pairs', 'Exactly the same'], 'Loose players and late position both widen a range.')]),
    L('L4', 'Pot odds', [['The price of a call', 'Pot odds compare what you pay with what you can win. If the pot is 100 and your opponent bets 20, the pot is now 120 and you must call 20. You risk 20 to win 120.'], ['Required equity', 'The chance you need to break even = call ÷ (pot after your call). Here: 20 ÷ (120 + 20) = 14.3%. If your chance to win is higher than that, calling makes money over many hands. If it is lower, it loses.']],
      () => [qPot(), qPot(), qCall(), qCall(), qCall()]),
    L('L5', 'Equity', [['What equity means', 'Equity is your share of the pot, on average, if the hand were played out many times. 35% equity means you win about 35 times in 100 (ties count as shares).'], ['Hand vs hand, hand vs range', 'Against one known hand it is a simple matchup. In real play you face a range, so your equity is the average across all the hands they could have.'], ['Outs: the rule of 2 and 4', 'An out is a card that improves you to the likely best hand. Outs × 2 ≈ your % to hit with one card to come. Outs × 4 ≈ your % with two cards to come. A flush draw has 9 outs: about 18% for one card, 36% for two.']],
      () => [qEq(), qEq(), qEq(), qOut(), qOut()]),
    L('L6', 'Range + equity + pot odds', [['Putting it together', 'To decide: (1) position, who acts last? (2) their range, how strong? (3) your equity against that range, (4) the price, the required equity. Call when your equity beats the price. The coach may disagree, and that is fine: what matters is whether your reasoning holds.'], ['Think about future streets', 'If you call now you may see another card. If the opponent checks, you could get a free card, but they might also bet again. Ask: will I improve? What if they bet again? Could I win by betting later? A free card is a possible bonus, never a reason to call by itself.']],
      () => [qCall(1), qCall(1), qCall(1), qCall(1), qCall(1)]),
    L('L7', 'Expected value (EV)', [['EV', 'EV is the average result of a decision if you made it many times. Call EV = equity × (pot after your call) − your call. Positive EV means profitable in the long run, even if this hand loses.'], ['Results vs decisions', 'Winning a hand does not make the decision good, and losing does not make it bad. Judge the decision by the math at the time, not by the cards that came later.']],
      () => [qEv(), qEv(), qEv(), qEv(), qEv()]),
    L('L8', 'Value betting and bluffing', [["Two reasons to bet", "Every bet needs a reason. You bet for value when you think worse hands will call. You bluff when you want better hands to fold. If neither is true, checking is usually better."], ["Value betting", "Ask yourself: which worse hands call me? If you can name some, bet. Pick a size they can call: too big and only better hands continue, too small and you leave money on the table. Strong hands that never bet win small pots."], ["Bluffing and the math", "A bluff risks a bet B to win the pot P. It breaks even when the opponent folds B ÷ (P + B) of the time. Betting 50 into 100 needs 50 ÷ 150 = 33% folds. A bluff with a draw is a semi-bluff: you win if they fold or if you hit, so it is stronger than a pure bluff."]],
      () => shuf([qBluff(), qBluffEv()].concat(draw(pool8, 3)))),
    L('L9', 'Postflop strategy', [["Read the board", "Dry boards (like K♠ 7♦ 2♣) have few draws. Wet boards (like J♥ T♥ 9♠) have many straight and flush draws. On wet boards hands change value quickly, so bet bigger with strong hands and be careful with medium ones."], ["The continuation bet", "If you raised before the flop, you have the initiative. A bet on the flop is called a continuation bet (c-bet). It works best on dry boards and against one or two opponents. Slow down against many opponents or when the board connects with the hands that call."], ["Sort your hand and make a plan", "Strong made hand: bet for value. Medium-strength hand: control the pot by checking or calling. Drawing hand: semi-bluff, or call if the price is right. Air (no pair, no draw): usually give up, and bluff only with a reason. Plan the turn and river before you bet the flop."]],
      () => shuf([qTexture(), qCat()].concat(draw(pool9, 3)))),
    L('L10', 'Reading opponents', [["Four player types", "Two questions describe most players: how many hands do they play (tight or loose), and how do they bet (passive: mostly calls, aggressive: bets and raises)? Your leaderboard shows the four types: very tight, calls a lot, tight-aggressive and loose-aggressive."], ["Reads come from behavior", "Watch what players do over many hands. A very tight player’s raise usually means strength. A loose player’s bets mean less because their range is wide. A passive player who suddenly bets big often has a strong hand. One hand proves nothing."], ["Adjust, don’t guess", "Against calling stations: value bet more and bluff less. Against very tight players: steal blinds and fold when they show strength. Against loose-aggressive players: stay patient, call with solid hands and let them bluff."]],
      () => draw(pool10, 5)),
    L('L11', 'Implied and reverse implied odds', [["Pot odds are not the whole picture", "Pot odds only count the money in the pot now. If you hit your hand you may win more on later streets. That extra money is implied odds. Example: calling 20 into 100 needs 14.3% equity, and a small pair flops a set only about 12% of the time. On price alone the call is slightly short, but a hidden set can win a big stack, so it can still be profitable."], ["Set mining rule of thumb", "To call with a small pair hoping for a set, you want effective stacks of about 10 to 15 times the call. With less, there is not enough extra money to win when you hit."], ["Reverse implied odds", "Sometimes making a hand costs you money. Hands that are often second best (a weak ace, the bottom of a straight, a small flush) can lose a big pot to a better hand. A made hand is not always a strong hand. Count implied odds as a bonus, not a promise: they shrink when stacks are short or the board gets scary."]],
      () => shuf([qSetMine(), qSetMine()].concat(draw(pool11, 3)))),
    L('L12', 'Advanced concepts', [["Variance and tilt", "Poker results swing a lot. Over dozens or even hundreds of hands, luck can hide skill, so judge your decisions, not short-term results. After a bad beat, take a break if you feel angry. The cards have no memory, and the next hand is a fresh start."], ["Stack-to-pot ratio (SPR)", "SPR = effective stack ÷ pot, measured on the flop. With a low SPR (about 3 or less), one pair is often strong enough to commit. With a high SPR (about 10 or more), you want sets, two pair, or strong draws before you put in a whole stack."], ["Solid first, exploit second", "Start with a solid default strategy, like the one the coach teaches. Once you see a habit (folds to every river bet, calls too much), adjust to exploit it. The further you move from your default, the more you can be exploited back, so adjust only on real evidence."]],
      () => shuf([qSpr()].concat(draw(pool12, 4))))

  ];
  const SOON = [];
  const curStage = () => LEVELS.find((l) => !rw.road[l.id]);
  function checkRoad() {}
  const lpop = (title, html, btns) => { $('ltitle').textContent = title; $('lbody').innerHTML = html; const c = $('lbtns'); c.innerHTML = ''; btns.forEach((x) => { const b = document.createElement('button'); b.textContent = x[0]; b.onclick = x[1]; if (x[2]) b.className = x[2]; c.appendChild(b); }); $('lessonpop').hidden = false; };
  function showRoad() {
    const body = LEVELS.map((l, i) => { const done = rw.road[l.id], open = i === 0 || rw.road[LEVELS[i - 1].id];
      return [(done ? '✅ ' : open ? '👉 ' : '🔒 ') + 'Level ' + (i + 1) + ': ' + l.t, () => (open ? startLevel(l, 0) : null), open ? (done ? '' : 'go') : 'dim']; }).concat(SOON.map((t, i) => ['⏳ Level ' + (LEVELS.length + i + 1) + ': ' + t + ' (coming next)', () => null, 'dim']));
    lpop('🧭 Learning roadmap', '<p>Each level teaches one idea, then tests it with questions where you decide first and see the reasoning after. Pass a test by answering 4 of 5 correctly. In real hands, the coach recommends, but you are free to disagree: your decision is judged by the math, not by matching the AI.</p>', body);
  }
  function startLevel(l, i) {
    if (i < l.lessons.length) lpop('Level: ' + l.t, '<h4>' + l.lessons[i][0] + '</h4><p>' + l.lessons[i][1] + '</p><small>Step ' + (i + 1) + ' of ' + l.lessons.length + '</small>', [[i + 1 < l.lessons.length ? 'Next' : 'Start the test', () => startLevel(l, i + 1), 'go'], ['Back to roadmap', showRoad]]);
    else runTest(l, l.qs(), 0, 0);
  }
  function runTest(l, qs, i, score) {
    if (i >= qs.length) {
      const pass = score >= 4, first = pass && !rw.road[l.id];
      if (first) { rw.road[l.id] = Date.now(); addXp(150); rwMsgs.push('🧭 Level passed: ' + l.t + ' +150 XP'); flushRw(); updRw(); }
      return lpop(pass ? '🎉 Level passed' : 'Not yet', '<h4>' + score + ' / ' + qs.length + ' correct</h4><p>' + (pass ? 'You understand this one. The next level is unlocked.' : 'You need 4 out of 5. Read the lessons again and retry. The questions change each time.') + '</p>', [[pass ? 'Back to roadmap' : 'Try again', pass ? showRoad : () => startLevel(l, 0), 'go'], ['Back to roadmap', showRoad]]);
    }
    const q = qs[i], head = '<small>Question ' + (i + 1) + ' of ' + qs.length + '</small><h4>' + q.q + '</h4>';
    const done = (ok, extra) => lpop('Level: ' + l.t, head + '<div class="fb ' + (ok ? 'ok' : 'no') + '"><b>' + (ok ? '✅ Correct' : '❌ Not quite') + '</b> ' + extra + '<br>' + q.why + '</div>', [[i + 1 < qs.length ? 'Next question' : 'See result', () => runTest(l, qs, i + 1, score + (ok ? 1 : 0)), 'go']]);
    if (q.type === 'mc') lpop('Level: ' + l.t, head, q.opts.map((o, k) => [o, () => done(k === q.ans, '')]));
    else if (q.type === 'cof') lpop('Level: ' + l.t, head, [['CALL', () => done(q.ans === 'CALL', 'The math says ' + q.ans + '. You chose CALL.')], ['FOLD', () => done(q.ans === 'FOLD', 'The math says ' + q.ans + '. You chose FOLD.')]]);
    else {
      lpop('Level: ' + l.t, head + (q.slider ? '<input id="gin" type="range" min="0" max="100" value="50"><p id="gv">50%</p>' : '<input id="gin" type="number" inputmode="decimal" placeholder="your answer in %">'), [['Lock in my answer', () => { const g = parseFloat($('gin').value); if (isNaN(g)) return; done(Math.abs(g - q.ans) <= q.tol, 'You said ' + Math.round(g) + '%. Actual: ' + q.ans.toFixed(1) + '%.'); }, 'go']]);
      if (q.slider) $('gin').oninput = () => { $('gv').textContent = $('gin').value + '%'; };
    }
  }
  $('lx').onclick = () => { $('lessonpop').hidden = true; };
  const LK = 'poker.lb', lb = load(LK, { p: {} }), kindOf = (i) => seatKinds[spectate ? i : i - 1] || '';
  function lbRecord() {
    const r = table.handRecords[table.handRecords.length - 1]; if (!r) return;
    const pl = table.getPlayerView(HUMAN).players;
    for (const id in r.startStacks) {
      const i = +id, human = i === HUMAN && !spectate, name = human ? 'You' : pl[i].name, e = lb.p[name] || (lb.p[name] = { hands: 0, net: 0, kind: '' }), d = r.endStacks[id] - r.startStacks[id];
      e.hands++; e.net += d; if (!human) e.kind = kindOf(i);
    }
    save(LK, lb);
  }
  function showLb() {
    const KN = { TAG: 'Tight-aggressive', LAG: 'Loose-aggressive', Nit: 'Very tight', Station: 'Calls a lot' }, sg = (x) => (x > 0 ? '+' : '') + fmt(x);
    const rows = Object.keys(lb.p).map((name) => ({ name: name, e: lb.p[name], r: lb.p[name].hands ? lb.p[name].net / 10 / lb.p[name].hands * 100 : 0 })).sort((a, b) => ((b.e.hands >= 20) - (a.e.hands >= 20)) || b.r - a.r);
    $('lbbody').innerHTML = rows.length ? rows.map((x, i) => '<div class="bdg' + (x.name === 'You' ? ' got' : '') + '"><span class="ic">' + (i + 1) + '</span><div><b>' + esc(x.name) + '</b><small>' + (x.e.kind ? (KN[x.e.kind] || x.e.kind) + ' · ' : '') + x.e.hands + ' hands · ' + sg(x.e.net) + ' coins</small></div><b class="' + (x.r > 0 ? 'up' : x.r < 0 ? 'down' : '') + '" style="margin-left:auto">' + (x.e.hands >= 20 ? sg(Math.round(x.r)) + ' bb/100' : 'warming up') + '</b></div>').join('') : '<p class="tag">Nobody is ranked yet. Play or watch a few hands and the AIs will show up here.</p>';
    $('lbpop').hidden = false;
  }
  function updRw() {
    const l = lvlOf(rw.xp), a = lvlStart(l), b = lvlStart(l + 1), live = rw.day === today() || rw.day === new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    $('lvln').textContent = '⭐ Level ' + l; $('lvlx').textContent = (rw.xp - a) + ' / ' + (b - a) + ' XP'; $('lvlfill').style.width = Math.round(100 * (rw.xp - a) / (b - a)) + '%';
    const cs = curStage(); $('nextstep').textContent = cs ? '🧭 Next lesson: ' + cs.t : '🧭 All available levels passed!';
    $('streakn').textContent = live && rw.streak ? '🔥 ' + rw.streak + '-day streak' : '🔥 Play today to start a streak';
  }
  function showBadges() {
    $('bbody').innerHTML = BADGES.map((b) => { const t = rw.badges[b[0]]; return '<div class="bdg ' + (t ? 'got' : 'lock') + '"><span class="ic">' + (t ? b[1] : '🔒') + '</span><div><b>' + b[2] + '</b><small>' + b[3] + (t ? ' · ' + new Date(t).toLocaleDateString() : '') + '</small></div></div>'; }).join('');
    $('badgepop').hidden = false;
  }

  // ---- strategy chart: where does my hand sit in my own strategy? ----
  const RK = 'AKQJT98765432', CK = { raise: 'r', call: 'c', check: 'k' }, CN = { r: 'Raise', c: 'Call', k: 'Check', f: 'Fold' };
  function showChart() {
    const v = lastView, grid = $('cgrid'); grid.innerHTML = ''; $('cleg').innerHTML = '';
    if (!v || v.street !== 'preflop' || !v.isMyTurn) { $('cwhy').textContent = "The chart shows your strategy for a decision before the flop. Open it when it's your turn preflop."; $('chartpop').hidden = false; return; }
    const mine = Tr.preflop(v), tot = { r: 0, c: 0, k: 0, f: 0 };
    for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
      const cls = i === j ? RK[i] + RK[i] : i < j ? RK[i] + RK[j] + 's' : RK[j] + RK[i] + 'o';
      const a = Tr.preflop(Object.assign({}, v, { myCards: window.PokerEquity.classCombos(cls)[0] }));
      const k = CK[a.action] || 'f', d = document.createElement('div');
      d.className = 'cc ' + k + (cls === mine.cls ? ' me' : ''); d.textContent = cls; grid.appendChild(d);
      tot[k] += i === j ? 6 : i < j ? 4 : 12;
    }
    $('cwhy').textContent = mine.cls + ' → ' + mine.label + '. ' + mine.reason + ' (' + v.myPosition + (v.toCall > 0 ? ', ' + v.toCall + ' to call' : '') + ')';
    ['r', 'c', 'k', 'f'].filter((k) => tot[k]).forEach((k) => { const s = document.createElement('span'); s.className = 'cc leg ' + k; s.textContent = CN[k] + ' ' + (tot[k] / 13.26).toFixed(1) + '%'; $('cleg').appendChild(s); });
    $('chartpop').hidden = false;
  }
  $('chartbtn').onclick = showChart; $('cclose').onclick = () => { $('chartpop').hidden = true; };

  // ---- home screen: build the table, pick a mode ----
  const home = $('home');
  let hMode = 'trainer';
  const setHMode = (m) => { hMode = m; home.querySelectorAll('.mcard').forEach((b) => b.classList.toggle('on', b.dataset.mode === m)); $('h_coachlbl').style.display = m !== 'trainer' ? 'none' : ''; $('stack').parentNode.style.display = m === 'spectate' ? 'none' : ''; homeMode = m; applyAfford(); };
  home.querySelectorAll('.mcard').forEach((b) => { b.onclick = () => setHMode(b.dataset.mode); });
  function showHome() {
    clearTimeout(timer); $('chartpop').hidden = true; updBank(); updRw();
    setHMode($('mode').value); $('h_seats').value = $('seats').value; $('h_coach').value = $('coachmode').value; $('h_vex').value = $('vexmode').value;
    $('resume').hidden = !table; home.hidden = false;
  }
  $('deal').onclick = () => {
    $('mode').value = hMode; $('seats').value = $('h_seats').value; $('coachmode').value = $('h_coach').value; $('vexmode').value = $('h_vex').value;
    try { const o = {}; PIDS.forEach((id) => { o[id] = $(id).value; }); localStorage.setItem(PK, JSON.stringify(o)); } catch (e) {}
    if (!affordable()) { bankNote = 'Not enough coins for that buy-in.'; updBank(); return; }
    home.hidden = true; SFX.unlock(); newGame();
  };
  $('resume').onclick = () => { home.hidden = true; if (table) { render(); schedule(); } };
  // ---- leave table: show a summary, then go back to the main menu ----
  function showSummary() {
    if (!table) { showHome(); return; }
    if (spectate) { $('sumleave').onclick(); return; }
    clearTimeout(timer); $('chartpop').hidden = true; $('review').hidden = true;
    const recs = table.handRecords.filter((r) => r.startStacks[HUMAN] !== undefined), bb = table.bigBlind, start = table.opts.startingStack;
    const nets = recs.map((r) => r.endStacks[HUMAN] - r.startStacks[HUMAN]);
    const net = table._seats[HUMAN].stack - start * (1 + sess.rebuys), won = nets.filter((x) => x > 0).length;
    const sg = (x) => (x > 0 ? '+' : '') + x, row = (k, v) => '<div class="srow"><span>' + k + '</span><b>' + v + '</b></div>';
    const mins = Math.max(1, Math.round((Date.now() - sess.t0) / 60000));
    let h = '<div class="snet ' + (net > 0 ? 'up' : net < 0 ? 'down' : '') + '">' + sg(net) + ' chips</div><div class="ssub">' + sg(+(net / bb).toFixed(1)) + ' big blinds</div>';
    h += row('Mode', master() ? 'Gauntlet' : 'Trainer') + row('Table', table._seats.length + ' players · ' + start + ' chips') + row('Time played', mins + ' min') + (practice ? row('Bank', 'unchanged (practice table)') : row('Bank after cash-out', fmt(bank.coins + stackNow()) + ' coins'));
    h += row('Hands played', recs.length) + (recs.length ? row('Hands won', won + ' (' + Math.round(100 * won / recs.length) + '%)') + row('Biggest win', sg(Math.max(0, ...nets))) + row('Biggest loss', Math.min(0, ...nets)) : '');
    if (sess.rebuys) h += row('Rebuys', sess.rebuys);
    if (!master() && recs.length) h += row('✅ Played well', sess.well) + row('🎲 Bad beats', sess.badbeat) + row('🍀 Lucky escapes', sess.lucky) + row('❌ Mistakes', sess.mistake) + row('Chips lost to mistakes', '≈' + Math.round(sess.evLost));
    if (!(table.isHandOver() || table.street === 'idle')) h += '<div class="snote">Leaving now forfeits the hand in progress.</div>';
    $('sumbody').innerHTML = h; $('sumpop').hidden = false;
  }
  $('homebtn').onclick = showSummary;
  $('sumback').onclick = () => { $('sumpop').hidden = true; if (table) schedule(); };
  $('sumleave').onclick = () => { $('sumpop').hidden = true; clearTimeout(specTimer); saveTable(); if (cur && cur.mode === 'master' && cur.net >= 300) rw.solo = 1; if (cur && cur.net >= 500) award('green'); checkRoad(); flushRw(); bank.coins += practice ? 0 : stackNow(); bank.inPlay = 0; saveBank(); cur = null; table = null; bots = {}; $('revbtn').disabled = true; showHome(); };
  const PK = 'poker.prefs', PIDS = ['mode', 'seats', 'coachmode', 'vexmode', 'stack', 'speed'];
  try { const sv = JSON.parse(localStorage.getItem(PK) || '{}'); PIDS.forEach((id) => { const old = $(id).value; $(id).value = sv[id]; if ($(id).selectedIndex < 0) $(id).value = old; }); } catch (e) {}
  document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; $('chartpop').hidden = true; if (!$('sumpop').hidden) $('sumback').click(); });
  $('speedbtn').onclick = () => { const o = ['relaxed', 'normal', 'fast'], s = $('speed'); s.value = o[(o.indexOf(s.value) + 1) % 3]; updSpeed(); toast('Speed: ' + SPN[s.value] + (s.value === 'relaxed' ? ' — more time to think' : '')); try { const p = JSON.parse(localStorage.getItem(PK) || '{}'); p.speed = s.value; localStorage.setItem(PK, JSON.stringify(p)); } catch (e) {} };
  $('speed').onchange = updSpeed; updSpeed();
  $('rbtn').onclick = showRoad; $('lbtn').onclick = showLb; $('lclose').onclick = () => { $('lbpop').hidden = true; };
  $('bbtn').onclick = showBadges; $('bclose').onclick = () => { $('badgepop').hidden = true; };
  $('hbtn').onclick = showHistory; $('hclose').onclick = () => { $('histpop').hidden = true; };
  showHome();
})();

