import { logger } from "./logger.js";

let workspace = []
const STORAGE_KEY = "kb_data";

logger.debug("workspace","workspace.js loaded from:", import.meta.url);

export function getWorkspace() {
    logger.debug("workspace", "getWorkspace()");
    // ensure workspace is always sorted
    sortTree(workspace); // root stays in user-defined order
    return workspace;
}

export function createEmptyWorkspace() {
    return [];
}

// Main entry point
export function setWorkspace(tree) {
    //logger.debug("workspace", "setWorkspace()");

    logger.debug("workspace", "setWorkspace storing tree:", JSON.stringify(tree, null, 2));

    if (!Array.isArray(tree)) {
        logger.error("workspace", "setWorkspace received non-array:", tree);
        tree = [];
    }

    workspace = tree;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
}


function sortTree(nodes) {
    nodes.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );

    nodes.forEach(node => {
        if (node.type === "folder" && Array.isArray(node.children)) {
            sortTree(node.children);
        }
    });
}


function normalizeNode(node) {
    // Convert old "title" to new "name"
    if (!node.name && node.title) {
        node.name = node.title;
    }

    // Detect folder-like nodes
    const looksLikeFolder =
        Array.isArray(node.children) ||
        Array.isArray(node.files) ||   // ← THIS IS THE IMPORTANT LINE
        node.isOpen === true;

    // Fix type
    if (looksLikeFolder) {
        node.type = "folder";
    } else {
        node.type = "file";
    }

    // Ensure folder children
    if (node.type === "folder") {
        if (!Array.isArray(node.children)) {
            node.children = [];
        }

        // Migrate old "files" array
        if (Array.isArray(node.files)) {
            node.files.forEach(f => {
                node.children.push(normalizeNode({
                    id: f.id,
                    type: "file",
                    name: f.title,
                    content: f.content || ""
                }));
            });
            delete node.files;
        }
    }

    return node;
}



