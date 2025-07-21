// pricing.js
(function(){
  const PRICE_WEEKLY  = 'price_1RmeucG6uErAXP52t7MMIRUm';
  const PRICE_MONTHLY = 'price_1RmeuEG6uErAXP52bb1fgYVw';

  // Firebase init (skip if already)
  const firebaseConfig={ apiKey:"AIzaSyDMRtco7UXpAvPHb3HE52_54dafHytYDpw", authDomain:"pokernow-bot.firebaseapp.com", projectId:"pokernow-bot" };
  if(!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db   = firebase.firestore();

  const btnWeekly  = document.getElementById('btnWeekly');
  const btnMonthly = document.getElementById('btnMonthly');

  btnWeekly.disabled = btnMonthly.disabled = true; // until auth ready

  function startCheckout(priceId, btn){
    btn.disabled=true; btn.textContent='Redirecting…';
    const user = auth.currentUser;
    if(!user){ location.href = chrome.runtime.getURL('signup.html'); return; }
    const custRef = db.collection('users').doc(user.uid);
    custRef.set({}, { merge:true }).then(async ()=>{
      const closeUrl = chrome.runtime.getURL('checkout_done.html');
      custRef.collection('checkout_sessions').add({
        price: priceId,
        success_url: closeUrl,
        cancel_url: closeUrl,
        allow_promotion_codes: true // enable coupon entry on Stripe Checkout
      }).then((docRef)=>{
        custRef.collection('checkout_sessions').doc(docRef.id)
        .onSnapshot((snap)=>{
          const d=snap.data();
          if(d?.error){ alert(d.error.message); btn.disabled=false; btn.textContent='Try Again'; }
          if(d?.url){ window.location.assign(d.url); }
        });
      }).catch(async (e)=>{
        console.error('checkout error', e);
        // Attempt token refresh in case of permission error due to stale token
        await user.getIdToken(true);
        alert('Permission error starting checkout. Please try again.');
        btn.disabled=false; btn.textContent='Upgrade';
      });
    }).catch(async (e)=>{
      console.error(e);
      // Attempt token refresh in case of permission error due to stale token
      await user.getIdToken(true);
      alert('Permission error starting checkout. Please try again.');
      btn.disabled=false; btn.textContent='Upgrade';
    });
  }

  auth.onAuthStateChanged((user)=>{
    if(user){
      btnWeekly.disabled = btnMonthly.disabled = false;
      btnWeekly.addEventListener('click', ()=>startCheckout(PRICE_WEEKLY, btnWeekly));
      btnMonthly.addEventListener('click', ()=>startCheckout(PRICE_MONTHLY, btnMonthly));

      // No additional listener needed – background script picks up subscription change

    } else {
      btnWeekly.addEventListener('click', ()=>location.href = chrome.runtime.getURL('signup.html'));
      btnMonthly.addEventListener('click', ()=>location.href = chrome.runtime.getURL('signup.html'));
    }
  });
})(); 