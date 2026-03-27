import { handleOAuthRedirect, bindLoginButton, getToken, getGistId } from "./auth.js";
import { initResizers, renderSidebar, bindEditorEvents, bindPaneFocusEvents, updateLoginIndicator, loadFile } from "./ui.js";
import { loadState } from "./workspace.js";
import { setupMarked } from "./md-editor.js";
import { startSyncLoop, bindVisibilityEvents, bindActivityEvents, reconcileLocalAndCloud } from "./sync.js";
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
    logger.debug("auth: init", `hasOAuthCode(): ${has}`, `URL: ${window.location.href}`);
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
        const local = loadState(); // <-- capture the return value

        // ⭐ NEW: Reconcile local vs cloud BEFORE starting sync loop
        logger.debug("app: init()", "Running sync.reconcileLocalAndCloud()");
        await reconcileLocalAndCloud(local);

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

        // ------------------------------------------------------------
        // 9. Browser history: handle Back/Forward navigation
        // ------------------------------------------------------------
        logger.debug("app: init()", "Adding popState listener");
        window.addEventListener("popstate", (event) => {
            if (event.state && event.state.fileId) {
                logger.debug("app: popstate", "Navigating to fileId:", event.state.fileId);
                loadFile(event.state.fileId);
            } else {
                logger.debug("app: popstate", "event.state & event.state.fileId not found");
            }
        });

    } catch (err) {
        console.log("app: init()", "Unhandled error in init()", err);
    }
}


init();
