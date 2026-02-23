import { saveWorkspaceToGist, loadWorkspaceFromGist, showRestoreDialog } from "./sync.js";
import { getToken, bindLoginButton } from "./auth.js";
import { applyMarkdownFormat } from "./md-editor.js";

let saveTimer = null;
let subjects = [];
let activeFileId = null;
let activeSubjectId = null;
let activePane = "editor"; // "editor" or "preview"

// Set MD renderer (marked v9) to have separation betwen paragraghs but keep lists tight
const renderer = new marked.Renderer();
renderer.list = function (body, ordered, start) {
    const type = ordered ? "ol" : "ul";
    return `<${type}>\n${body}</${type}>\n\n`;
};
marked.use({ renderer });

export function getSubjects() {
    return subjects;
}

export function setSubjects(newSubjects) {
    subjects = newSubjects;
}

export function saveState() {
    localStorage.setItem("kb_data", JSON.stringify(subjects));
    // optional: auto-save to gist
    // await saveWorkspaceToGist();
}

export function initResizers() {
    const sbResizer = document.getElementById("sidebar-resizer");
    const sidebar = document.getElementById("sidebar");
    const edResizer = document.getElementById("editor-resizer");
    const editorCont = document.getElementById("editor-container");
    const workspace = document.getElementById("workspace-grid");

    // --- Helpers: normalize mouse/touch ---
    const getClientX = e => (e.touches ? e.touches[0].clientX : e.clientX);
    const getClientY = e => (e.touches ? e.touches[0].clientY : e.clientY);

    // ============================================================
    // SIDEBAR RESIZER (always horizontal drag)
    // ============================================================
    if (sbResizer) {
        const startSidebarResize = e => {
            e.preventDefault();
            sbResizer.classList.add("resizing");

            const handleMove = e2 => {
                const newWidth = getClientX(e2);
                if (newWidth >= 200 && newWidth <= 600) {
                    sidebar.style.width = newWidth + "px";
                }
            };

            const stop = () => {
                sbResizer.classList.remove("resizing");
                document.removeEventListener("mousemove", handleMove);
                document.removeEventListener("mouseup", stop);
                document.removeEventListener("touchmove", handleMove);
                document.removeEventListener("touchend", stop);
            };

            document.addEventListener("mousemove", handleMove);
            document.addEventListener("mouseup", stop);
            document.addEventListener("touchmove", handleMove, { passive: false });
            document.addEventListener("touchend", stop);
        };

        sbResizer.addEventListener("mousedown", startSidebarResize);
        sbResizer.addEventListener("touchstart", startSidebarResize, { passive: false });
    }

    // ============================================================
    // EDITOR RESIZER (horizontal in landscape, vertical in portrait)
    // ============================================================
    if (edResizer) {
        const startEditorResize = e => {
            e.preventDefault();
            edResizer.classList.add("resizing");

            const isPortrait = window.matchMedia("(orientation: portrait)").matches;
            const workspaceRect = workspace.getBoundingClientRect();

            // Capture starting values to prevent jumps
            const startX = getClientX(e);
            const startY = getClientY(e);
            const startWidth = editorCont.getBoundingClientRect().width;
            const startHeight = editorCont.getBoundingClientRect().height;

            const handleMove = e2 => {
                if (isPortrait) {
                    // ---------------------------
                    // PORTRAIT MODE → vertical drag (smooth, no jump)
                    // ---------------------------
                    const clientY = getClientY(e2);
                    const deltaY = clientY - startY;
                    const newHeight = startHeight - deltaY;

                    if (newHeight >= 100 && newHeight <= workspaceRect.height - 100) {
                        editorCont.style.height = newHeight + "px";
                        editorCont.style.flex = "none";
                    }

                } else {
                    // ---------------------------
                    // LANDSCAPE MODE → horizontal drag (unchanged)
                    // ---------------------------
                    const clientX = getClientX(e2);
                    const deltaX = clientX - startX;
                    const newWidth = startWidth - deltaX;

                    if (newWidth >= 100 && newWidth <= workspaceRect.width - 100) {
                        editorCont.style.width = newWidth + "px";
                        editorCont.style.flex = "none";
                    }
                }
            };

            const stop = () => {
                edResizer.classList.remove("resizing");
                document.removeEventListener("mousemove", handleMove);
                document.removeEventListener("mouseup", stop);
                document.removeEventListener("touchmove", handleMove);
                document.removeEventListener("touchend", stop);
            };

            document.addEventListener("mousemove", handleMove);
            document.addEventListener("mouseup", stop);
            document.addEventListener("touchmove", handleMove, { passive: false });
            document.addEventListener("touchend", stop);
        };

        edResizer.addEventListener("mousedown", startEditorResize);
        edResizer.addEventListener("touchstart", startEditorResize, { passive: false });
    }
}

