/*
Sync is hash-based.
lastSyncedHash is the canonical record of the last known cloud state.
Cloud-newer detection is cloudHash !== lastSyncedHash.
Timestamps are used only for idle-return and auto-save timing.
*/


import { 
    getToken, 
    getGistId, 
    setGistId, 
    requireLogin 
} from "./auth.js";

import { 
    setWorkspace,
    saveState,
    getWorkspace,
} from "./workspace.js";

import {
    renderSidebar,
    setSyncStatus,
    showNotification,
    showCountdownNotification
} from "./ui.js";


import { 
    flattenWorkspace,
    unflattenWorkspace
} from "./workspace.js";

import { 
    logger, 
    LOG_LEVELS, 
    formatDateNZ 
} from "./logger.js";

import {
    extractMetadata,
    applyMetadata
} from "./workspace-metadata.js";   


let lastSuccessfulSyncTime = 0;          // Local wall-clock time of last sync
let lastLocalEditTime = 0;     // Last time user typed anything
let syncInterval = 2 * 60 * 1000; // 2 minutes
let idleReturnThreshold = syncInterval * 2; // 4 minutes = “user returned”
let lastSyncedHash = localStorage.getItem("lastSyncedHash") || null;
let syncIntervalId = null;
let isSaving = false;
let lastActivityTime = Date.now(); 
const IDLE_THRESHOLD = 30_000; // 30 seconds

const GIST_API = "https://api.github.com/gists";
console.log("sync.js loaded from:", import.meta.url);


async function getCurrentWorkspaceGist() {
    if (!requireLogin()) {
        logger.info("sync: getCurrentWorkspaceGist", "Not logged in.");
        return null;
    }

    const gistId = getGistId();
    const githubToken = getToken();
    if (!gistId || !githubToken) {
        logger.info("sync: getCurrentWorkspaceGist", "No gistId or token found in localStorage.");
        disconnectFromGitHub("Cloud connection lost.");
        return null;
    }

    logger.info("sync: getCurrentWorkspaceGist", `Fetching gist with ID: ${gistId}`);

    const res = await fetch(`${GIST_API}/${gistId}`, {
        headers: { "Authorization": `token ${githubToken}` }
    });

    if (res.status === 401) {
        logger.error("sync: getCurrentWorkspaceGist", "GitHub token invalid or expired. Disconnecting.");
        disconnectFromGitHub("Cloud token expired.");
        return null;
    }

    if (!res.ok) {
        const text = await res.text();
        logger.error("sync: getCurrentWorkspaceGist", `Failed to fetch gist (status: ${res.status})`);
        return null;
    }

    const data = await res.json();

    if (!data || !data.files) {
        logger.error("sync: getCurrentWorkspaceGist", "Response missing files property");
        return null;
    }   

    logger.info("sync: getCurrentWorkspaceGist", `Fetched gist with ID: ${data.id}, updated_at: ${formatDateNZ(data.updated_at)}`, { files: Object.keys(data.files) });

    return data;
}


export async function startSyncLoop() {
    await runSyncCheck("startup");
console.log("startSyncLoop called");
    syncIntervalId = setInterval(async () => {
        await runSyncCheck("periodic");
    }, syncInterval);
}

export function stopSyncLoop() {
    console.log("stopSyncLoop:", syncIntervalId);

    if (syncIntervalId !== null) {
        clearInterval(syncIntervalId);
        syncIntervalId = null;
    }
}


// re-check the token immediately after wake to handle cases where GitHub token becomes invalid after laptop suspend
export async function bindVisibilityEvents() {
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            runSyncCheck("resume");
        }
    });
}

export function bindActivityEvents() {
    document.addEventListener("keydown", markActivity);
    document.addEventListener("mousemove", markActivity);
    document.addEventListener("mousedown", markActivity);
    document.addEventListener("touchstart", markActivity);
    document.addEventListener("focus", markActivity);
}

function markActivity() {
    const now = Date.now();
    const wasIdle = (now - lastActivityTime) > IDLE_THRESHOLD;
    lastActivityTime = now;

    if (wasIdle) {
        runSyncCheck("resume");
    }
}

function setConnectionButtonState(connected) {
    const loginBtn = document.getElementById("github-login");
    if (!loginBtn) return;

    if (connected) {
        loginBtn.textContent = "Connected to Cloud";
        loginBtn.classList.add("connected");
        loginBtn.classList.remove("github-login-needed");
    } else {
        loginBtn.textContent = "Sign in to Cloud";
        loginBtn.classList.add("github-login-needed");
        loginBtn.classList.remove("connected");
    }
}

