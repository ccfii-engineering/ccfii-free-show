import yauzl, { type Entry, type ZipFile } from "yauzl"
import { parentPort, workerData } from "worker_threads"

type ArchiveLimits = {
    maxEntries: number
    maxEntryBytes: number
    maxInflatedBytes: number
    maxSlides: number
    maxImagePixels: number
    maxTotalImagePixels: number
}

const { sourcePath, limits } = workerData as { sourcePath: string; limits: ArchiveLimits }
const imageExtension = /\.(?:apng|png|jpe?g|gif|bmp|webp|tiff?|svg|avif|heic|jxl)$/i

function failName(fileName: string) {
    if (fileName.includes("\\") || fileName.startsWith("/") || /^[a-z]:/i.test(fileName)) return true
    const segments = fileName.split("/")
    return segments.some((segment) => segment === "..")
}

function readTiffDimensions(data: Buffer) {
    if (data.length < 8) return
    const little = data.toString("ascii", 0, 2) === "II"
    if (!little && data.toString("ascii", 0, 2) !== "MM") return
    const u16 = (offset: number) => (little ? data.readUInt16LE(offset) : data.readUInt16BE(offset))
    const u32 = (offset: number) => (little ? data.readUInt32LE(offset) : data.readUInt32BE(offset))
    if (u16(2) !== 42) return
    const directory = u32(4)
    if (directory + 2 > data.length) return
    const count = Math.min(u16(directory), 4096)
    let width: number | undefined
    let height: number | undefined
    for (let index = 0; index < count; index++) {
        const offset = directory + 2 + index * 12
        if (offset + 12 > data.length) break
        const tag = u16(offset)
        const type = u16(offset + 2)
        const valueCount = u32(offset + 4)
        if (valueCount !== 1 || (type !== 3 && type !== 4)) continue
        const value = type === 3 ? u16(offset + 8) : u32(offset + 8)
        if (tag === 0x0100) width = value
        else if (tag === 0x0101) height = value
    }
    return width && height ? { width, height } : undefined
}

function readJpegDimensions(data: Buffer) {
    if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return
    const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
    let offset = 2
    while (offset + 4 <= data.length) {
        if (data[offset] !== 0xff) return
        while (data[offset] === 0xff) offset++
        const marker = data[offset++]
        if (marker === 0xd9 || marker === 0xda) return
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
        if (offset + 2 > data.length) return
        const segmentLength = data.readUInt16BE(offset)
        if (segmentLength < 2 || offset + segmentLength > data.length) return
        if (frameMarkers.has(marker) && segmentLength >= 11) {
            const components = data[offset + 7]
            if (components < 1 || components > 4 || segmentLength < 8 + 3 * components) return
            return { height: data.readUInt16BE(offset + 3), width: data.readUInt16BE(offset + 5) }
        }
        offset += segmentLength
    }
    return undefined
}

function readWebpDimensions(data: Buffer) {
    if (data.length < 25 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP" || data.readUInt32LE(4) + 8 > data.length) return
    const chunk = data.toString("ascii", 12, 16)
    const chunkSize = data.readUInt32LE(16)
    if (chunkSize > data.length - 20) return
    if (chunk === "VP8X" && chunkSize >= 10 && data.length >= 30) return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) }
    if (chunk === "VP8L" && chunkSize >= 5 && data[20] === 0x2f) {
        const bits = data.readUInt32LE(21)
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) }
    }
    if (chunk === "VP8 " && chunkSize >= 10 && data.length >= 30 && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) {
        return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff }
    }
    return undefined
}

type ImageDimensions = { mime: string; width: number; height: number }

