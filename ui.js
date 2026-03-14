import { getToken, getGistId} from "./auth.js";
import { bindSmartKeyboardEvents, bindGlobalShortcuts, bindScrollSync, bindToolbarEvents, bindPopupEvents, bindSidebarEvents} from "./binding.js";
import { getWorkspace, setWorkspace, findNodeById, findNodeAndParent, createFolder, createFile, saveState} from "./workspace.js";
import { logger } from "./logger.js";

let saveTimer = null;
let activeFileId = null;
let notificationTimeout = null;
let countdownInterval = null;
const contextMenu = document.getElementById("context-menu");
const contextMenuList = contextMenu.querySelector("ul");
let currentContextTarget = null;

logger.debug("ui","ui.js loaded from:", import.meta.url);

export function showContextMenu(target, items, x, y) {
    currentContextTarget = target;

    contextMenuList.innerHTML = "";

    items.forEach(item => {
        const li = document.createElement("li");
        li.textContent = item.label;
        li.addEventListener("click", () => {
            item.action(target);
            hideContextMenu();
        });
        contextMenuList.appendChild(li);
    });

    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.remove("hidden");
}

export function hideContextMenu() {
    contextMenu.classList.add("hidden");
    currentContextTarget = null;
}

document.addEventListener("click", e => {
    if (!contextMenu.contains(e.target)) {
        hideContextMenu();
    }
});


export function initResizers() {
    logger.debug("ui", "initResizers()");
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
    logger.debug("ui", "renderSidebar()");
    const container = document.getElementById("sidebar-list");
    if (!container) return;

    const tree = getWorkspace();

    container.innerHTML = "";

    if (!tree || tree.length === 0) {
        container.innerHTML = `<div class="empty-sidebar">No folders yet</div>`;
        return;
    }

    tree.forEach(node => {
        const el = renderNode(node, 0);
        container.appendChild(el);
    });
}


function renderNode(node, depth) {
    return node.type === "folder"
        ? renderFolderNode(node, depth)
        : renderFileNode(node, depth);
}

function renderFolderNode(folder, depth) {
    const wrapper = document.createElement("div");
    wrapper.className = "sidebar-folder";

    const isOpen = folder.isOpen ?? true;

    const header = document.createElement("div");
    header.className = "sidebar-folder-header";
    header.style.paddingLeft = `${depth === 0 ? 10 : depth * 16}px`;

    header.innerHTML = `
        <span class="folder-toggle">
            <span class="chevron ${isOpen ? "open" : ""}">▶</span>
        </span>
        <span class="folder-name">${folder.name.replace(/^_+/, "")}</span>
        <span class="folder-actions">
            <button class="item-menu-btn" title="Actions">⋯</button>
        </span>
    `;

    const folderMenuItems = [
        { label: "Add File", action: () => addFile(folder.id) },
        { label: "Add Folder", action: () => createSubfolder(folder.id) },
        { label: "Rename", action: () => renameFolder(folder.id) },
        { label: "Delete", action: () => deleteFolder(folder.id) }
    ];

    header.querySelector(".item-menu-btn").addEventListener("click", e => {
        e.stopPropagation();
        showContextMenu(folder, folderMenuItems, e.pageX, e.pageY);
    });

    header.addEventListener("contextmenu", e => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(folder, folderMenuItems, e.pageX, e.pageY);
    });

    // Expand/collapse
    header.querySelector(".folder-toggle").addEventListener("click", e => {
        e.stopPropagation();

        const newState = !(folder.isOpen ?? true);
        folder.isOpen = newState;

        saveState();      // persists workspace + metadata
        renderSidebar();  // re-renders with updated isOpen
    });

    wrapper.appendChild(header);

    if (isOpen && folder.children.length > 0) {
        const childrenContainer = document.createElement("div");
        childrenContainer.className = "sidebar-folder-children";

        folder.children.forEach(child => {
            childrenContainer.appendChild(renderNode(child, depth + 1));
        });

        wrapper.appendChild(childrenContainer);
    }

    return wrapper;
}




function renderFileNode(file, depth) {
    const el = document.createElement("div");
    el.className = `file-item sidebar-file ${file.id === activeFileId ? "active" : ""}`;
    el.style.paddingLeft = `${depth * 16}px`;

    el.innerHTML = `
        <div class="file-main" style="display: flex; align-items: center; overflow: hidden; flex: 1;">
            <span class="file-icon">${file.name.endsWith(".md") ? "M↓" : "⧉"}</span>
            <span class="file-name" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${file.name}
            </span>
        </div>
        <div class="file-actions">
            <button class="item-menu-btn" title="Actions">⋯</button>
        </div>
    `;

    // Load file + mobile auto-close
    el.addEventListener("click", e => {
        e.stopPropagation();
        loadFile(file.id);

        if (window.innerWidth < 1400 && window.matchMedia("(orientation: portrait)").matches) {
            document.body.classList.remove("sidebar-open");
        }
    });

    el.querySelector(".item-menu-btn").addEventListener("click", e => {
        e.stopPropagation();

        showContextMenu(file, [
            { label: "Rename", action: () => renameFile(file.id) },
            { label: "Duplicate", action: () => duplicateFile(file.id) },
            { label: "Delete", action: () => deleteFile(file.id) }
        ], e.pageX, e.pageY);
    });

    return el;
}

