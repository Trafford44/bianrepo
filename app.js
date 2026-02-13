import { handleOAuthRedirect, bindLoginButton } from "./auth.js";
import { initResizers, renderSidebar, bindEditorEvents,  bindPaneFocusEvents, updateLoginIndicator } from "./ui.js";

async function init() {
    await handleOAuthRedirect();
    bindLoginButton();
    updateLoginIndicator();
    renderSidebar();
    initResizers();
    bindEditorEvents();
    bindPaneFocusEvents();
}

init();

