// pokernow-master/auth.js

const firebaseConfig = {
  apiKey: 'AIzaSyDMRtco7UXpAvPHb3HE52_54dafHytYDpw',
  authDomain: 'pokernow-bot.firebaseapp.com',
  projectId: 'pokernow-bot',
  storageBucket: 'pokernow-bot.appspot.com',
  messagingSenderId: '54978395059',
  appId: '1:54978395059:web:8ffd353787671dc609e9c6',
  measurementId: 'G-K5VD40LTYL'
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

document.addEventListener('DOMContentLoaded', () => {
  // UI refs
  const modeToggle = document.getElementById('modeToggle');
  const form       = document.getElementById('authForm');
  const emailInput = document.getElementById('email');
  const passInput  = document.getElementById('password');
  const confirmFld = document.getElementById('confirmField');
  const confirmInp = document.getElementById('confirm');
  const primaryBtn = document.getElementById('primaryBtn');
  const switchLink = document.getElementById('switchLink');
  const googleBtn  = document.getElementById('googleBtn');
  let mode = 'signin';

  function setMode(next){
    if(mode===next) return;
    mode = next;
    modeToggle.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
    if(mode==='signup'){
      confirmFld.style.display='';
      primaryBtn.textContent='Create Account';
      switchLink.textContent='Already registered? Sign in';
    }else{
      confirmFld.style.display='none';
      primaryBtn.textContent='Sign In';
      switchLink.textContent='Need an account? Create one';
    }
  }
  modeToggle.addEventListener('click',e=>{if(e.target.dataset.mode) setMode(e.target.dataset.mode);});
  switchLink.addEventListener('click',()=>setMode(mode==='signin'?'signup':'signin'));

  googleBtn.replaceWith(googleBtn.cloneNode(true)); // remove previous listener
  const newGoogleBtn=document.getElementById('googleBtn');
  newGoogleBtn.addEventListener('click',()=>{
    chrome.runtime.sendMessage({ action:'google_login' },res=>{
      if(res&&res.ok){window.close();}
      else{alert(res?.error?.message||'Google sign-in failed');}
    });
  });

  // Legal links – open externally using chrome.tabs API for maximum compatibility
  document.querySelectorAll('.legal a').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: link.href });
    });
  });

  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const email=emailInput.value.trim();
    const pass=passInput.value;
    if(!email||!pass) return alert('Enter email & password');
    if(mode==='signup' && pass!==confirmInp.value) return alert('Passwords do not match');
    try{
      if(mode==='signup') await auth.createUserWithEmailAndPassword(email,pass);
      else await auth.signInWithEmailAndPassword(email,pass);
      window.close();
    }catch(err){alert(err.message);} 
  });
}); 