export function saveState() {
    logger.debug("workspace", "saveState()");
    const tree = getWorkspace();

    if (!Array.isArray(tree)) {
        logger.error("workspace", "saveState received non-array workspace:", tree);
        return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
}

export function loadState() {
    logger.debug("workspace", "loadState()");
    const saved = localStorage.getItem(STORAGE_KEY);

    if (!saved) {
        logger.info("workspace: loadState", "No local workspace found");
        return null;   // ← IMPORTANT
    }

    logger.debug("workspace: loadState", "Raw localStorage:", saved);

    try {
        const tree = JSON.parse(saved);

        if (!Array.isArray(tree)) {
            logger.error("workspace: loadState", "Invalid workspace format:", tree);
            return null;   // ← IMPORTANT
        }

        return tree;   // ← DO NOT migrate or save here

    } catch (e) {
        logger.error("workspace: loadState", "Failed to parse workspace:", e);
        return null;   // ← IMPORTANT
    }
}



export function findNodeById(nodeList, id) {
    for (const node of nodeList) {
        if (node.id === id) return node;

        if (node.type === "folder") {
            const found = findNodeById(node.children, id);
            if (found) return found;
        }
    }
    return null;
}

export function findNodeAndParent(nodeList, id, parent = null) {
    for (const node of nodeList) {
        if (node.id === id) {
            return { node, parent };
        }

        if (node.type === "folder") {
            const found = findNodeAndParent(node.children, id, node);
            if (found) return found;
        }
    }
    return null;
}

export function createFolder(name) {
    logger.debug("workspace", "Running createFolder");
    return {
        id: createNewID("Creating folder"),
        type: "folder",
        name: sanitizeName(name),
        children: [],

        // Internal linking
        pathCache: null,

        // Public sharing (future)
        isPublic: false,
        publicId: null,
        publicAt: null,
        updatedAt: Date.now()
    };
}


export function createFile(name, content = "") {
    logger.debug("workspace", "Running createFile");
    return {
        id: createNewID("Creating file"),
        type: "file",
        name: sanitizeName(name),
        content: typeof content === "string" ? content : "",

        // Internal linking
        pathCache: null,

        // Public sharing
        isPublic: false,
        publicId: null,
        publicAt: null,
        updatedAt: Date.now(),

        // Future features
        backlinks: [],
        tags: [],
        template: false
    };
}

export function sanitizeName(name) {
    // Illegal in GitHub filenames
    const illegal = /[\/\\:\?\*"<>\|]/g;

    // Replace illegal characters with underscore
    let safe = name.replace(illegal, "_");

    // Trim whitespace
    safe = safe.trim();

    // Prevent empty names
    if (safe.length === 0) {
        safe = "untitled";
    }

    return safe;
}


export function flattenWorkspace(tree) {
    logger.debug("workspace", "Running flattenWorkspace");
    const output = [];

    function walk(nodes, pathParts) {

        // ------------------------------------------------------------
        // 1. Deterministically sort siblings before processing them.
        //
        //    Why?
        //    - The original version relied on insertion order.
        //    - That causes nondeterministic flattening across devices.
        //    - Sorting ensures stable ordering → stable hashing.
        //
        //    Rules:
        //    - Folders always come before files.
        //    - Within each group, sort alphabetically by name.
        // ------------------------------------------------------------
        const sorted = [...nodes].sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === "folder" ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        for (const node of sorted) {
            const encoded = encodeName(node.name);

            if (node.type === "folder") {

                // ------------------------------------------------------------
                // Recurse into folder children.
                // We push the encoded folder name into the path.
                // ------------------------------------------------------------
                walk(node.children, [...pathParts, encoded]);

            } else if (node.type === "file") {

                // ------------------------------------------------------------
                // 2. Ensure file has a valid extension.
                //
                //    This preserves your existing behavior:
                //    - .md and .puml are allowed
                //    - everything else becomes .md
                // ------------------------------------------------------------
                let fileName = encoded;
                if (!fileName.endsWith(".md") && !fileName.endsWith(".puml")) {
                    fileName += ".md";
                }

                // ------------------------------------------------------------
                // 3. Construct the full encoded path using your "___" separator.
                // ------------------------------------------------------------
                const fullPath = [...pathParts, fileName].join("___");

                // ------------------------------------------------------------
                // 4. Push deterministic file entry.
                // ------------------------------------------------------------
                output.push({
                    path: fullPath,
                    content: node.content || "",
                    id: node.id
                });
            }
        }
    }

    // Start walking from the root
    walk(tree, []);

    // ------------------------------------------------------------
    // 5. Sort final output list by path.
    //
    //    Why?
    //    - Even with sorted siblings, recursion order can still
    //      produce subtle differences.
    //    - Sorting the final list guarantees a stable file order.
    // ------------------------------------------------------------
    output.sort((a, b) => a.path.localeCompare(b.path));

    return output;
}

export function inflateWorkspace(flatList) {
    logger.debug("workspace", "Running inflateWorkspace()");
    logger.debug("workspace", "inflateWorkspace input:", flatList);

    // Root of the reconstructed tree
    const root = [];

    if (!Array.isArray(flatList)) {
        logger.error("workspace", "inflateWorkspace received non-array:", flatList);
        return root;
    }

    // Map from path → node for quick lookup
    const pathMap = new Map();

    for (const entry of flatList) {
        if (!entry || !entry.path) continue;

        const parts = entry.path.split("___").map(decodeName);
        const isFile = parts[parts.length - 1].match(/\.(md|puml)$/i);

        let current = root;
        let currentPath = "";

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLast = i === parts.length - 1;
            const isFileNode = isLast && isFile;

            logger.debug("workspace", "inflateWorkspace processing path:", entry.path);

            currentPath = currentPath ? `${currentPath}___${part}` : part;

            // Check if we already created this node
            let node = pathMap.get(currentPath);

            logger.debug("workspace: inflateWorkspace", "inflate: created node", {
                name: node.name,
                type: node.type,
                id: node.id,
                path: currentPath
            });

            if (!node) {
                if (isFileNode) {
                    // FILE NODE — preserve ID from flatList
                    node = {
                        id: entry.id,              // ← CRITICAL: preserve ID
                        type: "file",
                        name: part,
                        content: entry.content || ""
                    };
                } else {
                    // FOLDER NODE — preserve ID from flatList
                    node = {
                        id: entry.id,              // ← CRITICAL: preserve ID
                        type: "folder",
                        name: part,
                        children: []
                    };
                }

                current.push(node);
                pathMap.set(currentPath, node);
            }

            // Descend into folder children
            if (!isFileNode) {
                current = node.children;
            }
        }
    }

    return root;
}


function buildLocalPathMap(tree, prefix = "") {
    logger.debug("workspace", "buildLocalPathMap()");
    const map = {};

    for (const node of tree) {
        const path = prefix ? `${prefix}___${node.name}` : node.name;

        map[path] = node;

        if (node.type === "folder") {
            Object.assign(map, buildLocalPathMap(node.children, path));
        }
    }

    return map;
}

function buildMetadataPathMap(metadata) {
    logger.debug("workspace", "buildMetadataPathMap()");
    const map = {};

    function walk(nodes, prefix = "") {
        for (const node of nodes) {
            const path = prefix ? `${prefix}___${node.name}` : node.name;
            map[path] = node;

            if (node.type === "folder" && node.children) {
                walk(node.children, path);
            }
        }
    }

    walk(metadata);
    return map;
}

function logIdAnomaly(context, path, cloudEntry, meta, local) {
    logger.watch("logIdAnomaly", {
        context,
        path,
        cloudId: cloudEntry?.id,
        metaId: meta?.id,
        localId: local?.id,
        cloudEntry,
        meta,
        local
    });
}

export function mergeWorkspace(localTree, cloudFlat, cloudMetadata) {
    logger.debug("workspace", "mergeWorkspace() CALLED", {
        localCount: Array.isArray(localTree) ? localTree.length : typeof localTree,
        cloudFlatCount: Array.isArray(cloudFlat) ? cloudFlat.length : typeof cloudFlat,
        cloudMetaCount: Array.isArray(cloudMetadata) ? cloudMetadata.length : typeof cloudMetadata,
    });

    // 🔥 SAFETY FILTER: remove null, undefined, or missing-path entries
    if (!Array.isArray(cloudFlat)) {
        cloudFlat = [];
    } else {
        cloudFlat = cloudFlat.filter(f => f && typeof f.path === "string");
    }

    const localMap = buildLocalPathMap(localTree);
    const metaMap = buildMetadataPathMap(cloudMetadata || []);


    const mergedMap = {};

    function ensureFolderPath(path) {
        if (!path) return;
        if (mergedMap[path]) return;

        const parts = path.split("___");
        const name = parts[parts.length - 1];

        const meta = metaMap[path];
        const local = localMap[path];

        let id;
        const cloudEntry = cloudFlat.find(f => f.path === path);

        // checking for missing ID issue
        if (cloudEntry && !("id" in cloudEntry)) {
            logger.watch("mergeWorkspace:id-missing", {
                context: "cloudEntry missing id property",
                path,
                cloudEntry
            });
        }

        if (meta && !("id" in meta)) {
            logger.watch("mergeWorkspace:id-missing", {
                context: "meta entry missing id property",
                path,
                meta
            });
        }

        if (local && !("id" in local)) {
            logger.watch("mergeWorkspace:id-missing", {
                context: "local entry missing id property",
                path,
                local
            });
        }

        if (cloudEntry && cloudEntry.id) {
            id = cloudEntry.id;                     // ✔ canonical
        } else if (meta && meta.id) {
            id = meta.id;                           // ✔ fallback
        } else if (local && local.id) {
            id = local.id;                          // ✔ fallback
        } else {
            // No ID source found — log BEFORE createNewID runs
            logIdAnomaly("ensureFolderPath:all-missing", path, cloudEntry, meta, local);            
            id = createNewID("mergeWorkspace() new folder: ", meta.name);  // ✔ only for brand-new nodes
        }

        // Log if the chosen ID is undefined/null/empty
        if (!id) {
            logIdAnomaly("ensureFolderPath:undefined-id", path, cloudEntry, meta, local);
        }

        mergedMap[path] = {
            id,
            type: "folder",
            name,
            content: null,
            children: []
        };
    }

    // --- 1. Merge cloud files/folders (gist is source of truth) ---
    const cloudPaths = Array.isArray(cloudFlat)
        ? cloudFlat
            .filter(f => f && typeof f.path === "string" && f.path.length > 0)
            .map(f => f.path)
            .sort()
        : [];

    for (const flatKey of cloudPaths) {
        if (!flatKey || typeof flatKey !== "string") {
            logger.error("workspace: mergeWorkspace", "Invalid cloud path:", flatKey);
            continue;
        }

        const parts = flatKey.split("___");
        const name = parts[parts.length - 1];
        const isFile = name.endsWith(".md") || name.endsWith(".puml");

        // Ensure all parent folders exist
        for (let i = 1; i < parts.length; i++) {
            const parentPath = parts.slice(0, i).join("___");
            ensureFolderPath(parentPath);
        }

        const meta = metaMap[flatKey];
        const local = localMap[flatKey];
        const cloudEntry = cloudFlat.find(f => f.path === flatKey);

        let id;
        if (cloudEntry && cloudEntry.id) {
            id = cloudEntry.id;                     // ✔ canonical
        } else if (meta && meta.id) {
            id = meta.id;                           // ✔ fallback
        } else if (local && local.id) {
            id = local.id;                          // ✔ fallback
        } else {
            logIdAnomaly("cloudLoop:all-missing", flatKey, cloudEntry, meta, local);
            id = createNewID("mergeWorkspace() new file: ", meta.name); // ✔ only for brand-new nodes
        }

        // Log if the chosen ID is undefined/null/empty
        if (!id) {
            logIdAnomaly("cloudLoop:undefined-id", flatKey, cloudEntry, meta, local);
        }        

        mergedMap[flatKey] = {
            id,
            type: isFile ? "file" : "folder",
            name,
            content: isFile ? (cloudEntry?.content || "") : null,
            children: []
        };
    }

    // --- 2. Add local-only files/folders (unsaved work) ---
    const localPaths = Object.keys(localMap || {}).sort();

    for (const path of localPaths) {
        if (mergedMap[path]) continue;

        const node = localMap[path];
        const parts = path.split("___");

        // Ensure parents exist
        for (let i = 1; i < parts.length; i++) {
            const parentPath = parts.slice(0, i).join("___");
            ensureFolderPath(parentPath);
        }

        mergedMap[path] = {
            id: node.id,
            type: node.type,
            name: node.name,
            content: node.type === "file" ? node.content : null,
            children: []
        };
    }

    // --- 3. Rebuild tree structure deterministically ---
    const root = [];
    const mergedPaths = Object.keys(mergedMap).sort();

    for (const path of mergedPaths) {
        const parts = path.split("___");
        let current = root;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isFile =
                i === parts.length - 1 &&
                (part.endsWith(".md") || part.endsWith(".puml"));

            const fullPath = parts.slice(0, i + 1).join("___");
            const node = mergedMap[fullPath];

            if (!node) {
                logger.error("mergeWorkspace", "Missing node for path", fullPath);
                break;
            }

            let existing = current.find(n => n.name === part);

            if (!existing) {
                existing = {
                    id: node.id,
                    type: node.type,
                    name: node.name,
                    content: node.content,
                    children: []
                };
                current.push(existing);
            }

            if (!isFile) {
                current = existing.children;
            }
        }
    }

    // --- 4. Sort children: folders first, then files, by name ---
    function sortTree(nodes) {
        nodes.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === "folder" ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
        for (const n of nodes) {
            if (n.children && n.children.length > 0) {
                sortTree(n.children);
            }
        }
    }

    sortTree(root);

    return root;
}

