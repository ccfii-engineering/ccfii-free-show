const BLOCK_ELEMENTS = new Set(["ADDRESS", "ARTICLE", "BLOCKQUOTE", "DIV", "LI", "OL", "P", "SECTION", "UL"])
const OMIT_ELEMENTS = new Set(["EMBED", "IFRAME", "OBJECT", "SCRIPT", "STYLE"])

export function htmlToPlainText(value: unknown): string {
    const template = document.createElement("template")
    template.innerHTML = String(value || "")

    function collect(node: Node): string {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent || ""
        if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE || node.nodeType === Node.DOCUMENT_NODE) return Array.from(node.childNodes).map(collect).join("")
        if (node.nodeType !== Node.ELEMENT_NODE) return ""

        const element = node as Element
        if (element.tagName === "BR") return "\n"
        if (OMIT_ELEMENTS.has(element.tagName)) return ""

        const content = Array.from(element.childNodes).map(collect).join("")
        return BLOCK_ELEMENTS.has(element.tagName) ? `\n${content}\n` : content
    }

    return collect(template.content)
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
}
