// script.js - Leaderboard and Player Stats functionality
// Uses Firestore helpers exported from firebase-client.js on window.fbFs

// ---------- Shared helpers ----------

function getDb() {
  const db = window.fbDb;
  if (!db) {
    throw new Error("Firestore (window.fbDb) not initialized. " +
      "Make sure firebase-client.js runs before script.js.");
  }
  return db;
}

function getAuthInstance() {
  const auth = window.fbAuth;
  if (!auth) {
    throw new Error("Auth (window.fbAuth) not initialized. " +
      "Make sure firebase-client.js runs before script.js.");
  }
  return auth;
}

function getFs() {
  const fs = window.fbFs;
  if (!fs) {
    throw new Error("Firestore helpers (window.fbFs) not initialized. " +
      "Make sure firebase-client.js sets window.fbFs.");
  }
  return fs;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (s) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return map[s] || s;
  });
}

// ---------- Initial wiring ----------

window.addEventListener("DOMContentLoaded", () => {
  console.log("script.js loaded");

  // If firebase already initialized, run immediately
  if (window.fbDb && window.fbAuth && window.fbFs) {
    try {
      loadLeaderboard("weekly");
    } catch (e) {
      console.error("loadLeaderboard immediate call failed:", e);
    }
    return;
  }

  // Otherwise wait for firebase-ready from firebase-client.js
  const onReady = () => {
    window.removeEventListener("firebase-ready", onReady);
    try {
      loadLeaderboard("weekly");
    } catch (err) {
      console.error("loadLeaderboard after firebase-ready failed:", err);
    }
  };
  window.addEventListener("firebase-ready", onReady);
});

// ---------- LEADERBOARD ----------

async function loadLeaderboard(period = "weekly") {
  console.log("loadLeaderboard started for period:", period);

  const leaderboardList = document.getElementById("leaderboard-list");
  const btnWeekly  = document.getElementById("btn-weekly");
  const btnMonthly = document.getElementById("btn-monthly");
  const btnAlltime = document.getElementById("btn-alltime");

  if (!leaderboardList) {
    console.warn("No #leaderboard-list element found; aborting loadLeaderboard.");
    return;
  }

  // Active button styling
  [btnWeekly, btnMonthly, btnAlltime].forEach(btn =>
    btn?.classList.remove("active")
  );
  if (period === "weekly")       btnWeekly?.classList.add("active");
  else if (period === "monthly") btnMonthly?.classList.add("active");
  else if (period === "alltime") btnAlltime?.classList.add("active");

  leaderboardList.innerHTML =
    '<li style="text-align:center; color:#888;">Loading...</li>';

  try {
    const db = getDb();
    const { collection, query, where, orderBy, limit, getDocs, Timestamp } = getFs();

    const leaderboardRef = collection(db, "leaderboard");
    let q;
    let fetchLimit = 10;

    if (period === "weekly" || period === "monthly") {
      const cutoff = new Date();
      if (period === "weekly") cutoff.setDate(cutoff.getDate() - 7);
      else                      cutoff.setMonth(cutoff.getMonth() - 1);

      fetchLimit = 100;

      q = query(
        leaderboardRef,
        where("timestamp", ">=", Timestamp.fromDate(cutoff)),
        orderBy("timestamp", "desc"),
        limit(fetchLimit)
      );
    } else {
      // all‑time
      q = query(
        leaderboardRef,
        orderBy("score", "desc"),
        orderBy("timestamp", "desc"),
        limit(10)
      );
    }

    const snapshot = await getDocs(q);

    if (!snapshot || snapshot.empty) {
      leaderboardList.innerHTML =
        '<li style="text-align:center; color:#888;">No scores yet</li>';
      return;
    }

    const entries = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data) entries.push(data);
    });

    if (period === "weekly" || period === "monthly") {
      entries.sort((a, b) => {
        const scoreA = a.score || 0;
        const scoreB = b.score || 0;
        if (scoreB !== scoreA) return scoreB - scoreA;

        const timeA =
          a.timestamp && typeof a.timestamp.toMillis === "function"
            ? a.timestamp.toMillis()
            : 0;
        const timeB =
          b.timestamp && typeof b.timestamp.toMillis === "function"
            ? b.timestamp.toMillis()
            : 0;
        return timeB - timeA;
      });
      if (entries.length > 10) entries.splice(10);
    }

    leaderboardList.innerHTML = "";
    entries.forEach((data, index) => {
      const li = document.createElement("li");
      li.className = "leaderboard-row";
      li.style.display = "flex";
      li.style.justifyContent = "space-between";
      li.style.alignItems = "center";
      li.style.padding = "8px 12px";
      li.innerHTML = `
        <span style="flex:1; text-align:left;">${index + 1}. ${escapeHtml(
          data.username || "Anonymous"
        )}</span>
        <span style="width:80px; text-align:right; font-weight:700;">${Number(
          data.score || 0
        )}</span>
      `;
      leaderboardList.appendChild(li);
    });

    console.log("loadLeaderboard completed");
  } catch (error) {
    console.error("Error loading leaderboard:", error);
    leaderboardList.innerHTML =
      '<li style="text-align:center; color:#c00;">Error loading leaderboard</li>';
  }
}

