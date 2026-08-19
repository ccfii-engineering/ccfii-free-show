export interface OutputRenderAuthority {
    sessionId: string
    revision: number
}

export class OutputRenderAuthorityTracker {
    private revision = 0
    private readonly sessionId: string

    constructor(sessionId: string) {
        this.sessionId = sessionId
    }

    current(): OutputRenderAuthority {
        return { sessionId: this.sessionId, revision: this.revision }
    }

    beginRevision(revision: number): { commit(): void; rollback(): void } {
        const previousRevision = this.revision
        this.revision = revision
        let settled = false

        return {
            commit: () => {
                settled = true
            },
            rollback: () => {
                if (settled) return
                settled = true
                if (this.revision === revision) this.revision = previousRevision
            }
        }
    }
}