function imageDimensions(data: Buffer): ImageDimensions | undefined {
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    if (data.length >= pngSignature.length && data.subarray(0, 8).equals(pngSignature)) {
        if (data.length < 24 || data.readUInt32BE(8) !== 13 || data.toString("ascii", 12, 16) !== "IHDR") throw new Error("The .pptx archive contains a PNG with an invalid header")
        return { mime: "image/png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
    }
    if (data.length >= 2 && data[0] === 0xff && data[1] === 0xd8) {
        const dimensions = readJpegDimensions(data)
        if (!dimensions) throw new Error("The .pptx archive contains a JPEG without a valid frame header")
        return { mime: "image/jpeg", ...dimensions }
    }
    if (data.length >= 6 && (data.toString("ascii", 0, 6) === "GIF87a" || data.toString("ascii", 0, 6) === "GIF89a")) {
        if (data.length < 10) throw new Error("The .pptx archive contains a GIF with an invalid header")
        return { mime: "image/gif", width: data.readUInt16LE(6), height: data.readUInt16LE(8) }
    }
    if (data.length >= 2 && data.toString("ascii", 0, 2) === "BM") {
        if (data.length < 54 || data.readUInt32LE(14) < 40) throw new Error("The .pptx archive contains a BMP with an unsupported header")
        return { mime: "image/bmp", width: Math.abs(data.readInt32LE(18)), height: Math.abs(data.readInt32LE(22)) }
    }
    if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
        const dimensions = readWebpDimensions(data)
        if (!dimensions) throw new Error("The .pptx archive contains a WebP with an invalid header")
        return { mime: "image/webp", ...dimensions }
    }
    if (data.length >= 4 && ((data.toString("ascii", 0, 2) === "II" && data.readUInt16LE(2) === 42) || (data.toString("ascii", 0, 2) === "MM" && data.readUInt16BE(2) === 42))) {
        const dimensions = readTiffDimensions(data)
        if (!dimensions) throw new Error("The .pptx archive contains a TIFF without valid dimensions")
        return { mime: "image/tiff", ...dimensions }
    }
    return undefined
}

function isSvgData(fileName: string, data: Buffer, contentType?: string) {
    if (fileName.toLowerCase().endsWith(".svg") || contentType?.toLowerCase() === "image/svg+xml" || contentType?.toLowerCase() === "image/svg") return true
    const start = data.toString("utf8", 0, Math.min(data.length, 4096)).trimStart()
    return /<svg\b/i.test(start)
}

function svgPixels(text: string) {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("The .pptx archive contains an SVG with an unsupported document type")
    const root = text.match(/<svg\b([^>]*)>/i)?.[1]
    if (!root) throw new Error("The .pptx archive contains an invalid SVG image")
    const attributes = parseXmlAttributes(root)
    const readLength = (name: string) => {
        const raw = attributes.get(name.toLowerCase())?.trim()
        if (!raw || raw.endsWith("%")) return undefined
        const match = raw.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|pt|pc|mm|cm|in|q)?$/i)
        if (!match) return undefined
        const value = Number(match[1])
        const unit = match[2]?.toLowerCase()
        const factor = unit === "pt" ? 96 / 72 : unit === "pc" ? 16 : unit === "mm" ? 96 / 25.4 : unit === "cm" ? 96 / 2.54 : unit === "in" ? 96 : unit === "q" ? 96 / 101.6 : 1
        return value * factor
    }
    let width = readLength("width")
    let height = readLength("height")
    const viewBox = attributes
        .get("viewbox")
        ?.trim()
        .split(/[\s,]+/)
        .map(Number)
    if ((!width || !height) && viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
        if (width && !height) height = width * (viewBox[3] / viewBox[2])
        else if (height && !width) width = height * (viewBox[2] / viewBox[3])
        else if (!width && !height) [width, height] = [viewBox[2], viewBox[3]]
    }
    if (!width && !height) [width, height] = [300, 150]
    if (!width) width = 300
    if (!height) height = 150
    const pixels = Math.ceil(width) * Math.ceil(height)
    if (!Number.isSafeInteger(pixels) || width <= 0 || height <= 0 || pixels > limits.maxImagePixels) {
        throw new Error("The .pptx archive contains an SVG larger than the 40 megapixel safety limit")
    }
    return pixels
}

function decodeXmlReferences(text: string) {
    return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_reference, name: string) => {
        const normalized = name.toLowerCase()
        const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }
        if (named[normalized]) return named[normalized]
        const codePoint = normalized.startsWith("#x") ? Number.parseInt(normalized.slice(2), 16) : Number.parseInt(normalized.slice(1), 10)
        if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) throw new Error("The .pptx archive contains an invalid SVG character reference")
        return String.fromCodePoint(codePoint)
    })
}

