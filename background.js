// pokernow-master/background.js

// Firebase libs (loaded remotely – allowed via CSP)
importScripts('vendor/firebase-app-compat.js',
              'vendor/firebase-firestore-compat.js',
              'vendor/firebase-auth-compat.js');

const firebaseConfig = {
  apiKey: 'AIzaSyDMRtco7UXpAvPHb3HE52_54dafHytYDpw',
  authDomain: 'pokernow-bot.firebaseapp.com',
  projectId: 'pokernow-bot',
  storageBucket: 'pokernow-bot.appspot.com',
  messagingSenderId: '54978395059',
  appId: '1:54978395059:web:8ffd353787671dc609e9c6',
  measurementId: 'G-K5VD40LTYL'
};
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
const CUSTOMER_COLLECTION = 'users';
const FREE_HANDS = 20;
const auth = firebase.auth();

// Utility to compute sub type
async function computeAndPersistSubType(uid){
  const userRef = db.collection('users').doc(uid);
  const doc = await userRef.get();
  const data = doc.data()||{};
  const played = data.handsPlayed || 0;

  // Admin override
  const adminActive = data.adminActive === true;

  // Check for active Stripe subscription via extension data
  const subsSnap = await db.collection(CUSTOMER_COLLECTION).doc(uid).collection('subscriptions')
    .where('status','in',['trialing','active']).get();
  const stripeActive = !subsSnap.empty;

  const effectiveActive = adminActive || stripeActive;

  const subType = effectiveActive ? 'ACTIVE' : (played < FREE_HANDS ? 'FREE_TRIAL' : 'INACTIVE');

  const authUser = firebase.auth().currentUser;
  const emailField = authUser && authUser.uid === uid ? { email: authUser.email } : {};
  await userRef.set({ subscription_type: subType, ...emailField }, { merge: true });
}

// Ensure popup reflects current auth tier
auth.onAuthStateChanged(async (user)=>{
  if(!user){ chrome.action.setPopup({popup:'signup.html'}); return; }
  // Ensure subscription type stays accurate
  computeAndPersistSubType(user.uid);

  const doc = await db.collection('users').doc(user.uid).get();
  const data = doc.data()||{};
  let subTypeCurrent = data.subscription_type || 'INACTIVE';
  if (data.adminActive === true) subTypeCurrent = 'ACTIVE';
  if(subTypeCurrent === 'ACTIVE'){
    chrome.action.setPopup({popup:'panel_pro.html'});
  }else{
    chrome.action.setPopup({popup:'panel_trial.html'});
  }

  // Listen for Stripe subscription changes and update status live
  db.collection(CUSTOMER_COLLECTION).doc(user.uid).collection('subscriptions')
    .onSnapshot(()=>computeAndPersistSubType(user.uid));
});

// ---------- Offscreen helpers for Google OAuth ----------
const OFFSCREEN_PATH = 'offscreen.html';
let creatingOffscreen;

async function hasOffscreen() {
  const clientsList = await self.clients.matchAll();
  return clientsList.some(c => c.url === chrome.runtime.getURL(OFFSCREEN_PATH));
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (creatingOffscreen) { await creatingOffscreen; return; }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [ chrome.offscreen.Reason.DOM_SCRAPING ],
    justification: 'Google OAuth'
  });
  await creatingOffscreen;
  creatingOffscreen = null;
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('PokerNow Bot Master installed');
  // Open auth page so user can sign up/login
  chrome.windows.create({ url: chrome.runtime.getURL('auth.html'), type: 'popup', width: 420, height: 620 });
});

// Re-inject content scripts into existing PokerNow tabs after install/update
chrome.runtime.onInstalled.addListener(async () => {
  const manifest = chrome.runtime.getManifest();
  const contentScripts = manifest.content_scripts || [];

  for (const cs of contentScripts) {
    for (const tab of await chrome.tabs.query({ url: cs.matches })) {
      try {
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: cs.js });
      } catch (e) {
        // Ignore tabs where scripts cannot be injected (e.g., chrome://)
      }
    }
  }
});

/* --------------------------------------------------
 * Hand played updates from content script
 * -------------------------------------------------- */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'hand_complete') {
    chrome.storage.local.get(['currentUid'], async (res) => {
      const uid = res.currentUid;
      if (!uid) return; // not signed in
      try {
        const userRef = db.collection('users').doc(uid);
        // Increment handsPlayed first
        await userRef.set({ handsPlayed: firebase.firestore.FieldValue.increment(1) }, { merge: true });
        const doc   = await userRef.get();
        const data  = doc.data() || {};
        const played= data.handsPlayed || 0;
        // Recompute using helper (handles adminActive)
        await computeAndPersistSubType(uid);

        if ((await userRef.get()).data().subscription_type === 'INACTIVE') {
          console.warn('Free hand quota reached for user', uid);
        }
        sendResponse({ handsPlayed: played });
      } catch (e) {
        console.error('Error updating handsPlayed', e);
      }
    });
    return true; // indicates async sendResponse
  }
  if (msg.action === 'check_access') {
    chrome.storage.local.get(['currentUid'], async (res) => {
      const uid = res.currentUid;
      if (!uid) return sendResponse({ allowed: false });
      try {
        const data = (await db.collection('users').doc(uid).get()).data() || {};
        const played = data.handsPlayed || 0;
        const subType = data.subscription_type || (played < FREE_HANDS ? 'FREE_TRIAL' : 'INACTIVE');
        const allowed = subType !== 'INACTIVE';
        sendResponse({ allowed, handsPlayed: played, subscriptionType: subType });
      } catch (e) {
        console.error('check_access error', e);
        sendResponse({ allowed: false });
      }
    });
    return true; // async
  }
  if (msg.action === 'google_login') {
    (async () => {
      await ensureOffscreen();
      chrome.runtime.sendMessage({ target: 'offscreen' }, async (result) => {
        if (!result) { sendResponse({ ok:false, error:{ message:'No response' }}); return; }
        if (result.name === 'FirebaseError') {
          sendResponse({ ok:false, error: result });
          return;
        }
        try {
          // Build credential from ID token returned by remote page
          const idTok = result._tokenResponse?.oauthIdToken || null;
          const accessTok = result._tokenResponse?.oauthAccessToken || null;
          const cred = firebase.auth.GoogleAuthProvider.credential(idTok, accessTok);
          await auth.signInWithCredential(cred);
          sendResponse({ ok:true });
        } catch (e) {
          sendResponse({ ok:false, error: e });
        }
      });
    })();
    return true; // async
  }
  if (msg.action === 'open_pricing') {
    chrome.windows.create({
      url: chrome.runtime.getURL('pricing.html'),
      type: 'popup',
      width: 420,
      height: 640
    });
    return; // no async response
  }
}); 