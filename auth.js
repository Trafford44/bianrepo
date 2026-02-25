
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
        showNotification("warning", "Please sign in with GitHub first");
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
    if (!code) return;

    const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
    });

    const data = await res.json();

    if (data.access_token) {
        localStorage.setItem("github_token", data.access_token);
        window.history.replaceState({}, "", window.location.pathname);
        console.log("GitHub login successful");
        updateLoginIndicator();
    } else {
        console.error("OAuth error:", data);
    }
}

