// pokernow‑bot‑master/lib/poker‑evaluator.js

if (typeof window !== 'undefined' && window.PokerEvaluator) {
  /* Already loaded in this page – avoid redeclaring */
} else {

const PokerEvaluator = (() => {
    // Simple cache for flop equity results keyed by hero+board+players
    const flopCache = new Map();

    const RANK_ORDER = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
    const RANK_VALUES = RANK_ORDER.reduce((a,r,i)=>{ a[r]=i+2; return a },{});
    const SUITS = ['c','d','h','s'];
    const CATEGORY_NAMES = [
      'High Card','One Pair','Two Pair','Three of a Kind',
      'Straight','Flush','Full House','Four of a Kind','Straight Flush'
    ];
  
    function generateDeck() {
      return RANK_ORDER.flatMap(r => SUITS.map(s => r+s));
    }
  
    function removeCards(deck, cards) {
      cards.forEach(c => {
        const i = deck.indexOf(c);
        if (i !== -1) deck.splice(i,1);
      });
    }
  
    function popRandom(arr) {
      const i = Math.floor(Math.random()*arr.length);
      return arr.splice(i,1)[0];
    }
  
    function findStraight(ranks) {
      const u = [...new Set(ranks)].sort((a,b)=>b-a);
      if (u[0]===14) u.push(1);
      let streak=1;
      for (let i=0; i<u.length-1; i++) {
        if (u[i]-1===u[i+1]) {
          if (++streak>=5) return u[i-3];
        } else streak=1;
      }
      return 0;
    }
  
    function evaluateHand(cards) {
      const ranks = cards.map(c => RANK_VALUES[c[0]]).sort((a,b)=>b-a);
      const suitsCount = {c:[],d:[],h:[],s:[]};
      cards.forEach(c => suitsCount[c[1]].push(RANK_VALUES[c[0]]));
      let flushSuit = SUITS.find(s => suitsCount[s].length >= 5) || null;
      if (flushSuit) {
        const sf = findStraight(suitsCount[flushSuit]);
        if (sf) return [8, sf];
      }
      const count = {};
      ranks.forEach(r => count[r] = (count[r]||0)+1);
      const groups = Object.entries(count)
        .map(([r,c])=>({r:+r,c}))
        .sort((a,b)=> b.c - a.c || b.r - a.r);
  
      // Four of a Kind
      if (groups[0].c===4) {
        const quad=groups[0].r;
        const kicker=groups.find(g=>g.r!==quad).r;
        return [7,quad,kicker];
      }
      // Full House
      if (groups[0].c===3 && groups[1] && groups[1].c>=2) {
        return [6, groups[0].r, groups[1].r];
      }
      // Flush
      if (flushSuit) {
        const top5 = suitsCount[flushSuit].sort((a,b)=>b-a).slice(0,5);
        return [5, ...top5];
      }
      // Straight
      const st = findStraight(ranks);
      if (st) return [4,st];
      // Three of a Kind
      if (groups[0].c===3) {
        const kickers = groups.filter(g=>g.c===1).map(g=>g.r).slice(0,2);
        return [3, groups[0].r, ...kickers];
      }
      // Two Pair
      if (groups[0].c===2 && groups[1] && groups[1].c===2) {
        const [hi,lo] = [groups[0].r, groups[1].r];
        const k = groups.find(g=>g.c===1).r;
        return [2, hi, lo, k];
      }
      // One Pair
      if (groups[0].c===2) {
        const kickers = groups.filter(g=>g.c===1).map(g=>g.r).slice(0,3);
        return [1, groups[0].r, ...kickers];
      }
      // High Card
      return [0, ...ranks.slice(0,5)];
    }
  
    function compareHands(a,b) {
      for (let i=0; i<Math.max(a.length,b.length); i++) {
        const d = (a[i]||0)-(b[i]||0);
        if (d) return d>0?1:-1;
      }
      return 0;
    }
  
    /**
     * Calculate all metrics for a given state.
     * @param {string[]} hole 2 hero cards
     * @param {string[]} board 0–5 community cards
     * @param {number} iters Monte Carlo iterations off‐flop
     * @param {number} players total seats in hand
     * @param {number} pot current pot size (before call)
     * @param {number} call cost to call/check (0 if check)
     */
    function calcAll(hole, board=[], iters=5000, players=2, pot=0, call=0) {
      // --- Flop cache lookup ---
      if (board.length === 3) {
        const key = `${hole.slice().sort().join('')}|${board.slice().sort().join('')}|${players}`;
        const cached = flopCache.get(key);
        if (cached) return cached;
      }

      const known = [...hole, ...board];
      const baseDeck = generateDeck();
      removeCards(baseDeck, known);
  
      let win=0, tie=0;
      const dist = Array(9).fill(0);
      // Precompute total cases based on board stage
      let total;
      if (board.length === 3) {
        // Flop – enumerate all turn+river card pairs
        total = (baseDeck.length * (baseDeck.length - 1)) / 2;
      } else if (board.length === 4) {
        // Turn – enumerate each possible single river card exactly once
        total = baseDeck.length;
      } else {
        total = iters;
      }
  
      // helper for one run‐out
      function evalRun(runDeck, runBoard) {
        const heroEval = evaluateHand([...hole, ...runBoard]);
        dist[heroEval[0]]++;
        let best=true, tied=false;
        for (let p=1; p<players; p++) {
          const o1 = popRandom(runDeck), o2 = popRandom(runDeck);
          const oppEval = evaluateHand([o1,o2, ...runBoard]);
          const cmp = compareHands(heroEval, oppEval);
          if (cmp<0) { best=false; break; }
          if (cmp===0) tied=true;
        }
        if (best) tied ? tie++ : win++;
      }
  
      // exact enumeration on flop (turn+river pairs) or turn (single river)
      if (board.length===3) {
        const deck = baseDeck.slice();
        for (let i=0; i<deck.length; i++) {
          for (let j=i+1; j<deck.length; j++) {
            const d0=deck[i], d1=deck[j];
            const runBoard = [...board, d0, d1];
            const runDeck = deck.filter(c=>c!==d0&&c!==d1).slice();
            evalRun(runDeck, runBoard);
          }
        }
      } else if (board.length===4) {
        // Exact enumeration on turn – loop over each possible river card once
        const deck = baseDeck.slice();
        for (let i=0; i<deck.length; i++) {
          const river = deck[i];
          const runBoard = [...board, river];
          const runDeck = deck.filter(c => c !== river).slice();
          evalRun(runDeck, runBoard);
        }
      } else {
        // Monte Carlo
        for (let i=0; i<iters; i++) {
          const deck = baseDeck.slice();
          const runBoard = board.slice();
          while (runBoard.length<5) runBoard.push(popRandom(deck));
          evalRun(deck, runBoard);
        }
      }
  
      const w = win/total, t = tie/total;
      const eq = w + t*0.5;

      const result = {
        winPct: w,
        tiePct: t,
        equityPct: eq,
        dist: dist.map(c=>c/total),
        categories: CATEGORY_NAMES
      };

      // Store in cache if flop
      if (board.length === 3) {
        const key = `${hole.slice().sort().join('')}|${board.slice().sort().join('')}|${players}`;
        flopCache.set(key, result);
      }

      return result;
    }
  
    return { evaluateHand, calcAll, CATEGORY_NAMES };
  })();

// Expose globally
if (typeof module !== 'undefined') module.exports = PokerEvaluator;
if (typeof window !== 'undefined') window.PokerEvaluator = PokerEvaluator;

}
 