export function renderSidebar() {
    const container = document.getElementById("sidebar-list");
    if (!container) return;

    container.innerHTML = "";

    // Empty workspace state
    if (!subjects || subjects.length === 0) {
        container.innerHTML = `
            <div class="empty-workspace">
                <p>Your workspace is empty.</p>
                <p class="hint">Use the <strong>+ Folder</strong> button above to create your first subject, or:</p>
                <button id="github-login" class="btn-tool">Sign in with GitHub</button>
                <button id="load-from-cloud" class="btn-tool">Load from Cloud</button>
            </div>
        `;

        // Bind login button NOW that it exists
        bindLoginButton();

        // Bind load-from-cloud button
        document.getElementById("load-from-cloud").onclick = async () => {
            await loadWorkspaceFromGist();
            renderSidebar();
        };

        return;
    }

    subjects.forEach(subject => {
        const sContainer = document.createElement("div");
        sContainer.className = "subject-container";

        const sHeader = document.createElement("div");
        sHeader.className = "subject-header";
        sHeader.innerHTML = `
            <span class="chevron ${subject.isOpen ? "open" : ""}">▶</span>
            <span class="subject-title">${subject.title}</span>

            <div class="subject-actions">
                <button class="btn-add-file" title="Add File"><span>✚</span></button>
                <button class="btn-rename-folder" title="Rename Folder"><span style="font-weight: bold;">✎</span></button>
                <button class="btn-delete-folder" title="Delete Folder"><span style="font-weight: bold;">✖</span></button>                
            </div>
        `;

        // Add File
        sHeader.querySelector(".btn-add-file").addEventListener("click", e => {
            e.stopPropagation();
            addFile(subject.id);
        });

        // Rename Folder
        sHeader.querySelector(".btn-rename-folder").addEventListener("click", e => {
            e.stopPropagation();
            renameFolder(subject.id);
        });

        // Delete Folder
        sHeader.querySelector(".btn-delete-folder").addEventListener("click", e => {
            e.stopPropagation();
            deleteFolder(subject.id);
        });    
   
        sHeader.addEventListener("click", () => {
            subject.isOpen = !subject.isOpen;
            saveState();
            renderSidebar();
        });

        sContainer.appendChild(sHeader);

        if (subject.isOpen) {
            subject.files.forEach(file => {
                const fDiv = document.createElement("div");
                fDiv.className = `file-item ${file.id === activeFileId ? "active" : ""}`;
                fDiv.innerHTML = `
                    <div style="display: flex; align-items: center; overflow: hidden; flex: 1;">
                        <span class="file-icon">${file.type === "md" ? "M↓" : "⧉"}</span>
                        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${file.title}</span>
                    </div>
                    <div class="file-actions">
                        <div class="icon-btn rename" title="Rename">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 20h9"></path>
                                <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"></path>
                            </svg>
                        </div>
                        <div class="icon-btn" title="Duplicate">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                            </svg>
                        </div>
                        <div class="icon-btn del" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                            </svg>
                        </div>
                    </div>
                `;

                fDiv.addEventListener("click", e => {
                    e.stopPropagation();
                    loadFile(subject.id, file.id);

                    // Close sidebar automatically on mobile portrait
                    if (window.innerWidth < 1400 && window.matchMedia("(orientation: portrait)").matches) {
                        document.body.classList.remove("sidebar-open");
                    }
                });

                const [renameBtn, dupBtn, delBtn] = fDiv.querySelectorAll(".icon-btn");
                renameBtn.addEventListener("click", e => {
                    e.stopPropagation();
                    renameFile(subject.id, file.id);
                });
                dupBtn.addEventListener("click", e => {
                    e.stopPropagation();
                    duplicateFile(subject.id, file.id);
                });
                delBtn.addEventListener("click", e => {
                    e.stopPropagation();
                    deleteFile(subject.id, file.id);
                });

                sContainer.appendChild(fDiv);
            });
        }

        container.appendChild(sContainer);
    });
}

