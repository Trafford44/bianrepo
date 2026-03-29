/*
Sync is hash-based.
lastSyncedHash is the canonical record of the last known cloud state.
Cloud-newer detection is cloudHash !== lastSyncedHash.
Timestamps are used only for idle-return and auto-save timing.
*/


import { getToken, getGistId, setGistId, requireLogin } from "./auth.js";
import { setWorkspace, saveState, getWorkspace, flattenWorkspace, migrateWorkspace, mergeWorkspace, createEmptyWorkspace, loadState, inflateWorkspace } from "./workspace.js";
import { renderSidebar, setSyncStatus, showNotification, showCountdownNotification} from "./ui.js";
import { logger, LOG_LEVELS, formatDateNZ } from "./logger.js";
import { extractMetadata, applyMetadata} from "./workspace-metadata.js";   
import { updateSyncToggleButton } from "./binding.js";


let lastSuccessfulSyncTime = 0;          // Local wall-clock time of last sync
let lastLocalEditTime = 0;     // Last time user typed anything
let syncInterval = 2 * 60 * 1000; // 2 minutes
let idleReturnThreshold = syncInterval * 2; // 4 minutes = “user returned”
let lastSyncedHash = localStorage.getItem("lastSyncedHash") || null;
let syncIntervalId = null;
let isSaving = false;
let lastActivityTime = Date.now(); 
const IDLE_THRESHOLD = 30_000; // 30 seconds

// When we have paths populated, chane to using paths, so as to avoind duplicate files. So wil lbecome EXCLUSION_PATHS
export const EXCLUSION_FILES = new Set(["__workspace.json", "workspace.json"]);

const GIST_API = "https://api.github.com/gists";

logger.debug("sync","sync.js loaded from:", import.meta.url);

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

    try {
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

    } catch (error) {
        logger.error("sync: getCurrentWorkspaceGist", error);
        return null;
    }            
}


export async function startSyncLoop() {
    logger.debug("sync", "Running startSyncLoop()");
    if (syncIntervalId !== null) {
        logger.warn("sync", "startSyncLoop() called but loop already running");
        return;
    }    
    try {
        await runSyncCheck("startup");
        logger.info("startSyncLoop called");
        syncIntervalId = setInterval(async () => {
            await runSyncCheck("periodic");
        }, syncInterval);
        updateSyncToggleButton();
    } catch (error) {
        logger.error("sync: startSyncLoop", error);
        return null;
    }        
}

export function stopSyncLoop() {
    logger.debug("sync", "Running stopSyncLoop()");
    try {      
        if (syncIntervalId !== null) {
            clearInterval(syncIntervalId);
            syncIntervalId = null;
            logger.info("stopSyncLoop:", syncIntervalId);
            updateSyncToggleButton();
        }
    } catch (error) {
        logger.error("sync: stopSyncLoop", error);
        return null;
    }           
}

export function toggleSyncLoop() {
    if (syncIntervalId === null) {
        startSyncLoop();
        logger.info("sync", "toggleSyncLoop → started");
    } else {
        stopSyncLoop();
        logger.info("sync", "toggleSyncLoop → stopped");
    }
}


// re-check the token immediately after wake to handle cases where GitHub token becomes invalid after laptop suspend
export async function bindVisibilityEvents() {
    logger.debug("sync", "Running bindVisibilityEvents()");

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            runSyncCheck("resume");
        }
    });
}

export function bindActivityEvents() {
    logger.debug("sync", "Running bindActivityEvents()");
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
    logger.debug("sync", "Running setConnectionButtonState()");
    const loginBtn = document.getElementById("github-login");
    if (!loginBtn) {
        logger.info("sync: setConnectionButtonState", "Button 'github-login' not found");
        return;
    }

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
    logger.debug("sync", "Running bindReconnectLink()");
    setTimeout(() => {
        const link = document.getElementById("reconnect-link");
        if (!link) {
            logger.info("sync: bindReconnectLink", "Link 'reconnect-link' not found");
            return;
        }        

        link.addEventListener("click", (e) => {
            e.preventDefault();
            const btn = document.getElementById("github-login");
            if (btn) btn.click();
        });
    }, 0);
}

