import { handleOAuthRedirect, bindLoginButton } from "./auth.js";
import { initResizers, renderSidebar, bindEditorEvents,  bindPaneFocusEvents, updateLoginIndicator } from "./ui.js";
import { setSubjects } from "./ui.js";

// TEMP: allow setting gist_id via URL
(function () {
    const params = new URLSearchParams(window.location.search);
    const gist = params.get("set_gist");
    if (gist) {
        localStorage.setItem("gist_id", gist);
        console.log("Gist ID set via URL:", gist);
    }
})();

async function init() {
    await handleOAuthRedirect();
    bindLoginButton();
    updateLoginIndicator();

    // NEW: load workspace from localStorage
    const stored = JSON.parse(localStorage.getItem("kb_data"));
    if (Array.isArray(stored)) {
        setSubjects(stored);
    }

    renderSidebar();
    initResizers();
    bindEditorEvents();
    bindPaneFocusEvents();
}

init();

