import assert from "node:assert/strict"
import { test } from "node:test"

import { createIPCRequestMetadata, decodeIPCRequestReply, runIPCRequest } from "../../src/types/IPC/Request.ts"

test("registers the reply listener before sending and preserves falsey response values", async () => {
    for (const value of [false, 0, "", null]) {
        let listener
        let listenerActive = false
        let removed = false

        const resultPromise = runIPCRequest({
            timeoutMs: 100,
            subscribe: (receive) => {
                listener = receive
                listenerActive = true
                return () => {
                    listenerActive = false
                    removed = true
                }
            },
            send: () => {
                assert.equal(listenerActive, true)
                const reply = decodeIPCRequestReply({
                    data: value,
                    ipcRequest: createIPCRequestMetadata("reply", { status: "success" })
                })
                assert.ok(reply)
                listener(reply)
            },
            cancel: () => assert.fail("an immediate reply must not be cancelled")
        })

        assert.deepEqual(await resultPromise, { status: "success", data: value })
        assert.equal(listenerActive, false)
        assert.equal(removed, true)
    }
})

test("does not infer protocol outcomes from fields in an application value", () => {
    const applicationValue = {
        status: "error",
        error: { name: "ApplicationError", message: "ordinary data" },
        ipcRequest: { protocol: "freeshow-ipc-request", version: 1, kind: "reply", status: "error" }
    }
    const decoded = decodeIPCRequestReply({
        data: applicationValue,
        ipcRequest: createIPCRequestMetadata("reply", { status: "success" })
    })

    assert.deepEqual(decoded, { status: "success", data: applicationValue })
})

test("keeps no reply distinct from a negotiated handler failure", () => {
    assert.equal(decodeIPCRequestReply({ data: null }), undefined)
    assert.equal(decodeIPCRequestReply({ data: "late", ipcRequest: createIPCRequestMetadata("request") }), undefined)
    assert.deepEqual(decodeIPCRequestReply({ data: undefined, ipcRequest: createIPCRequestMetadata("reply", { status: "success" }) }), { status: "error", error: { name: "IPCProtocolError", message: "Malformed IPC request reply" } })

    assert.deepEqual(
        decodeIPCRequestReply({
            data: undefined,
            ipcRequest: createIPCRequestMetadata("reply", { status: "error", error: { name: "Error", message: "handler failed" } })
        }),
        { status: "error", error: { name: "Error", message: "handler failed" } }
    )
})

test("reports timeout as execution-unknown, cancels work, ignores late replies, and cleans up", async () => {
    let listener
    let removed = false
    let cancelCount = 0

    const resultPromise = runIPCRequest({
        timeoutMs: 5,
        subscribe: (receive) => {
            listener = receive
            return () => {
                removed = true
            }
        },
        send: () => {},
        cancel: () => {
            cancelCount++
        }
    })

    assert.deepEqual(await resultPromise, { status: "timeout", execution: "unknown" })
    assert.equal(cancelCount, 1)
    assert.equal(removed, true)

    listener({ status: "success", data: "late" })
    assert.deepEqual(await resultPromise, { status: "timeout", execution: "unknown" })
})

test("settles an aborted request as cancelled and identifies work that may continue", async () => {
    const controller = new AbortController()
    let listener
    let removed = false
    let cancelCount = 0

    const resultPromise = runIPCRequest({
        timeoutMs: 100,
        signal: controller.signal,
        subscribe: (receive) => {
            listener = receive
            return () => {
                removed = true
            }
        },
        send: () => {},
        cancel: () => {
            cancelCount++
        }
    })

    controller.abort()
    assert.deepEqual(await resultPromise, { status: "cancelled", work: "may-continue" })
    assert.equal(cancelCount, 1)
    assert.equal(removed, true)

    listener({ status: "success", data: "late" })
    assert.deepEqual(await resultPromise, { status: "cancelled", work: "may-continue" })
})

test("does not send a request when its signal was already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    let subscribed = false
    let sent = false

    const result = await runIPCRequest({
        timeoutMs: 100,
        signal: controller.signal,
        subscribe: () => {
            subscribed = true
            return () => {}
        },
        send: () => {
            sent = true
        },
        cancel: () => assert.fail("pre-aborted requests must not send cancellation")
    })

    assert.deepEqual(result, { status: "cancelled", work: "not-started" })
    assert.equal(subscribed, false)
    assert.equal(sent, false)
})

test("returns handler failures as a distinct result and removes the listener", async () => {
    let removed = false
    const result = await runIPCRequest({
        timeoutMs: 100,
        subscribe: (receive) => {
            queueMicrotask(() => receive({ status: "error", error: { name: "Error", message: "failed" } }))
            return () => {
                removed = true
            }
        },
        send: () => {},
        cancel: () => assert.fail("handler failure is a reply, not cancellation")
    })

    assert.deepEqual(result, { status: "error", error: { name: "Error", message: "failed" } })
    assert.equal(removed, true)
})
