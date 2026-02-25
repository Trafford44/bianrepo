import { handleOAuthRedirect, bindLoginButton } from "./auth.js";
import { initResizers, renderSidebar, bindEditorEvents,  bindPaneFocusEvents, updateLoginIndicator, setSubjects } from "./ui.js";

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