function embeddedDataImageUris(text: string) {
    const references: string[] = []
    const pattern = /data:image\/[a-z0-9.+-]+/gi
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text))) {
        const start = match.index
        const comma = text.indexOf(",", start + match[0].length)
        const headerBoundary = text.slice(start + match[0].length, comma < 0 ? text.length : comma).search(/["'<>)]/)
        if (comma < 0 || headerBoundary >= 0) throw new Error("The .pptx archive contains an invalid embedded SVG image URI")

        let end = text.length
        for (const delimiter of ['"', "'", "<", ">", ")"]) {
            const index = text.indexOf(delimiter, comma + 1)
            if (index >= 0 && index < end) end = index
        }
        references.push(text.slice(start, end).trim())
        pattern.lastIndex = end
    }
    return references
}

function decodeDataImage(uri: string, depth: number): number {
    let decodedUri: string
    try {
        decodedUri = decodeURIComponent(uri)
    } catch {
        throw new Error("The .pptx archive contains an invalid percent-encoded SVG image URI")
    }
    const comma = decodedUri.indexOf(",")
    if (!decodedUri.toLowerCase().startsWith("data:image/") || comma < 0) throw new Error("The .pptx archive contains an unsupported embedded SVG image URI")

    const header = decodedUri.slice(5, comma)
    const mime = header.split(";", 1)[0].toLowerCase()
    const isBase64 = /;base64(?:;|$)/i.test(header)
    if (!isBase64) {
        if (mime !== "image/svg+xml" && mime !== "image/svg") throw new Error("The .pptx archive contains a non-base64 embedded raster image")
        return embeddedSvgImagePixels(Buffer.from(decodedUri.slice(comma + 1), "utf8"), depth + 1)
    }

    const encoded = decodedUri.slice(comma + 1).replace(/\s/g, "")
    if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
        throw new Error("The .pptx archive contains an invalid embedded SVG image")
    }
    const data = Buffer.from(encoded, "base64")
    if (mime === "image/svg+xml" || mime === "image/svg") return embeddedSvgImagePixels(data, depth + 1)

    const image = imageDimensions(data)
    if (!image) throw new Error("The .pptx archive contains an embedded SVG image with an unsupported raster format")
    const normalizedMime = mime === "image/jpg" ? "image/jpeg" : mime
    if (image.mime !== normalizedMime) throw new Error("The .pptx archive contains an embedded SVG image with a mismatched MIME type")
    const pixels = image.width * image.height
    if (!Number.isSafeInteger(pixels) || image.width < 1 || image.height < 1) throw new Error("The .pptx archive contains an embedded SVG image with invalid dimensions")
    if (pixels > limits.maxImagePixels) throw new Error("The .pptx archive contains an embedded image larger than the 40 megapixel per-image limit")
    return pixels
}

function embeddedSvgImagePixels(data: Buffer, depth = 0): number {
    if (depth > 5) throw new Error("The .pptx archive contains too many nested SVG images")
    const text = decodeXmlReferences(data.toString("utf8"))
    let pixels = svgPixels(text)
    for (const uri of embeddedDataImageUris(text)) {
        pixels += decodeDataImage(uri, depth)
        if (!Number.isSafeInteger(pixels) || pixels > limits.maxTotalImagePixels) {
            throw new Error("The .pptx archive contains more than 160 megapixels of images")
        }
    }
    return pixels
}

function openArchive() {
    return new Promise<ZipFile>((resolve, reject) => {
        yauzl.open(sourcePath, { lazyEntries: true, autoClose: false, decodeStrings: true, strictFileNames: true, validateEntrySizes: true }, (error, zipFile) => {
            if (error || !zipFile) reject(error || new Error("The .pptx file is not a valid ZIP archive"))
            else resolve(zipFile)
        })
    })
}

type ContentTypeHints = { defaults: Map<string, string>; overrides: Map<string, string> }

