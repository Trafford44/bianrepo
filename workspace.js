let workspace = []
const STORAGE_KEY = "kb_data";

export function getWorkspace() {
    // ensure workspace is always sorted
    sortTree(workspace); // root stays in user-defined order
    return workspace;
}


// Main entry point
export function setWorkspace(data) {
    console.log("setWorkspace called with:", data);
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
    const tree = getWorkspace();
    if (!Array.isArray(tree)) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
}

export function loadState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    try {
        let tree = JSON.parse(saved);

        // Ensure root is ALWAYS an array
        if (!Array.isArray(tree)) {
            tree = [tree];
        }

        migrateWorkspace(tree);  // Migrate to new model

        setWorkspace(tree);
        saveState(); // ensure new fields persist
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


export function createFile(name) {
    return {
        id: crypto.randomUUID(),
        type: "file",
        name,
        content: "",

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

function migrateNode(node) {
    // Internal linking
    if (!("pathCache" in node)) node.pathCache = null;

    // Public sharing
    if (!("isPublic" in node)) node.isPublic = false;
    if (!("publicId" in node)) node.publicId = null;
    if (!("publicAt" in node)) node.publicAt = null;
    if (!("updatedAt" in node)) node.updatedAt = Date.now();

    // Future features
    if (node.type === "file") {
        if (!("backlinks" in node)) node.backlinks = [];
        if (!("tags" in node)) node.tags = [];
        if (!("template" in node)) node.template = false;
    }

    // Folder-specific
    if (node.type === "folder") {
        if (!Array.isArray(node.children)) node.children = [];
        node.children.forEach(migrateNode);
    }
}

function migrateWorkspace(workspace) {
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
