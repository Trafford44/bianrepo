import { saveWorkspaceToGist, loadWorkspaceFromGist, showRestoreDialog } from "./sync.js";
import { getToken } from "./auth.js";
import { applyMarkdownFormat } from "./md-editor.js";

let subjects = JSON.parse(localStorage.getItem("kb_data")) || [
    {
        id: "s1",
        title: "Subject 1",
        isOpen: true,
        files: [
            {
                id: "f1",
                title: "Readme",
                type: "md",
                content:
                    "# Welcome\nThis is a Markdown file with PlantUML support.\n\n@startuml\nUser -> System: Request\nSystem -> Database: Query\nDatabase --> System: Results\nSystem --> User: Display\n@enduml"
            },
            {
                id: "f2",
                title: "System Architecture",
                type: "puml",
                content:
                    "@startuml\nactor User\nnode \"Web Server\" {\n  component \"Express App\"\n}\ndatabase PostgreSQL\n\nUser -> \"Express App\": HTTP Request\n\"Express App\" -> PostgreSQL: SQL\n@enduml"
            }
        ]
    }
];

let activeFileId = null;
let activeSubjectId = null;
let activePane = "editor"; // "editor" or "preview"


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

    if (sbResizer) {
        sbResizer.addEventListener("mousedown", e => {
            e.preventDefault();
            sbResizer.classList.add("resizing");
            const handleSidebarResize = e2 => {
                const newWidth = e2.clientX;
                if (newWidth >= 200 && newWidth <= 600) {
                    sidebar.style.width = newWidth + "px";
                }
            };
            const stop = () => {
                sbResizer.classList.remove("resizing");
                document.removeEventListener("mousemove", handleSidebarResize);
                document.removeEventListener("mouseup", stop);
            };
            document.addEventListener("mousemove", handleSidebarResize);
            document.addEventListener("mouseup", stop);
        });
    }

    if (edResizer) {
        edResizer.addEventListener("mousedown", e => {
            e.preventDefault();
            edResizer.classList.add("resizing");
            const handleEditorResize = e2 => {
                const workspaceRect = workspace.getBoundingClientRect();
                const newWidth = workspaceRect.right - e2.clientX;

                if (newWidth >= 100 && newWidth <= workspaceRect.width - 100) {
                    editorCont.style.width = newWidth + "px";
                    editorCont.style.flex = "none";
                }
            };
            const stop = () => {
                edResizer.classList.remove("resizing");
                document.removeEventListener("mousemove", handleEditorResize);
                document.removeEventListener("mouseup", stop);
            };
            document.addEventListener("mousemove", handleEditorResize);
            document.addEventListener("mouseup", stop);
        });
    }
}

export function renderSidebar() {
    const container = document.getElementById("sidebar-list");
    if (!container) return;

    container.innerHTML = "";

    subjects.forEach(subject => {
        const sContainer = document.createElement("div");
        sContainer.className = "subject-container";

        const sHeader = document.createElement("div");
        sHeader.className = "subject-header";
        sHeader.innerHTML = `
            <span class="chevron ${subject.isOpen ? "open" : ""}">▶</span>
            <span class="subject-title">${subject.title}</span>
            <button class="btn-add-file">+ File</button>
        `;
        sHeader.querySelector(".btn-add-file").addEventListener("click", e => {
            e.stopPropagation();
            addFile(subject.id);
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
                        <span class="file-icon">${file.type === "md" ? "M↓" : "⬡"}</span>
                        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${file.title}</span>
                    </div>
                    <div class="file-actions">
                        <div class="icon-btn" title="Duplicate">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg>
                        </div>
                        <div class="icon-btn del" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>
                        </div>
                    </div>
                `;
                fDiv.addEventListener("click", e => {
                    e.stopPropagation();
                    loadFile(subject.id, file.id);
                });
                const [dupBtn, delBtn] = fDiv.querySelectorAll(".icon-btn");
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

    document.getElementById("active-file-title").textContent = file.title;
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
}

export function updatePreview() {
    const textarea = document.getElementById("editor-textarea");
    const preview = document.getElementById("preview-pane");
    const content = textarea.value;

    const subject = subjects.find(s => s.id === activeSubjectId);
    const file = subject?.files.find(f => f.id === activeFileId);
    if (!file) return;

    file.content = content;
    saveState();

    if (file.type === "puml") {
        const url = getPumlUrl(content);
        preview.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center;">
                <img src="${url}" alt="PlantUML Diagram" />
                <a href="${url}" target="_blank" style="font-size: 0.75rem; color: #9ca3af; margin-top: 1rem; text-decoration: underline;">Open SVG link</a>
            </div>`;
    } else {
        const pumlRegex = /@startuml([\s\S]*?)@enduml/g;
        const processed = content.replace(pumlRegex, (match, p1) => {
            const url = getPumlUrl(p1);
            return `\n![PlantUML](${url})\n`;
        });
        preview.innerHTML = `<div class="prose">${marked.parse(processed)}</div>`;
    }
}

function getPumlUrl(puml) {
    try {
        const encoded = plantumlEncoder.encode(puml.trim());
        return `https://www.plantuml.com/plantuml/svg/${encoded}`;
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

export function bindPaneFocusEvents() {
    const editor = document.getElementById("editor-textarea");
    const preview = document.getElementById("preview-pane");

    editor?.addEventListener("focus", () => activePane = "editor");
    preview?.addEventListener("click", () => activePane = "preview");
}

export function zoomEditor(delta) {
    const root = document.documentElement;
    const current = parseFloat(getComputedStyle(root).getPropertyValue("--editor-font-size"));
    const next = Math.min(40, Math.max(10, current + delta));
    root.style.setProperty("--editor-font-size", next + "px");
}

export function zoomPreview(delta) {
    const root = document.documentElement;
    const current = parseFloat(getComputedStyle(root).getPropertyValue("--preview-font-size"));
    const next = Math.min(40, Math.max(10, current + delta));
    root.style.setProperty("--preview-font-size", next + "px");
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
    if (bgPopup) {
        bgPopup.addEventListener("click", e => {
            const bg = e.target.dataset.bg;
            if (!bg) return;

            applyBgColorFormat(bg, textarea);
            bgPopup.classList.add("hidden");
        });
    }

}

function toggleColorPopup(button) {
    const popup = document.getElementById("md-color-popup");
    popup.classList.toggle("hidden");

    // Position popup under the button
    const rect = button.getBoundingClientRect();
    popup.style.left = rect.left + "px";
    popup.style.top = rect.bottom + "px";
}

function applyClearFormatting(textarea) {
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
        .replace(/\*\*(.*?)\*\*/g, "$1")   // bold
        .replace(/\*(.*?)\*/g, "$1")       // italic
        .replace(/__(.*?)__/g, "$1")       // bold alt
        .replace(/_(.*?)_/g, "$1")         // italic alt
        .replace(/~~(.*?)~~/g, "$1")       // strike
        .replace(/`(.*?)`/g, "$1");        // inline code

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

function toggleBgColorPopup(button) {
    const popup = document.getElementById("md-bgcolor-popup");
    popup.classList.toggle("hidden");

    const rect = button.getBoundingClientRect();
    popup.style.left = rect.left + "px";
    popup.style.top = rect.bottom + "px";
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

