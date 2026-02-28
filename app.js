import { handleOAuthRedirect, bindLoginButton } from "./auth.js";
import { initResizers, renderSidebar, bindEditorEvents, bindPaneFocusEvents, updateLoginIndicator, setSubjects } from "./ui.js";
import { setupMarked } from "./md-editor.js";
import { startSyncLoop } from "./sync.js";

/* it's critical that the order remains as below
This ensures:
The sync loop starts after login handling
The sync loop starts after the workspace is loaded
The sync loop starts before the user interacts with the UI
The sync loop starts before any file is opened
*/
async function init() {
    // 1. Markdown renderer must be ready before any preview happens
    setupMarked();

    // 2. Handle OAuth redirect (may store token)
    await handleOAuthRedirect();

    // 3. Load workspace from localStorage
    const stored = JSON.parse(localStorage.getItem("kb_data"));
    if (Array.isArray(stored)) {
        setSubjects(stored);
    }

    // 4. Start sync loop AFTER token is known
    startSyncLoop();

    // 5. Render UI
    renderSidebar();

    // 6. Bind login button AFTER sidebar is rendered
    bindLoginButton();

    // 7. Update login indicator AFTER login button exists
    updateLoginIndicator();

    // 8. Bind UI interactions
    initResizers();
    bindEditorEvents();
    bindPaneFocusEvents();
}

init();