// Detect old format: array of { title, files }
function looksLikeOldFormat(data) {
    return Array.isArray(data) &&
           data.length > 0 &&
           data[0].title &&
           Array.isArray(data[0].files);
}

export function createNewID(context = "unspecified") {
    const id = crypto.randomUUID();
    logger.watch("createNewID", `Generated new ID: ${id} (context: ${context})`);
    return id;
}


/*

Summary Table — All Fields, All Locations
Field	Workspace Tree?	Metadata?	Saved In	Meaning
id	✔	✔	__workspace.json (metadata)	Stable node identity
type	✔	✔	Both	"file" or "folder"
name	✔	✔ (⚠ copy only)	Workspace tree → Gist	Canonical filename/folder name
children	✔ (actual nodes)	✔ (IDs only)	Metadata	Real hierarchy vs UI ordering
content	✔	❌	Gist	File content
isOpen	❌	✔	Metadata	UI folder open/closed state
isPublic	✔	✔	Workspace tree → Gist	Public sharing flag
publicId	✔	✔	Workspace tree → Gist	Public share ID
publicAt	✔	✔	Workspace tree → Gist	Timestamp of publication
updatedAt	✔	✔	Workspace tree → Gist	Last modified timestamp
backlinks	✔	❌	Workspace tree → Gist	Future feature
tags	✔	❌	Workspace tree → Gist	Future feature
template	✔	❌	Workspace tree → Gist	Future feature
pathCache	✔	❌	Workspace tree (local only)	Internal linking helper
path	❌	✔	Metadata	Full path used as metadata key

*/