export function loadFile(sId, fId) {
    activeSubjectId = sId;
    activeFileId = fId;

    const subject = subjects.find(s => s.id === sId);
    const file = subject.files.find(f => f.id === fId);

    document.getElementById("empty-state").classList.add("hidden");
    document.getElementById("workspace-grid").classList.remove("hidden");
    document.getElementById("editor-actions").classList.remove("hidden");

    const textarea = document.getElementById("editor-textarea");
    textarea.value = file.content;

    document.getElementById("active-file-title").textContent = `${subject.title} / ${file.title}`;
    document.getElementById("active-file-type-icon").innerHTML =
        file.type === "md"
            ? '<span class="type-label-md">MD</span>'
            : '<span class="type-label-puml">PUML</span>';

    if (file.type === "md") {
        document.getElementById("md-toolbar").classList.remove("hidden");
    } else {
        document.getElementById("md-toolbar").classList.add("hidden");
    }

    renderSidebar();
    updatePreview();
    updateToolbar()
}

function updateToolbar() {
    const subject = subjects.find(s => s.id === activeSubjectId);
    const file = subject?.files.find(f => f.id === activeFileId);

    const pumlButtons = document.querySelectorAll(".puml-only");

    const show = file?.type === "puml";

    pumlButtons.forEach(btn => {
        btn.style.display = show ? "inline-flex" : "none";
    });
}

export function renameFolder(subjectId) {
    const subject = subjects.find(s => s.id === subjectId);
    if (!subject) return;

    const newName = prompt("Rename folder:", subject.title);
    if (!newName || !newName.trim()) return;

    subject.title = newName.trim();

    saveState();
    renderSidebar();
}

export function deleteFolder(subjectId) {
    const subject = subjects.find(s => s.id === subjectId);
    if (!subject) return;

    if (!confirm(`Delete folder "${subject.title}" and all its files?`)) return;

    // Remove subject
    subjects = subjects.filter(s => s.id !== subjectId);

    // Clear active file + UI
    activeFileId = null;
    document.getElementById("workspace-grid").classList.add("hidden");
    document.getElementById("empty-state").classList.remove("hidden");
    document.getElementById("editor-actions").classList.add("hidden");

    // Persist + re-render
    saveState();
    renderSidebar();
}


export function updatePreview() {
    const textarea = document.getElementById("editor-textarea");
    const preview = document.getElementById("preview-pane");
    const link = document.getElementById('puml-external-link');
    const content = textarea.value;

    const subject = subjects.find(s => s.id === activeSubjectId);
    const file = subject?.files.find(f => f.id === activeFileId);
    if (!file) return;

    // debounce saving to avoid breaking undo
    file.content = content;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveState(), 300);


    if (file.type === "puml") {
        const url = getPumlRenderUrl(content);
        preview.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center;">
                <img src="${url}" alt="PlantUML Diagram" />
                <a href="${url}" target="_blank" style="font-size: 0.75rem; color: #9ca3af; margin-top: 1rem; text-decoration: underline;">Open SVG link</a>
            </div>`;
        link.href = getPumlHref(content);
    } else {
        const pumlRegex = /@startuml([\s\S]*?)@enduml/g;
        const processed = content.replace(pumlRegex, (match, p1) => {
            const url = getPumlRenderUrl(p1);
            return `\n![PlantUML](${url})\n`;
        });
        preview.innerHTML = `<div class="prose">${marked.parse(processed)}</div>`;
    }
}

function getPumlRenderUrl(puml) {
    try {
        const encoded = plantumlEncoder.encode(puml.trim());
        return `https://www.plantuml.com/plantuml/svg/${encoded}`;
    } catch (e) {
        console.error("Encoding error:", e);
        return "";
    }
}

