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
export function setWorkspace(data) {
    logger.debug("workspace", "setWorkspace()");
    // If nothing provided, initialize empty array
    if (!data) {
        workspace = [];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
        return;
    }

    // If data is a single object, wrap it
    if (!Array.isArray(data)) {
        data = [data];
    }

    // Normalize every node
    workspace = data.map(normalizeNode);

    // ensure all nodes have required fields - this allows adding a new field easily
    migrateWorkspace(workspace);

    // Save normalized version
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
    if (!Array.isArray(tree)) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
}

export function loadState() {
    logger.debug("workspace", "loadState()");
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
        logger.info("workspace: loadState", "Workspace not found: ", STORAGE_KEY);
        return;
    }
    logger.debug("workspace: loadState", "Raw localStorage: ", saved);

    try {
        let tree = JSON.parse(saved);
        logger.debug("workspace: loadState", "Parsed localStorage: ", tree);

        // Ensure root is ALWAYS an array
        if (!Array.isArray(tree)) {
            tree = [tree];
        }
        
        migrateWorkspace(tree);  // Migrate to new model
        setWorkspace(tree);
        saveState(); // ensure new fields persist
    } catch (e) {
        logger.error("Failed to load workspace:", e);
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
    return {
        id: crypto.randomUUID(),
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
    return {
        id: crypto.randomUUID(),
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
                    content: node.content || ""
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



export function unflattenWorkspace(flat) {
    logger.debug("workspace", "unflattenWorkspace()");
    const root = [];

    for (const flatKey in flat) {
        const parts = flatKey.split("___").map(decodeName);
        const content = flat[flatKey];

        let current = root;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];

            // this line results in anthign that's no 'md or 'puml' being treated as a folder e.g. 'json'
            const isFile =
                i === parts.length - 1 &&
                (part.endsWith(".md") || part.endsWith(".puml"));

            if (isFile) {
                // Prevent duplicate files
                let existing = current.find(
                    n => n.type === "file" && n.name === part
                );

                if (!existing) {
                    existing = {
                        id: crypto.randomUUID(),
                        type: "file",
                        name: part,
                        content
                    };
                    current.push(existing);
                } else {
                    // Overwrite content if duplicate
                    existing.content = content;
                }

            } else {
                // Folder
                let folder = current.find(
                    n => n.type === "folder" && n.name === part
                );

                if (!folder) {
                    folder = {
                        id: crypto.randomUUID(),
                        type: "folder",
                        name: part,
                        children: []
                    };
                    current.push(folder);
                }

                current = folder.children;
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

export function mergeWorkspace(localTree, cloudFlat, cloudMetadata) {
    logger.debug("workspace", "mergeWorkspace() CALLED", {
        localCount: Array.isArray(localTree) ? localTree.length : typeof localTree,
        cloudFlatCount: Object.keys(cloudFlat || {}).length,
        cloudMetaCount: Array.isArray(cloudMetadata) ? cloudMetadata.length : typeof cloudMetadata,
    });

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
        if (meta) {
            id = meta.id;
        } else if (local) {
            id = local.id;
        } else {
            id = crypto.randomUUID();
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
    const cloudPaths = Object.keys(cloudFlat || {}).sort();

    for (const flatKey of cloudPaths) {
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

        let id;
        if (meta) {
            // Cloud is canonical
            id = meta.id;
        } else if (local) {
            // Local-only file (unsaved work)
            id = local.id;
        } else {
            // Brand new file
            id = crypto.randomUUID();
        }

        mergedMap[flatKey] = {
            id,
            type: isFile ? "file" : "folder",
            name,
            content: isFile ? cloudFlat[flatKey] : null,
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
            const isFile = i === parts.length - 1 &&
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

// Convert old → new
function migrateOldFormat(oldSubjects) {
    return oldSubjects.map(subject => {
        const folder = createFolder(subject.title);

        subject.files.forEach(file => {
            const content = file.content || "";
            let name = file.title.trim();

            // If the old file already had an extension, keep it
            if (name.endsWith(".md") || name.endsWith(".puml")) {
                // keep as-is
            } else {
                // Detect PUML content
                // md files can contain puml scripts - so that would suggest that potentially md files are being renamed as puml
                const isPuml = /@startuml[\s\S]*?@enduml/.test(content);
                name += isPuml ? ".puml" : ".md";
            }

            folder.children.push({
                id: file.id || crypto.randomUUID(),
                type: "file",
                name,
                content
            });
        });

        return folder;
    });
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
    logger.debug("workspace", "migrateNode()");
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
}


export function migrateWorkspace(workspace) {
    logger.debug("workspace", "migrateWorkspace()");
    workspace.forEach(migrateNode);
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
