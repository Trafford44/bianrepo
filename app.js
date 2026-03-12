import { handleOAuthRedirect, bindLoginButton } from "./auth.js";
import { initResizers, renderSidebar, bindEditorEvents, bindPaneFocusEvents, updateLoginIndicator} from "./ui.js";
import { loadState } from "./workspace.js";    
import { setupMarked } from "./md-editor.js";
import { startSyncLoop, bindVisibilityEvents, bindActivityEvents, disconnectFromGitHub } from "./sync.js";

/* it's critical that the order remains as below
This ensures:
The sync loop starts after login handling
The sync loop starts after the workspace is loaded
The sync loop starts before the user interacts with the UI
The sync loop starts before any file is opened
*/


const token = localStorage.getItem("github_token");

async function init() {

// TEMPORARY DEBUG

alert("DEBUG: Token is " + (token ? "FOUND" : "MISSING"));
if (token) {
    document.body.style.border = "10px solid green";
} else {
    document.body.style.border = "10px solid red";
}


    // 1. Markdown renderer must be ready before any preview happens
    setupMarked();

    // 2. Handle OAuth redirect (may store token)
    await handleOAuthRedirect();

    // 3. Load workspace from localStorage (new model)
    loadState(); // loads kb_workspace into the recursive tree

    // 3.5 Re-check the token immediately after wake
    bindVisibilityEvents();
    bindActivityEvents();

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

    // 3. Final check - use the value directly to avoid "Redeclaration" errors
    if (!localStorage.getItem("github_token")) {
        // Only run this if we STILL don't have a token after redirect handling
        if (typeof disconnectFromGitHub === "function") {
            disconnectFromGitHub("Cloud sync is off."); 
        }
    }   
}


init();
