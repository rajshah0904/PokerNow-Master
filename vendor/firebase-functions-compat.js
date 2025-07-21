// firebase-functions-compat.js
// Lightweight compatibility shim for Firebase Functions in environments where the
// official firebase-functions-compat SDK is not bundled. It only supports the
// subset needed by this extension (httpsCallable). If the real SDK is loaded
// elsewhere, this file will detect it and exit early.

(function () {
  // If the real SDK is already present, do nothing.
  if (typeof firebase === 'undefined' || typeof firebase.functions === 'function') {
    return;
  }

  /**
   * Returns a callable function that invokes a HTTPS Cloud Function via fetch.
   * This is NOT a full implementation – it only supports the data-in / data-out
   * pattern used by `httpsCallable` and assumes JSON payloads.
   *
   * @param {string} functionName The name of the callable function (as deployed).
   * @param {object} [options]    Not supported in this shim. Included for API
   *                              parity with the real SDK.
   * @returns {(data: any) => Promise<{ data: any }>}
   */
  function httpsCallable(functionName /* , options */) {
    if (!functionName || typeof functionName !== 'string') {
      throw new Error('httpsCallable requires a valid function name');
    }

    return async function (data) {
      const app = firebase.app();
      const projectId = app.options.projectId;
      if (!projectId) {
        throw new Error('Missing projectId in Firebase config');
      }

      // Default to the us-central1 region which is where Extensions are
      // deployed unless explicitly configured otherwise.
      const region = 'us-central1';
      const url = `https://${region}-${projectId}.cloudfunctions.net/${functionName}`;

      // Attempt to include the Firebase Auth ID token if the user is signed in.
      let idToken;
      try {
        const currentUser = firebase.auth && firebase.auth().currentUser;
        if (currentUser) {
          idToken = await currentUser.getIdToken();
        }
      } catch (_) {
        // Ignore errors – function might be publicly callable.
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ data }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Callable function ${functionName} failed: ${response.status} ${text}`);
      }

      // According to the callable protocol, the response should be JSON with a
      // top-level "data" field.
      const json = await response.json();
      return { data: json.data !== undefined ? json.data : json };
    };
  }

  // Attach stubbed functions implementation to the firebase namespace.
  firebase.functions = function () {
    return {
      httpsCallable,
    };
  };
})(); 