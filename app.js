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

// app.js - Top of file
if (window.location.protocol === 'http:' && !window.location.hostname.includes('localhost')) {
    window.location.href = window.location.href.replace('http:', 'https:');
}

async function init() {

    let currentToken = localStorage.getItem("github_token");

    // TEMPORARY DEBUG  
    alert("DEBUG: Token is " + (currentToken ? "FOUND" : "MISSING"));

    if (currentToken) {
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
