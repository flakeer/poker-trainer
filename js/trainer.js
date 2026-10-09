
/*!
 * Trainer: one FIXED strategy (tight-aggressive). Same situation -> same advice.
 * Reads ONLY a player view (what the seat can see). Never touches hidden cards or the deck.
 *   Preflop: position-based chart (hand percentile from equity.js).
 *   Postflop: equity vs opponent ranges (guessed from their actions) compared with pot odds.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./equity.js'));
  else root.PokerTrainer = factory(root.PokerEngine, root.PokerEquity);
})(typeof self !== 'undefined' ? self : this, function (E, Q) {
  'use strict';
  const OPEN = { UTG: 14, HJ: 18, CO: 26, BTN: 42, SB: 36 };   // open-raise: top X% of hands
  // Standard 6-max (100bb) raise-first-in ranges, written out hand by hand.
  const OPEN_RANGE = {
    UTG: 'top0', HJ: 'top0', CO: 'top0', SB: 'top0', BTN: 'top0'
  };
  OPEN_RANGE.UTG = Q.parseRange('55+,A2s-A5s,ATs+,KTs+,QTs+,JTs,T9s,98s,AJo+,KQo');
  OPEN_RANGE.HJ = Q.parseRange('44+,A2s+,K9s+,Q9s+,J9s+,T9s,98s,87s,ATo+,KJo+,QJo');
  OPEN_RANGE.CO = Q.parseRange('22+,A2s+,K6s+,Q8s+,J8s+,T8s+,97s+,86s+,76s,65s,54s,A9o+,KTo+,QTo+,JTo');
  OPEN_RANGE.SB = Q.parseRange('22+,A2s+,K4s+,Q6s+,J7s+,T7s+,97s+,86s+,76s,65s,54s,A2o+,K9o+,QTo+,JTo');
  OPEN_RANGE.BTN = Q.parseRange('22+,A2s+,K2s+,Q4s+,J6s+,T6s+,96s+,85s+,75s+,64s+,54s,A2o+,K8o+,Q9o+,J9o+,T9o,98o');
  const pc = (x) => Math.round(x * 100) + '%';

  function pfInfo(v) {
    let raises = 0, limpers = 0, lastRaiser = null;
    for (const e of v.history) {
      if (e.street !== 'preflop' || e.type === 'sb' || e.type === 'bb') continue;
      if (e.type === 'raise' || e.type === 'bet') { raises++; lastRaiser = e.seat; }
      else if (e.type === 'call' && raises === 0) limpers++;
    }
    return { raises: raises, limpers: limpers, lastRaiser: lastRaiser };
  }

  const clamp = (L, x) => Math.max(L.minRaiseTo, Math.min(L.maxRaiseTo, Math.round(x)));
  const label = (a, amt, L) => a === 'fold' ? 'Fold' : a === 'check' ? 'Check' : a === 'call' ? 'Call ' + L.callAmount
    : (L.isBet ? 'Bet ' : 'Raise to ') + amt + (amt >= L.maxRaiseTo ? ' (all-in)' : '');

  // ---------------- Preflop chart ----------------
  function preflop(v) {
    const L = v.legal, bb = v.blinds.big, pos = v.myPosition, n = v.numPlayersInHand;
    const pct = Q.handPercentile(v.myCards[0], v.myCards[1]), cls = Q.handClass(v.myCards[0], v.myCards[1]);
    const info = pfInfo(v);
    let open = OPEN[pos] || 30;
    if (n === 2) open = 75; else if (n === 3) open = pos === 'BTN' ? 50 : 40;
    const out = (action, amount, reason, threshold) => ({
      street: 'preflop', action: action, amount: amount || 0, label: label(action, amount, L), reason: reason,
      close: threshold ? Math.abs(pct - threshold) / threshold <= 0.2 : false,
      pct: pct, cls: cls,
      numbers: cls + ' = top ' + pct.toFixed(0) + '% of hands · position ' + pos + ' · to call ' + L.toCall
    });

    if (info.raises === 0) {
      const thr = info.limpers ? open * 0.8 : open;
      if (pos === 'BB' && L.canCheck) {
        if (pct <= 10 && L.canRaise) return out('raise', clamp(L, bb * (3 + info.limpers)), cls + ' is strong: raise the limpers.', 10);
        return out('check', 0, 'Free flop with ' + cls + '.', 10);
      }
      const inRange = n >= 4 && OPEN_RANGE[pos] ? (OPEN_RANGE[pos].indexOf(cls) >= 0 && (!info.limpers || pct <= thr * 1.3)) : pct <= thr;
      if (inRange && L.canRaise) return out('raise', clamp(L, bb * (pos === 'SB' ? 3 : 2.5) + bb * info.limpers),
        cls + ' is in the standard range that ' + pos + ' ' + (info.limpers ? 'raises over limpers' : 'opens') + '. Raise, don\'t limp.', thr);
      if (L.canCheck) return out('check', 0, 'Nothing to pay.', thr);
      return out('fold', 0, cls + ' (top ' + pct.toFixed(0) + '%) is outside ' + pos + '\'s standard opening range.', thr);
    }
    if (info.raises === 1) {
      const callThr = pos === 'BB' ? (L.toCall > 4 * bb ? 18 : 28) : (pos === 'BTN' || pos === 'CO') ? 14 : pos === 'SB' ? 12 : 9;
      if (pct <= 5 && L.canRaise) return out('raise', clamp(L, v.currentBet * (pos === 'BTN' || pos === 'CO' ? 3 : 3.5)), cls + ' is a premium hand: re-raise (3-bet) for value.', 5);
      if (pct <= callThr) return out('call', 0, cls + ' is good enough to call a raise from ' + pos + ' (top ' + callThr + '%).', callThr);
      return out('fold', 0, cls + ' (top ' + pct.toFixed(0) + '%) is too weak against a raise from ' + pos + ' (calling range: top ' + callThr + '%).', callThr);
    }
    if (pct <= 2.5 && L.canRaise) return out('raise', clamp(L, v.currentBet * 2.3), cls + ' is strong enough to 4-bet against a re-raise.', 2.5);
    if (pct <= 5) return out('call', 0, cls + ' can call a re-raise, but not more.', 5);
    return out('fold', 0, 'Against a re-raise only the top 5% continues; ' + cls + ' is top ' + pct.toFixed(0) + '%.', 5);
  }

  // ---------------- Opponent ranges from public actions ----------------
  function rangeEntries(v) {
    const out = [];
    for (const p of v.players) {
      if (p.isMe || !p.inHand || p.folded) continue;
      let tight = 100, called = false, postAgg = false, raisesSeen = 0;
      for (const e of v.history) {
        if (e.street === 'preflop') {
          if (e.type === 'raise') { if (e.seat === p.id) tight = Math.min(tight, raisesSeen === 0 ? 15 : 6); raisesSeen++; }
          else if (e.type === 'call' && e.seat === p.id && raisesSeen > 0) called = true;
        } else if (e.seat === p.id && (e.type === 'bet' || e.type === 'raise')) postAgg = true;
      }
      if (tight === 100 && called) tight = 35;
      if (postAgg) tight = tight < 100 ? Math.min(tight, 20) : 30;
      out.push({ id: p.id, tight: tight < 100 ? tight : null });
    }
    return out;
  }

  function ranges(v) { return rangeEntries(v).map((e) => (e.tight === null ? null : 'top' + e.tight)); }

  function texture(board) {
    const suits = [0, 0, 0, 0], ranks = board.map((c) => c % 13).sort((a, b) => a - b);
    board.forEach((c) => suits[(c / 13) | 0]++);
    const flushy = Math.max.apply(null, suits) >= 3;
    let connected = false;
    for (let i = 0; i + 2 < ranks.length; i++) if (ranks[i + 2] - ranks[i] <= 4 && ranks[i] !== ranks[i + 1] && ranks[i + 1] !== ranks[i + 2]) connected = true;
    return flushy || connected ? 'wet' : 'dry';
  }

  // ---------------- Postflop: equity vs pot odds ----------------
  function postflop(v, eq) {
    const L = v.legal, opps = Math.max(1, v.numPlayersLive - 1), e = eq.equity, tex = texture(v.board);
    const req = Q.requiredEquity(v.toCall, v.pot), edge = e - req;
    const nums = 'Equity ' + pc(e) + ' (±' + pc(2 * eq.stdErr) + ') vs ' + opps + ' opp · needed ' + pc(req) + ' · pot ' + v.pot + ' · board ' + tex;
    const out = (action, amount, reason, close) => ({ street: v.street, action: action, amount: amount || 0, label: label(action, amount, L), reason: reason, close: !!close, edge: edge, equity: e, required: req, pot: v.pot, toCall: v.toCall, numbers: nums });

    if (L.toCall === 0) {
      const valueMin = 0.62 + 0.04 * (opps - 1);
      if (e >= valueMin && L.canRaise) { const f = tex === 'wet' ? 0.75 : 0.5; return out('raise', clamp(L, f * v.pot), 'Strong hand (' + pc(e) + '): bet ' + pc(f) + ' pot for value' + (tex === 'wet' ? ' and to charge draws.' : '.'), e - valueMin < 0.05); }
      const aggressor = pfInfo(v).lastRaiser === v.seat;
      if (aggressor && opps === 1 && tex === 'dry' && v.street === 'flop' && e >= 0.4 && L.canRaise) return out('raise', clamp(L, 0.33 * v.pot), 'Continuation bet: you raised before the flop and the board is dry.', false);
      return out('check', 0, 'Equity ' + pc(e) + ' is not enough to bet for value (need ' + pc(valueMin) + ').', valueMin - e < 0.05);
    }
    if (e >= 0.7 + 0.03 * (opps - 1) && L.canRaise) return out('raise', clamp(L, v.currentBet + 0.75 * (v.pot + v.toCall)), 'Very strong (' + pc(e) + '): raise for value.', false);
    if (edge >= 0.04) return out('call', 0, 'Equity ' + pc(e) + ' beats the ' + pc(req) + ' you need: call.', false);
    if (edge >= -0.04) return out(edge >= 0 ? 'call' : 'fold', 0, 'Marginal: equity ' + pc(e) + ' vs ' + pc(req) + ' needed. ' + (edge >= 0 ? 'Slightly profitable call.' : 'Slightly losing call.'), true);
    return out('fold', 0, 'Equity ' + pc(e) + ' is well below the ' + pc(req) + ' needed to call.', false);
  }

  /** svc: {estimate(params) -> Promise}. opts: {iterations, seed}. Returns Promise<advice>. */
  function advise(v, svc, opts) {
    opts = opts || {};
    if (!v.isMyTurn || !v.legal) return Promise.reject(new Error('Not this seat\'s turn'));
    if (v.street === 'preflop') return Promise.resolve(preflop(v));
    const params = { hero: v.myCards, board: v.board, opponents: ranges(v), iterations: opts.iterations || 3000, maxMillis: 250 };
    if (opts.seed !== undefined) params.seed = opts.seed;
    return svc.estimate(params).then((eq) => postflop(v, eq));
  }

  // ---------------- Judge what the player actually did ----------------
  const kind = (t) => (t === 'bet' || t === 'raise' || t === 'allin') ? 'raise' : t;
  function compare(advice, played) {
    const a = advice.action, p = kind(played.type);
    if (a === p) return { severity: 'ok', note: '' };
    if (advice.close) return { severity: 'ok', note: 'close spot' };
    if (a === 'fold') return p === 'call' ? { severity: 'major', note: 'Called too wide' } : { severity: 'major', note: 'Raised a hand that should fold' };
    if (a === 'raise') return p === 'fold' ? { severity: 'major', note: 'Folded a strong hand' } : { severity: 'minor', note: 'Too passive' };
    if (a === 'call') return p === 'fold' ? { severity: (advice.edge || 0) > 0.1 ? 'major' : 'minor', note: 'Folded too much' } : { severity: 'minor', note: 'Raised instead of calling' };
    return p === 'fold' ? { severity: 'minor', note: 'Folded for free' } : { severity: 'minor', note: 'Bet a marginal hand' }; // advice was check
  }

  return { advise: advise, compare: compare, preflop: preflop, postflop: postflop, ranges: ranges, rangeEntries: rangeEntries, pfInfo: pfInfo, texture: texture };
});

