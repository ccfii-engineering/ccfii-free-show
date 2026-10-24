import fs from "fs"
import path from "path"

export function getSofficePath(): string {
    const defaultPaths: Record<string, string[]> = {
        win32: [path.join(process.env.PROGRAMFILES || "C:\\Program Files", "LibreOffice", "program", "soffice.exe"), path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "LibreOffice", "program", "soffice.exe")],
        darwin: ["/Applications/LibreOffice.app/Contents/MacOS/soffice"],
        linux: ["/usr/bin/soffice", "/usr/bin/libreoffice"]
    }

    const standardPaths = defaultPaths[process.platform] || []
    for (const p of standardPaths) {
        try {
            if (fs.existsSync(p) && fs.lstatSync(p).isFile()) return p
        } catch (err) {
            // ignore
        }
    }

    return "soffice"
}
