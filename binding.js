import { applyMarkdownFormat, formatTable } from "./md-editor.js";
import { applyBgColorFormat, applyClearFormatting, applyColorFormat, toggleBgColorPopup, toggleColorPopup, toggleTablePopup, zoomEditor, zoomPreview, resetZoom, updatePreview, exportAll, deleteFile, addFolder, testFunctionality, copyRenderedPuml} from "./ui.js";
import { markLocalEdit, saveWorkspaceToGist, loadWorkspaceFromGist, showRestoreDialog, toggleSyncLoop, syncIntervalId, setSyncEnabled, getSyncEnabled, handleExpiredToken } from "./sync.js";
import { logger, getCallerName } from "./logger.js";
import { clearToken } from "./auth.js";

logger.debug("binding","binding.js loaded from:", import.meta.url);

export function bindSmartKeyboardEvents(textarea) {

    logger.debug("binding", "bindSmartKeyboardEvents(). CALLED BY: " + getCallerName("bindSmartKeyboardEvents"));
    textarea.addEventListener("input", (e) => {
        if (e.isTrusted) {  // only true for real user input
            markLocalEdit();
        }
        updatePreview();
    });

    textarea.addEventListener("keydown", (e) => {
        const { selectionStart, value } = textarea;
        const before = value.substring(0, selectionStart);
        const lineStart = before.lastIndexOf('\n') + 1;
        const lineEnd = value.indexOf('\n', selectionStart);
        const currentLine = value.substring(lineStart, lineEnd === -1 ? value.length : lineEnd);

        // --- TABLE NAVIGATION ---
        if (e.key === "Tab" && currentLine.includes("|")) {
            e.preventDefault();

            formatTable(); // safe: cursor restored below

            const updated = textarea.value;
            const nextPipe = updated.indexOf("|", selectionStart + 1);
            const lineBreak = updated.indexOf("\n", lineStart);

            if (nextPipe !== -1 && nextPipe <= lineBreak) {
                textarea.selectionStart = textarea.selectionEnd = nextPipe + 2;
            } else {
                const nextLine = lineBreak + 1;
                textarea.selectionStart = textarea.selectionEnd = nextLine;
            }
            return;
        }

        // --- SMART ENTER FOR LISTS ---
        if (e.key === "Enter" && !e.shiftKey) {
            const listMatch = currentLine.match(/^(\s*)([-*+]|\d+\.)\s+(.*)/);
            if (listMatch) {
                e.preventDefault();
                const [_, indent, marker, content] = listMatch;

                if (!content.trim()) {
                    textarea.setRangeText("", lineStart, selectionStart, "end");
                    textarea.setRangeText("\n", textarea.selectionStart, textarea.selectionStart, "end");
                } else {
                    let nextMarker = marker;
                    if (/^\d+\./.test(marker)) {
                        nextMarker = (parseInt(marker) + 1) + ".";
                    }
                    textarea.setRangeText(`\n${indent}${nextMarker} `, selectionStart, selectionStart, "end");
                }
                textarea.dispatchEvent(new Event("input"));
                return;
            }
        }

        // --- INDENT / OUTDENT ---
        if (e.key === "Tab") {
            e.preventDefault();
            if (e.shiftKey) {
                if (currentLine.startsWith("  ")) {
                    textarea.setRangeText("", lineStart, lineStart + 2, "end");
                }
            } else {
                textarea.setRangeText("  ", lineStart, lineStart, "end");
            }
            textarea.dispatchEvent(new Event("input"));
        }
    });
}

