<img align="right" width="150" height="150" src="public/ccfii-logo.png">

# FreeShow - CCFII Edition

> A customized build of [FreeShow](https://github.com/ChurchApps/FreeShow) for Christ Charismatic Fellowship Int'l, Inc. (CCFII). Show song lyrics, media, and presentations for free.

This is a fork of FreeShow branded for CCFII's worship services. It includes CCFII's color palette, logo, and visual identity while preserving all of FreeShow's features.

## Download & Install

Go to the [Releases](https://github.com/ccfii-engineering/ccfii-free-show/releases) page and download the latest version for your platform:

| Platform | File | Notes |
|---|---|---|
| **Windows** | `FreeShow-CCFII-x.x.x-x64.exe` | Run the installer. Windows may show a SmartScreen warning — click "More info" then "Run anyway" (the app is unsigned). |
| **macOS** | `FreeShow-CCFII-x.x.x-arm64.dmg` (Apple Silicon) or `FreeShow-CCFII-x.x.x-x64.dmg` (Intel) | Open the DMG and drag to Applications. On first launch, right-click the app and select "Open" to bypass Gatekeeper (the app is unsigned). |

## Updating the App

Since this is an internal build without code signing, **auto-updates are not available on macOS**. On Windows, the app may notify you of updates automatically — if it does, follow the prompts.

If auto-update does not work (or you are on macOS), follow these steps:

### Windows

1. Go to [Releases](https://github.com/ccfii-engineering/ccfii-free-show/releases)
2. Download the latest `.exe` installer
3. Run it — the installer will automatically replace the old version
4. Your shows, settings, and media are preserved (they are stored separately from the app)

### macOS

1. Go to [Releases](https://github.com/ccfii-engineering/ccfii-free-show/releases)
2. Download the latest `.dmg` for your Mac (arm64 for Apple Silicon, x64 for Intel)
3. Open the DMG and drag the new app to Applications, replacing the old one
4. Your shows, settings, and media are preserved (stored in `~/Library/Application Support/freeshow/`)

### How to check your current version

In the app, go to **Help > About** or look at the startup screen — the version number is displayed below "CCFII Edition."

## For Developers

### Prerequisites

- [Node.js](https://nodejs.org/en/download/) v22+
- [Python 3.11+](https://www.python.org/downloads/) with [`setuptools`](https://pypi.org/project/setuptools/)
- **Windows only:** [Visual Studio](https://visualstudio.microsoft.com/downloads/) with "Desktop development with C++" and "Windows 10 SDK"

### Development

```bash
npm install        # Install dependencies
npm start          # Start dev environment (Vite + Electron)
npm run build      # Production build
```

### Building Installers

```bash
npm run dist:internal    # Build unsigned installers for local testing
```

## Credits

FreeShow is created by [Kristoffer Vassbo](https://github.com/vassbo) and the [ChurchApps](https://churchapps.org/) team. Licensed under [GPL-3.0](LICENSE).

CCFII Edition branding by [CCFII Engineering](https://github.com/ccfii-engineering).
