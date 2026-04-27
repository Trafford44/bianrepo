export function collapseAllFolders() {
    workspace.forEach(node => collapseFolderRecursive(node));
    saveWorkspace(); // or whatever your persistence function is
    renderSidebar();
}

function collapseFolderRecursive(node) {
    if (node.type === "folder") {
        node.isOpen = false;
        node.children.forEach(child => collapseFolderRecursive(child));
    }
}
