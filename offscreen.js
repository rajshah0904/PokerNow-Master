// pokernow-bot-master/offscreen.js

// Public page that performs signInWithPopup; host this separately
// TODO: Replace with your deployed helper page URL. To work with the pre-configured
// Firebase Hosting sample, keep as shown below (update if you deploy somewhere else).
const REMOTE_AUTH_URL = 'https://pokernow-bot.web.app/offscreen_auth.html';

const iframe = document.createElement('iframe');
iframe.src = REMOTE_AUTH_URL;
document.documentElement.appendChild(iframe);

// Listen for messages from background
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.target !== 'offscreen') return false;

  function handleIframeMessage({ data }) {
    // Ignore Firebase internal postMessage noise (strings beginning with '!_{')
    if (typeof data === 'string' && data.startsWith('!_{')) return;
    try {
      if (typeof data === 'string') data = JSON.parse(data);
    } catch (e) {
      console.warn('offscreen: JSON parse error', e);
      return;
    }
    globalThis.removeEventListener('message', handleIframeMessage);
    sendResponse(data);
  }

  globalThis.addEventListener('message', handleIframeMessage, false);
  // Kick off auth flow in iframe
  iframe.contentWindow.postMessage({ initAuth: true }, new URL(REMOTE_AUTH_URL).origin);
  return true; // keep sendResponse alive
}); 