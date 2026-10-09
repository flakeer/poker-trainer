
/* Session + lifetime stats and mistake log for the Trainer. Saved in the browser (localStorage). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PokerStats = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const KEY = 'poker.stats.v1';
  let mem = { n: 0, ok: 0, minor: 0, major: 0, leaks: {}, log: [] };
  try { const s = localStorage.getItem(KEY); if (s) mem = Object.assign(mem, JSON.parse(s)); } catch (e) { /* no storage: memory only */ }
  mem.hands = Object.assign({ well: 0, badbeat: 0, lucky: 0, mistake: 0 }, mem.hands); mem.evLost = mem.evLost || 0;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* ignore */ } };
  return {
    record(r) {
      mem.n++; mem[r.severity]++;
      if (r.severity !== 'ok') {
        mem.leaks[r.note] = (mem.leaks[r.note] || 0) + 1;
        mem.log.push(r); if (mem.log.length > 100) mem.log.shift();
      }
      save();
    },
    recordHand(rev) {
      mem.hands[rev.verdict] = (mem.hands[rev.verdict] || 0) + 1;
      mem.evLost += rev.evLost || 0; save();
    },
    hands() { return Object.assign({ evLost: Math.round(mem.evLost) }, mem.hands); },
    summary() {
      const top = Object.entries(mem.leaks).sort((a, b) => b[1] - a[1])[0];
      return { n: mem.n, ok: mem.ok, minor: mem.minor, major: mem.major, pct: mem.n ? Math.round((100 * mem.ok) / mem.n) : 0, topLeak: top ? top[0] + ' ×' + top[1] : null };
    },
    recent(k) { return mem.log.slice(-k).reverse(); },
    reset() { mem = { n: 0, ok: 0, minor: 0, major: 0, leaks: {}, log: [], hands: { well: 0, badbeat: 0, lucky: 0, mistake: 0 }, evLost: 0 }; save(); }
  };
});

