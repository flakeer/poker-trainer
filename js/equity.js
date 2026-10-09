
/*!
 * Poker Equity: Monte Carlo equity, preflop ranges, and a Web Worker service.
 * Requires engine.js (uses its hand evaluator). Works in Node, the browser, and a Web Worker.
 *
 * HONESTY RULE: estimateEquity() only receives what the caller passes in (hero cards, board,
 * opponent count / ranges). Unknown cards are dealt at random from the cards that are NOT
 * visible to the hero. It never has access to the real opponent hands or the real deck.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.PokerEquity = factory(root.PokerEngine);
})(typeof self !== 'undefined' ? self : this, function (Engine) {
  'use strict';

  const RANK_CHARS = '23456789TJQKA';
  const evaluate = Engine.evaluate;

  // ======================================================================
  // Hand classes and ranges
  // A "class" is a string: 'AA' (pair), 'AKs' (suited), 'AKo' (offsuit).
  // ======================================================================
  function rankIdx(ch) {
    const i = RANK_CHARS.indexOf(ch.toUpperCase());
    if (i < 0) throw new Error('Bad rank: ' + ch);
    return i;
  }

  /** Two cards (ints) -> class string, e.g. [As, Kh] -> 'AKo'. */
  function handClass(c1, c2) {
    const r1 = c1 % 13, r2 = c2 % 13;
    const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
    if (hi === lo) return RANK_CHARS[hi] + RANK_CHARS[lo];
    const suited = ((c1 / 13) | 0) === ((c2 / 13) | 0);
    return RANK_CHARS[hi] + RANK_CHARS[lo] + (suited ? 's' : 'o');
  }

  /** Expand a class into its concrete two-card combos. */
  function classCombos(cls) {
    const hi = rankIdx(cls[0]), lo = rankIdx(cls[1]);
    const out = [];
    if (hi === lo) {
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) out.push([a * 13 + hi, b * 13 + lo]);
    } else if (cls[2] === 's') {
      for (let s = 0; s < 4; s++) out.push([s * 13 + hi, s * 13 + lo]);
    } else {
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (a !== b) out.push([a * 13 + hi, b * 13 + lo]);
    }
    return out;
  }

  // ---- Preflop ordering: Chen formula (a fast, well-known approximation; the Trainer's
  // actual preflop chart will be explicit and separate from this ordering). ----
  function chenScore(hi, lo, suited) {
    const base = (r) => (r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : (r + 2) / 2);
    if (hi === lo) return Math.max(5, base(hi) * 2);
    let s = base(hi);
    if (suited) s += 2;
    const gap = hi - lo - 1;
    s -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
    if (gap <= 1 && hi < 10) s += 1; // connected / one-gap, both below a Queen
    return Math.ceil(s);
  }

  const HAND_RANKING = (function () {
    const list = [];
    for (let hi = 12; hi >= 0; hi--) {
      for (let lo = hi; lo >= 0; lo--) {
        if (hi === lo) {
          list.push({ cls: RANK_CHARS[hi] + RANK_CHARS[lo], combos: 6, score: chenScore(hi, lo, false) + hi * 0.01 });
        } else {
          list.push({ cls: RANK_CHARS[hi] + RANK_CHARS[lo] + 's', combos: 4, score: chenScore(hi, lo, true) + hi * 0.01 + lo * 0.001 + 0.0005 });
          list.push({ cls: RANK_CHARS[hi] + RANK_CHARS[lo] + 'o', combos: 12, score: chenScore(hi, lo, false) + hi * 0.01 + lo * 0.001 });
        }
      }
    }
    const ORDER = 'AA KK QQ JJ TT 99 AKs AQs AKo AJs KQs 88 ATs KJs AQo KTs QJs AJo KQo QTs 77 A9s JTs KJo A8s ATo K9s KTo A7s A5s QJo J9s Q9s A6s A9o A4s QTo T9s K8s JTo 66 A3s A8o Q8s K7s K9o J8s A2s K6s T8s 55 A7o K5s Q9o 98s K4s T9o A5o A6o Q7s J9o J7s K3s Q6s K8o A4o 87s T7s K2s K7o 97s 44 Q8o A3o Q5s Q4s T8o J8o K6o 76s J6s A2o 96s T6s Q3s J5s K5o 98o 86s Q2s 33 Q7o J4s 65s T5s K4o 75s J7o J3s 95s T7o 87o Q6o 97o T4s 85s K3o 54s J2s Q5o T3s K2o 74s 22 64s Q4o J6o T2s 84s 53s 76o 94s 93s 96o 86o T6o Q3o 92s J5o 63s J4o 43s Q2o 73s 83s 65o 82s 85o 75o T5o 52s 54o J3o 62s T4o 95o 42s J2o 32s 64o 72s T3o 74o T2o 94o 53o 84o 93o 43o 92o 73o 63o 83o 82o 52o 42o 62o 72o 32o'.split(' ');
    list.sort((a, b) => ORDER.indexOf(a.cls) - ORDER.indexOf(b.cls));
    let cum = 0;
    for (const h of list) { cum += h.combos; h.cumPct = (100 * cum) / 1326; }
    return list;
  })();

  /** Classes making up the top `pct` percent of starting hands (by combos). */
  function topPercentClasses(pct) {
    const limit = (pct / 100) * 1326;
    const out = [];
    let cum = 0;
    for (const h of HAND_RANKING) {
      if (cum >= limit) break;
      out.push(h.cls);
      cum += h.combos;
    }
    return out;
  }

  /** Where a hand sits in the preflop ordering: 1 = best, 100 = worst (top X% of hands). */
  function handPercentile(c1, c2) {
    const cls = handClass(c1, c2);
    for (const h of HAND_RANKING) if (h.cls === cls) return h.cumPct;
    return 100;
  }

  /**
   * Parse range notation into class strings.
   *   'AA'  'AKs'  'AKo'  'AK' (suited + offsuit)
   *   'TT+' (TT..AA)   'ATs+' (ATs..AKs)   'KQo+'
   *   'TT-66' (pairs 66..TT)   'A5s-A2s' (same first rank, kicker range)
   *   'top15' or 'top15%' (top 15% of hands)
   * Tokens are separated by commas or spaces.
   */
  function parseRange(str) {
    const out = new Set();
    const addPair = (r) => out.add(RANK_CHARS[r] + RANK_CHARS[r]);
    const addNon = (hi, lo, kind) => {
      if (kind !== 'o') out.add(RANK_CHARS[hi] + RANK_CHARS[lo] + 's');
      if (kind !== 's') out.add(RANK_CHARS[hi] + RANK_CHARS[lo] + 'o');
    };
    const tokens = String(str).split(/[\s,]+/).filter(Boolean);
    for (const raw of tokens) {
      const tok = raw.trim();
      let m = /^top(\d+(?:\.\d+)?)%?$/i.exec(tok);
      if (m) { topPercentClasses(parseFloat(m[1])).forEach((c) => out.add(c)); continue; }

      // dash range
      m = /^([2-9TJQKA])([2-9TJQKA])([so]?)-([2-9TJQKA])([2-9TJQKA])([so]?)$/i.exec(tok);
      if (m) {
        const a1 = rankIdx(m[1]), a2 = rankIdx(m[2]), b1 = rankIdx(m[4]), b2 = rankIdx(m[5]);
        const kind = (m[3] || m[6] || '').toLowerCase();
        if (a1 === a2 && b1 === b2) {
          for (let r = Math.min(a1, b1); r <= Math.max(a1, b1); r++) addPair(r);
        } else if (a1 === b1) {
          for (let lo = Math.min(a2, b2); lo <= Math.max(a2, b2); lo++) addNon(a1, lo, kind);
        } else throw new Error('Unsupported range: ' + tok);
        continue;
      }

      m = /^([2-9TJQKA])([2-9TJQKA])([so]?)(\+?)$/i.exec(tok);
      if (!m) throw new Error('Bad range token: ' + tok);
      let r1 = rankIdx(m[1]), r2 = rankIdx(m[2]);
      const kind = m[3].toLowerCase(), plus = m[4] === '+';
      if (r1 < r2) { const t = r1; r1 = r2; r2 = t; }
      if (r1 === r2) {
        if (plus) for (let r = r1; r <= 12; r++) addPair(r); else addPair(r1);
      } else if (plus) {
        for (let lo = r2; lo < r1; lo++) addNon(r1, lo, kind);
      } else addNon(r1, r2, kind);
    }
    return Array.from(out);
  }

  /** Concrete combos of a range (array of classes), skipping any that use a dead card. */
  function expandRange(classes, dead) {
    const out = [];
    for (const cls of classes) {
      for (const cb of classCombos(cls)) {
        if (dead && (dead[cb[0]] || dead[cb[1]])) continue;
        out.push(cb);
      }
    }
    return out;
  }

  // ======================================================================
  // Monte Carlo equity
  // ======================================================================
  function secureSeed() {
    try {
      const c = (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) ? globalThis.crypto : require('crypto').webcrypto;
      const b = new Uint32Array(1);
      c.getRandomValues(b);
      return b[0];
    } catch (e) {
      return (Date.now() ^ (Math.random() * 4294967296)) >>> 0;
    }
  }

  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  /**
   * params:
   *   hero:        [card, card]            (ints 0-51)
   *   board:       [] | 3 | 4 | 5 cards
   *   opponents:   number (random hands) OR array; each entry is null (random hand),
   *                a range string ('QQ+,AKs'), an array of classes, or an array of combos.
   *   iterations:  default 4000
   *   maxMillis:   optional time cap (stops early, still returns a valid estimate)
   *   seed / rng:  optional, for tests (rng is not available through the worker)
   * returns { equity, win, tie, lose, iterations, stdErr, skipped }
   *   equity counts ties as a share of the pot (a 2-way tie is worth 0.5).
   */
  function estimateEquity(p) {
    const hero = p.hero;
    if (!hero || hero.length !== 2) throw new Error('hero must be two cards');
    const board = p.board || [];
    if ([0, 3, 4, 5].indexOf(board.length) < 0) throw new Error('board must have 0, 3, 4 or 5 cards');

    const dead = new Uint8Array(52);
    for (const c of hero.concat(board)) {
      if (!(c >= 0 && c < 52)) throw new Error('Bad card value: ' + c);
      if (dead[c]) throw new Error('Duplicate card: ' + c);
      dead[c] = 1;
    }

    const spec = typeof p.opponents === 'number' ? new Array(p.opponents).fill(null) : (p.opponents || [null]);
    if (spec.length < 1 || spec.length > 8) throw new Error('opponents must be 1-8');

    const oppCombos = spec.map((o) => {
      if (o === null || o === undefined) return null;
      let combos;
      if (typeof o === 'string') combos = expandRange(parseRange(o), dead);
      else if (Array.isArray(o) && o.length && typeof o[0] === 'string') combos = expandRange(o, dead);
      else if (Array.isArray(o)) combos = o.filter((cb) => !dead[cb[0]] && !dead[cb[1]]);
      else throw new Error('Bad opponent spec');
      if (!combos.length) throw new Error('Opponent range has no possible hands');
      return combos;
    });

    const pool = [];
    for (let c = 0; c < 52; c++) if (!dead[c]) pool.push(c);

    const rng = p.rng || Engine.makeSeededRng(p.seed !== undefined && p.seed !== null ? p.seed : secureSeed());
    const target = p.iterations || 4000;
    const maxMs = p.maxMillis || 0;
    const t0 = now();

    const nOpp = spec.length;
    const used = new Uint8Array(52);
    const oppHand = [];
    for (let i = 0; i < nOpp; i++) oppHand.push([0, 0]);

    let n = 0, skipped = 0, wins = 0, ties = 0, eqSum = 0, eqSq = 0;

    for (let iter = 0; iter < target; iter++) {
      if (maxMs && (iter & 255) === 255 && now() - t0 > maxMs) break;
      used.set(dead);

      let ok = true;
      for (let i = 0; i < nOpp && ok; i++) {
        const cl = oppCombos[i];
        if (!cl) continue;
        let picked = null;
        for (let tries = 0; tries < 40; tries++) {
          const cb = cl[rng(cl.length)];
          if (!used[cb[0]] && !used[cb[1]]) { picked = cb; break; }
        }
        if (!picked) { ok = false; break; }
        used[picked[0]] = 1; used[picked[1]] = 1;
        oppHand[i][0] = picked[0]; oppHand[i][1] = picked[1];
      }
      if (!ok) { skipped++; continue; }

      const draw = () => {
        let c;
        do { c = pool[rng(pool.length)]; } while (used[c]);
        used[c] = 1;
        return c;
      };
      for (let i = 0; i < nOpp; i++) {
        if (!oppCombos[i]) { oppHand[i][0] = draw(); oppHand[i][1] = draw(); }
      }
      const full = board.slice();
      while (full.length < 5) full.push(draw());

      const heroScore = evaluate(hero.concat(full));
      let bestOpp = -1, tiedOpp = 0;
      for (let i = 0; i < nOpp; i++) {
        const sc = evaluate(oppHand[i].concat(full));
        if (sc > bestOpp) { bestOpp = sc; tiedOpp = 1; } else if (sc === bestOpp) tiedOpp++;
      }

      let e = 0;
      if (heroScore > bestOpp) { wins++; e = 1; }
      else if (heroScore === bestOpp) { ties++; e = 1 / (tiedOpp + 1); }
      eqSum += e; eqSq += e * e; n++;
    }

    if (n === 0) throw new Error('No valid simulations (ranges conflict with the visible cards)');
    const mean = eqSum / n;
    const variance = Math.max(0, eqSq / n - mean * mean);
    return {
      equity: mean, win: wins / n, tie: ties / n, lose: (n - wins - ties) / n,
      iterations: n, stdErr: Math.sqrt(variance / n), skipped: skipped
    };
  }

  /** Equity needed to break even on a call: toCall / (pot + toCall). `pot` is the pot BEFORE you call. */
  function requiredEquity(toCall, pot) {
    if (toCall <= 0) return 0;
    return toCall / (pot + toCall);
  }

  // ======================================================================
  // Browser service: runs estimateEquity in a Web Worker, with a safe fallback.
  // Chrome blocks workers when a page is opened straight from disk (file://); in that
  // case this falls back to running on the main thread in small, bounded chunks.
  // ======================================================================
  function createEquityService(options) {
    const workerUrl = (options && options.workerUrl) || 'js/equity-worker.js';
    const pending = new Map();
    let worker = null, broken = typeof Worker === 'undefined', nextId = 1;

    function runLocal(params) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          try { resolve(estimateEquity(Object.assign({}, params, { maxMillis: params.maxMillis || 150 }))); }
          catch (e) { reject(e); }
        }, 0);
      });
    }

    function ensure() {
      if (worker || broken) return;
      try {
        worker = new Worker(workerUrl);
        worker.onmessage = (e) => {
          const entry = pending.get(e.data.id);
          if (!entry) return;
          pending.delete(e.data.id);
          if (e.data.error) entry.reject(new Error(e.data.error)); else entry.resolve(e.data.result);
        };
        worker.onerror = () => {
          broken = true;
          worker = null;
          const stuck = Array.from(pending.values());
          pending.clear();
          for (const entry of stuck) runLocal(entry.params).then(entry.resolve, entry.reject);
        };
      } catch (e) {
        broken = true; worker = null;
      }
    }

    return {
      estimate(params) {
        ensure();
        if (broken || !worker) return runLocal(params);
        const id = nextId++;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve: resolve, reject: reject, params: params });
          worker.postMessage({ id: id, params: params });
        });
      },
      terminate() {
        if (worker) worker.terminate();
        worker = null; broken = true;
        pending.clear();
      },
      get usingWorker() { return !!worker && !broken; }
    };
  }

  return {
    estimateEquity: estimateEquity,
    requiredEquity: requiredEquity,
    handClass: handClass,
    handPercentile: handPercentile,
    parseRange: parseRange,
    expandRange: expandRange,
    classCombos: classCombos,
    topPercentClasses: topPercentClasses,
    HAND_RANKING: HAND_RANKING,
    createEquityService: createEquityService
  };
});

