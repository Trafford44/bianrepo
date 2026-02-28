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

async function getCurrentWorkspaceGist() {
    if (!requireLogin()) {
        console.log("[SYNC] getCurrentWorkspaceGist: Not logged in.");
        return null;
    }

    const gistId = getGistId();
    const githubToken = getToken();

    if (!gistId) {
        console.log("[SYNC] getCurrentWorkspaceGist: No gistId stored.");
        return null;
    }

    console.log("[SYNC] Fetching current workspace gist:", gistId);

    const res = await fetch(`${GIST_API}/${gistId}`, {
        headers: { "Authorization": `token ${githubToken}` }
    });

    if (!res.ok) {
        const text = await res.text();
        console.error("[SYNC] Failed to fetch current gist:", text);
        return null;
    }

    const data = await res.json();

    if (!data || !data.files) {
        console.error("[SYNC] getCurrentWorkspaceGist: Response missing files.");
        return null;
    }

    console.log("[SYNC] Cloud gist fetched successfully.");
    console.log("[SYNC] updated_at:", data.updated_at);
    console.log("[SYNC] Cloud files:", Object.keys(data.files));

    return data;
}


export async function startSyncLoop() {
    await runSyncCheck("startup");

    setInterval(async () => {
        await runSyncCheck("periodic");
    }, syncInterval);
}

async function runSyncCheck(reason) {
    console.log("[SYNC] --- RUN SYNC CHECK ---");
    console.log("[SYNC] Reason:", reason);

    const now = Date.now();
    const idleReturn = now - lastSuccessfulSyncTime > idleReturnThreshold;

    console.log("[SYNC] lastSuccessfulSyncTime:", lastSuccessfulSyncTime);
    console.log("[SYNC] idleReturn:", idleReturn);

    const latest = await getCurrentWorkspaceGist();
    if (!latest) {
        console.log("[SYNC] No current workspace gist found. Aborting sync check.");
        return;
    }

    console.log("[SYNC] Reading gist ID:", latest.id);
    console.log("[SYNC] Cloud updated_at:", latest.updated_at);
    console.log("[SYNC] Cloud files:", Object.keys(latest.files));

    const cloudHash = await hashGistContent(latest.files);
    console.log("[SYNC] cloudHash:", cloudHash);
    console.log("[SYNC] lastSyncedHash:", lastSyncedHash);

    // First-time sync: adopt cloud hash
    if (lastSyncedHash === null) {
        console.log("[SYNC] No lastSyncedHash — adopting cloud hash.");
        lastSyncedHash = cloudHash;
        localStorage.setItem("lastSyncedHash", cloudHash);
        updateSyncState();
        return;
    }

    // Cloud is newer
    if (cloudHash !== lastSyncedHash) {
        console.log("[SYNC] Cloud hash differs — cloud is newer. Triggering cloud-change handler.");
        return handleCloudChange(latest, idleReturn);
    }

    console.log("[SYNC] Cloud matches local — updating sync timestamp and checking auto-save.");
    updateSyncState();
    maybeAutoSave();
}



function updateSyncState() {
    // Only updates timing — never the hash.
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
    const latest = await getCurrentWorkspaceGist();
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

    console.log("[SYNC] --- SAVE START ---");
    console.log("[SYNC] Current gistId:", gistId || "(none)");

    const files = flattenWorkspace();
    const gistFiles = {};
    files.forEach(f => {
        gistFiles[f.path] = { content: f.content || "" };
    });

    console.log("[SYNC] Local files to save:", Object.keys(gistFiles));

    const body = {
        description: "BIAN Workspace Backup",
        public: false,
        files: gistFiles
    };

    let method = "POST";
    let url = GIST_API;

    // Always PATCH if gistId exists, to preserve history and allow file deletions.
    if (gistId) {
        method = "PATCH";
        url = `${GIST_API}/${gistId}`;
        console.log("[SYNC] Using PATCH to update existing gist:", gistId);

        // Determine which files were deleted locally
        const existing = await fetch(`${GIST_API}/${gistId}`, {
            headers: { "Authorization": `token ${githubToken}` }
        }).then(r => r.json());

        if (existing && existing.files) {
            const existingNames = Object.keys(existing.files);
            console.log("[SYNC] Existing cloud files:", existingNames);

            for (const existingName of existingNames) {
                const stillExistsLocally = files.some(f => f.path === existingName);
                if (!stillExistsLocally) {
                    console.log("[SYNC] Marking file for deletion:", existingName);
                    body.files[existingName] = null;
                }
            }
        }
    } else {
        // No gist yet — create one
        method = "POST";
        url = GIST_API;
        console.log("[SYNC] No gistId found — creating new gist via POST");
    }

    console.log("[SYNC] Final request method:", method);
    console.log("[SYNC] Final request URL:", url);
    console.log("[SYNC] Final file list being sent:", Object.keys(body.files));

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
        console.error("[SYNC] Gist save error:", data);
        showSyncState("error");
        showNotification("error", "Failed to load workspace");
        console.log("[SYNC] --- SAVE FAILED ---");
        return;
    }

    if (!gistId && data.id) {
        console.log("[SYNC] New gist created with ID:", data.id);
        setGistId(data.id);
    }

    lastSyncedHash = await hashGistContent(data.files);
    localStorage.setItem("lastSyncedHash", lastSyncedHash);
    lastSuccessfulSyncTime = Date.now();

    console.log("[SYNC] Save successful.");
    console.log("[SYNC] Updated lastSyncedHash:", lastSyncedHash);
    console.log("[SYNC] --- SAVE END ---");

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
    console.log("[SYNC] Local edit detected at", new Date(lastLocalEditTime).toISOString());

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
