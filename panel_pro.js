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
// portalBtn handled via HTML form POST; no JS needed
const portalBtn  = document.getElementById('portalBtn');
if (portalBtn) {
  const ENDPOINT = 'https://us-central1-pokernow-bot.cloudfunctions.net/createCustomerPortalSession';

  portalBtn.addEventListener('click', async (e) => {
    // Prevent the form from navigating away – we'll handle it via JS
    e.preventDefault();

    portalBtn.disabled = true;
    portalBtn.textContent = 'Opening…';

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not signed in');

      const idToken = await user.getIdToken();

      // Call the HTTPS endpoint, requesting JSON instead of redirect
      const resp = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Bearer ' + idToken,
        },
        body: '{}',
        redirect: 'follow',
      });

      if (!resp.ok) throw new Error('HTTP ' + resp.status);

      // If the function returned JSON, parse it; otherwise, we might have followed a redirect
      let destUrl;
      const contentType = resp.headers.get('Content-Type') || '';
      if (contentType.includes('application/json')) {
        const data = await resp.json();
        destUrl = data && data.url;
      } else {
        // We followed redirect -> final URL is resp.url
        destUrl = resp.url;
      }

      if (!destUrl) throw new Error('No portal URL available');

      chrome.tabs.create({ url: destUrl });
    } catch (err) {
      console.error('Failed to open billing portal:', err);
      // Fallback to Stripe generic portal login
      chrome.tabs.create({ url: 'https://billing.stripe.com/p/login/6oU5kDabqeVs6LreO60Ny00' });
    } finally {
      portalBtn.disabled = false;
      portalBtn.textContent = 'Manage Subscription';
    }
  });
}

  signOutBtn.addEventListener('click', () => {
    auth.signOut().then(()=>{
      chrome.action.setPopup({ popup: 'signup.html' });
      window.location.href = chrome.runtime.getURL('signup.html');
    });
  });

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
  const handsLifetimeEl = document.getElementById('handsLifetime');
  if (handsLifetimeEl) {
    const db = firebase.firestore();
    auth.onAuthStateChanged((user) => {
      if (!user) return;
      db.collection('users').doc(user.uid).onSnapshot((snap) => {
        const d = snap.data() || {};
        if (d.handsPlayed !== undefined) handsLifetimeEl.textContent = d.handsPlayed;

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
              // Handle Firestore Timestamp, epoch seconds, or milliseconds
              let endDate;
              const val = sub.current_period_end;
              if (typeof val === 'object' && typeof val.toDate === 'function') {
                // Firestore Timestamp
                endDate = val.toDate();
              } else if (typeof val === 'number') {
                // Determine if seconds or milliseconds
                endDate = new Date(val < 1e12 ? val * 1000 : val);
              } else {
                // Unsupported format; skip rendering
                return;
              }

              const ONE_DAY = 86400000;
              // Use real-time difference and floor to avoid off-by-one rounding
              let days = Math.floor((endDate.getTime() - Date.now()) / ONE_DAY);
              if (!Number.isFinite(days) || days < 0) days = 0;

              planNote.textContent = days === 0 ?
                'Plan renews today.' :
                `Pro plan renews in ${days} day${days!==1?'s':''}. Manage your subscription anytime.`;
            }
          });
      });
    });
  }

  auth.onAuthStateChanged((user) => {
    if (!user) {
      // Redirect to signup panel immediately when signed out.
      chrome.action.setPopup({ popup: 'signup.html' });
      window.location.href = chrome.runtime.getURL('signup.html');
      return;
    }
    userEmailEl.textContent = user.email;
    statusPill.textContent = 'Active';
    // Store uid for background updates
    chrome.storage.local.set({ currentUid: user.uid });

    const db = firebase.firestore();
    const docRef = db.collection('users').doc(user.uid);

    // If doc doesn’t exist yet, create it with initial fields
    docRef.get().then(snap => {
      if (!snap.exists) {
        // Create document if missing, but don’t overwrite any metrics fields unintentionally
        docRef.set({
          email: user.email,
          subscription_type: 'ACTIVE',
          created: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } else {
        // Ensure subscription_type and email stay in sync without touching other fields
        docRef.set({ email: user.email, subscription_type: 'ACTIVE' }, { merge: true });
      }
    });

    // Observe subscription documents to auto-downgrade if plan cancelled / expired
    db.collection('users').doc(user.uid).collection('subscriptions')
      .where('status', 'in', ['trialing', 'active'])
      .onSnapshot(async (subSnap)=>{
        if (subSnap.empty) {
          // No longer active – recompute type and redirect
          const playedSnap = await docRef.get();
          const played = (playedSnap.data()||{}).handsPlayed || 0;
          const subType = played < 20 ? 'FREE_TRIAL' : 'INACTIVE';
          await docRef.set({ subscription_type: subType }, { merge:true });
          chrome.action.setPopup({ popup:'panel_trial.html' });
          window.location.href = chrome.runtime.getURL('panel_trial.html');
        }
      });
  });
})(); 