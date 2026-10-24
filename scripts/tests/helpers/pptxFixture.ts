import fs from "node:fs"
import yazl from "yazl"

const minimumPptxEntries: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
    <Default Extension="xml" ContentType="application/xml" />
    <Default Extension="png" ContentType="image/png" />
    <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml" />
    <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml" />
    <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml" />
    <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml" />
    <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml" />
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml" />
</Relationships>`,
    "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
    <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1" /></p:sldMasterIdLst>
    <p:sldIdLst><p:sldId id="256" r:id="rId2" /></p:sldIdLst>
    <p:sldSz cx="9144000" cy="5143500" />
    <p:notesSz cx="6858000" cy="9144000" />
</p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml" />
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml" />
</Relationships>`,
    "ppt/slides/slide1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
    <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="" /><p:cNvGrpSpPr /><p:nvPr /></p:nvGrpSpPr><p:grpSpPr /><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title" /><p:cNvSpPr /><p:nvPr /></p:nvSpPr><p:spPr /><p:txBody><a:bodyPr /><a:lstStyle /><a:p><a:r><a:t>Fixture slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`,
    "ppt/slides/_rels/slide1.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml" />
</Relationships>`,
    "ppt/slideLayouts/slideLayout1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree /></p:cSld></p:sldLayout>`,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml" />
</Relationships>`,
    "ppt/slideMasters/slideMaster1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Master"><p:spTree /></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink" /></p:sldMaster>`,
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml" />
</Relationships>`,
    "ppt/theme/theme1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Fixture"><a:themeElements><a:clrScheme name="Fixture"><a:dk1><a:srgbClr val="000000" /></a:dk1><a:lt1><a:srgbClr val="FFFFFF" /></a:lt1><a:dk2><a:srgbClr val="1F497D" /></a:dk2><a:lt2><a:srgbClr val="EEECE1" /></a:lt2><a:accent1><a:srgbClr val="4F81BD" /></a:accent1><a:accent2><a:srgbClr val="C0504D" /></a:accent2><a:accent3><a:srgbClr val="9BBB59" /></a:accent3><a:accent4><a:srgbClr val="8064A2" /></a:accent4><a:accent5><a:srgbClr val="4BACC6" /></a:accent5><a:accent6><a:srgbClr val="F79646" /></a:accent6><a:hlink><a:srgbClr val="0000FF" /></a:hlink><a:folHlink><a:srgbClr val="800080" /></a:folHlink></a:clrScheme><a:fontScheme name="Fixture"><a:majorFont><a:latin typeface="Arial" /></a:majorFont><a:minorFont><a:latin typeface="Arial" /></a:minorFont></a:fontScheme><a:fmtScheme name="Fixture"><a:fillStyleLst /><a:lnStyleLst /><a:effectStyleLst /><a:bgFillStyleLst /></a:fmtScheme></a:themeElements></a:theme>`
}

/**
 * Write a small, structurally complete PPTX package with any supplied parts
 * replacing the defaults. The file is a real ZIP; importer tests should run
 * the production ZIP/XML path against it rather than mocking archive contents.
 */
export function writePptxFixture(filePath: string, entries: Record<string, string | Buffer> = {}): Promise<string> {
    return new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile()
        const stream = fs.createWriteStream(filePath)

        zip.outputStream.pipe(stream)
        stream.on("error", reject)
        stream.on("close", () => resolve(filePath))
        zip.on("error", reject)

        for (const [name, content] of Object.entries({ ...minimumPptxEntries, ...entries })) {
            zip.addBuffer(typeof content === "string" ? Buffer.from(content, "utf8") : content, name)
        }
        zip.end()
    })
}
