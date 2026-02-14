import { updateLoginIndicator } from "./ui.js";
const GITHUB_CLIENT_ID = "Ov23likIpQOhuNITyTEh";
const WORKER_URL = "https://round-rain-473a.richard-191.workers.dev";

export function getToken() {
    return localStorage.getItem("github_token");
}

export function getGistId() {
    const raw = localStorage.getItem("gist_id");
    return raw && raw !== "undefined" ? raw : null;
}

export function setGistId(id) {
    localStorage.setItem("gist_id", id);
}


export function requireLogin() {
    const token = getToken();
    if (!token) {
        updateLoginIndicator();
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

