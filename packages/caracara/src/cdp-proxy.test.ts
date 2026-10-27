import { once } from "node:events"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { WebSocket, WebSocketServer } from "ws"

import { rewriteCdpClientMessage, startCdpWindowProxy } from "./cdp-proxy.js"

describe("rewriteCdpClientMessage", () => {
  it("opens new targets in their own window", () => {
    expect(
      JSON.parse(
        rewriteCdpClientMessage(
          JSON.stringify({
            id: 7,
            method: "Target.createTarget",
            params: { url: "about:blank", background: true },
          })
        )
      )
    ).toEqual({
      id: 7,
      method: "Target.createTarget",
      params: { url: "about:blank", background: true, newWindow: true },
    })
  })

  it("keeps an explicit newWindow choice", () => {
    const message = JSON.stringify({
      id: 1,
      method: "Target.createTarget",
      params: { url: "about:blank", newWindow: false },
    })
    expect(rewriteCdpClientMessage(message)).toBe(message)
  })

  it("passes other messages through byte for byte", () => {
    const message = '{"id":2,"method":"Page.captureScreenshot","sessionId":"S"}'
    expect(rewriteCdpClientMessage(message)).toBe(message)
    expect(rewriteCdpClientMessage("not json")).toBe("not json")
  })
})

describe("startCdpWindowProxy", () => {
  const cleanups: (() => Promise<void>)[] = []

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup()
    }
  })

  it("relays CDP traffic and rewrites createTarget on the way to the browser", async () => {
    const browser = new WebSocketServer({ host: "127.0.0.1", port: 0 })
    await once(browser, "listening")
    cleanups.push(
      () => new Promise<void>((resolve) => browser.close(() => resolve()))
    )
    const received: unknown[] = []
    browser.on("connection", (socket, request) => {
      expect(request.url).toBe("/devtools/browser/abc")
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString())
        received.push(message)
        socket.send(JSON.stringify({ id: message.id, result: {} }))
      })
    })
    const { port } = browser.address() as AddressInfo

    const proxy = await startCdpWindowProxy(
      `ws://127.0.0.1:${port}/devtools/browser/abc`
    )
    cleanups.push(() => proxy.close())
    expect(proxy.wsEndpoint).toMatch(
      /^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/abc$/
    )

    const client = new WebSocket(proxy.wsEndpoint)
    const replies: unknown[] = []
    client.on("message", (data) => replies.push(JSON.parse(data.toString())))
    await once(client, "open")
    client.send(
      JSON.stringify({
        id: 1,
        method: "Target.createTarget",
        params: { url: "about:blank" },
      })
    )
    client.send(JSON.stringify({ id: 2, method: "Target.getTargets" }))
    await expect.poll(() => replies.length).toBe(2)
    client.close()

    expect(received).toEqual([
      {
        id: 1,
        method: "Target.createTarget",
        params: { url: "about:blank", newWindow: true },
      },
      { id: 2, method: "Target.getTargets" },
    ])
    expect(replies).toEqual([
      { id: 1, result: {} },
      { id: 2, result: {} },
    ])
  })

  it("closes the client when the browser goes away", async () => {
    const browser = new WebSocketServer({ host: "127.0.0.1", port: 0 })
    await once(browser, "listening")
    browser.on("connection", (socket) => socket.terminate())
    const { port } = browser.address() as AddressInfo
    cleanups.push(
      () => new Promise<void>((resolve) => browser.close(() => resolve()))
    )

    const proxy = await startCdpWindowProxy(
      `ws://127.0.0.1:${port}/devtools/browser/abc`
    )
    cleanups.push(() => proxy.close())

    const client = new WebSocket(proxy.wsEndpoint)
    await once(client, "close")
    expect(client.readyState).toBe(WebSocket.CLOSED)
  })
})
