// firebase-client.js - Firebase initialization, auth, and score submission
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  getIdToken,
  sendPasswordResetEmail,
  deleteUser,
  sendEmailVerification
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  addDoc,
  runTransaction,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  Timestamp
} from 'firebase/firestore';
import { getFunctions } from "firebase/functions";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCM2Qo__OXH7f1igNo_UfDNxydj7brKZKM",
  authDomain: "big-shot-games-a20e7.firebaseapp.com",
  projectId: "big-shot-games-a20e7",
  storageBucket: "big-shot-games-a20e7.firebasestorage.app",
  messagingSenderId: "962063269777",
  appId: "1:962063269777:web:dbba1290279324cbd46430",
  measurementId: "G-0WJY19QC1J"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

// Expose auth and db globally
window.fbAuth = auth;
window.fbDb = db;

// Expose Firestore helpers so script.js can reuse the same module/functions
window.fbFs = {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  Timestamp,
  doc,
  getDoc
};

window.dispatchEvent(new Event('firebase-ready'));

console.log("Firebase initialized:", app.name);

const GAME_ID = "big-shot-games-a20e7";

/* Verification resend cooldown (ms) */
const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

/* ----------------------
   Username helper: normalize username to doc id
   ---------------------- */
function usernameKeyFor(username) {
  // simple normalization: lowercase + trim
  return username.trim().toLowerCase();
}

// Expose identifier resolver for other scripts if needed
window.resolveIdentifierToEmail = resolveIdentifierToEmail;

/* ========== USERNAME RESOLUTION (now uses /usernames collection) ========== */
async function resolveIdentifierToEmail(identifier) {
  if (!identifier || typeof identifier !== "string") {
    throw new Error("Identifier is required");
  }
  const trimmed = identifier.trim();
  if (trimmed.includes("@")) {
    return trimmed;
  }

  // Ensure db is available
  if (!db) {
    throw new Error("Firestore not initialized");
  }

  // Treat as username lookup via the /usernames collection
  const key = usernameKeyFor(trimmed);
  const usernameRef = doc(db, "usernames", key);
  const snap = await getDoc(usernameRef);
  if (!snap.exists()) {
    throw new Error(`Username "${trimmed}" not found`);
  }
  const data = snap.data() || {};
  if (data.email) return data.email;
  // Fallback: if we only stored userId, fetch users/{uid} to get email
  if (data.userId) {
    const userDoc = await getDoc(doc(db, "users", data.userId));
    if (userDoc.exists()) {
      const ud = userDoc.data() || {};
      if (ud.email) return ud.email;
    }
  }
  throw new Error(`Username "${trimmed}" has no associated email`);
}

// ========== SCORE SUBMISSION ==========
async function submitScoreToServer(score) {
  const user = auth.currentUser;
  if (!user) {
    console.log("No user signed in, score not submitted");
    return;
  }

  try {
    const userDocRef = doc(db, "users", user.uid);
    const userDoc = await getDoc(userDocRef);

    if (!userDoc.exists()) {
      console.error("User document not found");
      return;
    }

    const userData = userDoc.data();
    const username = userData.username || user.email || "Anonymous";

    // Get current user stats
    const userStatsRef = doc(db, "userStats", user.uid);
    const userStatsDoc = await getDoc(userStatsRef);

    let scores = [];
    let totalScore = 0;

    if (userStatsDoc.exists()) {
      const data = userStatsDoc.data();
      scores = data.scores || [];
      totalScore = data.totalScore || 0;
    }

    // Add new score with timestamp
    scores.push({
      score: score,
      timestamp: new Date().toISOString(),
      date: new Date().toLocaleDateString(),
      time: new Date().toLocaleTimeString()
    });

    // Sort by score descending and keep top 10
    scores.sort((a, b) => b.score - a.score);
    const top10 = scores.slice(0, 10);

    // Update total score
    totalScore += score;

    // Save to userStats
    await setDoc(userStatsRef, {
      userId: user.uid,
      username: username,
      scores: top10,
      totalScore: totalScore,
      lastUpdated: serverTimestamp()
    }, { merge: true });

    // Also submit to global leaderboard - use a unique ID for each score
    const leaderboardRef = collection(db, "leaderboard");
    await addDoc(leaderboardRef, {
      userId: user.uid,
      username: username,
      score: score,
      timestamp: serverTimestamp()
    });

    console.log("Score submitted successfully:", score);

    // Refresh player stats display
    if (window.loadPlayerStats && typeof window.loadPlayerStats === 'function') {
      window.loadPlayerStats();
    }

    // Refresh global leaderboard display
    if (window.loadLeaderboard && typeof window.loadLeaderboard === 'function') {
      // Reload the currently active leaderboard view
      const activeBtn = document.querySelector('#btn-weekly.active, #btn-monthly.active, #btn-alltime.active');
      if (activeBtn) {
        const period = activeBtn.id.replace('btn-', '');
        window.loadLeaderboard(period);
      } else {
        // default to weekly if no active button found
        window.loadLeaderboard('weekly');
      }
    }

  } catch (error) {
    console.error("Error submitting score:", error);
  }
}