export function duplicateFile(fileId) {
    const tree = getWorkspace();
    const result = findNodeAndParent(tree, fileId);

    if (!result || result.node.type !== "file") return;

    const { node: file, parent } = result;

    // Generate a unique name like "MyFile.md copy", "MyFile.md copy 2", etc.
    const newName = generateCopyName(file.name, parent.children);

    const copy = createFile(newName, file.content);

    parent.children.push(copy);

    setWorkspace(tree);
    saveState();
    renderSidebar();
    loadFile(copy.id);

    showNotification("success", "File duplicated");
}

function generateCopyName(name, siblings) {
    const extIndex = name.lastIndexOf(".");
    const base = extIndex !== -1 ? name.slice(0, extIndex) : name;
    const ext = extIndex !== -1 ? name.slice(extIndex) : "";

    let n = 1;
    let candidate = `${base} copy${ext}`;

    while (siblings.some(f => f.name === candidate)) {
        n++;
        candidate = `${base} copy ${n}${ext}`;
    }

    return candidate;
}


export function createFileInFolder(parentFolder) {
    const name = prompt("New file name:");
    if (!name || !name.trim()) return;

    const fileName = name.trim().endsWith(".md")
        ? name.trim()
        : name.trim() + ".md";

    parentFolder.children.push(createFile(fileName, ""));

    commitWorkspace();
}


export function createSubfolder(parentId) {
    const name = prompt("New Folder Name:");
    if (!name || !name.trim()) return;

    const tree = getWorkspace();
    const parent = findNodeById(tree, parentId);

    if (!parent || parent.type !== "folder") return;

    parent.children.push(createFolder(name.trim()));

    parent.children.sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === "folder" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });

    setWorkspace(tree);
    saveState();
    renderSidebar();
}


export function loadFile(fileId) {
    logger.debug("ui", "loadFile()");
    const tree = getWorkspace();
    const file = findNodeById(tree, fileId);

    if (!file || file.type !== "file") {
        console.warn("loadFile: file not found", fileId);
        return;
    }

    activeFileId = file.id;

    document.getElementById("empty-state").classList.add("hidden");
    document.getElementById("workspace-grid").classList.remove("hidden");
    document.getElementById("editor-actions").classList.remove("hidden");

    const textarea = document.getElementById("editor-textarea");
    textarea.value = file.content;

    document.getElementById("active-file-title").textContent = file.name;
    document.getElementById("active-file-type-icon").innerHTML =
        file.name.endsWith(".md")
            ? '<span class="type-label-md">MD</span>'
            : '<span class="type-label-puml">PUML</span>';

    if (file.name.endsWith(".md")) {
        document.getElementById("md-toolbar").classList.remove("hidden");
    } else {
        document.getElementById("md-toolbar").classList.add("hidden");
    }

    updatePreview();
    updateToolbar();
    renderSidebar();
}




function commitWorkspace() {
    logger.debug("ui", "commitWorkspace()");
    saveState();
    renderSidebar();
}

export function updateToolbar() {
    const tree = getWorkspace();
    const file = findNodeById(tree, activeFileId);

    const pumlButtons = document.querySelectorAll(".puml-only");
    const show = file && file.name.endsWith(".puml");

    pumlButtons.forEach(btn => {
        btn.style.display = show ? "inline-flex" : "none";
    });
}


export function renameFolder(folderId) {
    const tree = getWorkspace();
    const folder = findNodeById(tree, folderId);

    if (!folder || folder.type !== "folder") return;

    const newName = prompt("Rename folder:", folder.name);
    if (!newName || !newName.trim()) return;

    folder.name = newName.trim();

    setWorkspace(tree);
    saveState();
    renderSidebar();
}

export function deleteFolder(folderId) {
    const tree = getWorkspace();
    const result = findNodeAndParent(tree, folderId);

    if (!result || result.node.type !== "folder") return;

    const { node, parent } = result;

    if (!confirm(`Delete folder "${node.name}" and all its contents?`)) return;

    if (parent) {
        parent.children = parent.children.filter(c => c.id !== folderId);
    } else {
        // deleting a top-level folder
        const newTree = tree.filter(c => c.id !== folderId);
        setWorkspace(newTree);
    }

    if (activeFileId && findNodeById(tree, activeFileId) === null) {
        activeFileId = null;
        document.getElementById("workspace-grid").classList.add("hidden");
        document.getElementById("empty-state").classList.remove("hidden");
        document.getElementById("editor-actions").classList.add("hidden");
    }

    saveState();
    renderSidebar();
}