export function disconnectFromGitHub(message) {
    logger.debug("sync", "Running disconnectFromGitHub()");
    setSyncStatus("error", "Disconnected");
    setConnectionButtonState(false);
    showNotification("error",`${message} <a href="#" id="reconnect-link">Reconnect</a>.`);
    bindReconnectLink();
    stopSyncLoop();
}

function connectToGitHub() {
    logger.debug("sync", "Running connectToGitHub()");
    setSyncStatus("error", "Disconnected");
    setSyncStatus("synced", "Connected");
    setConnectionButtonState(true);
    showNotification("success", "Connected to cloud");
}

export async function runSyncCheck(reason) {
    logger.info("sync: runSyncCheck", `Running sync check (reason: ${reason})`);

    const token = getToken();
    let gistId = getGistId();

    // First-time login: token exists but no gistId
    if (reason === "login" && token && !gistId) {
        logger.info("sync: runSyncCheck", "Token exists but no gistId — adopting or creating gist");
        const newId = await adoptOrCreateGist();
        if (!newId) {
            logger.error("sync: runSyncCheck", "Failed to adopt or create gist");
            return;
        }
        gistId = newId;
    }
    else if (!token || !gistId) {
        logger.error("sync: runSyncCheck", "Missing token or gistId — likely after suspend/wake. Stopping sync.");
        disconnectFromGitHub("Cloud connection lost.");
        return;
    }

    // If workspace is empty, load from cloud
    if (gistId && workspaceIsEmpty()) {
        logger.info("sync: runSyncCheck", "Workspace empty — loading from cloud");
        await loadWorkspaceFromGist();
    }

    const now = Date.now();
    const idleReturn = now - lastSuccessfulSyncTime > idleReturnThreshold;

    logger.info("sync: runSyncCheck",
        `Idle return: ${idleReturn} (last successful sync was at ${new Date(lastSuccessfulSyncTime).toISOString()})`
    );

    // --- Load cloud workspace using the flat model ---
    const cloudWorkspace = await loadWorkspaceFromGist();
    if (!cloudWorkspace || !Array.isArray(cloudWorkspace.flat)) {
        logger.error("sync: runSyncCheck", "Cloud workspace invalid");
        return;
    }

    const flatList = cloudWorkspace.flat;
    const cloudHash = await computeWorkspaceHash(flatList);

    logger.info("sync: runSyncCheck",
        `Computed cloudHash: ${cloudHash}, lastSyncedHash: ${lastSyncedHash}`
    );

    // --- Load local workspace using the flat model ---
    const localTree = loadState();
    const localFlat = flattenWorkspace(localTree);
    const localHash = await computeWorkspaceHash(localFlat);


    // --- First-time sync: adopt cloud hash ---
    if (lastSyncedHash === null) {
        logger.info("sync: runSyncCheck", "No lastSyncedHash found. Adopting cloud hash as baseline.");
        lastSyncedHash = cloudHash;
        localStorage.setItem("lastSyncedHash", cloudHash);
        updateSyncState();
        return;
    }

    // --- Resume logic: only sync if something changed ---
    if (reason === "resume") {
        const nothingChanged =
            localHash === lastSyncedHash &&
            cloudHash === lastSyncedHash;

        if (nothingChanged) {
            logger.info("sync: runSyncCheck",
                "Resume detected but no cloud changes or local edits — skipping sync."
            );
            updateSyncState();
            return;
        }
    }

    // --- Cloud is newer ---
    // Only trigger cloud-change if we have *already* synced once
    if (lastSyncedHash !== null && cloudHash !== lastSyncedHash) {
        logger.info("sync: runSyncCheck",
            "Cloud hash differs from lastSyncedHash. Cloud is newer. Triggering cloud-change handler."
        );
        return handleCloudChange({ id: gistId }, idleReturn);
    }


    // --- Everything matches ---
    logger.info("sync: runSyncCheck",
        "Cloud hash matches lastSyncedHash. Updating sync timestamp and checking for auto-save."
    );

    updateSyncState();
    maybeAutoSave();
}