function getPumlHref(puml) {
    try {
        const encoded = plantumlEncoder.encode(puml.trim());
        return `https://www.plantuml.com/plantuml/uml/${encoded}`;
    } catch (e) {
        console.error("Encoding error:", e);
        return "";
    }
}

export function addSubject() {
    const title = prompt("New Subject Folder Name:");
    if (title) {
        subjects.push({
            id: "s" + Date.now(),
            title,
            isOpen: true,
            files: []
        });
        saveState();
        renderSidebar();
    }
}

export function addFile(sId) {
    const title = prompt("File Name:");
    if (!title) return;

    const type = confirm("Press OK for Markdown file, Cancel for PlantUML file") ? "md" : "puml";
    const subject = subjects.find(s => s.id === sId);
    const newFile = {
        id: "f" + Date.now(),
        title,
        type,
        content: type === "md" ? `# ${title}\n` : "@startuml\n\n@enduml"
    };

    subject.files.push(newFile);
    subject.isOpen = true;
    saveState();
    renderSidebar();
    loadFile(sId, newFile.id);
}

export function deleteCurrentFile() {
    if (!confirm("Delete this file?")) return;
    const subject = subjects.find(s => s.id === activeSubjectId);
    subject.files = subject.files.filter(f => f.id !== activeFileId);

    activeFileId = null;
    document.getElementById("empty-state").classList.remove("hidden");
    document.getElementById("workspace-grid").classList.add("hidden");
    document.getElementById("editor-actions").classList.add("hidden");

    saveState();
    renderSidebar();
}

