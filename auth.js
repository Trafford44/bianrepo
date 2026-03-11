
/**
 * auth.js
 * ----------
 * Handles all GitHub authentication and token management for the app.
 *
 * This module is responsible for initiating the GitHub OAuth login flow,
 * receiving the redirect callback, extracting and storing the access token,
 * and exposing helpers that other modules use to verify authentication state.
 *
 * Responsibilities:
 * - Start the OAuth login process using the configured GitHub OAuth App.
 * - Handle the redirect callback and extract the temporary `code` parameter.
 * - Exchange the `code` for an access token via the Cloudflare Worker proxy.
 * - Store and retrieve the GitHub token in localStorage.
 * - Expose requireLogin() to guard actions that need authentication.
 * - Expose getToken(), clearToken(), getGistId(), setGistId() helpers.
 * - Update the UI login indicator via updateLoginIndicator() from ui.js.
 *
 * This module contains **no sync logic** and **no workspace logic**.
 * It focuses solely on authentication state and token lifecycle.
 *
 * Exported functions:
 * - beginLogin()          → Starts the OAuth login flow.
 * - handleOAuthRedirect() → Processes the redirect and stores the token.
 * - requireLogin()        → Ensures the user is authenticated before actions.
 * - getToken()            → Returns the stored GitHub token.
 * - clearToken()          → Logs the user out.
 * - getGistId() / setGistId() → Manage the active Gist reference.
 *
 * Dependencies:
 * - updateLoginIndicator() from ui.js for visual feedback.
 * - Cloudflare Worker endpoint for secure token exchange.
 *
 * The goal of this module is to keep authentication isolated, predictable,
 * and easy to maintain without mixing UI, sync, or editor concerns.
 */
import { updateLoginIndicator, showNotification } from "./ui.js";
import { runSyncCheck } from "./sync.js";
import { deviceId } from "./device.js";

const GITHUB_CLIENT_ID = "Ov23likIpQOhuNITyTEh";
const WORKER_URL = "https://round-rain-473a.richard-191.workers.dev";

export function getToken() {
    const t = localStorage.getItem("github_token");
    
    if (!t || t === "undefined" || t === "null") return null;
    return t;
}

export function getGistId() {
    const raw = localStorage.getItem("gist_id");
    if (!raw || raw === "undefined" || raw === "null") return null;
    return raw;
}

export function setGistId(id) {
    localStorage.setItem("gist_id", id);
}


export function requireLogin() {
    const token = getToken();
    if (!token) {
        updateLoginIndicator();
        showNotification("warning", "Please sign in to Cloud first");
        return false;
    }
    return true;
}


export function bindLoginButton() {
    const btn = document.getElementById("github-login");
    if (!btn) return;

    btn.addEventListener("click", () => {

        // 1. Check for ?redirect=... in the URL (dev override)
        const redirectOverride = new URLSearchParams(window.location.search).get("redirect");

        // 2. Use override if present, otherwise use the current page
        const redirectUri = redirectOverride
            ? redirectOverride
            : window.location.origin + window.location.pathname;

        // 3. Build GitHub OAuth URL
        const url =
            `https://github.com/login/oauth/authorize` +
            `?client_id=${GITHUB_CLIENT_ID}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&scope=gist`;

        // 4. Redirect to GitHub
        window.location.href = url;
    });
}


export async function handleOAuthRedirect() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    // if (!code) return;

    
    // DEBUG: Let's see if the function even sees the URL
    // alert("URL Search: " + window.location.search); 

    if (!code) {
        // If we are on the callback page but have no code, that's the bug.
        if (window.location.pathname.includes("callback")) {
             alert("On callback page but NO CODE found in URL!");
        }
        return;
    }
    
    alert("Code found: " + code + ". Attempting worker fetch...");
    // ... rest of the fetch code


    
    try {
        const res = await fetch(WORKER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code })
        });

        // debug
        alert("Worker responded with status: " + res.status);
        
        // Add this check!
        if (!res.ok) {
            const errBody = await res.text();
            alert("Worker Server Error: " + errBody);
            return;
        }
        const data = await res.json();

        if (data.access_token) {
            localStorage.setItem("github_token", data.access_token);        
        //    window.history.replaceState({}, "", window.location.origin + window.location.pathname);
            updateLoginIndicator();
            await runSyncCheck("login");
        } else {
            // IF IT FAILS: This will tell us why on the phone screen
            alert("OAuth Error: " + (data.error || "No token received"));
        }
    } catch (err) {
        // IF THE NETWORK FAILS: (CORS or Worker down)
        alert("Fetch Error: " + err.message);
    }
}


//to be called on logout or if token is invalid/expired to clear the stored token and update the UI accordingly
//TO be wired up to the 'Logout' button in the UI and also called if we detect an auth error during API calls to ensure we clear out invalid tokens
// Gemini:  Without a clearToken function, the only way a user can "log out" is by manually clearing their browser cache or being a wizard in the DevTools console. If you ever want to switch GitHub accounts or troubleshoot a borked session, you'll be stuck in that login loop again.
export function clearToken() {
    // Remove the global token we just standardized
    localStorage.removeItem("github_token");
    
    // Optional: If you want to clear the specific Gist too on logout
    // localStorage.removeItem("gist_id");

    console.log("Logged out: Token cleared.");
    
    // Update the UI so the 'Reconnect' button shows up immediately
    updateLoginIndicator();
    
    // Optional: Redirect to home or refresh to reset app state
    // window.location.href = window.location.origin + window.location.pathname;
}
