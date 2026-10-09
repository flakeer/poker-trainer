
/*!
 * Vex: the sarcastic rival coach. Pure voice: picks wording, never changes the strategy or the verdict.
 * Lines are chosen deterministically from a seed so text never flickers between redraws.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PokerVex = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const pick = (arr, seed) => arr[hash(seed) % arr.length];
  const fill = (t, m) => t.replace(/\{(\w+)\}/g, (_, k) => (m[k] === undefined ? '' : m[k]));

  const ADVICE = {
    fold: ['Fold. Yes, your hand is really that bad. 🗑️', 'Muck it before you embarrass us both.', 'Fold. I know you want to call. That\'s the whole problem.', 'Throw it away. Hope is not a strategy. 🙄', 'Fold. Your cards just filed a complaint. 📄'],
    check: ['Check. Try not to invent a plan.', 'Check. Doing nothing: finally, a skill you have. 😏', 'Free card. Even you can\'t mess this up. Probably.', 'Tap the table and breathe. 🫠'],
    call: ['Call. The price is fine, which is more than I can say for your last hand.', 'Call. Do NOT turn this into a raise out of ego. 😒', 'Pay the man. Calling is correct, enjoy the novelty. 😏', 'Call. Look at you, making math-based decisions. 👏'],
    raise: ['Raise. Be brave, just this once. 😈', 'Bet it. Scared money never wins. You\'d know. 🐔', 'Put chips in. Yes, YOU. Aggressively. Try it.', 'Raise. Fortune favors the bold, not whatever you usually do. 🔥']
  };
  const VERDICT = {
    well: { emoji: '✅', title: ['Well played', 'Clean hand', 'Textbook', 'Wow, correct'],
      body: ['That was exactly what I would have done. Mark the date. 📅', 'Fine. Correct. I\'m almost impressed. Almost. 🙄', 'Boring, correct poker. Do that forever. 👌', 'Did you actually listen to me? Disgusting. Keep going. 😏'] },
    badbeat: { emoji: '🎲', title: ['Bad beat', 'Right move, wrong card', 'The deck hates you'],
      body: ['You did everything right and the deck still stabbed you. Even I feel bad. A little. 💪', 'You were ahead when it mattered{eq}. The river had other plans. 😤', 'Not your fault this time. Savor it, it\'s rare. Next hand.', 'Correct play, rotten luck. I\'d be furious too. Go again. 🔥'] },
    lucky: { emoji: '🍀', title: ['Lucky escape', 'You got away with it', 'Accident, not skill'],
      body: ['You won, but that was NOT the right play{cost}. Luck is not a strategy, champ. 🙃', 'Congratulations, you were wrong and got rewarded for it. Do that for a month and watch your stack vanish. 😈', 'The cards bailed you out. I noticed. I always notice. 👀', 'You won by accident{cost}. I\'m not clapping. 🙄'] },
    mistake: { emoji: '❌', title: ['Mistake', 'That one hurt', 'Do better', 'Seriously?'],
      body: ['I said {adv}, you did {played}. Bold choice. Wrong, but bold.{cost} 🤦', 'That was a donation, not a play.{cost} Send a thank-you card to the table. 💸', 'You paid for that one{cost}. My advice is free and you still ignored it. 😒', 'I literally told you: {adv}. You did {played}. What did you think would happen?{cost} 🤡'] }
  };
  const SASS = {
    'Called too wide': ['You can\'t call everything. It\'s not a buffet. 🙄', 'Curiosity is expensive. 🤦', 'Calling to "see what happens" is how stacks die.'],
    'Raised a hand that should fold': ['That wasn\'t a bluff, it was a donation. 💸', 'Bold, but the hand wasn\'t.', 'Raising trash is not a personality.'],
    'Folded too much': ['Scared money. You had the price. 🐔', 'You folded a profitable spot. Brave of you.', 'Cluck cluck. 🐔'],
    'Too passive': ['You had the goods and didn\'t bet? Charge them. 😤', 'Passive play. Pot-sized regret.', 'Slow-playing is for people who know what they\'re doing.'],
    'Raised instead of calling': ['Calling was enough. Ego raise? 😏', 'Not every hand needs a raise, hero.', 'Relax. You\'re not in a movie.'],
    'Bet a marginal hand': ['That bet was optimism, not strategy.', 'Check, then breathe.', 'Betting a weak hand: ambitious, wrong.'],
    'Folded a strong hand': ['You FOLDED that? Unbelievable. 🤡', 'Folding a monster. Congratulations.', 'The nuts called. They\'d like to know why you left. 📞'],
    'Folded for free': ['You folded when checking was free. 🤦', 'Free card, thrown away.', 'It was FREE. You paid with your hand. 🫠']
  };
  const FB = {
    ok: ['✅ Right call.', '✅ Obedient. Good.', '✅ Matches mine. Suspicious.'],
    close: ['✅ Close spot, either was fine.', '✅ Coin-flip decision. No judgement. Okay, a little.'],
    bad: ['😬 Not what I said.', '🙄 Interesting. I\'ll remember that.', '👀 Noted. We\'ll see how that goes.', '🤦 Bold. Wrong. But bold.', '😒 My advice is free. Ignoring it costs chips.']
  };
  let streak = { mistake: 0, well: 0 };

  const cost = (r) => (r && r.evCost ? ' (about ' + Math.round(r.evCost) + ' chips)' : '');
  const label = (r) => (r ? r.advice.label : 'something else');
  const played = (r) => { if (!r) return ''; const p = r.played; const t = p.type === 'allin' ? 'all-in' : p.type; return t.charAt(0).toUpperCase() + t.slice(1) + (p.amount ? ' ' + p.amount : ''); };

  return {
    advice(a, seed) { return { head: pick(ADVICE[a.action] || ADVICE.check, seed + a.action) }; },
    feedback(j, advLabel, seed) {
      if (j.severity === 'ok') return pick(j.note === 'close spot' ? FB.close : FB.ok, seed);
      return pick(FB.bad, seed) + ' (I said ' + advLabel + ': ' + j.note + ')';
    },
    /** Call once per finished hand, in order, so streak comments work. */
    react(rev) {
      if (rev.verdict === 'mistake' || rev.verdict === 'lucky') { streak.mistake++; streak.well = 0; }
      else if (rev.verdict === 'well') { streak.well++; streak.mistake = 0; }
      else { streak.mistake = 0; }
    },
    verdictLine(rev) {
      const v = VERDICT[rev.verdict], seed = 'h' + rev.handNumber + rev.verdict;
      const map = { cost: rev.worst ? cost(rev.worst) : '', adv: label(rev.worst), played: played(rev.worst), eq: rev.maxEquity ? ' (' + Math.round(rev.maxEquity * 100) + '% to win)' : '' };
      let body = fill(pick(v.body, seed), map);
      if (rev.verdict === 'mistake' && streak.mistake >= 5) body += ' That\'s ' + streak.mistake + ' in a row. Are you doing this on purpose? 🫠';
      else if (rev.verdict === 'mistake' && streak.mistake >= 3) body += ' That\'s ' + streak.mistake + ' in a row. 😬';
      if (rev.verdict === 'well' && streak.well >= 4) body += ' ' + streak.well + ' clean hands in a row... who are you? 👀';
      return { emoji: v.emoji, title: pick(v.title, seed + 't'), body: body };
    },
    rowLine(r) {
      if (r.severity === 'ok') return '✅ ' + r.street + ': ' + r.advice.label + (r.note ? ' (' + r.note + ')' : '') + ', you did the same.';
      const c = r.evCost ? ' ≈ ' + (r.advice.action === 'fold' ? '−' : 'missed ') + Math.round(r.evCost) + ' chips expected.' : '';
      return '❌ ' + r.street + ': I said ' + r.advice.label + ', you played ' + played(r) + '. ' + r.note + '.' + c + ' ' + pick(SASS[r.note] || [''], r.street + r.note);
    },
    resetStreak() { streak = { mistake: 0, well: 0 }; }
  };
});