function workspaceIsEmpty() {
    const ws = getWorkspace();   // you already have this
    return !Array.isArray(ws) || ws.length === 0;
}

function updateSyncState() {
    logger.debug("sync", "Running updateSyncState()");
    // Only updates timing — never the hash.
    lastSuccessfulSyncTime = Date.now();
}

async function handleCloudChange(latest, idleReturn) {
    logger.debug("sync", "Running handleCloudChange()");
    const now = Date.now();
    const recentlyTyped = (now - lastLocalEditTime) < 30_000;

    const countdown = recentlyTyped ? 30 : 10;

    showCountdownNotification({
        countdown,
        onConfirm: async () => {

            // --- SAFETY GUARD: ensure we have a valid gist reference ---
            if (!latest || !latest.id) {
                logger.error("sync: handleCloudChange", "Invalid latest gist object:", latest);
                showNotification("error", "Cloud sync failed — invalid gist reference");
                return;
            }

            // Ensure local gistId is correct
            setGistId(latest.id);

            // --- Load cloud workspace (flat list) ---
            const cloudWorkspace = await loadWorkspaceFromGist();
            if (!cloudWorkspace || !Array.isArray(cloudWorkspace.flat)) {
                logger.error("sync: handleCloudChange", "Cloud workspace invalid");
                return;
            }

            const flatList = cloudWorkspace.flat;

            // --- Inflate flat list → hierarchical tree ---
            const tree = inflateWorkspace(flatList);

            // --- Apply cloud workspace locally ---
            setWorkspace(tree);
            saveState();

            // --- Compute new cloud hash using the flat list ---
            lastSyncedHash = await computeWorkspaceHash(flatList);
            localStorage.setItem("lastSyncedHash", lastSyncedHash);
            lastSuccessfulSyncTime = Date.now();

            logger.info(
                "sync: handleCloudChange",
                `Cloud accepted. Updated lastSyncedHash: ${lastSyncedHash}`
            );
        },

        onCancel: () => {
            showNotification(
                "warning",
                "Cloud version is newer. Saving now will overwrite it."
            );
        }
    });
}


export function buildCanonicalSnapshot(flat) {
    logger.debug("sync", "Running buildCanonicalSnapshot()");

    // Defensive: ensure flat is an object
    if (!Array.isArray(flat)) {
        logger.error("sync", "buildCanonicalSnapshot expected flat array:", flat);
        return { version: 1, flat: [] };
    }


    // Convert object → array of entries
    const entries = flat.map(f => ({
        name: f.path,
        content: f.content || ""
    }));

    // Defensive: ensure flat is an array of { path, content }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    return {
        version: 1,
        flat: entries
    };
}



async function sha256(str) {
    // Encode string as UTF-8
    const encoder = new TextEncoder();
    const data = encoder.encode(str);

    // Hash the data
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);

    // Convert ArrayBuffer → hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");

    return hashHex;
}

export async function computeWorkspaceHash(flat) {
    logger.debug("sync", "Running computeWorkspaceHash()");

    // Must be a flat ARRAY of { path, content }
    if (!Array.isArray(flat)) {
        logger.error("sync", "computeWorkspaceHash expected flat array, received:", flat);
        flat = [];
    }

    // Build canonical snapshot from flat array
    const snapshot = {
        version: 1,
        files: flat
            .map(f => ({
                path: f.path,
                content: f.content || ""
            }))
            .sort((a, b) => a.path.localeCompare(b.path))
    };

    const json = JSON.stringify(snapshot);
    const hash = await sha256(json);

    logger.debug("sync", `computeWorkspaceHash → ${hash}`);
    return hash;
}


