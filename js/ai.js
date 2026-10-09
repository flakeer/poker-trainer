
/*!
 * Master AI: adaptive opponents. No hints, no peeking.
 * A bot reads ONLY its player view (its own cards + public information) and its own memory of
 * what it has seen opponents do. Decisions are mixed strategies (randomised at the margins),
 * so they are not predictable, and they adapt to each opponent's observed style.
 *   Preflop : position ranges scaled by personality, mixed at the boundaries, widened/tightened by opponent stats.
 *   Postflop: Monte Carlo equity vs adjusted opponent ranges, pot odds, value bets, bluffs, semi-bluffs, slow-plays.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./equity.js'), require('./trainer.js'));
  else root.PokerAI = factory(root.PokerEngine, root.PokerEquity, root.PokerTrainer);
})(typeof self !== 'undefined' ? self : this, function (E, Q, T) {
  'use strict';
  const PERSONALITIES = {
    Nit:     { scale: 0.72, aggr: 0.85, bluff: 0.4,  callDown: -0.02 },  // tight and careful
    TAG:     { scale: 1.0,  aggr: 1.0,  bluff: 1.0,  callDown: 0 },      // balanced
    LAG:     { scale: 1.4,  aggr: 1.35, bluff: 1.5,  callDown: 0.01 },   // loose-aggressive
    Station: { scale: 1.5,  aggr: 0.55, bluff: 0.25, callDown: 0.06 }    // loose-passive, calls too much
  };
  const NAMES = ['Rex', 'Maya', 'Ivan', 'Lena', 'Omar'];
  const OPEN = { UTG: 14, HJ: 18, CO: 26, BTN: 42, SB: 36 };
  const clampN = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  function assign(k) { const c = ['TAG', 'LAG', 'Nit', 'Station', 'TAG']; return Array.from({ length: k }, (_, i) => c[i % c.length]); }

  function createBot(opts) {
    opts = opts || {};
    const P = Object.assign({}, PERSONALITIES[opts.personality || 'TAG']);
    const ri = E.makeSeededRng(opts.seed !== undefined ? opts.seed : E.makeSecureRng()(4294967296));
    const rnd = () => ri(1000000) / 1000000;
    const prob = (x) => rnd() < x;
    const iterations = opts.iterations || 1500;
    const models = {};

    // ---------- opponent modelling (public information only) ----------
    function endHand(v) {
      for (const p of v.players) {
        if (p.id === v.seat || !p.inHand) continue;
        const m = models[p.id] || (models[p.id] = { hands: 0, vpip: 0, pfr: 0, agg: 0, pas: 0, faced: 0, folded: 0 });
        m.hands++;
        let vp = false, pr = false;
        const bets = {};
        for (const e of v.history) {
          if (e.seat !== p.id) { if (e.street !== 'preflop' && (e.type === 'bet' || e.type === 'raise')) bets[e.street] = true; continue; }
          if (e.type === 'sb' || e.type === 'bb') continue;
          if (e.street === 'preflop') { if (e.type === 'call' || e.type === 'raise') vp = true; if (e.type === 'raise') pr = true; }
          else {
            if (bets[e.street]) { m.faced++; if (e.type === 'fold') m.folded++; }
            if (e.type === 'bet' || e.type === 'raise') m.agg++; else if (e.type === 'call') m.pas++;
          }
        }
        if (vp) m.vpip++; if (pr) m.pfr++;
      }
    }
    function stat(id) { // shrunk toward typical values so a few hands don't mislead
      const m = models[id] || { hands: 0, vpip: 0, pfr: 0, agg: 0, pas: 0, faced: 0, folded: 0 };
      return {
        hands: m.hands, vpip: (m.vpip + 2.5) / (m.hands + 10), pfr: (m.pfr + 1.5) / (m.hands + 10),
        af: (m.agg + 1) / (m.pas + 1), foldToBet: (m.folded + 3.6) / (m.faced + 8)
      };
    }
    function adjustedRanges(v) {
      return T.rangeEntries(v).map((e) => (e.tight === null ? null : 'top' + clampN(Math.round(e.tight * clampN(stat(e.id).vpip / 0.25, 0.6, 1.8)), 3, 100)));
    }

    // ---------- helpers ----------
    const soft = (pct, thr) => { const lo = thr * 0.85, hi = thr * 1.15; return pct <= lo ? 1 : pct >= hi ? 0 : (hi - pct) / (hi - lo); };
    const clampAmt = (L, x) => Math.max(L.minRaiseTo, Math.min(L.maxRaiseTo, Math.round(x)));
    const raise = (L, x) => ({ type: 'raise', amount: clampAmt(L, x) });

    // ---------- preflop ----------
    function preflop(v) {
      const L = v.legal, bb = v.blinds.big, pos = v.myPosition, n = v.numPlayersInHand;
      const pct = Q.handPercentile(v.myCards[0], v.myCards[1]), info = T.pfInfo(v);
      let open = OPEN[pos] || 30;
      if (n === 2) open = 75; else if (n === 3) open = pos === 'BTN' ? 50 : 40;
      open = Math.min(95, open * P.scale);

      if (info.raises === 0) {
        const thr = info.limpers ? open * 0.8 : open;
        if (pos === 'BB' && L.canCheck) return L.canRaise && prob(soft(pct, 10 * P.scale) * P.aggr) ? raise(L, bb * (3 + info.limpers) * (0.9 + 0.3 * rnd())) : { type: 'check' };
        if (L.canRaise && prob(soft(pct, thr))) return raise(L, (bb * (pos === 'SB' ? 3 : 2.2 + 0.8 * rnd()) + bb * info.limpers));
        if (!L.canCheck && P.scale > 1.3 && pct <= thr * 1.25 && prob(0.4)) return { type: 'call' }; // loose players limp
        return L.canCheck ? { type: 'check' } : { type: 'fold' };
      }
      if (info.raises === 1) {
        const st = stat(info.lastRaiser), lf = clampN(st.pfr / 0.15, 0.7, 1.8); // opener raises a lot -> defend wider
        const late = pos === 'BTN' || pos === 'CO';
        const callThr = (pos === 'BB' ? (L.toCall > 4 * bb ? 18 : 28) : late ? 14 : pos === 'SB' ? 12 : 9) * P.scale * lf * (1 + 3 * P.callDown);
        const t3 = 5 * P.scale * P.aggr * lf;
        if (L.canRaise && (prob(soft(pct, t3)) || (pct <= 35 && prob(0.04 * P.bluff)))) return raise(L, v.currentBet * (late ? 2.8 : 3.4) * (0.9 + 0.2 * rnd()));
        if (prob(soft(pct, callThr))) return { type: 'call' };
        return { type: 'fold' };
      }
      if (L.canRaise && prob(soft(pct, 2.5 * P.scale))) return raise(L, v.currentBet * 2.3);
      return prob(soft(pct, 5 * P.scale)) ? { type: 'call' } : { type: 'fold' };
    }

    // ---------- postflop ----------
    function postflop(v) {
      const L = v.legal, ents = T.rangeEntries(v), opps = Math.max(1, v.numPlayersLive - 1);
      const eq = Q.estimateEquity({ hero: v.myCards, board: v.board, opponents: adjustedRanges(v), iterations: iterations, maxMillis: 150, seed: ri(1000000000) });
      const e = eq.equity, wet = T.texture(v.board) === 'wet', req = Q.requiredEquity(v.toCall, v.pot), edge = e - req;
      const sts = ents.map((x) => stat(x.id)), foldTB = avg(sts.map((s) => s.foldToBet)), af = avg(sts.map((s) => s.af));
      const folder = clampN(foldTB / 0.45, 0.3, 2);       // bluff more against players who fold, rarely against stations
      const bet = (f) => raise(L, f * v.pot * (0.9 + 0.2 * rnd()));
      const aggressor = T.pfInfo(v).lastRaiser === v.seat;

      if (L.toCall === 0) {
        const vMin = 0.57 + 0.04 * (opps - 1);
        if (e >= vMin && L.canRaise) {
          if (e > 0.9 && !wet && opps === 1 && v.street === 'flop' && prob(0.3)) return { type: 'check' }; // slow-play monsters sometimes
          if (prob(0.9)) return bet(e > 0.8 ? (wet ? 0.85 : 0.65) : (wet ? 0.7 : 0.5));
        } else if (e >= 0.48 && L.canRaise && prob(0.3 * P.aggr)) return bet(0.33); // thin value
        if (L.canRaise && opps === 1) {
          let pb = 0;
          if (aggressor && v.street === 'flop') pb = 0.55;                                  // continuation bets, including air
          if (e < 0.45 && e >= 0.28 && v.street !== 'river') pb = Math.max(pb, 0.35);        // semi-bluff with draws
          else if (e < 0.28) pb = Math.max(pb, 0.1);
          if (e < vMin && prob(Math.min(0.8, pb * P.bluff * folder))) return bet(wet ? 0.66 : 0.5);
        }
        return { type: 'check' };
      }
      if (L.canRaise && e >= 0.72 + 0.03 * (opps - 1) && prob(0.55 * P.aggr)) return raise(L, v.currentBet + 0.8 * (v.pot + v.toCall)); // value raise
      if (L.canRaise && opps === 1 && e < 0.3 && v.street !== 'river' && prob(0.04 * P.bluff * folder)) return raise(L, v.currentBet + 0.8 * (v.pot + v.toCall)); // rare bluff-raise
      const margin = 0.015 - P.callDown - (af > 1.6 ? 0.03 : 0) + (v.street === 'river' ? 0.02 : 0); // call lighter vs aggressive players, tighter on the river
      if (edge >= margin) return { type: 'call' };
      if (edge >= margin - 0.04 && prob(0.35)) return { type: 'call' };
      return { type: 'fold' };
    }

    function decide(v) {
      if (!v.isMyTurn || !v.legal) throw new Error('Not this seat\'s turn');
      const L = v.legal;
      let a = v.street === 'preflop' ? preflop(v) : postflop(v);
      if (a.type === 'raise' && !L.canRaise) a = L.canCall ? { type: 'call' } : { type: 'check' };
      if (a.type === 'check' && !L.canCheck) a = { type: 'call' };
      if (a.type === 'call' && !L.canCall) a = { type: 'check' };
      return a;
    }
    function thinkMs(v) { // human-like pacing: longer for postflop and big bets
      return Math.round(450 + 900 * rnd() + (v.street === 'preflop' ? 0 : 350) + (v.toCall > v.pot * 0.6 ? 400 : 0));
    }
    return { decide: decide, endHand: endHand, thinkMs: thinkMs, getModel: stat, personality: opts.personality || 'TAG' };
  }

  return { createBot: createBot, assign: assign, NAMES: NAMES, PERSONALITIES: PERSONALITIES };
});

