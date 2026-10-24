export type FolderBatchAckIdentity = {
    requestId: string
    batchSequence: number
    ownerId: number
}

export function matchesFolderBatchAck(expected: FolderBatchAckIdentity, received: unknown): boolean {
    if (!received || typeof received !== "object") return false
    const ack = received as FolderBatchAckIdentity & { accepted?: unknown }
    return ack.requestId === expected.requestId && ack.batchSequence === expected.batchSequence && ack.ownerId === expected.ownerId && ack.accepted === true
}
