// workspace-metadata.js

export function extractMetadata(nodes) {
    const meta = [];

    function walk(list) {
        for (const node of list) {
            const entry = {
                id: node.id,
                type: node.type,
                name: node.name
            };

            if (node.type === "folder") {
                entry.isOpen = !!node.isOpen;
                entry.children = node.children.map(c => c.id);
                meta.push(entry);
                walk(node.children);
            } else {
                entry.isPublic = !!node.isPublic;
                entry.publicId = node.publicId || null;
                entry.publicAt = node.publicAt || null;
                entry.updatedAt = node.updatedAt || null;
                meta.push(entry);
            }
        }
    }

    walk(nodes);

    return {
        version: 1,
        nodes: meta
    };
}

// workspace-metadata.js

export function applyMetadata(tree, metadata) {
    const map = new Map();
    metadata.nodes.forEach(n => map.set(n.id, n));

    function walk(nodes) {
        for (const node of nodes) {
            const meta = map.get(node.id);
            if (!meta) continue;

            node.name = meta.name;

            if (node.type === "folder") {
                node.isOpen = !!meta.isOpen;

                // Reorder children to match metadata order
                node.children.sort((a, b) =>
                    meta.children.indexOf(a.id) -
                    meta.children.indexOf(b.id)
                );

                walk(node.children);
            } else {
                node.isPublic = !!meta.isPublic;
                node.publicId = meta.publicId || null;
                node.publicAt = meta.publicAt || null;
                node.updatedAt = meta.updatedAt || null;
            }
        }
    }

    walk(tree);
}
