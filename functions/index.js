// functions/index.js
// Firebase Cloud Functions entry point
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const stripe = require('stripe')(functions.config().stripe.secret);

admin.initializeApp();

// Replace callable with HTTP endpoint that creates a customer portal session then redirects
exports.createCustomerPortalSession = functions.https.onRequest(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.status(204).send('');
    return;
  }

  // Only allow POST as per Stripe docs
  if (req.method !== 'POST') {
    res.set('Allow', 'POST').status(405).send('Method Not Allowed');
    return;
  }

  // Always set CORS header on other responses
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Expose-Headers', 'Location');
  try {
    // Authenticate the Firebase user – check for Bearer token or session cookie
    let decoded;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      const idToken = req.headers.authorization.split('Bearer ')[1];
      decoded = await admin.auth().verifyIdToken(idToken);
    } else if (req.cookies && req.cookies.__session) {
      decoded = await admin.auth().verifySessionCookie(req.cookies.__session, true);
    } else {
      res.status(401).send('Unauthorized');
      return;
    }

    const uid = decoded.uid;
    const userSnap = await admin.firestore().doc(`users/${uid}`).get();
    if (!userSnap.exists) {
      res.status(404).send('User not found');
      return;
    }

    const customerId = userSnap.get('stripeId');
    if (!customerId) {
      res.status(400).send('Missing Stripe customer ID');
      return;
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: 'https://pokernow-bot.web.app/portal_done',
    });

    // If the client explicitly accepts JSON, return the URL instead of redirect
    const wantJson = (req.get('Accept') || '').includes('application/json');
    if (wantJson) {
      res.status(200).json({ url: session.url });
      return;
    }

    // Otherwise, perform a redirect
    res.redirect(303, session.url);
  } catch (err) {
    console.error('Error creating portal session', err);
    res.status(500).send('Internal Server Error');
  }
}); 