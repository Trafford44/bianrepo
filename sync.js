/*
Sync is hash-based.
lastSyncedHash is the canonical record of the last known cloud state.
Cloud-newer detection is cloudHash !== lastSyncedHash.
Timestamps are used only for idle-return and auto-save timing.
*/


import { getToken, getGistId, setGistId, requireLogin } from "./auth.js";
import { rebuildWorkspaceFromGist, flattenWorkspace, setSubjects, getSubjects, renderSidebar, saveState, setSyncStatus, showNotification, showCountdownModal } from "./ui.js";
import { logger, LOG_LEVELS, formatDateNZ } from "./logger.js";

let lastSuccessfulSyncTime = 0;          // Local wall-clock time of last sync
let lastLocalEditTime = 0;     // Last time user typed anything
let syncInterval = 2 * 60 * 1000; // 2 minutes
let idleReturnThreshold = syncInterval * 2; // 4 minutes = “user returned”
let lastSyncedHash = localStorage.getItem("lastSyncedHash") || null;



const GIST_API = "https://api.github.com/gists";

async function getCurrentWorkspaceGist() {
    if (!requireLogin()) {
        logger.info("sync: getCurrentWorkspaceGist", "Not logged in.");
        return null;
    }

    const gistId = getGistId();
    const githubToken = getToken();

    if (!gistId) {
        logger.info("sync: getCurrentWorkspaceGist", "No gistId found in localStorage.");
        return null;
    }

    logger.info("sync: getCurrentWorkspaceGist", `Fetching gist with ID: ${gistId}`);

    const res = await fetch(`${GIST_API}/${gistId}`, {
        headers: { "Authorization": `token ${githubToken}` }
    });

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

    setInterval(async () => {
        await runSyncCheck("periodic");
    }, syncInterval);
}

async function runSyncCheck(reason) {
    logger.info("sync: runSyncCheck", `Running sync check (reason: ${reason})`);

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
        logger.info("sync: debugCloud", "No gist found when fetching newest gist across account. Possible causes: Not logged in, token expired, no gists exist for this account or GitHub API error.");
        return;
    }

    logger.info("sync: debugCloud", `Fetched newest gist across account (ID: ${latest.id}, updated_at: ${formatDateNZ(latest.updated_at)}, files: ${Object.keys(latest.files).join(", ")})`);

    const hash = await hashGistContent(latest.files);
    logger.info("sync: debugCloud", `Computed cloudHash for newest gist: ${hash}`);
};


export async function saveWorkspaceToGist() {
    if (!requireLogin()) return;

    const githubToken = getToken();
    let gistId = getGistId();

    showSyncState("saving");

    logger.info("sync: saveWorkspaceToGist", `Starting save process. Current gistId: ${gistId || "(none)"}`);

    const files = flattenWorkspace();
    const gistFiles = {};
    files.forEach(f => {
        gistFiles[f.path] = { content: f.content || "" };
    });

    logger.info("sync: saveWorkspaceToGist", `Prepared ${Object.keys(gistFiles).length} files for saving: ${Object.keys(gistFiles).join(", ")}`);

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
        logger.info("sync: saveWorkspaceToGist", `Updating existing gist with ID: ${gistId} using PATCH method.`);

        // Determine which files were deleted locally
        const existing = await fetch(`${GIST_API}/${gistId}`, {
            headers: { "Authorization": `token ${githubToken}` }
        }).then(r => r.json());

        if (existing && existing.files) {
            const existingNames = Object.keys(existing.files);
                logger.info("sync: saveWorkspaceToGist", `Existing cloud files before update: ${existingNames.join(", ")}`);

            for (const existingName of existingNames) {
                const stillExistsLocally = files.some(f => f.path === existingName);
                if (!stillExistsLocally) {
                    logger.info("sync: saveWorkspaceToGist", `Marking file for deletion: ${existingName}`);
                    body.files[existingName] = null;
                }
            }
        }
    } else {
        // No gist yet — create one
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