export async function reconcileLocalAndCloud(localTree) {
    logger.debug("sync", "Running reconcileLocalAndCloud()");

    // SAFETY FIX:
    // Do NOT convert null → [].
    // Null means "no local workspace exists".
    const hasLocal = Array.isArray(localTree) && localTree.length > 0;

    const cloudMeta = await getLatestWorkspaceGistMeta();
    const lastSyncedHash = localStorage.getItem("lastSyncedHash");

    // ------------------------------------------------------------
    // CASE 1: No cloud gist exists yet
    // ------------------------------------------------------------
    if (!cloudMeta) {
        logger.debug("sync: reconcileLocalAndCloud", "CASE 1: No cloud gist exists yet");

        if (!hasLocal) {
            // No local, no cloud → create empty workspace
            const fresh = createEmptyWorkspace();
            saveState(fresh);

            await saveWorkspaceToGist();

            const freshFlat = flattenWorkspace(fresh);
            const freshHash = await computeWorkspaceHash(freshFlat);
            localStorage.setItem("lastSyncedHash", freshHash);
            return;
        }

        // Local exists, cloud doesn't → push local to cloud
        await saveWorkspaceToGist();

        const localFlat = flattenWorkspace(localTree);
        const localHash = await computeWorkspaceHash(localFlat);
        localStorage.setItem("lastSyncedHash", localHash);
        return;
    }

    // ------------------------------------------------------------
    // CASE 2: Cloud exists → load cloud workspace
    // ------------------------------------------------------------
    const cloud = await loadWorkspaceFromGist();
    if (!cloud || !Array.isArray(cloud.flat)) {
        logger.error("sync: reconcileLocalAndCloud", "Cloud load failed or returned invalid structure");
        return;
    }
    logger.debug("sync: reconcileLocalAndCloud", "CASE 2: Cloud exists → load cloud workspace");

    const cloudFlat = cloud.flat;
    const cloudTree = inflateWorkspace(cloudFlat);
    const cloudMetadata = cloud.metadata || [];

    // ------------------------------------------------------------
    // Compute structural hashes (FLAT MODEL)
    // ------------------------------------------------------------
    const localFlat = hasLocal ? flattenWorkspace(localTree) : [];
    const localHash = await computeWorkspaceHash(localFlat);
    const cloudHash = await computeWorkspaceHash(cloudFlat);

    logger.debug("sync: reconcileLocalAndCloud", "localHash:", localHash);
    logger.debug("sync: reconcileLocalAndCloud", "cloudHash:", cloudHash);
    logger.debug("sync: reconcileLocalAndCloud", "lastSyncedHash:", lastSyncedHash);

    // ------------------------------------------------------------
    // CASE 3: Local and cloud match → nothing to do
    // ------------------------------------------------------------
    if (hasLocal && localHash === cloudHash) {
        logger.debug("sync: reconcileLocalAndCloud", "CASE 3: Local and cloud match → nothing to do");
        const migrated = migrateWorkspace(localTree);
        saveState(migrated);
        localStorage.setItem("lastSyncedHash", localHash);
        return;
    }

    // ------------------------------------------------------------
    // CASE 4: Cloud changed since last sync → cloud wins
    // ------------------------------------------------------------
    if (cloudHash !== lastSyncedHash) {
        logger.debug("sync: reconcileLocalAndCloud", "CASE 4: Cloud changed since last sync → cloud wins");
        const merged = mergeWorkspace(localTree || [], cloudTree, cloudMetadata);
        const migrated = migrateWorkspace(merged);

        saveState(migrated);
        localStorage.setItem("lastSyncedHash", cloudHash);
        return;
    }

    // ------------------------------------------------------------
    // CASE 5: Local changed, cloud didn’t → local wins
    // ------------------------------------------------------------
    logger.debug("sync: reconcileLocalAndCloud", "CASE 5: Local changed, cloud didn’t → local wins");

    const merged = mergeWorkspace(localTree || [], cloudTree, cloudMetadata);
    const migrated = migrateWorkspace(merged);

    saveState(migrated);
    await saveWorkspaceToGist();

    const newFlat = flattenWorkspace(migrated);
    const newHash = await computeWorkspaceHash(newFlat);
    localStorage.setItem("lastSyncedHash", newHash);
}