window.loadLeaderboard = loadLeaderboard;

// ---------- PLAYER STATS ----------

async function loadPlayerStats() {
  let auth, db, fs;
  try {
    auth = getAuthInstance();
    db   = getDb();
    fs   = getFs();
  } catch (e) {
    console.error("Firebase not initialized for loadPlayerStats:", e);
    const userStatsStatus = document.getElementById("user-stats-status");
    if (userStatsStatus) {
      userStatsStatus.textContent = "Firebase not initialized.";
      userStatsStatus.style.display = "block";
    }
    return;
  }

  const { doc, getDoc } = fs;

  const userStatsTitle  = document.getElementById("user-stats-title");
  const userStatsStatus = document.getElementById("user-stats-status");
  const userStatsList   = document.getElementById("user-stats-list");
  const userTotalScore  = document.getElementById("user-total-score");

  const user = auth.currentUser;

  if (!user) {
    if (userStatsTitle) userStatsTitle.textContent = "Player Stats";
    if (userStatsStatus) {
      userStatsStatus.textContent = "Sign in to see your stats.";
      userStatsStatus.style.display = "block";
    }
    if (userStatsList)  userStatsList.innerHTML = "";
    if (userTotalScore) userTotalScore.textContent = "Total Score: 0";
    return;
  }

  try {
    // user doc
    const userDocRef = doc(db, "users", user.uid);
    const userDoc    = await getDoc(userDocRef);

    let username = user.email || "Player";
    if (userDoc && userDoc.exists()) {
      const userData = userDoc.data();
      username = userData.username || user.email || username;
    }

    if (userStatsTitle) {
      userStatsTitle.textContent = `${username}'s Top Scores`;
    }

    // stats doc
    const userStatsRef = doc(db, "userStats", user.uid);
    const userStatsDoc = await getDoc(userStatsRef);

    if (!userStatsDoc || !userStatsDoc.exists()) {
      if (userStatsStatus) {
        userStatsStatus.textContent = "No games played yet.";
        userStatsStatus.style.display = "block";
      }
      if (userStatsList)  userStatsList.innerHTML = "";
      if (userTotalScore) userTotalScore.textContent = "Total Score: 0";
      return;
    }

    const statsData  = userStatsDoc.data();
    const scores     = Array.isArray(statsData.scores) ? statsData.scores : [];
    const totalScore = Number(statsData.totalScore || 0);

    if (userStatsStatus) userStatsStatus.style.display = "none";

    if (userStatsList) {
      userStatsList.innerHTML = "";

      if (scores.length === 0) {
        const li = document.createElement("li");
        li.style.textAlign = "center";
        li.style.color = "#888";
        li.textContent = "No scores yet";
        userStatsList.appendChild(li);
      } else {
        scores.forEach((scoreEntry, index) => {
          const li = document.createElement("li");
          li.style.display = "flex";
          li.style.justifyContent = "space-between";
          li.style.alignItems = "center";
          li.style.padding = "6px 10px";

          const dateText = `${scoreEntry.date || ""} ${
            scoreEntry.time || ""
          }`.trim();

          li.innerHTML = `
            <span style="flex:1; text-align:left;">${index + 1}. ${Number(
            scoreEntry.score || 0
          )}</span>
            <span style="width:140px; text-align:right; font-size:11px; color:#666;">${escapeHtml(
              dateText
            )}</span>
          `;
          userStatsList.appendChild(li);
        });
      }
    }

    if (userTotalScore) {
      const gamesCount = scores.length;
      const avgScore   = gamesCount > 0 ? totalScore / gamesCount : 0;
      const avgDisplay = Number.isInteger(avgScore)
        ? avgScore.toString()
        : avgScore.toFixed(2);

      userTotalScore.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:16px; font-weight:700;">
          <div style="flex:1; text-align:left;  font-size:14px;">Games: ${gamesCount}</div>
          <div style="flex:1; text-align:center; font-size:14px;">Total Score: ${totalScore}</div>
          <div style="flex:1; text-align:right; font-size:14px;">Avg. Score: ${avgDisplay}</div>
        </div>
      `;
    }
  } catch (error) {
    console.error("Error loading player stats:", error);
    if (userStatsStatus) {
      userStatsStatus.textContent = "Error loading stats.";
      userStatsStatus.style.display = "block";
    }
  }
}

window.loadPlayerStats = loadPlayerStats;