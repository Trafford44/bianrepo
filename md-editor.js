export function applyMarkdownFormat(type, textarea) {
    // store previous value for one-level formatting undo
    textarea.dataset.lastFormatValue = textarea.value;

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
        case "underline":
            replacement = `<u>${selected}</u>`;
            break;
        case "strike":
            replacement = `~~${selected}~~`;
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
        case "date":
            replacement = new Date().toISOString().split("T")[0];
            break;
        case "br":
            replacement = `<br>\n`;
            break;
        case "hr":
            replacement = `\n***\n`;
            break;
    }

textarea.setRangeText(before + replacement + after, start, end, "end");

// restore cursor without breaking undo
const cursorStart = start + before.length;
const cursorEnd = cursorStart + replacement.length;

textarea.selectionStart = cursorStart;
textarea.selectionEnd = cursorEnd;

textarea.focus();
textarea.dispatchEvent(new Event("input"));

}

