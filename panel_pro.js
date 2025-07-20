// panel_pro.js
(function(){
  const firebaseConfig = {
    apiKey: "AIzaSyDMRtco7UXpAvPHb3HE52_54dafHytYDpw",
    authDomain: "pokernow-bot.firebaseapp.com",
    projectId: "pokernow-bot"
  };
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();

  const hudBtn      = document.getElementById('hudBtn');
  const signOutBtn  = document.getElementById('signOutBtn');
  const userEmailEl = document.getElementById('userEmail');
  const statusPill  = document.getElementById('statusPill');
  const planNote   = document.getElementById('planNote');

  signOutBtn.addEventListener('click', () => auth.signOut());

  hudBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { action: 'toggle' }, (res) => {
        const visible = res && res.visible;
        hudBtn.textContent = visible ? 'Hide HUD' : 'Launch HUD';
      });
    });
  });

  // Set initial button label based on current state
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { action: 'get_state' }, (res) => {
      const visible = res && res.visible;
      hudBtn.textContent = visible ? 'Hide HUD' : 'Launch HUD';
    });
  });

  // Basic metrics update (only handsPlayed for now)
  const handsMonthEl = document.getElementById('handsMonth');
  if (handsMonthEl) {
    const db = firebase.firestore();
    auth.onAuthStateChanged((user) => {
      if (!user) return;
      db.collection('users').doc(user.uid).onSnapshot((snap) => {
        const d = snap.data() || {};
        if (d.handsPlayed !== undefined) handsMonthEl.textContent = d.handsPlayed;

        // Admin override
        if (d.adminActive === true) {
          planNote.textContent = 'Account enabled by admin settings.';
          return;
        }

        // Fetch active subscription for renewal date
        db.collection('users').doc(user.uid)
          .collection('subscriptions')
          .where('status', 'in', ['trialing', 'active'])
          .limit(1)
          .get()
          .then(q => {
            if (q.empty) return;
            const sub = q.docs[0].data();
            if (sub.current_period_end) {
              const endMs = sub.current_period_end * 1000; // Stripe epoch seconds
              const days = Math.max(0, Math.ceil((endMs - Date.now()) / 86400000));
              planNote.textContent = `Pro plan renews in ${days} day${days!==1?'s':''}. Manage your subscription anytime.`;
            }
          });
      });
    });
  }

  auth.onAuthStateChanged((user) => {
    if (!user) {
      // User signed out; no redirect to avoid extra popup.
      return;
    }
    userEmailEl.textContent = user.email;
    statusPill.textContent = 'Active';
    // Store uid for background updates
    chrome.storage.local.set({ currentUid: user.uid });

    // Ensure subscription_type field stays in sync
    const db = firebase.firestore();
    const docRef = db.collection('users').doc(user.uid);
    docRef.set({ email: user.email, subscription_type: 'ACTIVE' }, { merge: true });
  });
})(); 