function bindReconnectLink() {
    // Delay ensures the notification HTML is in the DOM
    setTimeout(() => {
        const link = document.getElementById("reconnect-link");
        if (!link) return;

        link.addEventListener("click", (e) => {
            e.preventDefault();
            const btn = document.getElementById("github-login");
            if (btn) btn.click();
        });
    }, 0);
}

function disconnectFromGitHub(message) {
    setSyncStatus("error", "Disconnected");
    setConnectionButtonState(false);
    showNotification("error",`${message} <a href="#" id="reconnect-link">Reconnect</a>.`);
    bindReconnectLink();
    stopSyncLoop();
}

function connectToGitHub() {
    setSyncStatus("synced", "Connected");
    setConnectionButtonState(true);
    showNotification("success", "Connected to cloud");
}

export async function runSyncCheck(reason) {
    logger.info("sync: runSyncCheck", `Running sync check (reason: ${reason})`);

    // --- Guard: stop if token or gistId missing (common after laptop suspend) ---
    const token = getToken();
    const gistId = getGistId();
    if (!token || !gistId) {
        logger.error("sync: runSyncCheck", "Missing token or gistId — likely after suspend/wake. Stopping sync.");
        disconnectFromGitHub("Cloud connection lost.");
        return;
    }
    // ---------------------------------------------------------------------------

    const now = Date.now();
    const idleReturn = now - lastSuccessfulSyncTime > idleReturnThreshold;

    logger.info("sync: runSyncCheck", `Idle return: ${idleReturn} (last successful sync was at ${new Date(lastSuccessfulSyncTime).toISOString()})`);   

    const latest = await getCurrentWorkspaceGist();
    if (!latest) {
        logger.info("sync: runSyncCheck", "No current workspace gist found. Aborting sync check.");
        return;
    }

    logger.info("sync: runSyncCheck", `Fetched latest gist (ID: ${latest.id}, Cloud updated_at: ${formatDateNZ(latest.updated_at)}`, `Cloud files: ${Object.keys(latest.files).join(", ")}`);

    const cloudHash = await hashGistContent(latest.files);
    logger.info("sync: runSyncCheck", `Computed cloudHash: ${cloudHash}, lastSyncedHash: ${lastSyncedHash}`);

    // First-time sync: adopt cloud hash
    if (lastSyncedHash === null) {
        logger.info("sync: runSyncCheck", "No lastSyncedHash found. Adopting cloud hash as baseline."); 
        lastSyncedHash = cloudHash;
        localStorage.setItem("lastSyncedHash", cloudHash);
        updateSyncState();
        return;
    }

    // On resume, only sync if cloud changed OR local edits exist
    if (reason === "resume") {
        const now = Date.now();
        const hasLocalChanges = (now - lastLocalEditTime) < syncInterval;

        if (!hasLocalChanges && cloudHash === lastSyncedHash) {
            logger.info("sync: runSyncCheck", "Resume detected but no cloud changes or local edits — skipping sync.");
            updateSyncState();
            return;
        }
    }

    // Cloud is newer
    if (cloudHash !== lastSyncedHash) {
        logger.info("sync: runSyncCheck", "Cloud hash differs from lastSyncedHash. Cloud is newer. Triggering cloud-change handler.");
        return handleCloudChange(latest, idleReturn);
    }

    logger.info("sync: runSyncCheck", "Cloud hash matches lastSyncedHash. Updating sync timestamp and checking for auto-save.");
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

    showCountdownNotification({
        countdown,
        onConfirm: async () => {
            setGistId(latest.id);
            await loadWorkspaceFromGist();

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
        logger.info("sync: debugCloud", "No gist found when fetching newest gist across account. Possible causes: Not logged in, token expired, no gists exist for this account or GitHub API error.");
        return;
    }

    logger.info("sync: debugCloud", `Fetched newest gist across account (ID: ${latest.id}, updated_at: ${formatDateNZ(latest.updated_at)}, files: ${Object.keys(latest.files).join(", ")})`);

    const hash = await hashGistContent(latest.files);
    logger.info("sync: debugCloud", `Computed cloudHash for newest gist: ${hash}`);
};

export async function saveWorkspaceToGist() {
    if (!requireLogin()) return;

    if (isSaving) {
        logger.info("sync: saveWorkspaceToGist", "Save skipped — already in progress.");
        return;
    }

    isSaving = true;
    try {
        const githubToken = getToken();
        let gistId = getGistId();

        showSyncState("saving");

        logger.info("sync: saveWorkspaceToGist", `Starting save process. Current gistId: ${gistId || "(none)"}`);

        const files = flattenWorkspace(getWorkspace());
        const gistFiles = {};

        files.forEach(f => {
            gistFiles[f.path] = { content: f.content || "" };
        });

        // save metadata as a special file in the gist
        const metadata = extractMetadata(getWorkspace());
        gistFiles["__workspace.json"] = {
            content: JSON.stringify(metadata, null, 2)
        };

        logger.info("sync: saveWorkspaceToGist", `Prepared ${Object.keys(gistFiles).length} files for saving: ${Object.keys(gistFiles).join(", ")}`);

        const body = {
            description: "BIAN Workspace Backup",
            public: false,
            files: gistFiles
        };

        let method = "POST";
        let url = GIST_API;

        if (gistId) {
            method = "PATCH";
            url = `${GIST_API}/${gistId}`;
            logger.info("sync: saveWorkspaceToGist", `Updating existing gist with ID: ${gistId} using PATCH method.`);

            const existing = await fetch(`${GIST_API}/${gistId}`, {
                headers: { "Authorization": `token ${githubToken}` }
            }).then(r => r.json());

            if (existing && existing.files) {
                const existingNames = Object.keys(existing.files);
                logger.info("sync: saveWorkspaceToGist", `Existing cloud files before update: ${existingNames.join(", ")}`);

                for (const existingName of existingNames) {

                    // DO NOT DELETE METADATA FILE
                    if (existingName === "__workspace.json") continue;     

                    const stillExistsLocally = files.some(f => f.path === existingName);
                    if (!stillExistsLocally) {
                        logger.info("sync: saveWorkspaceToGist", `Marking file for deletion: ${existingName}`);
                        body.files[existingName] = null;
                    }
                }
            }
        } else {
            method = "POST";
            url = GIST_API;
            logger.info("sync: saveWorkspaceToGist", "No gistId found — creating new gist via POST");
        }

        logger.info("sync: saveWorkspaceToGist", `Final request method: ${method}`);
        logger.info("sync: saveWorkspaceToGist", `Final request URL: ${url}`);
        logger.info("sync: saveWorkspaceToGist", `Final file list being sent: ${Object.keys(body.files).join(", ")}`);

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
            logger.error("sync: saveWorkspaceToGist", `Gist save error: ${data.message || "Unknown error"}`);
            showSyncState("error");
            showNotification("error", "Failed to load workspace");
            logger.info("sync: saveWorkspaceToGist", "--- SAVE FAILED ---");
            return;
        }

        if (!gistId && data.id) {
            logger.info("sync: saveWorkspaceToGist", `New gist created with ID: ${data.id}`);
            setGistId(data.id);
        }

        lastSyncedHash = await hashGistContent(data.files);
        localStorage.setItem("lastSyncedHash", lastSyncedHash);
        lastSuccessfulSyncTime = Date.now();

        logger.info("sync: saveWorkspaceToGist", "Save successful.");
        logger.info("sync: saveWorkspaceToGist", `Updated lastSyncedHash: ${lastSyncedHash}`);
        logger.info("sync: saveWorkspaceToGist", "--- SAVE END ---");

        showSyncState("synced");
        showNotification("success", "Saved to cloud");

    } finally {
        isSaving = false;
    }
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

    // Convert flat gist files → recursive workspace tree
    const flat = {};
    for (const filename in data.files) {
        flat[filename] = data.files[filename].content;
    }

    const tree = unflattenWorkspace(flat);

    // Ensure root is ALWAYS an array
    if (!Array.isArray(tree)) {
        tree = [tree];
    }

    migrateWorkspace(tree); // 🔥 NEW: migrate to the latest model
    setWorkspace(tree);
    saveState();
    renderSidebar();

    showNotification("success", "Data loaded from Cloud");
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
        showNotification("info", "No cloud backup found");
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

    // ⭐ 1. Load metadata file if present
    const metadataFile = data.files["__workspace.json"];
    let metadata = null;

    if (metadataFile && metadataFile.content) {
        try {
            metadata = JSON.parse(metadataFile.content);
        } catch (e) {
            console.warn("Invalid metadata file", e);
        }
    }

    // 2. Convert flat gist files → recursive workspace tree
    const flat = {};
    for (const filename in data.files) {
        if (filename === "__workspace.json") continue; // skip metadata file
        flat[filename] = data.files[filename].content;
    }

    let tree = unflattenWorkspace(flat);

    // ⭐ 3. Apply metadata to the reconstructed tree
    if (metadata) {
        applyMetadata(tree, metadata);
    }

    // 4. Save into app state
    setWorkspace(tree);
    saveState();
    renderSidebar();

    showNotification("success", "Workspace restored from previous version");
}



export function markLocalEdit() {
    lastLocalEditTime = Date.now();
    logger.info("sync: markLocalEdit", `Local edit detected at ${new Date(lastLocalEditTime).toISOString()}`);
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
