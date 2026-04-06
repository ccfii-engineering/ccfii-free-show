module.exports = {
    appId: "app.freeshow",
    productName: "FreeShow - CCFII Edition",
    artifactName: "FreeShow-CCFII-${version}-${arch}.${ext}",
    extraMetadata: {
        internalBuild: true
    },
    publish: [
        {
            provider: "github"
        }
    ],
    files: ["build/electron/**", "build/types/**", "public/**", "!node_modules/@napi-rs"],
    extraResources: [
        {
            from: "node_modules/slideshow/",
            to: "slideshow",
            filter: ["connector-*"]
        }
    ],
    win: {
        target: "NSIS",
        icon: "build/public/icon.png",
        asarUnpack: ["**/node_modules/macadam/**/*.node"]
    },
    linux: {
        asarUnpack: ["**/node_modules/grandiose/**", "**/node_modules/macadam/**/*.node", "**/node_modules/libltc-wrapper/**/*"],
        category: "AudioVideo",
        target: ["AppImage", "deb", "rpm"],
        icon: "build/public"
    },
    deb: {
        depends: ["libfontconfig1", "uuid-runtime", "libltc11"]
    },
    mac: {
        icon: "build/public/icon.png",
        asarUnpack: ["**/node_modules/macadam/**/*.node"],
        target: [
            {
                target: "dmg",
                arch: ["x64", "arm64"]
            },
            {
                target: "zip",
                arch: ["x64", "arm64"]
            }
        ],
        category: "public.app-category.utilities",
        identity: null,
        hardenedRuntime: false,
        gatekeeperAssess: false,
        notarize: false,
        extendInfo: {
            NSMicrophoneUsageDescription: "Please give access to your microphone if you want to use it for input.",
            NSCameraUsageDescription: "Please give access to your camera if you want to use it for input."
        }
    },
    dmg: {
        background: "build/public/dmg.png",
        sign: false,
        contents: [
            {
                x: 140,
                y: 150
            },
            {
                x: 400,
                y: 150,
                type: "link",
                path: "/Applications"
            }
        ]
    }
}
