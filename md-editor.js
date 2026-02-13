export function applyMarkdownFormat(type, textarea) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end);

    let before = "";
    let after = "";
    let replacement = selected;

    switch (type) {
        case "bold":
            before = "**"; after = "**";
            break;
        case "italic":
            before = "*"; after = "*";
            break;
        case "h1":
            replacement = `# ${selected}`;
            break;
        case "link":
            replacement = `[${selected || "text"}](url)`;
            break;
        case "code":
            before = "`"; after = "`";
            break;
        case "quote":
            replacement = `> ${selected}`;
            break;
        case "ul":
            replacement = `- ${selected}`;
            break;
        case "ol":
            replacement = `1. ${selected}`;
            break;
    }

    const newText =
        textarea.value.substring(0, start) +
        before + replacement + after +
        textarea.value.substring(end);

    textarea.value = newText;

    // restore cursor
    textarea.selectionStart = start + before.length;
    textarea.selectionEnd = start + before.length + replacement.length;

    textarea.dispatchEvent(new Event("input"));
}