export function updatePreview() {
    const textarea = document.getElementById("editor-textarea");
    const preview = document.getElementById("preview-pane");
    const link = document.getElementById("puml-external-link");
    const content = textarea.value;

    // Find the active file in the new recursive workspace tree
    const tree = getWorkspace();
    const file = findNodeById(tree, activeFileId);
    if (!file || file.type !== "file") return;

    // Save content (debounced)
    file.content = content;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveState(), 300);

    // PUML preview
    if (file.name.endsWith(".puml")) {
        const url = getPumlRenderUrl(content);
        preview.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center;">
                <img src="${url}" alt="PlantUML Diagram" />
                <a href="${url}" target="_blank" style="font-size: 0.75rem; color: #9ca3af; margin-top: 1rem; text-decoration: underline;">Open SVG link</a>
            </div>
        `;
        link.href = getPumlHref(content);
        return;
    }

    // Markdown preview (with embedded PUML blocks)
    const pumlRegex = /@startuml([\s\S]*?)@enduml/g;
    const processed = content.replace(pumlRegex, (match, p1) => {
        const url = getPumlRenderUrl(p1);
        return `\n![PlantUML](${url})\n`;
    });

    preview.innerHTML = `<div class="prose">${marked.parse(processed)}</div>`;
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

export function addFolder() {
    const name = prompt("New Folder Name:");
    if (!name || !name.trim()) return;

    const tree = getWorkspace();
    tree.push(createFolder(name.trim()));

    setWorkspace(tree);
    saveState();
    renderSidebar();
}


export function addFile(folderId) {
    const name = prompt("File Name:");
    if (!name || !name.trim()) return;



    const isMarkdown = confirm("Press OK for Markdown file, Cancel for PlantUML file");
    const ext = isMarkdown ? ".md" : ".puml";

    const fileName = name.trim().endsWith(ext)
        ? name.trim()
        : name.trim() + ext;

    const tree = getWorkspace();
    const folder = findNodeById(tree, folderId);

    if (!folder || folder.type !== "folder") {
        console.warn("addFile: folder not found", folderId);
        return;
    }

    const newFile = createFile(
        fileName,
        isMarkdown ? `# ${fileName}\n` : "@startuml\n\n@enduml"
    );

    folder.children.push(newFile);
    // Sort children: folders first, then files, alphabetical
    folder.children.sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === "folder" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });


    setWorkspace(tree);

    saveState();
    renderSidebar();
    loadFile(newFile.id);
}