async function getLatestWorkspaceGistMeta() {
    const gistId = getGistId();
    const token = getToken();

    if (!gistId || !token) {
        logger.info("sync: getLatestWorkspaceGistMeta", "No gistId or token found.");
        return null;
    }

    try {
        const res = await fetch(`${GIST_API}/${gistId}`, {
            headers: { "Authorization": `token ${token}` }
        });

        if (res.status === 401) {
            logger.error("sync: getLatestWorkspaceGistMeta", "Token invalid or expired.");
            disconnectFromGitHub("Cloud token expired.");
            return null;
        }

        if (!res.ok) {
            const text = await res.text();
            logger.error("sync: getLatestWorkspaceGistMeta", `Failed to fetch gist metadata: ${res.status}`, text);
            return null;
        }

        const data = await res.json();

        // Extract hash from __workspace.json if present
        let cloudHash = null;
        if (data.files["__workspace.json"]) {
            try {
                const parsed = JSON.parse(data.files["__workspace.json"].content);
                cloudHash = parsed.hash || null;
            } catch (err) {
                logger.error("sync: getLatestWorkspaceGistMeta", "Failed to parse __workspace.json", err);
            }
        }

        return {
            id: data.id,
            updatedAt: data.updated_at,
            hash: cloudHash,
            files: Object.keys(data.files)
        };localStorage.clear();

    } catch (err) {
        logger.error("sync: getLatestWorkspaceGistMeta", "Network or fetch error", err);
        return null;
    }
}


async function maybeAutoSave() {
    logger.debug("sync", "Running maybeAutoSave()");

    // --- Compute local hash using the flat model ---
    const localTree = loadState();
    const localFlat = flattenWorkspace(localTree);
    const localHash = await computeWorkspaceHash(localFlat);


    // --- No local changes since last sync ---
    if (localHash === lastSyncedHash) {
        logger.info("sync: maybeAutoSave", "No local changes found");
        return;
    }

    // --- Do not auto-save if cloud is newer ---
    if (await cloudHashChanged()) {
        logger.info("sync: maybeAutoSave", "Cloud is newer — auto-save skipped");
        return;
    }

    // --- Safe to auto-save ---
    logger.info("sync: maybeAutoSave", "Local changes detected — auto-saving");
    await saveWorkspaceToGist();
}


async function cloudHashChanged() {
    logger.debug("sync", "Running cloudHashChanged()");

    const latest = await getCurrentWorkspaceGist();
    if (!latest) {
        logger.info("sync: cloudHashChanged", "Latest Gist workspace not found");
        return false;
    }

    // Load cloud workspace using the flat model
    const cloudWorkspace = await loadWorkspaceFromGist();
    if (!cloudWorkspace || !Array.isArray(cloudWorkspace.flat)) {
        logger.error("sync: cloudHashChanged", "Cloud workspace invalid");
        return false;
    }

    const cloudHash = await computeWorkspaceHash(cloudWorkspace.flat);
    logger.debug(
        "sync",
        "cloudHashChanged → cloudHash:",
        cloudHash,
        "lastSyncedHash:",
        lastSyncedHash
    );

    return cloudHash !== lastSyncedHash;
}



