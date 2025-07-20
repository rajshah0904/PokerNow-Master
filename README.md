# PokerNow Master Chrome Extension

PokerNow Master is a real-time decision assistant for games played on [PokerNow.club](https://www.pokernow.club).  
It overlays live equity, pot-odds, and optimal-action advice directly on the table while you play.

---

## Features

* **Live HUD** – Displays win %, equity %, pot odds, and hand-category distribution.
* **Action Advisor** – Suggests *Check / Fold / Call / Raise* based on equity vs. pot odds.
* **Hand Tracking** – Counts hands played and locks HUD after a free-trial quota.
* **Panels** – Separate popup panels for Free-Trial and Pro users.
* **Fast Equity Engine** – Optimised evaluator with:
  * Exact flop turn+river enumeration cached per unique board.
  * Exact turn river enumeration (47 deterministic run-outs).
  * Monte-Carlo fallback for pre-flop and river.
* **Firebase Integration** – Auth, Firestore storage, Stripe subscription data.

---

## Installation (Developer Mode)

1. Clone / download this repository.
2. In Chrome/Edge go to **chrome://extensions/** ⇢ enable *Developer mode*.
3. Click **Load unpacked** and select the project folder.
4. Open a PokerNow table, click the extension icon, and launch the HUD.

No build step is required – everything runs as vanilla JavaScript/HTML/CSS.

---

## Firebase Configuration & Security

The project uses Firebase Authentication and Firestore.  
`firebaseConfig` objects inside the source contain **web API keys** which are **public by design**—they do *not* grant administrative access.  

To keep your project secure:

1. **Lock down Firestore rules** to allow only the reads/writes your extension needs.
2. Optionally restrict the browser key in Google Cloud Console → APIs & Services → Credentials → *Key restrictions*.
3. Never commit service-account JSON keys; those are private.

---

## Development Tips

* **Reloading the HUD** – Press the HUD button in the panel to toggle visibility.  No page refresh is needed; the content script now re-evaluates every second and resets when the session ends.
* **Testing subscription tiers** – Use Firestore to tweak `subscription_type` (`FREE_TRIAL`, `ACTIVE`, `INACTIVE`) for your test user.
* **Performance** – The equity engine caches flop results and enumerates the turn exactly, delivering ~100× speed-ups without losing accuracy.

---

## License

MIT © 2025 – Raj Shah