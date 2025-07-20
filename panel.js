// pokernow-bot-master/panel.js

document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('toggle');
  const controlsDiv = document.querySelector('.controls');
  // Hide controls until auth state determined
  controlsDiv.style.display = 'none';

  // Helper: determine if a tab belongs to PokerNow
  const isPokerNowTab = (url) => /^https?:\/\/[^\/]*\.pokernow\.club\//.test(url || '');

  // Helper to set button label
  const setLabel = (visible) => {
    toggleBtn.textContent = visible ? 'Hide HUD' : 'Show HUD';
  };

  // Retrieve current overlay state when popup opens
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0] || !isPokerNowTab(tabs[0].url)) return; // Bail if not a PokerNow page
    chrome.tabs.sendMessage(tabs[0].id, { action: 'get_state' }, (res) => {
      if (chrome.runtime.lastError) {
        // content script likely not injected yet – assume visible
        setLabel(true);
      } else {
        setLabel(res && res.visible !== false);
      }
    });
  });

  // Toggle click handler
  toggleBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0] || !isPokerNowTab(tabs[0].url)) return; // Only interact with PokerNow pages
      chrome.tabs.sendMessage(tabs[0].id, { action: 'toggle' }, (res) => {
        if (!chrome.runtime.lastError) {
          // Update label with new state
          setLabel(res && res.visible);
          return;
        }

        // If content.js is not present, inject it and try again
        const files = ['lib/poker-evaluator.js', 'content.js'];
        chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files }, () => {
          setTimeout(() => {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'toggle' }, (r2) => {
              setLabel(r2 && r2.visible);
            });
          }, 200);
        });
      });
    });
  });

  /* --------------------------------------------------
   * Firebase setup
   * -------------------------------------------------- */
  const firebaseConfig = {
    apiKey: "AIzaSyDMRtco7UXpAvPHb3HE52_54dafHytYDpw",
    authDomain: "pokernow-bot.firebaseapp.com",
    projectId: "pokernow-bot",
    storageBucket: "pokernow-bot.appspot.com",
    messagingSenderId: "54978395059",
    appId: "1:54978395059:web:8ffd353787671dc609e9c6",
    measurementId: "G-K5VD40LTYL"
  };

  // Prevent re-initialisation if panel reloaded
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  const auth = firebase.auth();
  const db   = firebase.firestore();

  /* --------------------------------------------------
   * UI Elements
   * -------------------------------------------------- */
  const logoutBtn       = document.getElementById('logout-btn');
  const userArea        = document.getElementById('user-area');
  const authCta         = document.getElementById('auth-cta');
  const userEmailSpan   = document.getElementById('user-email');
  const handsRemaining  = document.getElementById('hands-remaining');
  const handsStatus     = document.getElementById('hands-status');
  const handsPlayedEl   = document.getElementById('hands-played');
  const subscribeBtn    = document.getElementById('subscribe-btn');
  const statusTag       = document.getElementById('status-tag');
  const openAuthBtn     = document.getElementById('open-auth-btn');
  const statusArea      = document.getElementById('status-area');

  const FREE_HANDS = 20;

  // Open standalone auth window
  openAuthBtn.addEventListener('click', () => {
    const url = chrome.runtime.getURL('auth.html');
    chrome.windows.create({ url, type: 'popup', width: 420, height: 620 });
  });

  logoutBtn.addEventListener('click', () => auth.signOut());

  subscribeBtn.addEventListener('click', async () => {
    // TODO: Implement Stripe Checkout session creation (e.g., via Firebase Functions)
    // Placeholder – open pricing page
    chrome.tabs.create({ url: 'https://your-app.com/subscribe' });
  });

  /* --------------------------------------------------
   * Update UI on auth change
   * -------------------------------------------------- */
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      controlsDiv.style.display = 'block';
      authCta.style.display = 'none';
      statusArea.style.display = 'block';
      userArea.style.display = 'block';
      userEmailSpan.textContent = user.email;

      // Persist UID so background/content scripts can access
      chrome.storage.local.set({ currentUid: user.uid });

      // Fetch or create user doc and listen for live updates
      const docRef = db.collection('users').doc(user.uid);
      const docSnap = await docRef.get();
      if (!docSnap.exists) {
        await docRef.set({ handsPlayed: 0, subscriptionActive: false, created: firebase.firestore.FieldValue.serverTimestamp() });
      }

      docRef.onSnapshot((snap) => {
        const data = snap.data() || {};
        const played = data.handsPlayed || 0;
        const remaining = Math.max(0, FREE_HANDS - played);

        handsPlayedEl.textContent = `Hands played: ${played}`;
        updateStatusTag(played, data.subscriptionActive);

        if (data.subscriptionActive) {
          // pro panel
          chrome.action.setPopup({ popup: 'panel_pro.html' });
          if (!location.pathname.endsWith('panel_pro.html')) {
            window.location.href = chrome.runtime.getURL('panel_pro.html'); return;
          }
        } else {
          // trial panel
          chrome.action.setPopup({ popup: 'panel_trial.html' });
          if (!location.pathname.endsWith('panel_trial.html')) {
            window.location.href = chrome.runtime.getURL('panel_trial.html'); return;
          }
          handsStatus.textContent = `Hands remaining: ${remaining}/${FREE_HANDS}`;
          subscribeBtn.style.display = remaining === 0 ? 'inline-block' : 'none';
        }
      });
    } else {
      // Signed out
      chrome.action.setPopup({ popup: 'signup.html' });
      window.location.href = chrome.runtime.getURL('signup.html');
      return;
    }
  });

  function updateStatusTag(played, subscriptionActive) {
    if (subscriptionActive) {
      statusTag.textContent = 'ACTIVE';
      statusTag.style.color = '#21c8c3';
    } else if (played < FREE_HANDS) {
      statusTag.textContent = 'FREE TRIAL';
      statusTag.style.color = '#ffa500';
    } else {
      statusTag.textContent = 'INACTIVE';
      statusTag.style.color = '#ff5050';
    }
  }
}); 