window.debugCloud = async () => {
    logger.debug("sync", "Assigning window.debugCloud");

    const latest = await getNewestGistAcrossAccount();
    if (!latest) {
        logger.info("sync: debugCloud", "No gist found when fetching newest gist across account.");
        return;
    }

    logger.info(
        "sync: debugCloud",
        `Fetched newest gist across account (ID: ${latest.id}, updated_at: ${formatDateNZ(latest.updated_at)}, files: ${Object.keys(latest.files).join(", ")})`
    );

    // Load the workspace using the flat model
    const cloudWorkspace = await loadWorkspaceFromGist();
    if (!cloudWorkspace || !Array.isArray(cloudWorkspace.flat)) {
        logger.error("sync: debugCloud", "Cloud workspace invalid");
        return;
    }

    const cloudHash = await computeWorkspaceHash(cloudWorkspace.flat);
    logger.info("sync: debugCloud", `Computed cloudHash for newest gist: ${cloudHash}`);
};


export async function saveWorkspaceToGist() {
    logger.debug("sync", "Running saveWorkspaceToGist()");
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

        logger.info("sync: saveWorkspaceToGist",
            `Starting save process. Current gistId: ${gistId || "(none)"}`
        );

        // --- 1. Build flat file list from workspace ---
        const workspace = getWorkspace();
        const files = flattenWorkspace(workspace);
        const gistFiles = {};

        files.forEach(f => {
            gistFiles[f.path] = { content: f.content || "" };
        });

        // --- 2. Save metadata file ---
        const metadata = extractMetadata(workspace);
        gistFiles["__workspace.json"] = {
            content: JSON.stringify(metadata, null, 2)
        };

        logger.info("sync: saveWorkspaceToGist",
            `Prepared ${Object.keys(gistFiles).length} files for saving: ${Object.keys(gistFiles).join(", ")}`
        );

        // --- 3. Prepare request body ---
        const body = {
            description: "BIAN Workspace Backup",
            public: false,
            files: gistFiles
        };

        let method = "POST";
        let url = GIST_API;

        // --- 4. Update existing gist ---
        if (gistId) {
            method = "PATCH";
            url = `${GIST_API}/${gistId}`;
            logger.info("sync: saveWorkspaceToGist",
                `Updating existing gist with ID: ${gistId} using PATCH method.`
            );

            const existing = await fetch(`${GIST_API}/${gistId}`, {
                headers: { "Authorization": `token ${githubToken}` }
            }).then(r => r.json());

            if (existing && existing.files) {
                const existingNames = Object.keys(existing.files);
                logger.info("sync: saveWorkspaceToGist",
                    `Existing cloud files before update: ${existingNames.join(", ")}`
                );

                for (const existingName of existingNames) {
                    if (existingName === "__workspace.json") continue;

                    const stillExistsLocally = files.some(f => f.path === existingName);
                    if (!stillExistsLocally) {
                        logger.info("sync: saveWorkspaceToGist",
                            `Marking file for deletion: ${existingName}`
                        );
                        body.files[existingName] = null;
                    }
                }
            }
        } else {
            logger.info("sync: saveWorkspaceToGist",
                "No gistId found — creating new gist via POST"
            );
        }

        logger.info("sync: saveWorkspaceToGist", `Final request method: ${method}`);
        logger.info("sync: saveWorkspaceToGist", `Final request URL: ${url}`);
        logger.info("sync: saveWorkspaceToGist",
            `Final file list being sent: ${Object.keys(body.files).join(", ")}`
        );

        // --- 5. Send request ---
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
            logger.error("sync: saveWorkspaceToGist",
                `Gist save error: ${data.message || "Unknown error"}`
            );
            showSyncState("error");
            showNotification("error", "Failed to save workspace");
            logger.info("sync: saveWorkspaceToGist", "--- SAVE FAILED ---");
            return;
        }

        // --- 6. Store gistId if new ---
        if (!gistId && data.id) {
            logger.info("sync: saveWorkspaceToGist",
                `New gist created with ID: ${data.id}`
            );
            setGistId(data.id);
            gistId = data.id;
        }

        // --- 7. Compute new cloud hash using corrected loader ---
        const cloud = await loadWorkspaceFromGist();
        const safeFlat = Array.isArray(cloud?.flat) ? cloud.flat : [];
        lastSyncedHash = await computeWorkspaceHash(safeFlat);

        localStorage.setItem("lastSyncedHash", lastSyncedHash);
        lastSuccessfulSyncTime = Date.now();

        logger.info("sync: saveWorkspaceToGist", "Save successful.");
        logger.info("sync: saveWorkspaceToGist",
            `Updated lastSyncedHash: ${lastSyncedHash}`
        );
        logger.info("sync: saveWorkspaceToGist", "--- SAVE END ---");

        showSyncState("synced");
        showNotification("success", "Saved to cloud");

    } catch (error) {
        logger.error("sync: saveWorkspaceToGist", error);
        return false;
    } finally {
        isSaving = false;
    }
}



