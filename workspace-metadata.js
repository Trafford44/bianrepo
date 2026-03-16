// workspace-metadata.js
import { logger } from "./logger.js";

logger.debug("workspace-metadata","workspace-metadata.js loaded from:", import.meta.url);

export function extractMetadata(nodes) {
    const meta = [];

    function walk(list, parentPath = "") {
        for (const node of list) {
            const path = parentPath ? `${parentPath}___${node.name}` : node.name;

            const entry = {
                id: node.id,
                type: node.type,
                name: node.name,
                path
            };

            if (node.type === "folder") {
                entry.isOpen = !!node.isOpen;
                entry.children = node.children.map(c => c.id);
                meta.push(entry);
                walk(node.children, path);
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
    metadata.nodes.forEach(n => map.set(n.path, n));

    // amend this function if adding a new field
    function walk(nodes, parentPath = "") {
        for (const node of nodes) {
            const nodePath = parentPath
                ? `${parentPath}___${node.name}`
                : node.name;

            const meta = map.get(nodePath);
            if (meta) {
                node.id = meta.id;            // restore ID
                //node.name = meta.name;          // NEVER restore node.name

                if (node.type === "folder") {
                    node.isOpen = !!meta.isOpen;

                    // reorder children
                    node.children.sort((a, b) =>
                        meta.children.indexOf(a.id) -
                        meta.children.indexOf(b.id)
                    );
                } else {
                    node.isPublic = !!meta.isPublic;
                    node.publicId = meta.publicId || null;
                    node.publicAt = meta.publicAt || null;
                    node.updatedAt = meta.updatedAt || null;
                }
            }

            if (node.children) {
                walk(node.children, nodePath);
            }
        }
    }

    walk(tree);
}

