let workspace = []
const STORAGE_KEY = "kb_data";

export function getWorkspace() {
    // ensure workspace is always sorted
    sortTree(workspace, true); // root stays in user-defined order
    return workspace;
}


// Main entry point
export function setWorkspace(data) {
    if (!data) {
        workspace = [];
        return;
    }

    // Already new-ish format?
    if (Array.isArray(data)) {
        // Normalize every node (handles mixed old/new)
        workspace = data.map(normalizeNode);

        // Save normalized version
        localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
        return;
    }

    // Old format?
    if (looksLikeOldFormat(data)) {
        const migrated = migrateOldFormat(data).map(normalizeNode);
        workspace = migrated;

        // Save new format so migration happens only once
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return;
    }

    // Fallback: empty workspace
    workspace = [];
}


function sortTree(nodes, isRoot = false) {
    // Only sort children, not the root
    if (!isRoot) {
        nodes.sort((a, b) => {
            // files first
            if (a.type !== b.type) {
                return a.type === "file" ? -1 : 1;
            }
            // alphabetical within type
            return a.name.localeCompare(b.name);
        });
    }

    // Recurse into folders
    nodes.forEach(node => {
        if (node.type === "folder" && Array.isArray(node.children)) {
            sortTree(node.children, false);
        }
    });
}

function normalizeNode(node) {
    // Convert old "title" to new "name"
    if (!node.name && node.title) {
        node.name = node.title;
    }

    // Infer type if missing
    if (!node.type) {
        node.type = node.children ? "folder" : "file";
    }

    // Ensure children array exists for folders
    if (node.type === "folder" && !Array.isArray(node.children)) {
        node.children = [];
    }

    // Recurse
    if (node.children) {
        node.children = node.children.map(normalizeNode);
    }

    return node;
}


export function saveState() {
    const tree = getWorkspace();
    if (!Array.isArray(tree)) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
}

export function loadState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    try {
        const tree = JSON.parse(saved);
        setWorkspace(tree);
    } catch (e) {
        console.error("Failed to load workspace:", e);
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
        name,
        children: []
    };
}

export function createFile(name, content = "") {
    return {
        id: crypto.randomUUID(),
        type: "file",
        name,
        content
    };
}

export function flattenWorkspace(tree) {
    const output = {};

    function walk(nodes, pathParts) {
        for (const node of nodes) {
            const encoded = encodeName(node.name);

            if (node.type === "folder") {
                walk(node.children, [...pathParts, encoded]);
            } else if (node.type === "file") {
                let fileName = encoded;

                // Ensure extension is preserved or defaulted
                if (!fileName.endsWith(".md") && !fileName.endsWith(".puml")) {
                    fileName += ".md";
                }

                const fullPath = [...pathParts, fileName].join("___");
                output[fullPath] = node.content;
            }
        }
    }

    walk(tree, []);
    return output;
}

export function unflattenWorkspace(flat) {
    const root = [];

    for (const flatKey in flat) {
        const parts = flatKey.split("___").map(decodeName);
        const content = flat[flatKey];

        let current = root;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];

            const isFile =
                i === parts.length - 1 &&
                (part.endsWith(".md") || part.endsWith(".puml"));

            if (isFile) {
                current.push({
                    id: crypto.randomUUID(),
                    type: "file",
                    name: part,
                    content
                });
            } else {
                let folder = current.find(n => n.type === "folder" && n.name === part);

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