export function markLocalEdit() {
    lastLocalEditTime = Date.now();
    //logger.debug("sync: markLocalEdit", `Local edit detected at ${new Date(lastLocalEditTime).toISOString()}`);
}

function showSyncState(state) {
    logger.debug("sync", "Running showSyncState()");
    const map = {
        saving: ["saving", "Saving…"],
        synced: ["synced", "Synced"],
        error: ["error", "Error"]
    };
    setSyncStatus(...map[state]);
}

export async function loadWorkspaceFromGist() {
    logger.debug("sync", "Running loadWorkspaceFromGist()");
    logger.debug("sync", "loadWorkspaceFromGist gistId:", getGistId());

    if (!requireLogin()) {
        logger.info("sync: loadWorkspaceFromGist", "Login not required");
        return null;
    }

    const gistId = getGistId();
    const githubToken = getToken();

    if (!gistId) {
        showNotification("info", "No cloud backup found. Save to Cloud first.");
        logger.info("sync: loadWorkspaceFromGist", "No cloud backup found.");
        return null;
    }

    try {
        const res = await fetch(`${GIST_API}/${gistId}`, {
            headers: { "Authorization": `token ${githubToken}` }
        });

        if (!res.ok) {
            logger.error("sync: loadWorkspaceFromGist", `GitHub returned ${res.status}`);
            return null;
        }

        const data = await res.json();
        const files = data.files || {};

        // --- 1. Build flat ARRAY model from all real content files ---
        const flat = [];

        for (const filename in files) {
            if (filename === "__workspace.json") continue; // skip metadata

            flat.push({
                path: filename,
                content: files[filename].content || ""
            });
        }

        // --- 2. Parse metadata (optional) ---
        let metadata = [];
        if (files["__workspace.json"]) {
            try {
                metadata = JSON.parse(files["__workspace.json"].content);
            } catch (err) {
                logger.error("sync: loadWorkspaceFromGist", "Failed to parse metadata", err);
                metadata = [];
            }
        }

        if (!Array.isArray(metadata)) {
            metadata = [metadata];
        }

        logger.debug("sync: loadWorkspaceFromGist", "Returning cloud data:", {
            flatType: Array.isArray(flat) ? "array" : typeof flat,
            flatLength: Array.isArray(flat) ? flat.length : "n/a",
            metadataType: Array.isArray(metadata) ? "array" : typeof metadata,
            metadataLength: Array.isArray(metadata) ? metadata.length : "n/a",
            fileKeys: Object.keys(files)
        });

        // --- 3. Return structured cloud data ---
        return {
            flat,       // ARRAY of { path, content }
            metadata    // ARRAY of metadata entries
        };

    } catch (error) {
        logger.error("sync: loadWorkspaceFromGist", {
            message: error.message,
            stack: error.stack
        });
        return null;
    }
}






