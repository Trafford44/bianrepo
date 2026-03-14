import { handleOAuthRedirect, bindLoginButton, getToken, getGistId } from "./auth.js";
import { initResizers, renderSidebar, bindEditorEvents, bindPaneFocusEvents, updateLoginIndicator } from "./ui.js";
import { loadState } from "./workspace.js";
import { setupMarked } from "./md-editor.js";
import { startSyncLoop, bindVisibilityEvents, bindActivityEvents } from "./sync.js";
import { logger } from "./logger.js";

/* it's critical that the order remains as below
This ensures:
The sync loop starts after login handling
The sync loop starts after the workspace is loaded
The sync loop starts before the user interacts with the UI
The sync loop starts before any file is opened
*/

logger.debug("app", "app.js loaded from:", import.meta.url);

export function hasOAuthCode() {
    const has = window.location.search.includes("code=");
    logger.debug("auth", `hasOAuthCode(): ${has}`, `URL: ${window.location.href}`);
    return has;
}

async function init() {
    try {
        // 1. Markdown renderer must be ready before any preview happens
        logger.debug("md-editor", "setupMarked()");
        setupMarked();

        // 2. Handle OAuth redirect ONLY if we actually have ?code=
        if (hasOAuthCode()) {
            logger.debug("auth", "Detected OAuth code, running handleOAuthRedirect()");
            await handleOAuthRedirect();
        }

        // 3. Load workspace from localStorage (new model)
        logger.debug("app: init()", "Running workspace.loadState()");
        loadState(); // loads kb_workspace into the recursive tree

        // 3.5 Re-check the token immediately after wake
        logger.debug("app: init()", "Running sync.bindVisibilityEvents()");
        bindVisibilityEvents();
        logger.debug("app: init()", "Running sync.bindActivityEvents()");
        bindActivityEvents();

        // 4. Start sync loop ONLY if token + gistId exist
        const token = getToken();
        const gistId = getGistId();
        if (token && gistId) {
            logger.debug("app: init()", "Starting sync loop (token + gistId present)");
            startSyncLoop();
        } else {
            logger.debug("app: init()", "Not starting sync loop — missing token or gistId");

            // ⭐ NEW: ensure login button is visible
            const editorActions = document.getElementById("editor-actions");
            if (editorActions) {
                editorActions.classList.remove("hidden");
            }            
        }

        // 5. Render UI
        logger.debug("app: init()", "Running ui.renderSidebar()");
        renderSidebar();

        // 6. Bind login button AFTER sidebar is rendered
        logger.debug("app: init()", "Running auth.bindLoginButton()");
        bindLoginButton();

        // 7. Update login indicator AFTER login button exists
        logger.debug("app: init()", "Running ui.updateLoginIndicator()");
        updateLoginIndicator();

        // 8. Bind UI interactions
        logger.debug("app: init()", "Running ui.initResizers()");
        initResizers();
        logger.debug("app: init()", "Running ui.bindEditorEvents()");
        bindEditorEvents();
        logger.debug("app: init()", "Running ui.bindPaneFocusEvents()");
        bindPaneFocusEvents();

    } catch (err) {
        logger.error("app: init()", "Unhandled error in init()", err);
    }
}

init();