// Expose submitScoreToServer to window
window.submitScoreToServer = submitScoreToServer;

/* 
  INSERTED: DOMContentLoaded wrapper
  - All DOM queries and event listeners are located inside this single block.
  - This is placed immediately after `window.submitScoreToServer = submitScoreToServer;`.
*/
window.addEventListener('DOMContentLoaded', () => {
  // ==== AUTH UI WIRING (DOM-dependent elements) ====
  const authPanel = document.getElementById("auth-panel");
  const authSignedOut = document.getElementById("auth-signed-out");
  const authSignedIn = document.getElementById("auth-signed-in");
  const authUsername = document.getElementById("auth-username");
  const authError = document.getElementById("auth-error");

  const authEmailInput = document.getElementById("auth-email");
  const authPasswordInput = document.getElementById("auth-password");
  const authSignInBtn = document.getElementById("auth-signin-btn");
  const authSignUpBtn = document.getElementById("auth-signup-btn");
  const authSignOutBtn = document.getElementById("auth-signout-btn");
  const authForgotPasswordLink = document.getElementById("auth-forgot-password");

  const signupModal = document.getElementById("signup-modal");
  const signupEmailInput = document.getElementById("signup-email");
  const signupPasswordInput = document.getElementById("signup-password");
  const signupPasswordConfirmInput = document.getElementById("signup-password-confirm");
  const signupUsernameInput = document.getElementById("signup-username");
  const signupError = document.getElementById("signup-error");
  const signupSubmitBtn = document.getElementById("signup-submit-btn");
  const signupCancelBtn = document.getElementById("signup-cancel-btn");

  // Verification overlay elements (optional; safe to be missing)
  const verifyOverlay = document.getElementById("verify-overlay");
  const resendVerificationBtn = document.getElementById("resend-verification-btn");
  const verifyCheckBtn = document.getElementById("verify-check-btn");
  const verifySignoutLink = document.getElementById("verify-signout");
  const verifyStatusEl = document.getElementById("verify-status");

  // Expose simple show/hide helpers if not already provided by another script
  if (typeof window.showVerificationOverlay !== 'function') {
    window.showVerificationOverlay = () => {
      if (verifyOverlay) {
        verifyOverlay.classList.add('open');
        verifyOverlay.setAttribute('aria-hidden', 'false');
      }
    };
  }
  if (typeof window.hideVerificationOverlay !== 'function') {
    window.hideVerificationOverlay = () => {
      if (verifyOverlay) {
        verifyOverlay.classList.remove('open');
        verifyOverlay.setAttribute('aria-hidden', 'true');
      }
    };
  }

  // track the element that opened the signup modal so we can restore focus on close
  let signupModalOpener = null;

  function closeSignupModal() {
    if (!signupModal) return;

    try {
      const active = document.activeElement;

      // If focus is still inside the modal, try to restore it to the opener or a sensible fallback
      if (active && signupModal.contains(active)) {
        const restoreTarget = signupModalOpener
          || document.getElementById('auth-signup-btn')
          || document.getElementById('auth-signin-btn')
          || document.body;

        // Try to move focus to the restore target first
        if (restoreTarget && typeof restoreTarget.focus === 'function') {
          try { restoreTarget.focus(); } catch (e) { /* ignore */ }
        }

        // Give the browser one tick to move focus — if it's still inside the modal, blur it
        setTimeout(() => {
          try {
            const stillFocused = document.activeElement;
            if (stillFocused && signupModal.contains(stillFocused) && typeof stillFocused.blur === 'function') {
              try { stillFocused.blur(); } catch (e) { /* ignore */ }
            }

            // Now safe to hide the modal for assistive tech
            signupModal.classList.remove('open');
            signupModal.setAttribute('aria-hidden', 'true');
            signupModalOpener = null;
          } catch (e) {
            console.warn('closeSignupModal (finalize) error', e);
            // fallback hide if anything goes wrong
            signupModal.classList.remove('open');
            signupModal.setAttribute('aria-hidden', 'true');
            signupModalOpener = null;
          }
        }, 0);

        return;
      }
    } catch (e) {
      console.warn('closeSignupModal focus restore error', e);
    }

    // No focused element in modal — hide immediately
    signupModal.classList.remove('open');
    signupModal.setAttribute('aria-hidden', 'true');
    signupModalOpener = null;
  }

  // Safe helper UI functions
  function showSignedInUI(displayName) {
    if (authSignedOut) authSignedOut.style.display = 'none';
    if (authSignedIn) {
      authSignedIn.style.display = 'block';
      if (authUsername) authUsername.textContent = displayName || '';
    }
  }
  function showSignedOutUI() {
    if (authSignedOut) authSignedOut.style.display = 'block';
    if (authSignedIn) authSignedIn.style.display = 'none';
    if (authUsername) authUsername.textContent = '';
  }

  // Auth state observer (kept inside DOMContentLoaded; uses try/catch)
  onAuthStateChanged(auth, async (user) => {
    try {
      // Safe DOM lookups for player-stats area
      const userStatsTitle = document.getElementById("user-stats-title");
      const userStatsStatus = document.getElementById("user-stats-status");
      const userStatsList = document.getElementById("user-stats-list");
      const userTotalScore = document.getElementById("user-total-score");

      if (user) {
        // User is signed in
        const userDocRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userDocRef);

        let displayName = user.email || "Player";
        if (userDoc.exists()) {
          const userData = userDoc.data() || {};
          displayName = userData.username || user.email || displayName;
        }

        if (authUsername) authUsername.textContent = displayName;
        if (authSignedOut) authSignedOut.style.display = "none";
        if (authSignedIn) authSignedIn.style.display = "block";

        // Update player stats title immediately
        if (userStatsTitle) {
          userStatsTitle.textContent = `${displayName}'s Stats`;
        }

        // If user's email is not verified, show the verification overlay (if present)
        if (user && !user.emailVerified) {
          if (typeof window.showVerificationOverlay === 'function') {
            window.showVerificationOverlay();
            if (verifyStatusEl) verifyStatusEl.textContent = "Your email is unverified. We sent a verification link — check your inbox.";
          }
        } else {
          // Hide overlay if user is verified
          if (typeof window.hideVerificationOverlay === 'function') {
            window.hideVerificationOverlay();
          }
        }

        // Load player stats
        if (window.loadPlayerStats && typeof window.loadPlayerStats === 'function') {
          window.loadPlayerStats();
        }
      } else {
        // User is signed out
        if (authSignedOut) authSignedOut.style.display = "block";
        if (authSignedIn) authSignedIn.style.display = "none";

        // Hide verification overlay when signed out
        if (typeof window.hideVerificationOverlay === 'function') {
          window.hideVerificationOverlay();
        }

        // Clear player stats
        if (userStatsTitle) userStatsTitle.textContent = "Player Stats";
        if (userStatsStatus) {
          userStatsStatus.textContent = "Sign in to see your stats.";
          userStatsStatus.style.display = "block";
        }
        if (userStatsList) userStatsList.innerHTML = "";
        if (userTotalScore) userTotalScore.textContent = "Total Score: 0";
      }
    } catch (err) {
      console.error("Auth state observer error:", err);
    }
  });

  // Sign In button
  if (authSignInBtn) {
    authSignInBtn.addEventListener("click", async () => {
      const identifier = authEmailInput?.value?.trim();
      const password = authPasswordInput?.value;
      if (authError) { authError.style.color = '#c00'; authError.textContent = ""; }

      if (!identifier || !password) {
        if (authError) authError.textContent = "Please enter email/username and password";
        return;
      }

      try {
        const email = await resolveIdentifierToEmail(identifier);
        await signInWithEmailAndPassword(auth, email, password);
        if (authEmailInput) authEmailInput.value = "";
        if (authPasswordInput) authPasswordInput.value = "";
      } catch (error) {
        console.error("Sign in error:", error);
        if (authError) authError.textContent = error.message || "Sign in failed";
      }
    });
  }

  // Allow Enter/Return key to trigger sign-in
  const emailInput = authEmailInput;
  const passwordInput = authPasswordInput;
  const signInButton = authSignInBtn;

  const handleSignInEnter = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      signInButton?.click();
    }
  };

  if (emailInput) emailInput.addEventListener('keydown', handleSignInEnter);
  if (passwordInput) passwordInput.addEventListener('keydown', handleSignInEnter);

  // Sign Up button - opens modal
  if (authSignUpBtn) {
    authSignUpBtn.addEventListener("click", () => {
      // remember opener so we can return focus later
      signupModalOpener = document.activeElement || null;

      if (signupModal) {
        signupModal.classList.add("open");
        signupModal.setAttribute("aria-hidden", "false");
        // move focus into the modal (best practice)
        signupEmailInput?.focus();
      }
      if (signupError) signupError.textContent = "";
    });
  }

  // Cancel signup
  if (signupCancelBtn) {
    signupCancelBtn.addEventListener("click", () => {
      closeSignupModal();

      if (signupEmailInput) signupEmailInput.value = "";
      if (signupPasswordInput) signupPasswordInput.value = "";
      if (signupPasswordConfirmInput) signupPasswordConfirmInput.value = "";
      if (signupUsernameInput) signupUsernameInput.value = "";
      if (signupError) signupError.textContent = "";
    });
  }

  // Submit signup
  if (signupSubmitBtn) {
    signupSubmitBtn.addEventListener("click", async () => {
      const email = signupEmailInput?.value?.trim();
      const password = signupPasswordInput?.value;
      const passwordConfirm = signupPasswordConfirmInput?.value;
      const username = signupUsernameInput?.value?.trim();
      if (signupError) signupError.textContent = "";

      // Basic validation
      if (!email || !password || !passwordConfirm || !username) {
        if (signupError) signupError.textContent = "All fields are required";
        return;
      }

      if (password !== passwordConfirm) {
        if (signupError) signupError.textContent = "Passwords do not match";
        return;
      }

      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        if (signupError) signupError.textContent = "Username can only contain letters, numbers, and underscores";
        return;
      }

      try {
        // Check if username already exists (fast doc read)
        const unameKey = usernameKeyFor(username);
        const usernameRef = doc(db, "usernames", unameKey);
        const usernameSnap = await getDoc(usernameRef);

        if (usernameSnap.exists()) {
          if (signupError) signupError.textContent = "Username already taken";
          return;
        }

        // Outer try/catch handles auth + waiting for state
        try {
          // Create user (Auth)
          const userCredential = await createUserWithEmailAndPassword(auth, email, password);
          const user = userCredential.user;
          console.log('SignUp succeeded, user uid:', user?.uid);

          // Wait for auth state to confirm sign-in
          await new Promise((resolve) => {
            const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
              if (currentUser && currentUser.uid === user.uid) {
                unsubscribe();
                resolve();
              }
            });
          });

          // Small delay to ensure token readiness
          await new Promise(r => setTimeout(r, 500));

          // Force refresh ID token before Firestore writes (best effort)
          if (auth.currentUser) {
            try {
              // Use getIdToken import or user.getIdToken; prefer the method on the user object
              if (typeof auth.currentUser.getIdToken === 'function') {
                await auth.currentUser.getIdToken(true);
              } else {
                // fallback to imported getIdToken
                await getIdToken(auth.currentUser, true);
              }
            } catch (tErr) {
              console.warn('getIdToken error (non-fatal):', tErr);
            }
          }

          // Now perform an atomic transaction to create /usernames, users, userStats
          try {
            await runTransaction(db, async (tx) => {
              const unameKeyTx = usernameKeyFor(username);
              const unRef = doc(db, "usernames", unameKeyTx);
              const unSnapTx = await tx.get(unRef);
              if (unSnapTx.exists()) {
                throw new Error('Username already taken (race)');
              }

              // Prepare refs
              const userRef = doc(db, "users", user.uid);
              const userStatsRef = doc(db, "userStats", user.uid);

              // Set username mapping (store email + userId)
              tx.set(unRef, {
                userId: user.uid,
                username: username,
                email: email,
                createdAt: serverTimestamp()
              });

              // Set users doc
              tx.set(userRef, {
                email: email,
                username: username,
                createdAt: serverTimestamp()
              });

              // Initialize userStats doc
              tx.set(userStatsRef, {
                userId: user.uid,
                username: username,
                scores: [],
                totalScore: 0,
                lastUpdated: serverTimestamp()
              });
            });

            // Success: close modal (restore focus) and clear inputs
            closeSignupModal();

            if (signupEmailInput) signupEmailInput.value = "";
            if (signupPasswordInput) signupPasswordInput.value = "";
            if (signupPasswordConfirmInput) signupPasswordConfirmInput.value = "";
            if (signupUsernameInput) signupUsernameInput.value = "";

            console.log('Signup transaction completed for', user.uid);

            // Send email verification AFTER the transaction has succeeded.
            // Use auth.currentUser if available (should be the same user), else fallback to the user returned earlier.
            try {
              const userForVerification = auth.currentUser || user;

              // Optionally prevent rapid send (signup path is generally first send; we still record the timestamp)
              await sendEmailVerification(userForVerification);

              // Record cooldown timestamp to prevent immediate resends
              try {
                localStorage.setItem('lastVerificationSentAt', String(Date.now()));
              } catch (e) {
                // ignore localStorage failures (e.g., in strict privacy modes)
                console.warn('Could not persist verification timestamp:', e);
              }

              if (signupError) {
                signupError.style.color = "#0a8a0a";
                signupError.textContent = "Verification email sent (may be in spam folder).";
                setTimeout(() => {
                  signupError.textContent = "";
                  signupError.style.color = "#c00";
                }, 5000);
              }
            } catch (verErr) {
              console.error("Failed to send verification email:", verErr);
              if (signupError) signupError.textContent = "Unable to send verification email: " + (verErr.message || verErr);
            }

          } catch (txErr) {
            console.error("Signup transaction error:", txErr);

            // If the transaction failed due to username taken after auth creation,
            // attempt to delete the newly-created auth user to avoid orphaned account.
            try {
              if (auth.currentUser && auth.currentUser.uid === user.uid) {
                // Attempt delete
                await deleteUser(auth.currentUser);
                console.warn('Deleted newly-created auth user due to transaction failure.');
              }
            } catch (delErr) {
              console.warn('Failed to delete newly-created auth user after tx failure:', delErr);
            }

            if (signupError) signupError.textContent = txErr.message || "Sign up failed";
          }

        } catch (authError) {
          // Errors creating account or waiting for auth state
          console.error("Sign up error:", authError);
          if (signupError) signupError.textContent = authError.message || "Sign up failed";
        }

      } catch (outerError) {
        // Errors checking username availability or other unexpected issues
        console.error("Sign up flow error:", outerError);
        if (signupError) signupError.textContent = outerError.message || "Sign up failed";
      }
    });
  }

  // Optional: reusable resend verification helper + attach to a button if present
  async function resendVerificationEmail() {
    try {
      // Cooldown check
      try {
        const lastStr = localStorage.getItem('lastVerificationSentAt');
        const last = lastStr ? parseInt(lastStr, 10) : 0;
        const now = Date.now();
        if (last && (now - last) < VERIFICATION_RESEND_COOLDOWN_MS) {
          const secs = Math.ceil((VERIFICATION_RESEND_COOLDOWN_MS - (now - last)) / 1000);
          if (authError) {
            authError.style.color = '#c00';
            authError.textContent = `Please wait ${secs}s before requesting another verification email.`;
            setTimeout(() => {
              authError.textContent = "";
              authError.style.color = "#c00";
            }, 3000);
          }
          if (verifyStatusEl) {
            verifyStatusEl.textContent = `Please wait ${secs}s before requesting another verification email.`;
          }
          return;
        }
      } catch (e) {
        // ignore localStorage parse errors and continue
        console.warn('Verification cooldown check failed:', e);
      }

      const u = auth.currentUser;
      if (!u) {
        if (authError) authError.textContent = "No signed-in user to verify.";
        if (verifyStatusEl) verifyStatusEl.textContent = "No signed-in user to verify.";
        return;
      }
      if (u.emailVerified) {
        if (authError) {
          authError.style.color = "#0a8a0a";
          authError.textContent = "Your email is already verified.";
          setTimeout(() => {
            authError.textContent = "";
            authError.style.color = "#c00";
          }, 3000);
        }
        if (verifyStatusEl) {
          verifyStatusEl.textContent = "Your email is already verified.";
          setTimeout(() => { verifyStatusEl.textContent = ""; }, 3000);
        }
        return;
      }

      if (verifyStatusEl) {
        verifyStatusEl.textContent = "Sending verification email...";
      }

      await sendEmailVerification(u);

      // record the timestamp of the last successful send
      try {
        localStorage.setItem('lastVerificationSentAt', String(Date.now()));
      } catch (e) {
        console.warn('Could not persist verification timestamp:', e);
      }

      if (authError) {
        authError.style.color = "#0a8a0a";
        authError.textContent = "Verification email sent (may be in spam folder).";
        setTimeout(() => {
          authError.textContent = "";
          authError.style.color = "#c00";
        }, 5000);
      }
      if (verifyStatusEl) {
        verifyStatusEl.textContent = "Verification email sent. Check your inbox.";
        setTimeout(() => { verifyStatusEl.textContent = ""; }, 5000);
      }
    } catch (err) {
      console.error("Resend verification failed:", err);
      if (authError) authError.textContent = "Unable to resend verification: " + (err.message || err);
      if (verifyStatusEl) verifyStatusEl.textContent = "Unable to resend verification: " + (err.message || err);
    }
  }

  // If you have a "Resend verification" button element referenced by `resendVerificationBtn`,
  // this will attach the handler. If you don't have such an element, this does nothing.
  if (typeof resendVerificationBtn !== "undefined" && resendVerificationBtn) {
    resendVerificationBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      // disable the button briefly (UI nicety)
      try {
        resendVerificationBtn.disabled = true;
      } catch (e) { /* ignore */ }
      await resendVerificationEmail();
      // re-enable after cooldown (local check will enforce)
      setTimeout(() => {
        try { resendVerificationBtn.disabled = false; } catch (e) { /* ignore */ }
      }, 1000);
    });
  }

 // Attach overlay "I've verified — check now" and signout handlers idempotently
  if (!window.__verify_overlay_handlers_attached) {
    window.__verify_overlay_handlers_attached = true;

    if (verifyCheckBtn) {
      verifyCheckBtn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        if (verifyStatusEl) verifyStatusEl.textContent = "Checking verification status...";
        try {
          const current = auth.currentUser;
          if (current && typeof current.reload === 'function') {
            await current.reload();
          }
          const fresh = auth.currentUser || current;
          if (fresh && fresh.emailVerified) {
            if (verifyStatusEl) verifyStatusEl.textContent = "Email verified — thank you!";
            if (typeof window.hideVerificationOverlay === 'function') {
              window.hideVerificationOverlay();
            }
            // trigger post-verification updates
            if (typeof window.loadPlayerStats === 'function') window.loadPlayerStats();
            if (typeof window.loadLeaderboard === 'function') window.loadLeaderboard('weekly');
          } else {
            if (verifyStatusEl) verifyStatusEl.textContent = "Email still unverified. Please check your inbox.";
          }
        } catch (err) {
          console.error('Verification check failed', err);
          if (verifyStatusEl) verifyStatusEl.textContent = "Error checking verification. Try again.";
        }
      });
    }

    if (verifySignoutLink) {
      console.log('[verify overlay] attaching sign-out handler to', verifySignoutLink);
      verifySignoutLink.addEventListener('click', async (ev) => {
        console.log('[verify overlay] sign-out clicked');
        ev.preventDefault();
        if (verifyStatusEl) verifyStatusEl.textContent = "Signing out...";
        try {
          await signOut(auth);

          // Hide overlay & show signed-out UI immediately (onAuthStateChanged will also handle it)
          if (typeof window.hideVerificationOverlay === 'function') {
            try { window.hideVerificationOverlay(); } catch (e) { /* ignore */ }
          }
          try { showSignedOutUI(); } catch (e) { /* ignore */ }

          if (verifyStatusEl) verifyStatusEl.textContent = "Signed out.";
        } catch (err) {
          console.error('Sign out from verify overlay failed', err);
          if (verifyStatusEl) verifyStatusEl.textContent = "Sign out failed. Try again.";
        }
      });
    } else {
      console.log('[verify overlay] verifySignoutLink element not found');
    }
  }

 // Sign Out button (main auth UI)
  if (authSignOutBtn) {
    authSignOutBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      try {
        await signOut(auth);

        // Hide verification overlay if visible
        if (typeof window.hideVerificationOverlay === "function") {
          try { window.hideVerificationOverlay(); } catch (e) { /* ignore */ }
        }

        // Update UI to signed-out state
        try {
          if (typeof showSignedOutUI === "function") {
            showSignedOutUI();
          }
        } catch (e) {
          console.error("Error updating UI after sign out", e);
        }
      } catch (err) {
        console.error("Sign out failed", err);
      }
    });
  }

}); // end DOMContentLoaded