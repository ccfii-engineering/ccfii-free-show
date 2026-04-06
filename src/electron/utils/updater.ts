import { readFileSync } from "fs"
import path from "path"
import { app } from "electron"
import { autoUpdater } from "electron-updater"
import { isProd } from ".."
import { isInternalBuild, shouldCheckForUpdates } from "./updateSupport"

// let notification: Notification | null

export default async function checkForUpdates() {
    const internalBuild = getInternalBuildFlag()
    if (!shouldCheckForUpdates({ isProd, platform: process.platform, internalBuild })) {
        if (process.platform === "darwin" && internalBuild) {
            console.info("Skipping auto-update check for internal macOS build.")
        }
        return
    }

    try {
        await autoUpdater.checkForUpdatesAndNotify()
    } catch (err) {
        console.error("Auto-update error:", err)
    }

    // {
    //   title: app.getName(),
    //   body: "Downloading new update...",
    // }

    // autoUpdater.logger = console;

    // autoUpdater.on("update-available", () => {
    //   notification = new Notification({
    //     title: app.getName(),
    //     body: "Updates are available. Click to download.",
    //     silent: true,
    //     icon: nativeImage.createFromPath(join(__dirname, "..", "..", "public", "icon.png")),
    //   })
    //   notification.show()
    //   notification.on("click", () => {
    //     autoUpdater.downloadUpdate().catch((err) => {
    //       console.error(JSON.stringify(err))
    //     })
    //   })
    // })

    // // autoUpdater.on("update-not-available", () => {
    // //   notification = new Notification({
    // //     title: app.getName(),
    // //     body: "Your software is up to date.",
    // //     silent: true,
    // //     icon: nativeImage.createFromPath(join(__dirname, "..", "..", "public", "icon.png"))
    // //   })
    // //   notification.show()
    // // })

    // autoUpdater.on("update-downloaded", () => {
    //   notification = new Notification({
    //     title: app.getName(),
    //     body: "The updates are ready. Click to quit and install.",
    //     silent: true,
    //     icon: nativeImage.createFromPath(join(__dirname, "..", "..", "public", "icon.png")),
    //   })
    //   notification.show()
    //   notification.on("click", () => {
    //     autoUpdater.quitAndInstall()
    //   })
    // })

    // autoUpdater.on("error", (err) => {
    //   notification = new Notification({
    //     title: app.getName(),
    //     body: "Error: " + JSON.stringify(err) + "\n" + autoUpdater.getFeedURL(),
    //     silent: true,
    //     // icon: nativeImage.createFromPath(join(__dirname, "..", "..", "public", "icon.png")),
    //   })

    //   notification.show()
    // })
}

function getInternalBuildFlag(): boolean {
    try {
        const packageJsonPath = path.join(app.getAppPath(), "package.json")
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
        return isInternalBuild(packageJson)
    } catch (err) {
        console.warn("Could not determine build channel for auto-update checks:", err)
        return false
    }
}
