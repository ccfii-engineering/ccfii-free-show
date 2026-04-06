type UpdateSupportInput = {
    isProd: boolean
    platform: NodeJS.Platform
    internalBuild: boolean
}

type PackageJsonLike = {
    internalBuild?: boolean
}

export function isInternalBuild(packageJson?: PackageJsonLike | null): boolean {
    return packageJson?.internalBuild === true
}

export function shouldCheckForUpdates({ isProd, platform, internalBuild }: UpdateSupportInput): boolean {
    if (!isProd) return false
    if (platform === "darwin" && internalBuild) return false
    return true
}
