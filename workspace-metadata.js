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
