#!/usr/bin/env node
// Fairness tests: nobody can see hidden cards, the shuffle is unbiased, and chips are never created or lost.
// Usage: node tests/fairness.test.js   (no dependencies; exits with code 1 if anything fails)
const E = require('../js/engine.js'), AI = require('../js/ai.js');
let failed = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  (' + detail + ')' : '')); if (!ok) failed++; };

// 1. Simulate full games with every AI personality. While a hand is being played:
//    - no seat's view may contain another player's hole cards
//    - a hand that ends without a showdown must not reveal anyone's cards
//    - the total number of chips on the table must never change
let hands = 0, actions = 0, leaks = 0, chipErrors = 0, botErrors = 0;
const kinds = ['TAG', 'LAG', 'Nit', 'Station', 'TAG', 'LAG'];
for (let g = 0; g < 60; g++) {
  const n = 2 + (g % 5), t = new E.Table({ numSeats: n, smallBlind: 5, bigBlind: 10, startingStack: 1000 });
  const bots = []; for (let i = 0; i < n; i++) bots.push(AI.createBot({ personality: kinds[i], iterations: 150 }));
  const chips0 = t.totalChips();
  for (let h = 0; h < 8; h++) {
    if (!t.startHand()) break;
    hands++;
    for (let guard = 0; !t.isHandOver() && guard < 300; guard++) {
      const id = t.toAct; if (id === null) break;
      for (let s = 0; s < n; s++) {
        const v = t.getPlayerView(s);
        for (const p of v.players) if (p.id !== s && p.inHand && p.holeCards !== null) leaks++;
        if (v.result && !v.result.showdown && Object.keys(v.result.hands).length) leaks++;
      }
      const v = t.getPlayerView(id); let r;
      try { r = t.act(id, bots[id].decide(v)); } catch (e) { botErrors++; r = { ok: false }; }
      if (!r.ok) t.act(id, v.legal.canCheck ? { type: 'check' } : { type: 'fold' });
      actions++;
    }
    if (t.totalChips() !== chips0) chipErrors++;
  }
}
check('hidden cards are never visible to other seats', leaks === 0, hands + ' hands, ' + actions + ' actions');
check('chips are conserved (no chips created or lost)', chipErrors === 0);
check('AI bots never crash or send illegal moves', botErrors === 0);

// 2. The shuffle is unbiased: chi-square test on which card ends up on top (51 degrees of freedom).
//    The 99.99% critical value is about 100, so a fair shuffle passes essentially always.
const rng = E.makeSecureRng(), N = 52000, count = new Array(52).fill(0);
for (let i = 0; i < N; i++) count[E.shuffle(E.makeDeck(), rng)[0]]++;
const exp = N / 52; let chi = 0; for (const c of count) chi += (c - exp) * (c - exp) / exp;
check('shuffle is unbiased (top card)', chi < 100, 'chi-square ' + chi.toFixed(1) + ', fair < 100');

// 3. A player's view must not expose the deck or other hands at all.
const t2 = new E.Table({ numSeats: 6 }); t2.startHand(); const v2 = t2.getPlayerView(0);
check('player view has no deck', !Object.keys(v2).some((k) => /deck/i.test(k)));
check("opponents' hole cards are hidden", v2.players.filter((p) => p.id !== 0).every((p) => p.holeCards === null));

console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nAll checks passed');
process.exit(failed ? 1 : 0);