async function getNewestGistAcrossAccount() {
    logger.debug("sync", "Running getNewestGistAcrossAccount()");
    if (!requireLogin()) {
        logger.info("sync: getNewestGistAcrossAccount", "Login not required")
        return null;
    }

    try {
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

    } catch (error) {
        logger.error("sync: getNewestGistAcrossAccount", error);
        return null;
    }      
}

export async function listGistRevisions() {
    logger.debug("sync", "Running listGistRevisions()");
    if (!requireLogin()) {
        logger.info("sync: listGistRevisions", "Login not required")
        return [];
    }

    try {
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

    } catch (error) {
        logger.error("sync: listGistRevisions", error);
        return [];
    }     
}

export async function restoreFromGistVersion(versionId) {
    logger.debug("sync", "Running restoreFromGistVersion()");
    if (!requireLogin()) {
        logger.info("sync: restoreFromGistVersion", "Login not required")
        return;
    }

    try {
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

        // 1. Extract cloud flat files (excluding metadata)
        const cloudFlat = {};
        for (const filename in data.files) {
            if (filename !== "__workspace.json") {
                cloudFlat[filename] = data.files[filename].content;
            }
        }

        // 2. Parse cloud metadata
        const cloudMetadata = metadata || [];
        // ensure passing an array
        if (!Array.isArray(cloudMetadata)) {
            cloudMetadata = [cloudMetadata];
        }

        // 3. Load local workspace (unsaved work)
        const localTree = getWorkspace();

        // 4. Merge cloud + local using metadata to preserve IDs
        const merged = mergeWorkspace(localTree, cloudFlat, cloudMetadata);

        // 5. Save + render
        setWorkspace(merged);
        saveState();
        renderSidebar();


        showNotification("success", "Workspace restored from previous version");

    } catch (error) {
        logger.error("sync: restoreFromGistVersion", error);
        return;
    }     
}

export async function showRestoreDialog() {
    logger.debug("sync", "Running showRestoreDialog()");
    const revisions = await listGistRevisions();
    if (!revisions || revisions.length === 0) {
        logger.info("sync: showRestoreDialog", "No Gist revisions found")
        return;
    }    

    try {
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

    } catch (error) {
        logger.error("sync: showRestoreDialog", error);
        return;
    }      
}

async function adoptOrCreateGist() {
    logger.debug("sync", "Running adoptOrCreateGist()");
    const token = getToken();
    if (!token) {
        logger.info("sync: adoptOrCreateGist", `Token was null - exiting`);
        return null
    };

    // --- 1. Try to adopt newest existing gist ---
    try {
        const newest = await getNewestGistAcrossAccount();

        if (newest && newest.id) {
            logger.info("sync: adoptOrCreateGist", `Adopting existing gist ${newest.id}`);
            setGistId(newest.id);
            return newest.id;
        }

        logger.info("sync: adoptOrCreateGist", "No existing gists found — will create new gist");
    } catch (err) {
        logger.error("sync: adoptOrCreateGist", "Failed while checking for existing gists", err);
        // We *continue* — failure to list gists should not block creation
    }

    // --- 2. Create a new gist ---
    try {
        const res = await fetch("https://api.github.com/gists", {
            method: "POST",
            headers: {
                "Authorization": `token ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                description: "Workspace",
                public: false,
                files: {
                    "workspace.json": {
                        content: JSON.stringify({ created: Date.now() }, null, 2)
                    }
                }
            })
        });

        if (!res.ok) {
            logger.error( "sync: adoptOrCreateGist", `GitHub returned ${res.status} when creating gist` );
            return null;
        }

        const data = await res.json();

        if (!data || !data.id) {
            logger.error("sync: adoptOrCreateGist", "GitHub response missing gist ID", data);
            return null;
        }

        logger.info("sync: adoptOrCreateGist", `Created new gist ${data.id}`);
        setGistId(data.id);
        return data.id;

    } catch (err) {
        logger.error("sync: adoptOrCreateGist", "Exception while creating gist", err);
        return null;
    }
}