export function exportFile() {
    const subject = subjects.find(s => s.id === activeSubjectId);
    const file = subject.files.find(f => f.id === activeFileId);
    const blob = new Blob([file.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${file.title}.${file.type}`;
    a.click();
}

export function duplicateFile(sId, fId) {
    const s = subjects.find(x => x.id === sId);
    const f = s.files.find(x => x.id === fId);
    const copy = { ...f, id: "f" + Date.now(), title: f.title + " (Copy)" };
    s.files.push(copy);
    saveState();
    renderSidebar();
}

export function deleteFile(sId, fId) {
    if (!confirm("Delete file?")) return;
    const s = subjects.find(x => x.id === sId);
    s.files = s.files.filter(x => x.id !== fId);
    if (activeFileId === fId) {
        activeFileId = null;
        document.getElementById("workspace-grid").classList.add("hidden");
        document.getElementById("empty-state").classList.remove("hidden");
        document.getElementById("editor-actions").classList.add("hidden");
    }
    saveState();
    renderSidebar();
}

export function renameFile(sId, fId) {
    const s = subjects.find(x => x.id === sId);
    const f = s.files.find(x => x.id === fId);

    const newName = prompt("Rename file:", f.title);
    if (!newName) return;

    f.title = newName.trim();
    saveState();
    renderSidebar();
}

export function bindPaneFocusEvents() {
    const editor = document.getElementById("editor-textarea");
    const preview = document.getElementById("preview-pane");

    editor?.addEventListener("focus", () => actideletevePane = "editor");
    preview?.addEventListener("click", () => activePane = "preview");
}

export function zoomEditor(delta) {
    const root = document.documentElement;
    const current = parseFloat(getComputedStyle(root).getPropertyValue("--editor-font-size"));
    const next = Math.min(40, Math.max(10, current + delta));
    root.style.setProperty("--editor-font-size", next + "px");
}

function zoomPreview(delta) {
    const root = document.documentElement;

    // text zoom
    const currentFont = parseFloat(getComputedStyle(root).getPropertyValue('--preview-font-size'));
    const nextFont = Math.min(32, Math.max(8, currentFont + delta));
    root.style.setProperty('--preview-font-size', nextFont + "px");

    // image zoom
    const currentScale = parseFloat(getComputedStyle(root).getPropertyValue('--preview-zoom-scale'));
    const nextScale = Math.min(3, Math.max(0.5, currentScale + delta * 0.1));
    root.style.setProperty('--preview-zoom-scale', nextScale);
}


function resetZoom() {
    const root = document.documentElement;

    // Editor text size
    root.style.setProperty("--editor-font-size", "14px");

    // Preview text size
    root.style.setProperty("--preview-font-size", "16px");

    // SVG true-zoom scale (your Option B)
    root.style.setProperty("--preview-zoom-scale", "1");
}

export function setSyncStatus(state, text) {
    const el = document.getElementById("sync-status");
    if (!el) return;

    el.className = `sync-status sync-${state}`;
    el.textContent = text;
}

export function updateLoginIndicator() {
    const token = getToken();
    const btn = document.getElementById("github-login");
    if (!btn) return;

    if (token) {
        btn.classList.remove("github-login-needed");
        btn.classList.add("github-logged-in");
        btn.textContent = "GitHub Connected";
    } else {
        btn.classList.remove("github-logged-in");
        btn.classList.add("github-login-needed");
        btn.textContent = "Sign in with GitHub";
    }
}

export function bindEditorEvents() {
    const textarea = document.getElementById("editor-textarea");

    if (textarea) {
        textarea.addEventListener("input", updatePreview);
    }

    document.addEventListener("keydown", e => {
        // one-level undo for formatting
        if (e.ctrlKey && e.key === "z") {
            const textarea = document.getElementById("editor-textarea");
            if (textarea && textarea.dataset.lastFormatValue) {
                e.preventDefault(); // use our custom undo instead of native for this case
                textarea.value = textarea.dataset.lastFormatValue;
                delete textarea.dataset.lastFormatValue;
                textarea.dispatchEvent(new Event("input"));
                return;
            }
        }        
        if (e.ctrlKey && e.key === "=") {
            zoomEditor(1);
            zoomPreview(1);
            e.preventDefault();
        }
        if (e.ctrlKey && e.key === "-") {
            zoomEditor(-1);
            zoomPreview(-1);
            e.preventDefault();
        }
        if (e.ctrlKey && e.key === "0") {
            document.documentElement.style.setProperty("--editor-font-size", "14px");
            document.documentElement.style.setProperty("--preview-font-size", "16px");
            e.preventDefault();
        }
    });

    // wire toolbar buttons
    document.getElementById("add-subject-btn") ?.addEventListener("click", () => addSubject());
    document.getElementById("save-btn") ?.addEventListener("click", () => saveWorkspaceToGist());
    document.getElementById("load-btn") ?.addEventListener("click", () => loadWorkspaceFromGist());
    document.getElementById("restore-btn") ?.addEventListener("click", () => showRestoreDialog());
    document.getElementById("export-btn") ?.addEventListener("click", () => exportFile());
    document.getElementById("delete-btn") ?.addEventListener("click", () => deleteCurrentFile());

    // Zoom controls 
    document.getElementById("zoom-editor-in")
        ?.addEventListener("click", () => {
            if (activePane === "editor") zoomEditor(1);
            else zoomPreview(1);
        });

    document.getElementById("zoom-editor-out")
        ?.addEventListener("click", () => {
            if (activePane === "editor") zoomEditor(-1);
            else zoomPreview(-1);
        });

    document.getElementById("zoom-reset-btn")
        ?.addEventListener("click", resetZoom);

    document.getElementById("md-toolbar").addEventListener("click", e => {
        const type = e.target.dataset.md;
        const textarea = document.getElementById("editor-textarea");
        if (!type) return;
        if (type === "clear") {
            applyClearFormatting(textarea);
            return;
        }
        if (type === "color") {
            toggleColorPopup(e.target);
            return;
        }
        if (type === "bgcolor") {
            toggleBgColorPopup(e.target);
            return;
        }     
        if (type === "table-menu") {
            toggleTablePopup(e.target);
            return;
        }
        
        applyMarkdownFormat(type, textarea);
    });

    const colorPopup = document.getElementById("md-color-popup");
    if (colorPopup) {
        colorPopup.addEventListener("click", e => {
            const color = e.target.dataset.color;
            if (!color) return;

            applyColorFormat(color, textarea);
            colorPopup.classList.add("hidden");
        });
    }

    const bgPopup = document.getElementById("md-bgcolor-popup");
    if (bgPopup) {// Close sidebar button (static header)

    const closeSidebarBtn = document.getElementById("close-sidebar-btn");
    if (closeSidebarBtn) {
        closeSidebarBtn.addEventListener("click", e => {
            e.stopPropagation();
            document.body.classList.remove("sidebar-open");
        });
    }

        bgPopup.addEventListener("click", e => {
            const bg = e.target.dataset.bg;
            if (!bg) return;

            applyBgColorFormat(bg, textarea);
            bgPopup.classList.add("hidden");
        });
    }

    const tablePopup = document.getElementById("table-popup");
    if (tablePopup) {
        tablePopup.addEventListener("click", e => {
            const type = e.target.dataset.md;
            if (!type) return;

            applyMarkdownFormat(type, textarea);
        });
    }

    document.addEventListener("click", e => {
        const popup = document.getElementById("table-popup");
        const toggle = document.querySelector('[data-md="table-menu"]');

        if (!popup.contains(e.target) && e.target !== toggle) {
            popup.classList.add("hidden");
        }
    });


    // Close sidebar button (static header)
    const closeSidebarBtn = document.getElementById("close-sidebar-btn");
    if (closeSidebarBtn) {
        closeSidebarBtn.addEventListener("click", e => {
            e.stopPropagation();
            document.body.classList.remove("sidebar-open");
        });
    }

}

function applyClearFormatting(textarea) {
    // store previous value for one-level undo
    textarea.dataset.lastFormatValue = textarea.value;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end);

    // Remove HTML tags
    let cleaned = selected
        .replace(/<\/?span[^>]*>/gi, "")
        .replace(/<\/?u>/gi, "")
        .replace(/<\/?mark>/gi, "");

    // Remove Markdown formatting
    cleaned = cleaned
        // 1. FENCED CODE BLOCKS FIRST
        .replace(/```[\s\S]*?```/g, match => {
            return match.replace(/```/g, "");
        })

        // 2. INLINE FORMATTING
        .replace(/\*\*(.*?)\*\*/g, "$1")   // bold
        .replace(/\*(.*?)\*/g, "$1")       // italic
        .replace(/__(.*?)__/g, "$1")       // bold alt
        .replace(/_(.*?)_/g, "$1")         // italic alt
        .replace(/~~(.*?)~~/g, "$1")       // strike

        // 3. INLINE CODE — SINGLE LINE ONLY
        .replace(/`([^`\n]+)`/g, "$1")

        // 4. LISTS
        .replace(/^\s*[-*]\s+/gm, "")      // unordered list
        .replace(/^\s*\d+\.\s+/gm, "")     // ordered list

        // 5. INDENTED CODE BLOCKS
        .replace(/^( {4}|\t)/gm, "");


        
    // Replace selection
    textarea.value =
        textarea.value.substring(0, start) +
        cleaned +
        textarea.value.substring(end);

    textarea.selectionStart = start;
    textarea.selectionEnd = start + cleaned.length;
    textarea.dispatchEvent(new Event("input"));
}

function applyColorFormat(color, textarea) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end);

    const replacement = `<span style="color:${color}">${selected}</span>`;

    textarea.value =
        textarea.value.substring(0, start) +
        replacement +
        textarea.value.substring(end);

    textarea.selectionStart = start;
    textarea.selectionEnd = start + replacement.length;
    textarea.dispatchEvent(new Event("input"));
}

function hidePopups(except) {
    for (const p of document.querySelectorAll('.md-popup')) {
        if (p !== except) p.classList.add("hidden");
    }
}

function toggleColorPopup(button) {
    const popup = document.getElementById("md-color-popup");

    // Hide all other popups
    hidePopups(popup);

    popup.classList.toggle("hidden");

    // Position popup under the button
    const rect = button.getBoundingClientRect();
    popup.style.left = rect.left + "px";
    popup.style.top = rect.bottom + "px";
}

function toggleBgColorPopup(button) {
    const popup = document.getElementById("md-bgcolor-popup");

    // Hide all other popups
    hidePopups(popup);

    popup.classList.toggle("hidden");

    // Position popup under the button
    const rect = button.getBoundingClientRect();
    popup.style.left = rect.left + "px";
    popup.style.top = rect.bottom + "px";
}

function toggleTablePopup(button) {
    const popup = document.getElementById("table-popup");

    // Hide all other popups
    hidePopups(popup);

    // Toggle visibility
    popup.classList.toggle("hidden");

    if (!popup.classList.contains("hidden")) {
        const rect = button.getBoundingClientRect();
        popup.style.left = rect.left + "px";
        popup.style.top = rect.bottom + "px";
    }
}

function applyBgColorFormat(bg, textarea) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end);

    const replacement = `<span style="background-color:${bg}">${selected}</span>`;

    textarea.value =
        textarea.value.substring(0, start) +
        replacement +
        textarea.value.substring(end);

    textarea.selectionStart = start;
    textarea.selectionEnd = start + replacement.length;
    textarea.dispatchEvent(new Event("input"));
}

export function flattenWorkspace() {
    const files = [];
    subjects.forEach(subject => {
        subject.files.forEach(file => {
            let ext = "";
            if (file.type === "md" || file.type === "markdown") {
                ext = ".md";
            } else if (file.type === "puml" || file.type === "plantuml") {
                ext = ".puml";
            } else {
                ext = ".txt";
            }

            const safeSubject = subject.title.replace(/\s+/g, "_");
            const safeFile = file.title.replace(/\s+/g, "_");
            const path = `${safeSubject}___${safeFile}${ext}`;

            files.push({
                path,
                content: file.content || ""
            });
        });
    });
    return files;
}

export function rebuildWorkspaceFromGist(gistFiles) {
    const subjectsMap = {};

    for (const filename in gistFiles) {
        const content = gistFiles[filename].content;
        const [rawSubject, rawFileWithExt] = filename.split("___");

        const subjectTitle = rawSubject.replace(/_/g, " ");
        const fileTitle = rawFileWithExt
            .replace(/\.[^.]+$/, "")
            .replace(/_/g, " ");

        const type = rawFileWithExt.endsWith(".puml") ? "puml" : "md";

        if (!subjectsMap[subjectTitle]) {
            subjectsMap[subjectTitle] = {
                id: crypto.randomUUID(),
                title: subjectTitle,
                isOpen: true,
                files: []
            };
        }

        subjectsMap[subjectTitle].files.push({
            id: crypto.randomUUID(),
            title: fileTitle,
            type,
            content
        });
    }

    return Object.values(subjectsMap);
}

// Sidebar toggle for mobile
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("sidebar-toggle").addEventListener("click", () => {
        document.body.classList.toggle("sidebar-open");
    });
});

document.getElementById("toggle-editor").addEventListener("click", () => {
    const grid = document.querySelector(".workspace-grid");
    const btn = document.getElementById("toggle-editor");

    grid.classList.toggle("editor-hidden");

    // Update button label
    if (grid.classList.contains("editor-hidden")) {
        btn.textContent = "Show Editor";
    } else {
        btn.textContent = "Hide Editor";
    }
});