export function exportFile() {
    const tree = getWorkspace();
    const file = findNodeById(tree, activeFileId);

    if (!file || file.type !== "file") {
        showNotification("error", "No file selected to export");
        return;
    }

    const blob = new Blob([file.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();

    showNotification("success", "File exported");
}


export function deleteFile(fileId) {
    const tree = getWorkspace();
    const result = findNodeAndParent(tree, fileId);

    if (!result || result.node.type !== "file") return;

    const { node, parent } = result;

    if (!confirm(`Delete file "${node.name}"?`)) return;

    parent.children = parent.children.filter(c => c.id !== fileId);

    if (activeFileId === fileId) {
        activeFileId = null;
        document.getElementById("workspace-grid").classList.add("hidden");
        document.getElementById("empty-state").classList.remove("hidden");
        document.getElementById("editor-actions").classList.add("hidden");
    }

    setWorkspace(tree);
    saveState();
    renderSidebar();
}


export function renameFile(fileId) {
    const tree = getWorkspace();
    const file = findNodeById(tree, fileId);

    if (!file || file.type !== "file") return;

    const newName = prompt("Rename file:", file.name);
    if (!newName || !newName.trim()) return;

    file.name = newName.trim();

    setWorkspace(tree);
    saveState();
    renderSidebar();

    if (activeFileId === fileId) {
        document.getElementById("active-file-title").textContent = file.name;
        updateToolbar();
    }
}


export function bindPaneFocusEvents() {
    window.activePane = "editor";

    const editor = document.getElementById("editor-textarea");
    const preview = document.getElementById("preview-pane");

    editor?.addEventListener("focus", () => window.activePane = "editor");
    preview?.addEventListener("click", () => window.activePane = "preview");
}

export function zoomEditor(delta) {
    const root = document.documentElement;
    const current = parseFloat(getComputedStyle(root).getPropertyValue("--editor-font-size"));
    const next = Math.min(40, Math.max(10, current + delta));
    root.style.setProperty("--editor-font-size", next + "px");
}

export function zoomPreview(delta) {
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


export function resetZoom() {
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

export function showNotification(type, text) {
    const el = document.getElementById("notification");
    if (!el) return;

    el.className = "notification";
    el.classList.add(`notification-${type}`, "show");

    // Allow HTML - needed for reconnect link
    el.innerHTML = text;

    clearTimeout(notificationTimeout);
    notificationTimeout = setTimeout(() => {
        el.classList.remove("show");
    }, 5000);
}


export function updateLoginIndicator() {
    logger.debug("ui", "Running updateLoginIndicator()");

    // Update GitHub login button
    const loginBtn = document.getElementById("github-login");
    if (!loginBtn) {
        logger.debug("ui: updateLoginIndicator", "login button not yet in DOM");
        return;
    }

    try {
        const token = getToken();
        const gistId = getGistId();    
        const loggedIn = !!token && !!gistId;  // A user is only "logged in" if BOTH token and gistId exist

        // Clean slate - seems old states being held
        loginBtn.classList.remove("github-logged-in", "github-login-needed");

        if (loginBtn) {
            if (loggedIn) {
                loginBtn.classList.remove("github-login-needed");
                loginBtn.classList.add("github-logged-in");
                loginBtn.textContent = "GitHub Connected";
            } else {
                loginBtn.classList.remove("github-logged-in");
                loginBtn.classList.add("github-login-needed");
                loginBtn.textContent = "Sign in with GitHub";
            }
        }

        // Cloud‑action buttons to toggle
        const cloudButtons = [
            "save-btn",
            "load-btn",
            "restore-btn",
            "export-btn",
            "delete-btn"
        ];

        cloudButtons.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;

            el.disabled = !loggedIn;

            if (!loggedIn) {
                el.classList.add("cloud-disabled");
            } else {
                el.classList.remove("cloud-disabled");
            }
        });

    } catch (err) {
        logger.error("ui: updateLoginIndicator", err);
    }    
}

export function bindEditorEvents() {
    logger.debug("ui", "bindEditorEvents()");
    const textarea = document.getElementById("editor-textarea");
    if (!textarea) return;

    bindSmartKeyboardEvents(textarea);
    bindGlobalShortcuts(textarea);
    bindScrollSync(textarea);
    bindToolbarEvents(textarea);
    bindPopupEvents(textarea);
    bindSidebarEvents();
}

export function applyClearFormatting(textarea) {
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

export function applyColorFormat(color, textarea) {
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

export function toggleColorPopup(button) {
    const popup = document.getElementById("md-color-popup");

    // Hide all other popups
    hidePopups(popup);

    popup.classList.toggle("hidden");

    // Position popup under the button
    const rect = button.getBoundingClientRect();
    popup.style.left = rect.left + "px";
    popup.style.top = rect.bottom + "px";
}

export function toggleBgColorPopup(button) {
    const popup = document.getElementById("md-bgcolor-popup");

    // Hide all other popups
    hidePopups(popup);

    popup.classList.toggle("hidden");

    // Position popup under the button
    const rect = button.getBoundingClientRect();
    popup.style.left = rect.left + "px";
    popup.style.top = rect.bottom + "px";
}

export function toggleTablePopup(button) {
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

export function applyBgColorFormat(bg, textarea) {
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


export function showCountdownNotification({ countdown, onConfirm, onCancel }) {
    logger.debug("ui", "showCountdownNotification()");
    const el = document.getElementById("notification");
    if (!el) {
        logger.info("ui: showCountdownNotification", "Couldn't find element 'notification'");
        return;
    }

    clearTimeout(notificationTimeout);
    clearInterval(countdownInterval);

    try {
        let remaining = countdown;

        function bindCancel() {
            const cancel = el.querySelector("#cancel-countdown");
            if (cancel) {
                cancel.onclick = () => {
                    clearInterval(countdownInterval);
                    el.classList.remove("show");
                    onCancel();
                };
            }
        }

        function render() {
            el.className = "notification notification-countdown show";
            el.innerHTML = `
                Overwriting with newer cloud version in <strong>${remaining}</strong> seconds.
                <a id="cancel-countdown">Cancel</a>
            `;
            bindCancel();   // must be called after every render
        }

        render();

        countdownInterval = setInterval(() => {
            remaining--;
            render();

            if (remaining <= 0) {
                clearInterval(countdownInterval);
                el.classList.remove("show");
                onConfirm();
            }
        }, 1000);

    } catch (error) {
        logger.error("ui: showCountdownNotification", error);
        return;
    }     
}




// for testing purposes
if (location.hostname === "localhost") {
    window.showCountdownNotification = showCountdownNotification;
}
/* Use with:
From Console:
showCountdownNotification({
    countdown: 10,
    onConfirm: () => console.log("CONFIRMED"),
    onCancel: () => console.log("CANCELLED")
});
*/


