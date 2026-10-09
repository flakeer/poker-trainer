
/*!
 * Hand review: judges your DECISIONS separately from the RESULT.
 *   well     = you matched the coach          (and won, or lost a fair fight)
 *   badbeat  = you matched the coach, were ahead when it mattered, and still lost
 *   lucky    = you went against the coach and won anyway
 *   mistake  = you went against the coach (and lost, or folded a hand worth playing)
 * Uses only what was visible when you decided. Opponent cards shown at showdown never change the verdict.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./trainer.js'));
  else root.PokerReview = factory(root.PokerTrainer);
})(typeof self !== 'undefined' ? self : this, function (T) {
  'use strict';
  const kind = (t) => (t === 'bet' || t === 'raise' || t === 'allin') ? 'raise' : t;
  const round1 = (x) => Math.round(x * 10) / 10;

  /** decision: {street, cards, board, played:{type,amount}, advice}. Adds severity, note, evCost (chips, or null). */
  function judge(d) {
    const j = T.compare(d.advice, d.played), a = d.advice, p = kind(d.played.type);
    if (j.severity !== 'ok' && typeof a.equity === 'number' && a.toCall > 0) {
      const req = a.toCall / (a.pot + a.toCall), m = a.equity - req, pc = (x) => Math.round(x * 100) + '%', cont = p === 'call' || p === 'raise';
      const nums = ' (about ' + pc(a.equity) + ' to win vs ' + pc(req) + ' needed)';
      if (cont && a.action === 'fold' && m >= -0.03) { j.severity = 'ok'; j.note = (m >= 0.03 ? 'You disagreed with the coach, and your call holds up' : 'Close decision: you disagreed, and it is marginal either way') + nums + '. Later streets could shift this, so judge it over many hands.'; }
      else if (p === 'fold' && a.action === 'call' && m <= 0.03) { j.severity = 'ok'; j.note = 'You disagreed with the coach, and folding is defensible' + nums + '.'; }
      else j.note = 'You disagreed with the coach, and the math does not back it up' + nums + '. ' + (j.note || '');
    }
    let ev = null;
    if (j.severity !== 'ok' && typeof a.equity === 'number') {
      const evCall = a.equity * (a.pot + a.toCall) - a.toCall;       // expected chips from calling (ignores later streets)
      if (a.action === 'fold' && (p === 'call' || p === 'raise')) ev = Math.max(0, -evCall); // what continuing was expected to lose, at least
      else if (a.action === 'call' && p === 'fold') ev = Math.max(0, evCall);                 // what folding gave up
    }
    return Object.assign({}, d, { severity: j.severity, note: j.note, evCost: ev === null ? null : round1(ev) });
  }

  /** outcome: {net, folded, bb, opp?, mine?, handNumber?} */
  function build(decisions, outcome) {
    const rows = decisions.map(judge);
    const bad = rows.filter((r) => r.severity !== 'ok');
    const worst = bad.slice().sort((a, b) => (a.severity === 'major' ? 0 : 1) - (b.severity === 'major' ? 0 : 1) || (b.evCost || 0) - (a.evCost || 0))[0] || null;
    const maxEq = rows.reduce((m, r) => Math.max(m, typeof r.advice.equity === 'number' ? r.advice.equity : 0), 0);
    const premium = rows.some((r) => r.advice.street === 'preflop' && r.advice.action === 'raise' && r.advice.pct <= 8);
    let verdict;
    if (bad.length) verdict = outcome.net > 0 && !outcome.folded ? 'lucky' : 'mistake';
    else verdict = outcome.net < 0 && !outcome.folded && (maxEq >= 0.55 || premium) ? 'badbeat' : 'well';
    return {
      verdict: verdict, rows: rows, worst: worst, net: outcome.net, folded: !!outcome.folded, maxEquity: maxEq,
      evLost: round1(bad.reduce((s, r) => s + (r.evCost || 0), 0)), opp: outcome.opp || [], mine: outcome.mine || null,
      handNumber: outcome.handNumber || 0
    };
  }
  /** After a hand you folded in: was the fold right, and what would the cards have done? */
  function hindsight(ds, c, E) {
    const f = ds.filter((d) => d.played && d.played.type === 'fold')[0];
    if (!f) return null;
    const right = f.advice.action === 'fold', where = f.street === 'preflop' ? 'before the flop' : 'on the ' + f.street;
    const lead = right ? '✅ Good fold ' + where + ': the coach agreed.' : '❌ Early fold ' + where + ': the coach wanted you to stay in.';
    let res = null;
    if (c.myCards && c.myCards.length === 2 && c.board && c.board.length === 5 && c.hands) {
      const opps = Object.keys(c.hands).filter((id) => +id !== c.me).map((id) => ({ name: c.names[id], s: c.hands[id].score, h: c.hands[id].name }));
      if (opps.length) {
        const mine = E.evaluateDetailed(c.myCards.concat(c.board)), top = opps.reduce((a, b) => (b.s > a.s ? b : a));
        res = { hand: mine.name, cmp: mine.score > top.s ? 'win' : mine.score === top.s ? 'tie' : 'lose', opp: top.name, oppHand: top.h };
      }
    }
    if (!res) return lead + " Nobody showed cards, so there's nothing to check it against.";
    const beat = res.cmp === 'win' ? 'won' : 'chopped', note = " (Others might have played differently if you'd stayed in.)";
    if (right) return lead + (res.cmp === 'lose' ? ' Your ' + res.hand + " would have lost to " + res.opp + "'s " + res.oppHand + ', so the fold saved you chips.' : ' Your ' + res.hand + ' would have ' + beat + ' this time, but that is luck. The numbers still say fold, and over many hands it saves chips.') + note;
    return lead + (res.cmp === 'lose' ? ' It would have lost to ' + res.opp + "'s " + res.oppHand + ', so you got lucky, but by the numbers the fold is still a leak.' : ' Your ' + res.hand + ' would have ' + beat + ', so folding cost you.') + note;
  }
  return { build: build, judge: judge, hindsight: hindsight };
});

