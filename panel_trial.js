// panel_trial.js
(function(){
  const FREE_HANDS = 20;
  const hudBtn = document.getElementById('hudBtn');
  const hudStatus = document.getElementById('hudStatus');
  const userEmailEl = document.getElementById('userEmail');
  const usageFill = document.getElementById('usageFill');
  const usagePctLabel = document.getElementById('usagePctLabel');
  const remainText = document.getElementById('remainText');
  const playedText = document.getElementById('playedText');
  const sessionHands = document.getElementById('sessionHands');
  const signOutBtn = document.getElementById('signOutBtn');
  const planPill   = document.getElementById('planPill');
  const upgradeBtn = document.getElementById('upgradeBtn');
  let hudVisible = false;

  // Stripe Checkout link (replace with your real checkout URL)
  const STRIPE_CHECKOUT_URL = 'https://buy.stripe.com/test_00g14vb2Y4s6dP2cMM';

  // Stripe price IDs for weekly & monthly subscriptions
  const PRICE_WEEKLY   = 'price_1RmeucG6uErAXP52t7MMIRUm'; // $2 / week
  const PRICE_MONTHLY  = 'price_1RmeuEG6uErAXP52bb1fgYVw'; // $5 / month

  upgradeBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('pricing.html') });
  });

  const firebaseConfig = {
    apiKey: "AIzaSyDMRtco7UXpAvPHb3HE52_54dafHytYDpw",
    authDomain: "pokernow-bot.firebaseapp.com",
    projectId: "pokernow-bot"
  };
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

  function updateUI(played, subType='FREE_TRIAL') {
    const remaining = Math.max(0, FREE_HANDS - played);
    playedText.textContent = played;
    remainText.textContent = `${remaining} / ${FREE_HANDS}`;
    const pct = played / FREE_HANDS * 100;
    usageFill.style.setProperty('--pct', pct + '%');
    usagePctLabel.textContent = Math.round(pct) + '%';

    // Update plan pill & HUD availability
    if (subType === 'INACTIVE') {
      planPill.textContent = 'Inactive';
      hudBtn.disabled = true;
      hudBtn.textContent = 'HUD Locked';
      hudStatus.textContent = 'Locked';
    } else {
      planPill.textContent = 'Free Trial';
      hudBtn.disabled = false;
    }
  }

  hudBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'check_access' }, (accessRes) => {
      if (!accessRes || !accessRes.allowed) {
        // Shouldn’t happen – button disabled – but guard just in case
        return;
      }
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (!tabs[0]) return;
        chrome.tabs.sendMessage(tabs[0].id, { action: 'toggle' }, res => {
          hudVisible = res && res.visible;
          hudStatus.textContent = hudVisible ? 'Visible' : 'Hidden';
          hudBtn.textContent = hudVisible ? 'Hide HUD' : 'Show HUD';
        });
      });
    });
  });

  // Initialize HUD button label with current state
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { action: 'get_state' }, res => {
      hudVisible = res && res.visible;
      hudStatus.textContent = hudVisible ? 'Visible' : 'Hidden';
      hudBtn.textContent = hudVisible ? 'Hide HUD' : 'Show HUD';
    });
  });
  signOutBtn.addEventListener('click', () => auth.signOut());

  auth.onAuthStateChanged(async user => {
    if (!user) {
      window.location.href = chrome.runtime.getURL('signup.html');
      return;
    }
    userEmailEl.textContent = user.email;
    // Keep UID available for background script
    chrome.storage.local.set({ currentUid: user.uid });

    const docRef = db.collection('users').doc(user.uid);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      await docRef.set({
        email: user.email,
        handsPlayed: 0,
        subscription_type: 'FREE_TRIAL',
        created: firebase.firestore.FieldValue.serverTimestamp()
      });
      updateUI(0, 'FREE_TRIAL');
    }
    // live updates
    docRef.onSnapshot(snap => {
      const data = snap.data() || {};
      const played = data.handsPlayed || 0;
      let subType = data.adminActive === true ? 'ACTIVE' : (data.subscription_type || 'FREE_TRIAL');
      if (subType === 'FREE_TRIAL' && played >= FREE_HANDS) {
        subType = 'INACTIVE';
        docRef.set({ subscription_type: 'INACTIVE' }, { merge:true }); // persist change
      }
      updateUI(played, subType);
    });
  });
})(); 