function parseXmlAttributes(source: string) {
    const values = new Map<string, string>()
    for (const match of source.matchAll(/([a-z_][a-z\d_.:-]*)\s*=\s*(["'])(.*?)\2/gis)) values.set(match[1].toLowerCase(), match[3])
    return values
}

function parseContentTypeHints(data: Buffer): ContentTypeHints {
    const text = decodeXmlReferences(data.toString("utf8"))
    const defaults = new Map<string, string>()
    const overrides = new Map<string, string>()
    for (const match of text.matchAll(/<Default\b([^>]*)\/?\s*>/gi)) {
        const attributes = parseXmlAttributes(match[1])
        const extension = attributes.get("extension")?.toLowerCase()
        const contentType = attributes.get("contenttype")?.toLowerCase()
        if (extension && contentType) defaults.set(extension, contentType)
    }
    for (const match of text.matchAll(/<Override\b([^>]*)\/?\s*>/gi)) {
        const attributes = parseXmlAttributes(match[1])
        const partName = attributes.get("partname")?.replace(/^\/+/, "")
        const contentType = attributes.get("contenttype")?.toLowerCase()
        if (partName && contentType) overrides.set(`/${partName}`, contentType)
    }
    return { defaults, overrides }
}

function mimeTypeForEntry(fileName: string, contentTypes: ContentTypeHints) {
    const partName = `/${fileName.replace(/^\/+/, "")}`
    const override = contentTypes.overrides.get(partName)
    if (override) return override
    const extension = fileName.split(".").pop()?.toLowerCase()
    return extension ? contentTypes.defaults.get(extension) : undefined
}

function expectedMimeForExtension(fileName: string) {
    const extension = fileName.split(".").pop()?.toLowerCase()
    const imageTypes: Record<string, string> = {
        apng: "image/png",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        bmp: "image/bmp",
        webp: "image/webp",
        tif: "image/tiff",
        tiff: "image/tiff",
        svg: "image/svg+xml"
    }
    return extension ? imageTypes[extension] : undefined
}

function normalizedMime(mime: string) {
    const lower = mime.toLowerCase()
    if (lower === "image/jpg") return "image/jpeg"
    if (lower === "image/apng") return "image/png"
    if (lower === "image/svg") return "image/svg+xml"
    return lower
}

async function readContentTypeHints(): Promise<ContentTypeHints> {
    const zipFile = await openArchive()
    if (zipFile.entryCount > limits.maxEntries) {
        zipFile.close()
        throw new Error(`The .pptx archive has more than ${limits.maxEntries} entries`)
    }

    return new Promise<ContentTypeHints>((resolve, reject) => {
        let settled = false
        const finish = (error?: Error, hints: ContentTypeHints = { defaults: new Map(), overrides: new Map() }) => {
            if (settled) return
            settled = true
            zipFile.removeAllListeners("entry")
            zipFile.removeAllListeners("error")
            zipFile.removeAllListeners("end")
            zipFile.close()
            if (error) reject(error)
            else resolve(hints)
        }
        zipFile.once("error", (error) => finish(error))
        zipFile.once("end", () => finish())
        zipFile.on("entry", (entry: Entry) => {
            if (settled) return
            if (entry.fileName !== "[Content_Types].xml") {
                zipFile.readEntry()
                return
            }
            if (entry.uncompressedSize > limits.maxEntryBytes) return finish(new Error("The .pptx archive content type list exceeds the 64 MiB entry limit"))
            zipFile.openReadStream(entry, (error, stream) => {
                if (error || !stream) return finish(error || new Error("Could not read the .pptx archive content type list"))
                let totalBytes = 0
                const chunks: Buffer[] = []
                stream.on("data", (chunk: Buffer) => {
                    totalBytes += chunk.length
                    if (totalBytes > limits.maxEntryBytes) {
                        stream.destroy(new Error("The .pptx archive content type list exceeds the 64 MiB entry limit"))
                        return
                    }
                    chunks.push(chunk)
                })
                stream.once("error", (streamError) => finish(streamError))
                stream.once("end", () => {
                    if (settled) return
                    if (totalBytes !== entry.uncompressedSize) return finish(new Error("The .pptx archive content type list did not match its declared size"))
                    finish(undefined, parseContentTypeHints(Buffer.concat(chunks, totalBytes)))
                })
            })
        })
        zipFile.readEntry()
    })
}

async function inspectArchive() {
    const contentTypes = await readContentTypeHints()
    const zipFile = await openArchive()
    if (zipFile.entryCount > limits.maxEntries) {
        zipFile.close()
        throw new Error(`The .pptx archive has more than ${limits.maxEntries} entries`)
    }

    return new Promise<{ pageCount: number }>((resolve, reject) => {
        const names = new Set<string>()
        let slideCount = 0
        let declaredInflated = 0
        let actualInflated = 0
        let imagePixels = 0
        let settled = false

        const finish = (error?: Error) => {
            if (settled) return
            settled = true
            zipFile.removeAllListeners("entry")
            zipFile.removeAllListeners("error")
            zipFile.removeAllListeners("end")
            zipFile.close()
            if (error) reject(error)
            else if (slideCount < 1) reject(new Error("This .pptx file does not contain any slides"))
            else resolve({ pageCount: slideCount })
        }

        zipFile.once("error", (error) => finish(error))
        zipFile.once("end", () => finish())
        zipFile.on("entry", (entry: Entry) => {
            if (settled) return
            const fileName = entry.fileName
            if (!fileName || failName(fileName)) return finish(new Error("The .pptx archive contains an unsafe entry path"))
            if (names.has(fileName)) return finish(new Error("The .pptx archive contains duplicate entry paths"))
            names.add(fileName)
            if (entry.isEncrypted()) return finish(new Error("Encrypted .pptx archives are not supported"))

            if (entry.uncompressedSize > limits.maxEntryBytes) return finish(new Error(`The .pptx archive contains an entry larger than ${Math.round(limits.maxEntryBytes / (1024 * 1024))} MiB`))
            declaredInflated += entry.uncompressedSize
            if (declaredInflated > limits.maxInflatedBytes) return finish(new Error("The .pptx archive expands beyond the 512 MiB safety limit"))

            if (/^ppt\/slides\/slide\d+\.xml$/i.test(fileName)) {
                slideCount++
                if (slideCount > limits.maxSlides) return finish(new Error(`The .pptx file has more than ${limits.maxSlides} slides`))
            }

            const declaredType = mimeTypeForEntry(fileName, contentTypes)
            const extensionType = expectedMimeForExtension(fileName)
            const expectedType = declaredType || extensionType
            const isImage = imageExtension.test(fileName) || declaredType?.startsWith("image/") === true
            const isMedia = /^ppt\/media\//i.test(fileName)
            const shouldBuffer = isImage || isMedia
            let entryBytes = 0
            const chunks: Buffer[] = []
            zipFile.openReadStream(entry, (error, stream) => {
                if (error || !stream) return finish(error || new Error("Could not read a .pptx archive entry"))
                stream.on("data", (chunk: Buffer) => {
                    entryBytes += chunk.length
                    actualInflated += chunk.length
                    if (entryBytes > limits.maxEntryBytes) {
                        stream.destroy(new Error(`The .pptx archive contains an entry larger than ${Math.round(limits.maxEntryBytes / (1024 * 1024))} MiB`))
                        return
                    }
                    if (actualInflated > limits.maxInflatedBytes) {
                        stream.destroy(new Error("The .pptx archive expands beyond the 512 MiB safety limit"))
                        return
                    }
                    if (shouldBuffer) chunks.push(chunk)
                })
                stream.once("error", (streamError) => finish(streamError))
                stream.once("end", () => {
                    if (settled) return
                    if (entryBytes !== entry.uncompressedSize) return finish(new Error("A .pptx archive entry did not match its declared size"))
                    if (shouldBuffer) {
                        if (!entryBytes) return finish(new Error("The .pptx archive contains an empty raster image"))
                        const imageData = Buffer.concat(chunks, entryBytes)
                        if (isSvgData(fileName, imageData, declaredType)) {
                            try {
                                const svgPixels = embeddedSvgImagePixels(imageData)
                                if (expectedType && normalizedMime(expectedType) !== "image/svg+xml") return finish(new Error("The .pptx archive SVG content does not match its declared media type"))
                                imagePixels += svgPixels
                                if (!Number.isSafeInteger(imagePixels) || imagePixels > limits.maxTotalImagePixels) return finish(new Error("The .pptx archive contains more than 160 megapixels of images"))
                            } catch (error) {
                                return finish(error instanceof Error ? error : new Error(String(error)))
                            }
                            zipFile.readEntry()
                            return
                        }
                        const dimensions = imageDimensions(imageData)
                        if (!dimensions && !isImage) {
                            zipFile.readEntry()
                            return
                        }
                        if (!dimensions) {
                            return finish(new Error("The .pptx archive contains an unsupported raster image format"))
                        }
                        if (!Number.isSafeInteger(dimensions.width) || !Number.isSafeInteger(dimensions.height) || dimensions.width < 1 || dimensions.height < 1) return finish(new Error("The .pptx archive contains an image with invalid dimensions"))
                        const pixels = dimensions.width * dimensions.height
                        if (!Number.isSafeInteger(pixels) || pixels > limits.maxImagePixels) return finish(new Error("The .pptx archive contains an image larger than the 40 megapixel per-image limit"))
                        imagePixels += pixels
                        if (!Number.isSafeInteger(imagePixels) || imagePixels > limits.maxTotalImagePixels) return finish(new Error("The .pptx archive contains more than 160 megapixels of images"))
                        if (expectedType && normalizedMime(expectedType) !== dimensions.mime) return finish(new Error("The .pptx archive raster bytes do not match the declared media type"))
                    }
                    zipFile.readEntry()
                })
            })
        })

        zipFile.readEntry()
    })
}

void inspectArchive()
    .then((result) => parentPort?.postMessage(result))
    .catch((error: unknown) => parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) }))
