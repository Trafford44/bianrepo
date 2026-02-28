/*
Sync is hash-based.
lastSyncedHash is the canonical record of the last known cloud state.
Cloud-newer detection is cloudHash !== lastSyncedHash.
Timestamps are used only for idle-return and auto-save timing.
*/


import { getToken, getGistId, setGistId, requireLogin } from "./auth.js";
import { rebuildWorkspaceFromGist, flattenWorkspace, setSubjects, getSubjects, renderSidebar, saveState, setSyncStatus, showNotification, showCountdownModal } from "./ui.js";

let lastSuccessfulSyncTime = 0;          // Local wall-clock time of last sync
let lastLocalEditTime = 0;     // Last time user typed anything
let syncInterval = 2 * 60 * 1000; // 2 minutes
let idleReturnThreshold = syncInterval * 2; // 4 minutes = “user returned”
let lastSyncedHash = localStorage.getItem("lastSyncedHash") || null;



const GIST_API = "https://api.github.com/gists";

async function getLatestWorkspaceGist() {
    if (!requireLogin()) return null;

    const gistId = getGistId();
    const githubToken = getToken();

    if (!gistId) {
        // No cloud backup yet
        return null;
    }

    const res = await fetch(`${GIST_API}/${gistId}`, {
        headers: { "Authorization": `token ${githubToken}` }
    });

    if (!res.ok) {
        console.error("Failed to fetch gist metadata:", await res.text());
        return null;
    }

    const data = await res.json();
    return data; // contains .updated_at, .files, .id, etc.
}

export async function startSyncLoop() {
    await runSyncCheck("startup");

    setInterval(async () => {
        await runSyncCheck("periodic");
    }, syncInterval);
}

async function runSyncCheck(reason) {
    const now = Date.now();
    const idleReturn = now - lastSuccessfulSyncTime > idleReturnThreshold;

    const latest = await getNewestGistAcrossAccount();
    if (!latest) return;

    const cloudHash = await hashGistContent(latest.files);

    if (lastSyncedHash === null) {
        return updateSyncState(cloudHash);
    }

    if (cloudHash !== lastSyncedHash) {
        return handleCloudChange(latest, idleReturn);
    }

    updateSyncState(cloudHash);
    maybeAutoSave();
}

function updateSyncState(hash) {
    if (!hash) return; // defensive guard
    lastSyncedHash = hash;
    localStorage.setItem("lastSyncedHash", hash);
    lastSuccessfulSyncTime = Date.now();
}

async function handleCloudChange(latest, idleReturn) {
    const now = Date.now();
    const recentlyTyped = (now - lastLocalEditTime) < 30_000;

    let countdown = recentlyTyped ? 30 : 10;

    showCountdownModal({
        countdown,
        message: "A newer cloud version was found.",
        onConfirm: async () => {
            setGistId(latest.id);
            await loadWorkspaceFromGist();

            // FIX: update hash correctly
            lastSyncedHash = await hashGistContent(latest.files);
            localStorage.setItem("lastSyncedHash", lastSyncedHash);
            lastSuccessfulSyncTime = Date.now();
        },
        onCancel: () => {
            showNotification("warning",
                "Cloud version is newer. Saving now will overwrite it."
            );
        }
    });
}

async function hashGistContent(files) {
    const entries = Object.entries(files)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, f]) => name + "\n" + (f.content || ""));

    const content = entries.join("\n---\n");

    const buffer = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(content)
    );

    return Array.from(new Uint8Array(buffer))
        .map(x => x.toString(16).padStart(2, "0"))
        .join("");
}



async function maybeAutoSave() {
    const now = Date.now();

    // Only auto-save if user typed since last sync
    const hasLocalChanges = (now - lastLocalEditTime) < syncInterval;

    if (!hasLocalChanges) return;

    // Do not auto-save if cloud is newer
    if (await cloudHashChanged()) return;

    await saveWorkspaceToGist();
}

async function cloudHashChanged() {
    const latest = await getLatestWorkspaceGist();
    if (!latest) return false;

    const cloudHash = await hashGistContent(latest.files);
    return cloudHash !== lastSyncedHash;
}

window.debugCloud = async () => {
    const latest = await getNewestGistAcrossAccount();

    if (!latest) {
        console.log("No gist found. Possible causes:");
        console.log("- Not logged in");
        console.log("- Token expired");
        console.log("- No gists exist for this account");
        console.log("- GitHub API returned an error");
        return;
    }

    console.log("Gist ID:", latest.id);
    console.log("updated_at:", latest.updated_at);

    const hash = await hashGistContent(latest.files);
    console.log("cloudHash:", hash);
};


