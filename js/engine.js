
/*!
 * Poker Engine: Texas Hold'em, No-Limit, 2-6 players.
 * Pure game logic, no UI. Works in the browser (window.PokerEngine) and Node (require).
 *
 * FAIRNESS RULES (by design):
 *  - The deck is shuffled once per hand with a cryptographic RNG (Fisher-Yates, unbiased).
 *  - Nothing in the engine adjusts the deck based on stacks, cards, or results.
 *  - Trainer and AI code must read the game ONLY through table.getPlayerView(seat),
 *    which contains just what that seat could legally see.
 *  - Internal state lives in table._seats / table._deck. Never read those from AI/Trainer code.
 *
 * CARD FORMAT: integers 0..51.  rank = c % 13 (0 = Two ... 12 = Ace),  suit = floor(c / 13) (c d h s).
 *
 * AMOUNT FORMAT: bet/raise amounts are always "raise-to" totals for the current street.
 *  Example: facing a bet of 50, {type:'raise', amount:150} means "raise to 150 total".
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PokerEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ======================================================================
  // Cards
  // ======================================================================
  const RANK_CHARS = '23456789TJQKA';
  const SUIT_CHARS = 'cdhs';
  const RANK_NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
  const RANK_PLURAL = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];

  const rankOf = (c) => c % 13;
  const suitOf = (c) => (c / 13) | 0;

  function cardToString(c) {
    return RANK_CHARS[c % 13] + SUIT_CHARS[(c / 13) | 0];
  }

  function parseCard(s) {
    const r = RANK_CHARS.indexOf(String(s)[0].toUpperCase());
    const su = SUIT_CHARS.indexOf(String(s)[1].toLowerCase());
    if (r < 0 || su < 0) throw new Error('Bad card: ' + s);
    return su * 13 + r;
  }

  function cardsToString(cards) {
    return cards.map(cardToString).join(' ');
  }

  function makeDeck() {
    return Array.from({ length: 52 }, (_, i) => i);
  }

  // ======================================================================
  // Randomness
  // ======================================================================
  function getCrypto() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) return globalThis.crypto;
    if (typeof require === 'function') {
      try { return require('crypto').webcrypto; } catch (e) { /* fall through */ }
    }
    throw new Error('No secure random source available');
  }

  /** Cryptographically secure uniform integer in [0, n). Rejection sampling, no modulo bias. */
  function makeSecureRng() {
    const c = getCrypto();
    const buf = new Uint32Array(1);
    return function nextInt(n) {
      const limit = Math.floor(4294967296 / n) * n;
      let x;
      do { c.getRandomValues(buf); x = buf[0]; } while (x >= limit);
      return x % n;
    };
  }

  /** Seeded RNG (mulberry32) for tests and replays only. */
  function makeSeededRng(seed) {
    let a = seed >>> 0;
    return function nextInt(n) {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Math.floor(r * n);
    };
  }

  /** Fisher-Yates, in place. */
  function shuffle(arr, nextInt) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = nextInt(i + 1);
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  // ======================================================================
  // Hand evaluator (best 5 of 5-7 cards)
  // Score is an integer: higher always wins, equal means a tie.
  // score = category * 16^5 + five 4-bit tiebreak ranks.
  // ======================================================================
  const CATEGORY = {
    HIGH_CARD: 0, PAIR: 1, TWO_PAIR: 2, THREE_OF_A_KIND: 3, STRAIGHT: 4,
    FLUSH: 5, FULL_HOUSE: 6, FOUR_OF_A_KIND: 7, STRAIGHT_FLUSH: 8
  };
  const CATEGORY_NAMES = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];

  function pack(cat, ranks) {
    let s = cat;
    for (let i = 0; i < 5; i++) s = s * 16 + (i < ranks.length ? ranks[i] : 0);
    return s;
  }

  /** mask: bit r set if rank r present. Returns high-card rank of best straight, or -1. */
  function straightHigh(mask) {
    const ext = (mask << 1) | ((mask >> 12) & 1); // bit 0 = ace-low
    for (let h = 13; h >= 4; h--) {
      if (((ext >> (h - 4)) & 31) === 31) return h - 1;
    }
    return -1;
  }

  function kickers(rc, exclude, n) {
    const out = [];
    for (let r = 12; r >= 0 && out.length < n; r--) {
      if (rc[r] > 0 && exclude.indexOf(r) < 0) out.push(r);
    }
    return out;
  }

  function evaluate(cards) {
    const rc = new Array(13).fill(0);
    const sc = [0, 0, 0, 0];
    const sm = [0, 0, 0, 0];
    let mask = 0;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i], r = c % 13, s = (c / 13) | 0;
      rc[r]++; sc[s]++; sm[s] |= (1 << r); mask |= (1 << r);
    }
    let fs = -1;
    for (let s = 0; s < 4; s++) if (sc[s] >= 5) fs = s;

    if (fs >= 0) {
      const h = straightHigh(sm[fs]);
      if (h >= 0) return pack(CATEGORY.STRAIGHT_FLUSH, [h]);
    }

    let quad = -1;
    const trips = [], pairs = [];
    for (let r = 12; r >= 0; r--) {
      const n = rc[r];
      if (n === 4) quad = r;
      else if (n === 3) trips.push(r);
      else if (n === 2) pairs.push(r);
    }

    if (quad >= 0) return pack(CATEGORY.FOUR_OF_A_KIND, [quad].concat(kickers(rc, [quad], 1)));

    if (trips.length && (trips.length > 1 || pairs.length)) {
      let p;
      if (trips.length > 1) p = pairs.length ? Math.max(trips[1], pairs[0]) : trips[1];
      else p = pairs[0];
      return pack(CATEGORY.FULL_HOUSE, [trips[0], p]);
    }

    if (fs >= 0) {
      const ranks = [];
      for (let r = 12; r >= 0 && ranks.length < 5; r--) if ((sm[fs] >> r) & 1) ranks.push(r);
      return pack(CATEGORY.FLUSH, ranks);
    }

    const sh = straightHigh(mask);
    if (sh >= 0) return pack(CATEGORY.STRAIGHT, [sh]);

    if (trips.length) return pack(CATEGORY.THREE_OF_A_KIND, [trips[0]].concat(kickers(rc, [trips[0]], 2)));
    if (pairs.length >= 2) return pack(CATEGORY.TWO_PAIR, [pairs[0], pairs[1]].concat(kickers(rc, [pairs[0], pairs[1]], 1)));
    if (pairs.length === 1) return pack(CATEGORY.PAIR, [pairs[0]].concat(kickers(rc, [pairs[0]], 3)));
    return pack(CATEGORY.HIGH_CARD, kickers(rc, [], 5));
  }

  function categoryOf(score) {
    return score >> 20;
  }

  function describeHand(score) {
    const cat = score >> 20;
    const r0 = (score >> 16) & 15, r1 = (score >> 12) & 15;
    switch (cat) {
      case 0: return 'High Card, ' + RANK_NAMES[r0];
      case 1: return 'Pair of ' + RANK_PLURAL[r0];
      case 2: return 'Two Pair, ' + RANK_PLURAL[r0] + ' and ' + RANK_PLURAL[r1];
      case 3: return 'Three of a Kind, ' + RANK_PLURAL[r0];
      case 4: return 'Straight, ' + RANK_NAMES[r0] + ' high';
      case 5: return 'Flush, ' + RANK_NAMES[r0] + ' high';
      case 6: return 'Full House, ' + RANK_PLURAL[r0] + ' full of ' + RANK_PLURAL[r1];
      case 7: return 'Four of a Kind, ' + RANK_PLURAL[r0];
      default: return r0 === 12 ? 'Royal Flush' : 'Straight Flush, ' + RANK_NAMES[r0] + ' high';
    }
  }

  function evaluateDetailed(cards) {
    const score = evaluate(cards);
    return { score: score, category: score >> 20, categoryName: CATEGORY_NAMES[score >> 20], name: describeHand(score) };
  }

  // ======================================================================
  // Table: one poker table, one hand at a time
  // ======================================================================
  const STREETS = ['preflop', 'flop', 'turn', 'river'];

  function fail(msg) { return { ok: false, error: msg }; }

  class Table {
    /**
     * options:
     *   numSeats (2-6), smallBlind, bigBlind, startingStack, stacks (array, optional),
     *   names (array), humanSeat, autoRebuy (bool), seed (tests only), rng (custom nextInt)
     */
    constructor(options) {
      const o = Object.assign({
        numSeats: 6, smallBlind: 5, bigBlind: 10, startingStack: 1000, stacks: null,
        names: null, humanSeat: 0, autoRebuy: false, seed: null, rng: null, maxHistory: 500
      }, options || {});

      if (!Number.isInteger(o.numSeats) || o.numSeats < 2 || o.numSeats > 6) throw new Error('numSeats must be 2-6');
      if (!(o.smallBlind > 0) || !(o.bigBlind >= o.smallBlind)) throw new Error('Invalid blinds');
      if (!(o.startingStack >= o.bigBlind)) throw new Error('startingStack must be at least the big blind');

      this.opts = o;
      this.numSeats = o.numSeats;
      this.smallBlind = o.smallBlind;
      this.bigBlind = o.bigBlind;
      this._nextInt = o.rng || (o.seed !== null ? makeSeededRng(o.seed) : makeSecureRng());

      this._seats = [];
      this.totalBuyIn = 0;
      for (let i = 0; i < o.numSeats; i++) {
        const stack = o.stacks ? o.stacks[i] : o.startingStack;
        this.totalBuyIn += stack;
        this._seats.push({
          id: i,
          name: (o.names && o.names[i]) || (i === o.humanSeat ? 'You' : 'AI ' + i),
          isHuman: i === o.humanSeat,
          stack: stack, holeCards: [], bet: 0, totalBet: 0,
          folded: false, allIn: false, inHand: false,
          needsToAct: false, canRaise: true, levelAtAct: null, revealed: false, startStack: 0
        });
      }

      this.button = -1;
      this.handNumber = 0;
      this.street = 'idle';   // idle | preflop | flop | turn | river | showdown | complete
      this.board = [];
      this.currentBet = 0;
      this.lastRaiseSize = this.bigBlind;
      this.toAct = null;
      this.sbSeat = null;
      this.bbSeat = null;
      this.history = [];
      this.result = null;
      this.handRecords = [];
      this._dealt = [];
      this._deck = [];
      this._deckPos = 0;
      this._listeners = [];
    }

    // ------------------------------------------------------------------
    // Events (listeners get (type, data)). Drive AI from 'turn', not 'action'.
    // Types: handStart, street, reveal, action, turn, handEnd
    // ------------------------------------------------------------------
    on(fn) {
      this._listeners.push(fn);
      return () => { this._listeners = this._listeners.filter((f) => f !== fn); };
    }

    _emit(type, data) {
      for (const fn of this._listeners.slice()) {
        try { fn(type, data); } catch (e) { if (typeof console !== 'undefined') console.error('PokerEngine listener error:', e); }
      }
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------
    get pot() {
      let p = 0;
      for (const s of this._seats) p += s.totalBet;
      return p;
    }

    totalChips() {
      let t = 0;
      for (const s of this._seats) t += s.stack + s.totalBet;
      return t;
    }

    _inBetting() {
      return STREETS.indexOf(this.street) >= 0 && this.toAct !== null;
    }

    _nextSeatWhere(from, pred) {
      const n = this.numSeats;
      for (let i = 1; i <= n; i++) {
        const idx = (((from + i) % n) + n) % n;
        if (pred(this._seats[idx])) return idx;
      }
      return -1;
    }

    _clockwiseFrom(start) {
      const out = [];
      for (let i = 0; i < this.numSeats; i++) {
        const idx = (start + i) % this.numSeats;
        if (this._seats[idx].inHand) out.push(idx);
      }
      return out;
    }

    _live() {
      return this._seats.filter((s) => s.inHand && !s.folded);
    }

    _draw() {
      return this._deck[this._deckPos++];
    }

    _pay(s, amount) {
      const amt = Math.max(0, Math.min(amount, s.stack));
      s.stack -= amt; s.bet += amt; s.totalBet += amt;
      if (s.stack === 0) s.allIn = true;
      return amt;
    }

    _positionName(id) {
      const idx = this._dealt.indexOf(id);
      if (idx < 0) return null;
      const n = this._dealt.length;
      if (n === 2) return idx === 0 ? 'BTN' : 'BB'; // heads-up: button is also the small blind
      if (idx === 0) return 'BTN';
      if (idx === 1) return 'SB';
      if (idx === 2) return 'BB';
      const early = { 1: ['UTG'], 2: ['UTG', 'CO'], 3: ['UTG', 'HJ', 'CO'] }[n - 3];
      return early[idx - 3];
    }

    // ------------------------------------------------------------------
    // Starting a hand
    // ------------------------------------------------------------------
    canStartHand() {
      if (this.street !== 'idle' && this.street !== 'complete') return false;
      return this._seats.filter((s) => s.stack > 0).length >= 2 || (this.opts.autoRebuy && this.numSeats >= 2);
    }

    /** options.testDeck: array of cards (strings or ints) to force the top of the deck. TESTS ONLY. */
    startHand(options) {
      if (this.street !== 'idle' && this.street !== 'complete') throw new Error('A hand is already in progress');
      if (this.opts.autoRebuy) {
        for (const s of this._seats) if (s.stack <= 0) this.rebuy(s.id, this.opts.startingStack);
      }
      if (this._seats.filter((s) => s.stack > 0).length < 2) return false;

      this.handNumber++;
      this.button = this._nextSeatWhere(this.button, (s) => s.stack > 0);

      for (const s of this._seats) {
        s.holeCards = []; s.bet = 0; s.totalBet = 0;
        s.folded = false; s.allIn = false; s.needsToAct = false;
        s.canRaise = true; s.levelAtAct = null; s.revealed = false;
        s.inHand = s.stack > 0;
        s.startStack = s.stack;
      }
      this.board = [];
      this.history = [];
      this.result = null;
      this.currentBet = 0;
      this.lastRaiseSize = this.bigBlind;
      this.toAct = null;
      this.street = 'preflop';

      this._dealt = this._clockwiseFrom(this.button);
      const headsUp = this._dealt.length === 2;
      this.sbSeat = headsUp ? this.button : this._dealt[1];
      this.bbSeat = headsUp ? this._dealt[1] : this._dealt[2];

      // Shuffle: once, fair, never adjusted.
      let deck = shuffle(makeDeck(), this._nextInt);
      if (options && options.testDeck) {
        const forced = options.testDeck.map((x) => (typeof x === 'string' ? parseCard(x) : x));
        if (new Set(forced).size !== forced.length) throw new Error('testDeck has duplicate cards');
        deck = forced.concat(deck.filter((c) => forced.indexOf(c) < 0));
      }
      this._deck = deck;
      this._deckPos = 0;

      // Blinds
      const sb = this._seats[this.sbSeat], bb = this._seats[this.bbSeat];
      const sbPaid = this._pay(sb, this.smallBlind);
      const bbPaid = this._pay(bb, this.bigBlind);
      this.currentBet = this.bigBlind;
      this.history.push({ street: 'preflop', seat: sb.id, type: 'sb', amount: sbPaid, to: sb.bet, allIn: sb.allIn, potAfter: this.pot });
      this.history.push({ street: 'preflop', seat: bb.id, type: 'bb', amount: bbPaid, to: bb.bet, allIn: bb.allIn, potAfter: this.pot });

      // Deal two hole cards each, starting left of the button (small blind first)
      const order = this._clockwiseFrom(this.sbSeat);
      for (let round = 0; round < 2; round++) {
        for (const id of order) this._seats[id].holeCards.push(this._draw());
      }

      this._emit('handStart', { handNumber: this.handNumber, button: this.button, sbSeat: this.sbSeat, bbSeat: this.bbSeat });
      this._beginBettingRound(this.bbSeat);
      return true;
    }

    // ------------------------------------------------------------------
    // Betting flow
    // ------------------------------------------------------------------
    _beginBettingRound(firstFrom) {
      const live = this._live();
      const canActCount = live.filter((s) => !s.allIn).length;
      for (const s of live) {
        s.levelAtAct = null;
        s.canRaise = true;
        let othersMax = 0;
        for (const o of live) if (o !== s && o.bet > othersMax) othersMax = o.bet;
        // With fewer than two players able to act there is nobody to bet against, unless there is something to call.
        s.needsToAct = !s.allIn && (canActCount >= 2 || s.bet < othersMax);
      }
      if (!this._seats.some((s) => s.needsToAct)) {
        this._closeRound();
        return;
      }
      this.toAct = this._nextSeatWhere(firstFrom, (s) => s.needsToAct);
      this._emit('turn', { seat: this.toAct, street: this.street });
    }

    _afterAction() {
      const live = this._live();
      if (live.length === 1) { this._endUncontested(live[0]); return; }
      if (!this._seats.some((s) => s.needsToAct)) { this._closeRound(); return; }
      this.toAct = this._nextSeatWhere(this.toAct, (s) => s.needsToAct);
      this._emit('turn', { seat: this.toAct, street: this.street });
    }

    _closeRound() {
      this.toAct = null;
      if (this.street === 'river') { this._showdown(); return; }

      this.street = STREETS[STREETS.indexOf(this.street) + 1];
      for (const s of this._seats) s.bet = 0;
      this.currentBet = 0;
      this.lastRaiseSize = this.bigBlind;

      this._draw(); // burn card
      const count = this.street === 'flop' ? 3 : 1;
      for (let i = 0; i < count; i++) this.board.push(this._draw());
      this._emit('street', { street: this.street, board: this.board.slice() });

      // All remaining players all-in (or one left with chips): show hands, run out the board.
      const live = this._live();
      if (live.length > 1 && live.filter((s) => !s.allIn).length < 2 && !live.every((s) => s.revealed)) {
        for (const s of live) s.revealed = true;
        this._emit('reveal', { seats: live.map((s) => s.id) });
      }
      this._beginBettingRound(this.button);
    }

    // ------------------------------------------------------------------
    // Legal actions
    // ------------------------------------------------------------------
    _legal(s) {
      const toCall = Math.max(0, this.currentBet - s.bet);
      const callAmount = Math.min(toCall, s.stack);
      const maxRaiseTo = s.bet + s.stack;
      let canRaise = false, minRaiseTo = 0;
      if (s.canRaise && maxRaiseTo > this.currentBet) {
        const fullMin = this.currentBet === 0 ? this.bigBlind : this.currentBet + this.lastRaiseSize;
        canRaise = true;
        minRaiseTo = Math.min(fullMin, maxRaiseTo); // short stack may go all-in for less than a full raise
      }
      return {
        toCall: toCall, callAmount: callAmount,
        canFold: true, canCheck: toCall === 0, canCall: toCall > 0,
        canRaise: canRaise, isBet: this.currentBet === 0,
        minRaiseTo: canRaise ? minRaiseTo : 0, maxRaiseTo: canRaise ? maxRaiseTo : 0,
        allInTo: maxRaiseTo
      };
    }

    /** Legal actions for the seat whose turn it is, otherwise null. */
    getLegalActions(seatId) {
      if (!this._inBetting() || seatId !== this.toAct) return null;
      return this._legal(this._seats[seatId]);
    }

    /**
     * action: {type:'fold'|'check'|'call'|'bet'|'raise'|'allin', amount?}
     * amount is the "raise-to" total for the street (bet and raise are the same thing).
     * Returns {ok:true} or {ok:false, error}.
     */
    act(seatId, action) {
      if (!this._inBetting()) return fail('No betting round in progress');
      if (seatId !== this.toAct) return fail('It is not seat ' + seatId + "'s turn");
      if (!action || typeof action.type !== 'string') return fail('Invalid action');

      const s = this._seats[seatId];
      const L = this._legal(s);
      let type = action.type.toLowerCase();
      let amount = action.amount;

      if (type === 'bet') type = 'raise';
      if (type === 'allin') {
        if (s.stack <= L.toCall) type = 'call';
        else { type = 'raise'; amount = L.allInTo; }
      }

      const entry = { street: this.street, seat: seatId, type: type, amount: 0, to: 0, allIn: false, potAfter: 0 };

      if (type === 'fold') {
        s.folded = true; s.needsToAct = false;
      } else if (type === 'check') {
        if (L.toCall > 0) return fail('Cannot check, there is a bet to call');
        s.needsToAct = false; s.levelAtAct = this.currentBet;
      } else if (type === 'call') {
        if (L.toCall <= 0) return fail('Nothing to call, check instead');
        entry.amount = this._pay(s, L.callAmount);
        s.needsToAct = false; s.levelAtAct = this.currentBet;
      } else if (type === 'raise') {
        if (!L.canRaise) return fail('Raising is not allowed here');
        if (!Number.isInteger(amount)) return fail('Raise amount must be a whole number');
        if (amount > L.maxRaiseTo) return fail('Raise exceeds your stack');
        if (amount < L.minRaiseTo) return fail('Minimum raise is to ' + L.minRaiseTo);

        const prevBet = this.currentBet;
        const raiseSize = amount - prevBet;
        const isFullRaise = raiseSize >= this.lastRaiseSize;
        entry.type = prevBet === 0 ? 'bet' : 'raise';
        entry.amount = this._pay(s, amount - s.bet);
        this.currentBet = amount;
        if (isFullRaise) this.lastRaiseSize = raiseSize;

        for (const o of this._live()) {
          if (o === s || o.allIn) continue;
          o.needsToAct = true;
          if (isFullRaise) o.canRaise = true;
          // Incomplete all-in raise: players who already acted may re-raise only if the
          // total increase since their last action adds up to a full raise.
          else if (o.levelAtAct !== null) o.canRaise = (this.currentBet - o.levelAtAct) >= this.lastRaiseSize;
        }
        s.needsToAct = false; s.levelAtAct = this.currentBet;
      } else {
        return fail('Unknown action type: ' + action.type);
      }

      entry.to = s.bet;
      entry.allIn = s.allIn;
      entry.potAfter = this.pot;
      this.history.push(entry);
      this._emit('action', Object.assign({}, entry));
      this._afterAction();
      return { ok: true };
    }

    // ------------------------------------------------------------------
    // Ending a hand
    // ------------------------------------------------------------------
    _endUncontested(winner) {
      const pot = this.pot;
      winner.stack += pot;
      this.result = {
        showdown: false,
        pots: [{ amount: pot, eligible: [winner.id], winners: [winner.id], handName: null, uncalled: false }],
        winnings: { [winner.id]: pot },
        hands: {}
      };
      this._finishHand();
    }

    /** Main pot + side pots from each player's total contribution. */
    _buildPots() {
      const live = this._live();
      const levels = Array.from(new Set(live.filter((s) => s.totalBet > 0).map((s) => s.totalBet))).sort((a, b) => a - b);
      const pots = [];
      let prev = 0;
      for (const level of levels) {
        let amount = 0;
        for (const s of this._seats) amount += Math.min(s.totalBet, level) - Math.min(s.totalBet, prev);
        pots.push({ amount: amount, eligible: live.filter((s) => s.totalBet >= level).map((s) => s.id) });
        prev = level;
      }
      // Dead money above the highest live contribution (only possible from folded players)
      let leftover = 0;
      for (const s of this._seats) leftover += Math.max(0, s.totalBet - prev);
      if (leftover > 0 && pots.length) pots[pots.length - 1].amount += leftover;
      return pots;
    }

    _showdown() {
      this.street = 'showdown';
      const live = this._live();
      if (live.length > 1) for (const s of live) s.revealed = true;

      const scores = {};
      const hands = {};
      for (const s of live) {
        scores[s.id] = evaluate(s.holeCards.concat(this.board));
        hands[s.id] = { score: scores[s.id], name: describeHand(scores[s.id]), cards: s.holeCards.slice() };
      }

      const winnings = {};
      const resultPots = [];
      for (const pot of this._buildPots()) {
        let best = -1;
        for (const id of pot.eligible) if (scores[id] > best) best = scores[id];
        const winners = pot.eligible.filter((id) => scores[id] === best);
        // Odd chips go to the winners closest to the left of the button.
        winners.sort((a, b) => (((a - this.button - 1) % this.numSeats) + this.numSeats) % this.numSeats - (((b - this.button - 1) % this.numSeats) + this.numSeats) % this.numSeats);
        const share = Math.floor(pot.amount / winners.length);
        let rem = pot.amount - share * winners.length;
        for (const id of winners) {
          const extra = rem > 0 ? 1 : 0;
          rem -= extra;
          winnings[id] = (winnings[id] || 0) + share + extra;
        }
        resultPots.push({
          amount: pot.amount, eligible: pot.eligible.slice(), winners: winners.slice(),
          handName: describeHand(best), uncalled: pot.eligible.length === 1
        });
      }
      for (const id in winnings) this._seats[id].stack += winnings[id];

      this.result = { showdown: true, pots: resultPots, winnings: winnings, hands: hands };
      this._finishHand();
    }

    _finishHand() {
      this.street = 'complete';
      this.toAct = null;

      const startStacks = {}, holeCards = {}, endStacks = {};
      for (const s of this._seats) {
        if (!s.inHand) continue;
        startStacks[s.id] = s.startStack;
        holeCards[s.id] = s.holeCards.slice();
        endStacks[s.id] = s.stack;
      }
      this.result.busted = this._seats.filter((s) => s.inHand && s.stack === 0).map((s) => s.id);

      this.handRecords.push({
        handNumber: this.handNumber, button: this.button, sbSeat: this.sbSeat, bbSeat: this.bbSeat,
        blinds: [this.smallBlind, this.bigBlind], startStacks: startStacks, holeCards: holeCards,
        board: this.board.slice(), actions: this.history.map((h) => Object.assign({}, h)),
        result: JSON.parse(JSON.stringify(this.result)), endStacks: endStacks
      });
      if (this.handRecords.length > this.opts.maxHistory) this.handRecords.shift();

      for (const s of this._seats) { s.bet = 0; s.totalBet = 0; s.needsToAct = false; }
      this._emit('handEnd', { result: this.result });
    }

    // ------------------------------------------------------------------
    // Between hands
    // ------------------------------------------------------------------
    rebuy(seatId, amount) {
      if (this.street !== 'idle' && this.street !== 'complete') throw new Error('Cannot rebuy during a hand');
      const s = this._seats[seatId];
      if (!s) throw new Error('Bad seat');
      const amt = amount === undefined ? this.opts.startingStack : amount;
      if (!(amt > 0) || !Number.isInteger(amt)) throw new Error('Invalid rebuy amount');
      s.stack += amt;
      this.totalBuyIn += amt;
      return s.stack;
    }

    // ------------------------------------------------------------------
    // Player view: the ONLY thing Trainer and AI code may read.
    // Contains what this seat could legally see at a real table.
    // ------------------------------------------------------------------
    getPlayerView(seatId) {
      const me = this._seats[seatId];
      if (!me) throw new Error('Bad seat');
      const myTurn = this._inBetting() && this.toAct === seatId;

      const players = this._seats.map((s) => ({
        id: s.id, name: s.name, isHuman: s.isHuman, isMe: s.id === seatId,
        stack: s.stack, bet: s.bet, totalBet: s.totalBet,
        folded: s.folded, allIn: s.allIn, inHand: s.inHand,
        isButton: s.id === this.button, position: this._positionName(s.id),
        holeCards: s.id === seatId ? s.holeCards.slice() : (s.revealed ? s.holeCards.slice() : null)
      }));

      return {
        seat: seatId,
        handNumber: this.handNumber,
        street: this.street,
        board: this.board.slice(),
        pot: this.pot,
        currentBet: this.currentBet,
        lastRaiseSize: this.lastRaiseSize,
        blinds: { small: this.smallBlind, big: this.bigBlind },
        button: this.button, sbSeat: this.sbSeat, bbSeat: this.bbSeat,
        toAct: this.toAct,
        isMyTurn: myTurn,
        myCards: me.holeCards.slice(),
        myPosition: this._positionName(seatId),
        myStack: me.stack,
        toCall: Math.max(0, this.currentBet - me.bet),
        legal: myTurn ? this._legal(me) : null,
        players: players,
        numPlayersInHand: this._seats.filter((s) => s.inHand).length,
        numPlayersLive: this._live().length,
        history: this.history.map((h) => Object.assign({}, h)),
        result: this.result ? JSON.parse(JSON.stringify(this.result)) : null
      };
    }

    isHandOver() {
      return this.street === 'complete';
    }
  }

  return {
    Table: Table,
    evaluate: evaluate,
    evaluateDetailed: evaluateDetailed,
    describeHand: describeHand,
    categoryOf: categoryOf,
    CATEGORY: CATEGORY,
    CATEGORY_NAMES: CATEGORY_NAMES,
    cardToString: cardToString,
    cardsToString: cardsToString,
    parseCard: parseCard,
    rankOf: rankOf,
    suitOf: suitOf,
    makeDeck: makeDeck,
    shuffle: shuffle,
    makeSecureRng: makeSecureRng,
    makeSeededRng: makeSeededRng
  };
});

