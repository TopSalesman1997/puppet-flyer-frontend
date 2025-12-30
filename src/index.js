// frontend/src/index.js
// Frontend entry (browser bundle). This file must NOT contain server-side code.
// It imports the client-side firebase initializer and runs minimal startup hooks.

import './firebase-client.js';

// Optional lightweight startup: only call functions if they exist.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('load', () => {
    console.log('Frontend bundle loaded');

    // These functions are optional — call only if defined by other frontend scripts.
    if (typeof window.checkReady === 'function') {
      try { window.checkReady(); } catch (e) { console.warn('checkReady() failed', e); }
    }
    if (typeof window.positionOverlays === 'function') {
      try { window.positionOverlays(); } catch (e) { console.warn('positionOverlays() failed', e); }
    }
    if (typeof window.showWelcomeScreen === 'function') {
      try { window.showWelcomeScreen(); } catch (e) { console.warn('showWelcomeScreen() failed', e); }
    }
  });
}