export function bindGlobalShortcuts(textarea) {
    logger.debug("binding", "bindGlobalShortcuts(). CALLED BY: " + getCallerName("bindGlobalShortcuts"));
    document.addEventListener("keydown", (e) => {
        const isCmd = e.metaKey || e.ctrlKey;

        if (e.ctrlKey && e.key === "z") {
            if (textarea.dataset.lastFormatValue) {
                e.preventDefault();
                textarea.value = textarea.dataset.lastFormatValue;
                delete textarea.dataset.lastFormatValue;
                textarea.dispatchEvent(new Event("input"));
            }
            return;
        }

        if (e.ctrlKey && e.key === "=") {
            zoomEditor(1); zoomPreview(1); e.preventDefault();
        }
        if (e.ctrlKey && e.key === "-") {
            zoomEditor(-1); zoomPreview(-1); e.preventDefault();
        }
        if (e.ctrlKey && e.key === "0") {
            document.documentElement.style.setProperty("--editor-font-size", "14px");
            document.documentElement.style.setProperty("--preview-font-size", "16px");
            e.preventDefault();
        }

        if (isCmd) {
            const key = e.key.toLowerCase();
            if (key === "s") {
                e.preventDefault();
                try {
                    saveWorkspaceToGist();
                } catch (err) {
                    if (err.message === "TOKEN_INVALID") {
                        handleExpiredToken();
                        return;
                    }
                    throw err;
                }
                return;
            }
            if (key === "b") { e.preventDefault(); applyMarkdownFormat("bold", textarea); return; }
            if (key === "i") { e.preventDefault(); applyMarkdownFormat("italic", textarea); return; }
            if (key === "h") { e.preventDefault(); applyMarkdownFormat("h1", textarea); return; }
            if (key === "m") { e.preventDefault(); applyMarkdownFormat("puml", textarea); return; }

            if (key === "f") {
                const line = getCurrentLine(textarea);
                if (line.includes("|")) {
                    e.preventDefault();
                    formatTable();
                }
            }
        }
    });
}

export function getCurrentLine(textarea) {
    const { selectionStart, value } = textarea;
    const before = value.substring(0, selectionStart);
    const lineStart = before.lastIndexOf("\n") + 1;
    const lineEnd = value.indexOf("\n", selectionStart);
    return value.substring(lineStart, lineEnd === -1 ? value.length : lineEnd);
}


export function bindScrollSync(textarea) {
    logger.debug("binding", "bindScrollSync(). CALLED BY: " + getCallerName("bindScrollSync"));
    textarea.addEventListener("scroll", () => {
        const preview = document.getElementById("preview-pane");
        const maxEditor = textarea.scrollHeight - textarea.clientHeight;
        const maxPreview = preview.scrollHeight - preview.clientHeight;

        if (maxEditor <= 0 || maxPreview <= 0) return;

        const pct = textarea.scrollTop / maxEditor;
        preview.scrollTop = pct * maxPreview;
    });
}

export function bindToolbarEvents(textarea) {
    logger.debug("binding", "bindToolbarEvents(). CALLED BY: " + getCallerName("bindToolbarEvents"));
    // TOOLBAR & POPUP WIRE-UPS
    document.getElementById("add-folder-btn")?.addEventListener("click", () => addFolder());
    document.getElementById("save-btn")?.addEventListener("click", async () => {
        try {
            await saveWorkspaceToGist();
        } catch (err) {
            if (err.message === "TOKEN_INVALID") {
                handleExpiredToken();
                return;
            }
            throw err;
        }
    });

    document.getElementById("load-btn")?.addEventListener("click", async () => {
        try {
            await loadWorkspaceFromGist();
        } catch (err) {
            if (err.message === "TOKEN_INVALID") {
                handleExpiredToken();
                return;
            }
            throw err;
        }
    });

    document.getElementById("restore-btn")?.addEventListener("click", () => showRestoreDialog());
    document.getElementById("exportAll-btn")?.addEventListener("click", () => exportAll());
    document.getElementById("delete-btn")?.addEventListener("click", () => deleteFile());
    document.getElementById("logout-btn")?.addEventListener("click", () => clearToken());
    document.getElementById("copy-rendered-puml-btn")?.addEventListener("click", () => copyRenderedPuml());
    document.getElementById("test-btn")?.addEventListener("click", () => testFunctionality());
    document.getElementById("sync-toggle-btn")?.addEventListener("click", () => {
        const turningOn = (syncIntervalId === null);
        toggleSyncLoop();          // start or stop the loop
        setSyncEnabled(turningOn); // persist the new state
        updateSyncToggleButton();  // update UI
    });



    // Zoom Buttons
    document.getElementById("zoom-editor-in")?.addEventListener("click", () => {
        if (window.activePane === "editor") zoomEditor(1); else zoomPreview(1);
    });
    document.getElementById("zoom-editor-out")?.addEventListener("click", () => {
        if (window.activePane === "editor") zoomEditor(-1); else zoomPreview(-1);
    });
    document.getElementById("zoom-reset-btn")?.addEventListener("click", resetZoom);

    // Markdown Toolbar delegation
    document.getElementById("md-toolbar").addEventListener("click", (e) => {
        const type = e.target.dataset.md;
        if (!type) return;

        if (type === "clear") return applyClearFormatting(textarea);
        if (type === "color") return toggleColorPopup(e.target);
        if (type === "bgcolor") return toggleBgColorPopup(e.target);
        if (type === "table-menu") return toggleTablePopup(e.target);

        applyMarkdownFormat(type, textarea);
    });
}

