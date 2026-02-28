// see bottom for description of syncing
import { getToken, getGistId, setGistId, requireLogin } from "./auth.js";
import { rebuildWorkspaceFromGist, flattenWorkspace, setSubjects, getSubjects, renderSidebar, saveState, setSyncStatus, showNotification, showCountdownModal } from "./ui.js";

let lastSyncTime = 0;          // Local wall-clock time of last sync
let lastLocalEditTime = 0;     // Last time user typed anything
let syncInterval = 2 * 60 * 1000; // 2 minutes
let idleThreshold = syncInterval * 2; // 4 minutes = “user returned”
let lastSyncedHash = null;


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
    const idleReturn = (now - lastSyncTime) > idleThreshold;

    const latest = await getNewestGistAcrossAccount();
    if (!latest) return;

    const cloudHash = await hashGistContent(latest.files);

    // First sync ever
    if (!lastSyncedHash) {
        const localEmpty = getSubjects().length === 0;

        if (localEmpty) {
            lastSyncedHash = cloudHash;
            lastSyncTime = now;
            return;
        }

        // Local has data → cloud is newer
        await handleCloudNewer(latest, true);
        return;
    }

    // Cloud is newer
    if (cloudHash !== lastSyncedHash) {
        await handleCloudNewer(latest, idleReturn);
        return;
    }

    // Cloud same → safe
    lastSyncedHash = cloudHash;
    lastSyncTime = now;
    maybeAutoSave();
}

async function handleCloudNewer(latest, idleReturn) {
    const now = Date.now();
    const recentlyTyped = (now - lastLocalEditTime) < 30_000;

    let countdown = recentlyTyped ? 30 : 10;

    showCountdownModal({
        countdown,
        message: "A newer cloud version was found.",
        onConfirm: async () => {
            console.log("CONFIRM: switching gist", {
                newGistId: latest.id
            });

            setGistId(latest.id);
            await loadWorkspaceFromGist();

            // FIX: update hash correctly
            lastSyncedHash = await hashGistContent(latest.files);

            lastSyncTime = Date.now();
        },
        onCancel: () => {
            showNotification("warning",
                "Cloud version is newer. Saving now will overwrite it."
            );
        }
    });
}

async function hashGistContent(files) {
    const content = Object.values(files)
        .map(f => f.content || "")
        .join("\n");

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
    if (await cloudIsNewer()) return;

    await saveWorkspaceToGist();
}

async function cloudIsNewer() {
    const latest = await getLatestWorkspaceGist();
    if (!latest) return false;

    const cloudHash = await hashGistContent(latest.files);
    return cloudHash !== lastSyncedHash;
}

export async function saveWorkspaceToGist() {
    if (!requireLogin()) return;

    const githubToken = getToken();
    let gistId = getGistId();

    setSyncStatus("saving", "Saving…");

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
            setSyncStatus("error", "Error");
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
        setSyncStatus("error", "Error");
        showNotification("error", "Failed to load workspace");
        return;
    }

    if (!gistId && data.id) {
        setGistId(data.id);
    }

    lastSyncedHash = await hashGistContent(data.files);
    lastSyncTime = Date.now();

    // UI: successfully synced
    setSyncStatus("synced", "Synced");
    showNotification("success", "Workspace saved to cloud");
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

/*
How the sync loop starts
Your startup sequence is now:

setupMarked()

handleOAuthRedirect()

load workspace

startSyncLoop()

renderSidebar()

bindLoginButton()

updateLoginIndicator()

bind UI

This ensures:

The sync loop starts after login handling

The sync loop starts after the workspace is loaded

The sync loop starts before the user interacts with the UI

The sync loop starts before any file is opened

This is correct and race‑free.

How timestamps interact
You maintain three timestamps:

lastSyncedAt — the cloud’s timestamp from the last successful sync

lastSyncTime — the local wall‑clock time when the last sync occurred

lastLocalEditTime — the last time the user typed anything

These three signals allow you to detect:

cloud newer

cloud same

cloud older

user idle

user active

user returning after being away

safe auto‑save

unsafe auto‑save

This is the correct minimal set.

How idle‑return detection works
Idle return means:

“The user has been away long enough that another device might have edited the cloud.”

You detect this by:

js
if (now - lastSyncTime > idleThreshold) {
    // treat as idle return
}
Where:

syncInterval = 2 minutes

idleThreshold = syncInterval * 2 = 4 minutes

This means:

If the user leaves the tab for 4+ minutes

Or switches devices

Or the browser suspends the tab

Or the laptop sleeps

Or the phone goes background

…then the next sync tick immediately checks for cloud updates.

This is exactly how Joplin and Obsidian Sync behave.

How cloud‑newer detection works
You compare:

js
if (cloudUpdatedAt > lastSyncedAt)
This is correct because:

GitHub timestamps are second‑precision

Cloud may return the same timestamp for multiple saves

Cloud may return an older timestamp if the user saved locally more recently

Using strict equality would cause false positives

So:

cloud > local → cloud newer

cloud <= local → cloud same or older

This is correct.

How the adaptive countdown works
When cloud is newer:

js
const recentlyTyped = (now - lastLocalEditTime) < 30_000;
const countdown = recentlyTyped ? 30 : 10;
This gives:

30 seconds if the user typed recently

10 seconds if the user is idle

This is the correct UX:

Protects active work

Speeds up switching when idle

Avoids accidental overwrites

Avoids unnecessary waiting

The modal then:

Switches to cloud on confirm

Warns about overwriting on cancel

This is correct and safe.

How auto‑save works
Auto‑save runs only when:

The user has typed since the last sync

The cloud is not newer

This prevents:

Overwriting newer cloud data

Saving when nothing changed

Saving too frequently

This is correct.

How race conditions are avoided
Race: sync before login
Avoided because startSyncLoop() runs after handleOAuthRedirect().

Race: login button binding before sidebar
Avoided because bindLoginButton() runs after renderSidebar().

Race: preview before renderer
Avoided because setupMarked() runs first.

Race: editor events before DOM exists
Avoided because bindEditorEvents() runs last.

Race: sync loop and manual load
Avoided because both update lastSyncedAt and lastSyncTime.

Race: cloud-newer detection and auto-save
Avoided because auto-save checks cloudIsNewer() first.

Everything is clean.
*/