function migrateNode(node) {
    // logger.debug("workspace", "migrateNode()");

    logger.debug("workspace", "migrateNode BEFORE", {
        name: node.name,
        type: node.type,
        id: node.id
    });
   
    // Internal linking
    if (!("pathCache" in node)) node.pathCache = null;

    // Public sharing
    if (!("isPublic" in node)) node.isPublic = false;
    if (!("publicId" in node)) node.publicId = null;
    if (!("publicAt" in node)) node.publicAt = null;
    if (!("updatedAt" in node)) node.updatedAt = Date.now();

    // Future features
    /*
    if (node.type === "file") {
        if (!("backlinks" in node)) node.backlinks = [];
        if (!("tags" in node)) node.tags = [];
        if (!("template" in node)) node.template = false;
    }
    */
   
    // Folder-specific
    if (node.type === "folder") {
        if (!Array.isArray(node.children)) node.children = [];
        node.children.forEach(migrateNode);
    }

    logger.debug("workspace", "migrateNode AFTER", {
        name: node.name,
        type: node.type,
        id: node.id
    });

}

export function migrateWorkspace(workspace) {
    logger.debug("workspace", "migrateWorkspace(). Calls migrateNode() for each workspace tree node.");
    workspace.forEach(migrateNode);
    return workspace;   // ← THIS WAS MISSING
}

// Helpers
function isFolderNode(node) {
    return node && node.type === "folder" && Array.isArray(node.children);
}

function isFileNode(node) {
    return node && node.type === "file" && typeof node.content === "string";
}

function encodeName(name) {
    return name
        .replace(/___/g, "__TRIPLE__")
        .replace(/_/g, "__UNDERSCORE__");
}

function decodeName(name) {
    return name
        .replace(/__UNDERSCORE__/g, "_")
        .replace(/__TRIPLE__/g, "___");
}
