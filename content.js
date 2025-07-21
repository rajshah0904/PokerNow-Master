// pokernow-master/content.js
(function () {
  const DEBOUNCE_MS = 200;
  let debounceId;
  let iterations = 5000;
  let overlay;
  let visible = true;
  let limitNotifyShown = false;
  let lastMainPot = 0;
  let lastStreet = -1;
  let cachedEquity = null;
  let lastHoleSeen = Date.now();

  // Raise thresholds (postflop "bet when no bet to call" baseline by players)
  const RAISE_THRESHOLDS = {
    2: 0.43, 3: 0.34, 4: 0.30, 5: 0.28, 6: 0.27, 7: 0.25, 8: 0.23, 9: 0.22
  };

  // --- Config constants ---
  const OPEN_DELTA      = 0.10;     // Open-raise equity buffer over raw (often 0) pot odds
  const ISO_DELTA_SHIFT = -0.01;    // Slightly looser for isolating limpers
  const THREE_BET_DELTA = 0.15;     // Cushion to raise instead of call when facing a bet
  const CALL_MARGIN     = 1e-5;
  const LIMP_REL_RATIO  = 0.22;     // callAmt/pot <= this in multi-limp scenarios
  const LIMP_ABS_TOL    = 1.05;     // callAmt <= (bb * 1.05) / or absolute fallback if bb unknown

  // Blind inference state
  let inferredBB = null;
  let inferredSB = null;
  let inferredAnte = 0;
  let handIndex = 0;

  // After config constants
  const BET_EPS = 1e-6;           // comparison epsilon for bet deltas
  let streetMaxBet = 0;           // highest committed bet this street
  let heroLastCommitted = 0;      // hero's last committed bet amount

  // Raise tracking per street
  let raiseCountThisStreet = 0;  // counts voluntary raises this street
  let preflopRaiseCount   = 0;

  /* ---------- Overlay ---------- */
  function createOverlay() {
    const old = document.getElementById('pnb-panel');
    if (old) old.remove();

    overlay = document.createElement('div');
    overlay.id = 'pnb-panel';
    Object.assign(overlay.style, {
      position: 'fixed', top: '10px', right: '10px',
      width: '280px', zIndex: 9999, maxWidth: '280px'
    });

    overlay.innerHTML = `
      <style id="pnb-style">
        :root {
          --hud-bg: rgba(10, 15, 22, 0.92);
          --hud-border: #1f2a33;
          --hud-accent: #21c8c3;
          --hud-text: #e5e5e5;
          --hud-muted: #777;
          --hud-shadow: rgba(0, 0, 0, 0.8);
        }
        #pnb-panel {
          background: var(--hud-bg); color: var(--hud-text);
          font-family: "Segoe UI", Roboto, sans-serif; font-size: 12px;
          border: 1px solid var(--hud-border); border-radius: 12px;
          padding: 16px; box-shadow: 0 6px 20px var(--hud-shadow);
          transition: transform .2s ease, opacity .2s ease; opacity: .95;
        }
        #pnb-panel:hover { transform: translateY(-2px); opacity: 1; }
        .pnb-header{cursor:move;font-weight:bold;text-align:center;margin-bottom:14px;
          font-size:17px;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid var(--hud-border);padding-bottom:8px;}
        .pnb-row{display:grid;grid-template-columns:90px 1fr auto;align-items:center;margin-bottom:10px;}
        .pnb-label{color:var(--hud-muted);font-size:13px;text-transform:capitalize;}
        .pnb-bar{position:relative;height:8px;background:var(--hud-border);border-radius:4px;margin:0 10px;overflow:hidden;}
        .pnb-bar-fill{background:var(--hud-accent);height:100%;width:0;transition:width 0.4s cubic-bezier(.25,.8,.25,1);}
        .pnb-value{font-weight:600;font-size:13px;white-space:nowrap;}
        #pnb-action{text-align:center;margin:14px 0;font-size:14px;font-weight:700;color:var(--hud-text);}
        #pnb-panel hr{border:none;border-top:1px solid var(--hud-border);margin:16px 0;}
        #pnb-cat-grid{display:grid;grid-template-columns:repeat(2,1fr);column-gap:12px;row-gap:10px;margin-top:4px;font-size:11px;}
        .cat{display:grid;grid-template-columns:auto 1fr auto;align-items:center;row-gap:2px;}
        .cat-bar{grid-column:1/4;height:6px;background:var(--hud-border);border-radius:3px;overflow:hidden;margin-top:2px;}
        .cat-fill{height:100%;background:var(--hud-accent);border-radius:3px 0 0 3px;transition:width .25s ease;}
        .cat-label{color:var(--hud-muted);}
        .cat-val{text-align:right;color:var(--hud-text);font-weight:600;}
      </style>
      <div id="pnb-header" class="pnb-header">Poker Odds</div>
      <div class="pnb-row">
        <span class="pnb-label">Winning</span>
        <div class="pnb-bar"><div id="bar-win" class="pnb-bar-fill"></div></div>
        <span id="txt-win" class="pnb-value">--%</span>
      </div>
      <div class="pnb-row">
        <span class="pnb-label">Equity</span>
        <div class="pnb-bar"><div id="bar-equity" class="pnb-bar-fill"></div></div>
        <span id="txt-equity" class="pnb-value">--%</span>
      </div>
      <div class="pnb-row">
        <span class="pnb-label">Pot Odds</span>
        <div class="pnb-bar"><div id="bar-pot" class="pnb-bar-fill"></div></div>
        <span id="txt-pot" class="pnb-value">--%</span>
      </div>
      <div class="pnb-row" style="justify-content:center;margin-top:6px;">
        <strong id="pnb-action">Action: --</strong>
      </div>
      <hr/>
      <div id="pnb-cat-grid"></div>
    `;
    document.body.appendChild(overlay);

    const CAT_NAMES = ['High Card','One Pair','Two Pair','Three of a Kind','Straight','Flush','Full House','Four of a Kind','Straight Flush'];
    const catGrid = overlay.querySelector('#pnb-cat-grid');
    catGrid.innerHTML = CAT_NAMES.map((n,i)=>`
      <div class="cat">
        <span class="cat-label">${n}</span>
        <span id="cat-val-${i}" class="cat-val">0.00%</span>
        <div class="cat-bar"><div id="cat-fill-${i}" class="cat-fill"></div></div>
      </div>`).join('');
    makeDraggable(overlay, overlay.querySelector('#pnb-header'));
  }

  function makeDraggable(panel, handle) {
    let offsetX=0, offsetY=0, isDragging=false;
    handle = handle || panel;
    handle.addEventListener('mousedown', e=>{
      if (e.button!==0) return;
      isDragging=true;
      const r=panel.getBoundingClientRect();
      offsetX=e.clientX-r.left; offsetY=e.clientY-r.top;
      document.body.style.userSelect='none';
    });
    window.addEventListener('mousemove', e=>{
      if(!isDragging) return;
      panel.style.left = (e.clientX - offsetX)+'px';
      panel.style.top  = (e.clientY - offsetY)+'px';
      panel.style.right='auto';
    });
    window.addEventListener('mouseup', ()=>{
      if(!isDragging) return;
      isDragging=false;
      document.body.style.userSelect='';
    });
  }

  function updateOverlay(stats) {
    const pct = v => `${(v*100).toFixed(1)}%`;
    const set = (id,val,width) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (width != null) el.style.width = width;
      else el.textContent = val;
    };
    set('bar-win', null, pct(stats.winPct));
    set('txt-win', pct(stats.winPct));
    set('bar-equity', null, pct(stats.equityPct));
    set('txt-equity', pct(stats.equityPct));
    if (stats.potOdds != null) {
      set('bar-pot', null, pct(stats.potOdds));
      set('txt-pot', pct(stats.potOdds));
    } else {
      set('bar-pot', null, '0%');
      set('txt-pot', '--%');
    }
    const actionEl = document.getElementById('pnb-action');
    if (actionEl) actionEl.textContent = `Action: ${stats.action || '--'}`;
    stats.dist.forEach((v,i)=>{
      const fill = document.getElementById(`cat-fill-${i}`);
      const val  = document.getElementById(`cat-val-${i}`);
      if (fill) fill.style.width = pct(v);
      if (val)  val.textContent = pct(v);
    });
  }

  function showTrialLimitNotice() {
    if (limitNotifyShown) return;
    limitNotifyShown = true;
    const banner = document.createElement('div');
    banner.id = 'pnb-limit-banner';
    Object.assign(banner.style,{
      position:'fixed', top:'10px', right:'10px', background:'rgba(10,15,22,0.95)',
      color:'#f5f7fa', padding:'12px 16px', border:'1px solid #21c8c3', borderRadius:'8px',
      fontFamily:'Segoe UI, Roboto, sans-serif', fontSize:'13px', zIndex:10000,
      boxShadow:'0 4px 14px rgba(0,0,0,0.6)', cursor:'pointer'
    });
    banner.innerHTML = `<strong>PokerNow Master</strong><br/>Free-trial limit reached – HUD locked.<br/>
      <button id="pnb-upgrade-btn" style="margin-top:8px;padding:6px 14px;border:0;border-radius:8px;
        background:linear-gradient(90deg,#06b7c9,#11d0e3);color:#041316;font-weight:600;cursor:pointer;">
        Upgrade Now
      </button>`;
    banner.addEventListener('click', ()=>banner.remove());
    document.body.appendChild(banner);
    document.getElementById('pnb-upgrade-btn')?.addEventListener('click', e=>{
      e.stopPropagation();
      chrome.runtime.sendMessage({ action:'open_pricing' });
    });
  }

  /* ---------- Scraping Helpers ---------- */
  function getCardCode(el) {
    let code = el.dataset.card || el.getAttribute('data-card');
    if (code && code.length===2) return code;
    const valueSpan = el.querySelector('.value');
    const suitSpan  = el.querySelector('.suit');
    if (valueSpan && suitSpan) {
      let rank=valueSpan.textContent.trim().toUpperCase();
      if (rank==='10') rank='T';
      const suitTxt=suitSpan.textContent.trim().toLowerCase();
      if (rank && suitTxt) return rank+suitTxt;
    }
    // Alt/title
    code = el.getAttribute('alt') || el.getAttribute('title');
    if (code && /[2-9TJQKA][shdc]/i.test(code)) return code.slice(0,2);
    const src = el.getAttribute('src') || el.style.backgroundImage;
    if (src) {
      const m = src.match(/([2-9TJQKA][shdc])\.png/i);
      if (m) return m[1];
    }
    return null;
  }

  function scrapeCards() {
    const holeElems = document.querySelectorAll('.table-player.you-player .card, .table-player.you-player img.card');
    const boardEl = document.querySelectorAll('.table-cards .card, .table-cards img.card');
    const hole = Array.from(holeElems).map(getCardCode).filter(Boolean);
    const board= Array.from(boardEl).map(getCardCode).filter(Boolean);
    return { hole, board };
  }

  function scrapeMainPot() {
    const lbl = document.querySelector('.table-pot-size .main-value .chips-value .normal-value');
    if (!lbl) return 0;
    return parseFloat(lbl.textContent.replace(/[^\d.]/g,'')) || 0;
  }

  function scrapePotInfo() {
    let pot = 0;
    const totalLabel = document.querySelector('.table-pot-size .add-on-container .chips-value .normal-value');
    if (totalLabel) pot = parseFloat(totalLabel.textContent.replace(/[^\d.]/g,'')) || 0;

    const heroBetEl = document.querySelector('.table-player.you-player .table-player-bet-value .normal-value');
    const heroBet = heroBetEl ? parseFloat(heroBetEl.textContent.replace(/[^\d.]/g,'')) || 0 : 0;

    let largestOpp = 0;
    document.querySelectorAll('.table-player:not(.you-player) .table-player-bet-value .normal-value')
      .forEach(el=>{
        const v = parseFloat(el.textContent.replace(/[^\d.]/g,'')) || 0;
        if (v > largestOpp) largestOpp = v;
      });

    const callAmt = Math.max(0, largestOpp - heroBet);
    return { pot, callAmt, heroBet, largestOpp };
  }

  function getActivePlayerCount() {
    const all = Array.from(document.querySelectorAll('.table-player:not(.table-player-seat):not(.fold)'));
    const active = all.filter(p=>!p.querySelector('.standing-up'));
    return Math.max(2, active.length);
  }

  /* ---------- Blind Inference ---------- */
  function inferBlindsEarlyFromPot(rawPotValue){
    if(!rawPotValue||rawPotValue<=0) return {bb:null,sb:null,ante:0};
    const bb = rawPotValue/1.5;
    return { bb, sb: bb/2, ante:0 };
  }
  function inferBlindsDetailed(){
    const betVals = Array.from(document.querySelectorAll('.table-player .table-player-bet-value .normal-value'))
      .map(el=>parseFloat(el.textContent.replace(/[^\d.]/g,''))||0)
      .filter(v=>v>0).sort((a,b)=>a-b);
    if(!betVals.length) return {bb:null,sb:null,ante:0};
    const freq={}; betVals.forEach(v=>freq[v]=(freq[v]||0)+1);
    const entries=Object.entries(freq).map(([k,c])=>({v:parseFloat(k),c})).sort((a,b)=>a.v-b.v);
    let ante=0; if(entries.length>=2 && entries[0].c>=3) ante=entries[0].v;
    const uniq=[...new Set(betVals)].sort((a,b)=>b-a);
    let bb=uniq[0]; let sb=uniq.find(v=>v<bb) || (bb/2);
    if(uniq.length>=2){
      const top=uniq[0], second=uniq[1];
      if(top>=second*2.9){ bb=second; sb=bb/2; } // straddle ignore for now
    }
    if(Math.abs(bb/sb - 2)>0.3) sb=bb/2;
    return {bb,sb,ante};
  }
  function recordNewHandBlinds(potVal){
    const det=inferBlindsDetailed();
    if(det.bb){ inferredBB=det.bb; inferredSB=det.sb; inferredAnte=det.ante; return; }
    const simp=inferBlindsEarlyFromPot(potVal);
    if(simp.bb){ inferredBB=simp.bb; inferredSB=simp.sb; inferredAnte=simp.ante; }
  }
  function ensureBBGuessIfMissing() {
    if (inferredBB) return;
    // Try guess from current visible bets (two smallest positive values)
    const bets = Array.from(document.querySelectorAll('.table-player .table-player-bet-value .normal-value'))
      .map(el=>parseFloat(el.textContent.replace(/[^\d.]/g,''))||0)
      .filter(v=>v>0).sort((a,b)=>a-b);
    if (bets.length >= 2) {
      const sb = bets[0], bb = bets[1];
      if (bb > 0 && sb > 0 && Math.abs((bb/sb)-2)<0.35) {
        inferredBB = bb; inferredSB = sb;
      }
    }
  }

  /* ---------- Main Evaluation ---------- */
  function evaluate() {
    chrome.runtime.sendMessage({ action: 'check_access' }, (res) => {
      if (res && res.allowed === false) {
        if (overlay) overlay.style.display = 'none';
        if (res.subscriptionType === 'INACTIVE') {
          showTrialLimitNotice();
        }
        return;
      }

      // Access allowed – ensure HUD is visible and remove any prior limit notice.
      if (overlay && overlay.style.display === 'none') {
        overlay.style.display = 'block';
      }
      const limitBanner = document.getElementById('pnb-limit-banner');
      if (limitBanner) limitBanner.remove();

      // If the table element is gone, assume the game session has ended and reset HUD.
      const tableEl = document.querySelector('.table');
      if (!tableEl) {
        updateOverlay({
          winPct: 0,
          tiePct: 0,
          equityPct: 0,
          potOdds: null,
          action: null,
          dist: Array(9).fill(0)
        });
        return;
      }

      // Track hole visibility timing for game-end detection
      const { hole, board } = scrapeCards();
      if (hole.length === 2) {
        lastHoleSeen = Date.now();
      }

      // If no hole cards for over 8 seconds, treat as game ended and reset overlay
      if (hole.length !== 2 && Date.now() - lastHoleSeen > 8000) {
        updateOverlay({ winPct:0, tiePct:0, equityPct:0, potOdds:null, action:null, dist:Array(9).fill(0)});
      }

      // Early abort conditions after game-end handling
      if (!tableEl || (hole.length !== 2)) return;

      if (!window.PokerEvaluator || typeof PokerEvaluator.calcAll !== 'function') return;

      const players = getActivePlayerCount();
      let { pot, callAmt, heroBet, largestOpp } = scrapePotInfo();

      // Edge: small blind completes vs limpers – heroBet may read 0, callAmt=0 but hero still owes (bb - sb)
      if (board.length === 0 && callAmt === 0 && inferredBB && inferredSB) {
        const diff = (inferredBB - heroBet);
        if (diff > BET_EPS && diff <= inferredBB * 1.05) {
          callAmt = diff;
        }
      }

      const mainPot = scrapeMainPot();

      // New hand detection (main pot reset)
      if (lastMainPot > 0 && mainPot === 0) {
        handIndex++;
        setTimeout(()=>{
          const totalLabel=document.querySelector('.table-pot-size .add-on-container .chips-value .normal-value');
          const potVal=totalLabel ? parseFloat(totalLabel.textContent.replace(/[^\d.]/g,''))||0 : 0;
          recordNewHandBlinds(potVal);
        },50);
        // Notify background script – increment hands counter
        chrome.runtime.sendMessage({ action: 'hand_complete' });

        // Reset per-hand trackers
        raiseCountThisStreet = 0;
        preflopRaiseCount = 0;
        lastStreet = -1;
        cachedEquity = null;
      }
      lastMainPot = mainPot;

      const street = board.length;

      // -------- Street baseline & raise observation --------
      if (street !== lastStreet) {
        // new street baseline
        raiseCountThisStreet = 0;
        streetMaxBet = Math.max(heroBet, largestOpp); // blinds + any posts so far
        heroLastCommitted = heroBet;
      }

      // function to observe any new top bet (hero or villains)
      const observeNewRaises = (hBet, oppBetMax) => {
        const top = Math.max(hBet, oppBetMax);
        if (top > streetMaxBet + BET_EPS) {
          raiseCountThisStreet++;
          if (street === 0) preflopRaiseCount++;
          streetMaxBet = top;
        }
      };

      // call observer before advice calc
      observeNewRaises(heroBet, largestOpp);

      // Recalc equity once per street
      if (street !== lastStreet) {
        cachedEquity = PokerEvaluator.calcAll(hole, board, iterations, players);
        lastStreet = street;
      }

      const equityRes = cachedEquity || { winPct:0, tiePct:0, equityPct:0, dist:[] };
      const stats = {
        winPct: equityRes.winPct || 0,
        tiePct: equityRes.tiePct || 0,
        equityPct: equityRes.equityPct || 0,
        dist: equityRes.dist || []
      };

      // Pot odds only if facing a call
      stats.potOdds = callAmt > 0 ? (callAmt / (pot + callAmt)) : null;

      ensureBBGuessIfMissing();

      /* -------- Decision Logic v2 -------- */
      const preflop = (street === 0);
      const raiseLevel = raiseCountThisStreet; // 0 = none, 1 = first raise, 2+ multi-raised
      const heroIsLastAgg = Math.abs(heroBet - streetMaxBet) < BET_EPS;

      const bbRef = inferredBB || 1;

      // helper
      function openPotOdds(){
        if(callAmt===0){
          if(heroBet>0) return heroBet/(pot+heroBet);
          return 0;
        }
        return callAmt/(pot+callAmt);
      }

      // ---- Preflop ----
      let action;
      if(preflop){
        const isoNeedEq = openPotOdds() + (OPEN_DELTA + ISO_DELTA_SHIFT);
        const openNeedEq = openPotOdds() + OPEN_DELTA;

        if(raiseLevel===0){
          if(callAmt===0){
            if(heroBet>=bbRef-BET_EPS){ // Big blind free option
              action = (stats.equityPct>=isoNeedEq)? 'RAISE':'CHECK';
            }else{
              // folded to hero in non-BB position
              action = (stats.equityPct>=openNeedEq)? 'RAISE':'CHECK';
            }
          }else{
            // Limp pot
            if(stats.equityPct>=isoNeedEq) action='RAISE';
            else if(stats.equityPct+CALL_MARGIN>=openPotOdds()) action='CALL';
            else action='FOLD';
          }
        }else if(raiseLevel===1){
          if(callAmt>0){
            // facing first raise (3-bet decision)
            const potOdds = stats.potOdds ?? (callAmt/(pot+callAmt));
            if(stats.equityPct>=potOdds+THREE_BET_DELTA) action='RE-RAISE';
            else if(stats.equityPct+CALL_MARGIN>=potOdds) action='CALL';
            else action='FOLD';
          }else{
            // no new bet; hero was last aggressor
            action='CHECK';
          }
        }else{ // raiseLevel>=2
          const potOdds = stats.potOdds ?? (callAmt/(pot+callAmt));
          if(stats.equityPct>=potOdds+THREE_BET_DELTA) action='RE-RAISE';
          else if(stats.equityPct+CALL_MARGIN>=potOdds) action='CALL';
          else action='FOLD';
        }
      }
      else{ // ---- Postflop ----
        const raiseThresh = RAISE_THRESHOLDS[Math.min(players,9)]||0.25;

        if(raiseLevel===0 && callAmt===0){
          action = (stats.equityPct>=raiseThresh)?'RAISE':'CHECK';
        }else if(raiseLevel===0 && callAmt>0){
          const potOdds = stats.potOdds ?? (callAmt/(pot+callAmt));
          if(stats.equityPct>=potOdds+THREE_BET_DELTA) action='RAISE';
          else if(stats.equityPct+CALL_MARGIN>=potOdds) action='CALL';
          else action='FOLD';
        }else if(raiseLevel===1 && callAmt>0){
          const potOdds = stats.potOdds ?? (callAmt/(pot+callAmt));
          if(stats.equityPct>=potOdds+THREE_BET_DELTA) action='RE-RAISE';
          else if(stats.equityPct+CALL_MARGIN>=potOdds) action='CALL';
          else action='FOLD';
        }else if(raiseLevel===1 && callAmt===0){
          // hero was last aggressor; keep prior intent
          action = heroIsLastAgg ? 'RAISE' : 'CHECK';
        }else{ // raiseLevel>=2
          const potOdds = stats.potOdds ?? (callAmt/(pot+callAmt));
          if(stats.equityPct>=potOdds+THREE_BET_DELTA) action='RE-RAISE';
          else if(stats.equityPct+CALL_MARGIN>=potOdds) action='CALL';
          else action='FOLD';
        }
      }

      stats.action = action;
      /* -------- End Decision Logic -------- */

      // update hero committed baseline for next loop
      heroLastCommitted = heroBet;

      updateOverlay(stats);

      // Uncomment for debugging:
      // console.debug('DBG', {
      //   street, preflop, callAmt, pot, largestOpp, raiseCountThisStreet,
      //   preflopRaiseCount, unopenedPreflop, isLimpPot, facingOpen,
      //   heroBet, heroPrevBet, equity: stats.equityPct.toFixed(3), action
      // });
    });
  }

  /* ---------- Bootstrap ---------- */
  function init() {
    createOverlay();
    evaluate();
    // Periodic evaluation every second to handle idle scenarios (e.g., game end without DOM mutations)
    setInterval(evaluate, 1000);
    const table = document.querySelector('.table');
    const obs = new MutationObserver(()=>{
      clearTimeout(debounceId);
      debounceId = setTimeout(evaluate, DEBOUNCE_MS);
    });
    if (table) {
      obs.observe(table, {
        childList:true, subtree:true, attributes:true,
        characterData:true, attributeFilter:['class']
      });
    }
  }

  function whenReady(cb){
    if (document.querySelector('.table-player')) return cb();
    const obs = new MutationObserver((_m,o)=>{
      if (document.querySelector('.table-player')){
        o.disconnect(); cb();
      }
    });
    obs.observe(document.documentElement,{ childList:true, subtree:true });
  }

  whenReady(init);

  chrome.runtime.onMessage.addListener((msg,_s,sendResponse)=>{
    if (msg.action === 'toggle') {
      chrome.runtime.sendMessage({ action:'check_access' }, r=>{
        if (r && r.allowed === false) {
          if (overlay) overlay.style.display='none';
          showTrialLimitNotice();
          sendResponse?.({ visible:false, denied:true });
          return;
        }
        visible=!visible;
        overlay.style.display = visible ? 'block' : 'none';
        sendResponse?.({ visible });
      });
      return true;
    } else if (msg.action === 'get_state') {
      sendResponse?.({ visible });
    }
  });

})();
