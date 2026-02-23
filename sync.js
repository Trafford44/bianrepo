/**
 * sync.js
 * ----------
 * Handles all cloud‑sync operations for the workspace.
 *
 * This module is responsible for saving and loading the user’s workspace
 * to and from a private GitHub Gist using the GitHub REST API.
 *
 * Responsibilities:
 * - Flatten the current workspace into a Gist‑compatible file map.
 * - Determine whether to create a new Gist (POST) or update an existing one (PATCH).
 * - Validate whether the existing Gist’s file list matches the current workspace.
 * - Perform authenticated fetch requests using the stored GitHub token.
 * - Store and retrieve the active Gist ID for future sync operations.
 * - Report sync progress to the UI via setSyncStatus() (saving, synced, error).
 *
 * This module contains **no UI logic** and **no authentication logic**.
 * It exposes pure sync functions that other modules (UI, auth, editor) can call.
 *
 * Exported functions:
 * - saveWorkspaceToGist()   → Saves the current workspace to GitHub.
 * - loadWorkspaceFromGist() → Loads the workspace from the user’s Gist.
 *
 * Dependencies:
 * - getToken(), requireLogin(), getGistId(), setGistId() from auth/storage helpers.
 * - flattenWorkspace() from workspace utilities.
 * - setSyncStatus() from ui.js for visual feedback.
 *
 * The goal of this module is to keep all cloud‑sync behavior isolated,
 * predictable, and easy to maintain without mixing UI or editor concerns.
 */

import { getToken, getGistId, setGistId, requireLogin } from "./auth.js";
import { rebuildWorkspaceFromGist, flattenWorkspace, setSubjects, getSubjects, renderSidebar, saveState, setSyncStatus } from "./ui.js";

const GIST_API = "https://api.github.com/gists";

export async function saveWorkspaceToGist() {
    if (!requireLogin()) return;

    if (!gistId) {
        console.log("No gist ID — creating new gist");
    }

    // UI: saving started
    setSyncStatus("saving", "Saving…");

    const githubToken = getToken();
    let gistId = getGistId();

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
        return;
    }

    if (!gistId && data.id) {
        setGistId(data.id);
    }

    // UI: successfully synced
    setSyncStatus("synced", "Synced");
}


export async function loadWorkspaceFromGist() {
    if (!requireLogin()) return;

    const gistId = getGistId();
    const githubToken = getToken();

    if (!gistId) {
        alert("No cloud backup found");
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

    alert("Workspace loaded from GitHub Gist");
}

export async function listGistRevisions() {
    if (!requireLogin()) return [];

    const githubToken = getToken();
    const gistId = getGistId();

    if (!gistId) {
        alert("No Gist ID found");
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

    alert("Workspace restored from previous version");
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

