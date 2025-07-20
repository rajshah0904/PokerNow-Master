// signup.js
(function(){
  const btn=document.getElementById('openAuth');
  if(btn){
    btn.addEventListener('click',()=>{
      chrome.windows.create({
        url: chrome.runtime.getURL('auth.html'),
        type: 'popup',
        width: 420,
        height: 620
      });
      // Close current popup if running inside extension popup
      if (window.close) setTimeout(()=>window.close(), 100);
    });
  }
})(); 