export async function saveWorkspaceToGist() {
    if (!requireLogin()) return;

    const githubToken = getToken();
    let gistId = getGistId();

    showSyncState("saving");

    if (!gistId) {
        console.log("No gist ID — creating new gist");
    }

    const files = flattenWorkspace();
    const gistFiles = {};
    files.forEach(f => {
        gistFiles[f.path] = { content: f.content || "" };
    });

    const body = {
        description: "BIAN Workspace Backup",
        public: false,
        files: gistFiles
    };

    const workspaceFileList = files => files.map(f => f.path).sort();
    const gistFileList = gistFiles => Object.keys(gistFiles).sort();

    let method = "POST";
    let url = GIST_API;

    if (gistId) {
        try {
            const existing = await fetch(`${GIST_API}/${gistId}`, {
                headers: { "Authorization": `token ${githubToken}` }
            }).then(r => r.json());

            if (existing && existing.files) {
                const existingFiles = gistFileList(existing.files);
                const newFiles = workspaceFileList(files);
                const filenamesMatch =
                    JSON.stringify(existingFiles) === JSON.stringify(newFiles);

                if (filenamesMatch) {
                    method = "PATCH";
                    url = `${GIST_API}/${gistId}`;
                } else {
                    gistId = null;
                    method = "POST";
                    url = GIST_API;
                }
            } else {
                gistId = null;
            }
        } catch (err) {
            console.error("Error checking existing Gist:", err);
            showSyncState("error");
            showNotification("error", "Failed to load workspace");
            return;
        }
    }

    const res = await fetch(url, {
        method,
        headers: {
            "Authorization": `token ${githubToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    const data = await res.json();

    if (!res.ok) {
        console.error("Gist save error:", data);
        showSyncState("error");
        showNotification("error", "Failed to load workspace");
        return;
    }

    if (!gistId && data.id) {
        setGistId(data.id);
    }

    lastSyncedHash = await hashGistContent(data.files);
    localStorage.setItem("lastSyncedHash", lastSyncedHash);
    lastSuccessfulSyncTime = Date.now();

    // UI: successfully synced
    showSyncState("synced");
    showNotification("success", "Workspace saved to cloud");
}

function showSyncState(state) {
    const map = {
        saving: ["saving", "Saving…"],
        synced: ["synced", "Synced"],
        error: ["error", "Error"]
    };
    setSyncStatus(...map[state]);
}

export async function loadWorkspaceFromGist() {

    if (!requireLogin()) return;

    const gistId = getGistId();
    const githubToken = getToken();

    if (!gistId) {
        showNotification("info", "No cloud backup found. Save to Cloud first.");
        return;
    }

    const res = await fetch(`${GIST_API}/${gistId}`, {
        headers: { "Authorization": `token ${githubToken}` }
    });

    const data = await res.json();

    const subjects = rebuildWorkspaceFromGist(data.files);
    setSubjects(subjects);
    saveState();
    renderSidebar();
    showNotification("success", "Workspace loaded from cloud");
}

async function getNewestGistAcrossAccount() {
    if (!requireLogin()) return null;

    const githubToken = getToken();

    const res = await fetch("https://api.github.com/gists", {
        headers: { "Authorization": `token ${githubToken}` }
    });

    if (!res.ok) return null;

    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) return null;

    // Sort by updated_at descending
    list.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    return list[0]; // newest gist
}

export async function listGistRevisions() {
    if (!requireLogin()) return [];

    const githubToken = getToken();
    const gistId = getGistId();

    if (!gistId) {
        showNotification("info", "No Gist ID found");
        return [];
    }

    const res = await fetch(`${GIST_API}/${gistId}/commits`, {
        headers: { "Authorization": `token ${githubToken}` }
    });

    const data = await res.json();
    return data;
}

export async function restoreFromGistVersion(versionId) {
    if (!requireLogin()) return;

    const gistId = getGistId();
    const githubToken = getToken();

    const res = await fetch(`${GIST_API}/${gistId}/${versionId}`, {
        headers: { "Authorization": `token ${githubToken}` }
    });

    const data = await res.json();

    const subjects = rebuildWorkspaceFromGist(data.files);
    setSubjects(subjects);
    saveState();
    renderSidebar();

    showNotification("success", "Workspace restored from previous version");
}

export function markLocalEdit() {
    lastLocalEditTime = Date.now();
}

export async function showRestoreDialog() {
    const revisions = await listGistRevisions();
    if (!revisions || revisions.length === 0) return;

    let msg = "Choose a version to restore:\n\n";
    revisions.forEach((rev, i) => {
        msg += `${i + 1}. ${rev.version} — ${rev.committed_at}\n`;
    });

    const choice = prompt(msg);
    if (!choice) return;

    const index = parseInt(choice, 10) - 1;
    const versionId = revisions[index]?.version;
    if (!versionId) return;

    await restoreFromGistVersion(versionId);
}