export function updateSyncToggleButton() {
    const btn = document.getElementById("sync-toggle-btn");
    if (!btn) return;

    const enabled = getSyncEnabled();

    // If sync is disabled, always show "Start Sync"
    if (!enabled) {
        btn.textContent = "Start Sync";
        btn.classList.add("sync-stopped");
        btn.classList.remove("sync-running");
        return;
    }

    // Sync enabled → reflect actual loop state
    const running = syncIntervalId !== null;

    btn.textContent = running ? "Stop Sync" : "Start Sync";
    btn.classList.toggle("sync-running", running);
    btn.classList.toggle("sync-stopped", !running);
}

export function bindPopupEvents(textarea) {
    logger.debug("binding", "bindPopupEvents(). CALLED BY: " + getCallerName("bindPopupEvents"));
    const colorPopup = document.getElementById("md-color-popup");
    if (colorPopup) {
        colorPopup.addEventListener("click", (e) => {
            const color = e.target.dataset.color;
            if (!color) return;
            applyColorFormat(color, textarea);
            colorPopup.classList.add("hidden");
        });
    }

    const bgPopup = document.getElementById("md-bgcolor-popup");
    if (bgPopup) {
        bgPopup.addEventListener("click", (e) => {
            const bg = e.target.dataset.bg;
            if (!bg) return;
            applyBgColorFormat(bg, textarea);
            bgPopup.classList.add("hidden");
        });
    }

    const tablePopup = document.getElementById("table-popup");
    if (tablePopup) {
        tablePopup.addEventListener("click", (e) => {
            const type = e.target.dataset.md;
            if (!type) return;
            applyMarkdownFormat(type, textarea);
            tablePopup.classList.add("hidden");
        });
    }

    document.addEventListener("click", (e) => {
        hidePopupsIfClickedOutside(e);
    });
}
 
export function hidePopupsIfClickedOutside(e) {
    logger.debug("binding", "hidePopupsIfClickedOutside(). CALLED BY: " + getCallerName("hidePopupsIfClickedOutside"));
    const popups = [
        document.getElementById("md-color-popup"),
        document.getElementById("md-bgcolor-popup"),
        document.getElementById("table-popup")
    ];

    popups.forEach(p => {
        if (!p) return;
        if (!p.contains(e.target) && !e.target.dataset.md) {
            p.classList.add("hidden");
        }
    });
}

export function bindSidebarEvents() {
    logger.debug("binding", "bindSidebarEvents(). CALLED BY: " + getCallerName("bindSSidebarEvents"));
    const closeBtn = document.getElementById("close-sidebar-btn");
    if (!closeBtn) return;

    closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        document.body.classList.remove("sidebar-open");
    });
}
