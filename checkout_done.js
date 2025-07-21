(function(){
  // Close the tab/window as soon as the page loads
  try {
    chrome.runtime.sendMessage({ action: 'close_self' });
  } catch(e){}
  setTimeout(()=>window.close(), 100);
})(); 