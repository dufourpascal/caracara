import { once } from "node:events"
import type { AddressInfo } from "node:net"
import { setTimeout as delay } from "node:timers/promises"
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

  it("keeps an explicit newWindow choice and hidden targets", () => {
    for (const params of [
      { url: "about:blank", newWindow: false },
      { url: "about:blank", hidden: true },
    ]) {
      const message = JSON.stringify({
        id: 1,
        method: "Target.createTarget",
        params,
      })
      expect(rewriteCdpClientMessage(message)).toBe(message)
    }
  })

  it("passes other messages through byte for byte", () => {
    const message = '{"id":2,"method":"Page.captureScreenshot","sessionId":"S"}'
    expect(rewriteCdpClientMessage(message)).toBe(message)
    expect(rewriteCdpClientMessage("not json")).toBe("not json")
  })
})

describe("startCdpWindowProxy", () => {
  const cleanups: (() => Promise<void> | void)[] = []

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup()
    }
  })

  // A fake browser that records each command and answers it, after an
  // optional handshake delay.
  async function startBrowser(input: { handshakeDelayMs?: number } = {}) {
    const server = new WebSocketServer({
      host: "127.0.0.1",
      port: 0,
      verifyClient: (_info, done) => {
        setTimeout(() => done(true), input.handshakeDelayMs ?? 0)
      },
    })
    await once(server, "listening")
    cleanups.push(
      () => new Promise<void>((resolve) => server.close(() => resolve()))
    )
    const received: Record<string, unknown>[] = []
    const requestUrls: string[] = []
    const sockets: WebSocket[] = []
    server.on("connection", (socket, request) => {
      sockets.push(socket)
      requestUrls.push(request.url ?? "")
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString())
        received.push(message)
        socket.send(JSON.stringify({ id: message.id, result: {} }))
      })
    })
    const { port } = server.address() as AddressInfo
    return {
      endpoint: `ws://127.0.0.1:${port}/devtools/browser/abc`,
      received,
      requestUrls,
      sockets,
    }
  }

  async function startProxy(endpoint: string) {
    const proxy = await startCdpWindowProxy(endpoint)
    cleanups.push(() => proxy.close())
    return proxy
  }

  async function connect(url: string, options?: { origin?: string }) {
    const client = new WebSocket(url, options)
    cleanups.push(() => client.terminate())
    const replies: Record<string, unknown>[] = []
    client.on("message", (data, isBinary) => {
      if (!isBinary) {
        replies.push(JSON.parse(data.toString()))
      }
    })
    await once(client, "open")
    return { client, replies }
  }

  it("relays commands in order, including those sent before the browser accepts", async () => {
    const browser = await startBrowser({ handshakeDelayMs: 100 })
    const proxy = await startProxy(browser.endpoint)
    expect(proxy.wsEndpoint).toMatch(
      /^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/abc$/
    )

    const { client, replies } = await connect(proxy.wsEndpoint)
    client.send(
      JSON.stringify({
        id: 1,
        method: "Target.createTarget",
        params: { url: "about:blank" },
      })
    )
    client.send(JSON.stringify({ id: 2, method: "Target.getTargets" }))
    await expect.poll(() => replies.length).toBe(2)

    expect(browser.requestUrls).toEqual(["/devtools/browser/abc"])
    expect(browser.received).toEqual([
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

  it("activates a page before its screenshot and hides the proxy's reply", async () => {
    const browser = await startBrowser()
    const proxy = await startProxy(browser.endpoint)
    const { client, replies } = await connect(proxy.wsEndpoint)
    await expect.poll(() => browser.sockets.length).toBe(1)

    for (const [sessionId, targetId, type] of [
      ["S1", "T1", "page"],
      ["S2", "T2", "iframe"],
    ]) {
      browser.sockets[0]!.send(
        JSON.stringify({
          method: "Target.attachedToTarget",
          params: { sessionId, targetInfo: { targetId, type } },
        })
      )
    }
    await expect.poll(() => replies.length).toBe(2)

    client.send(
      JSON.stringify({
        id: 3,
        method: "Page.captureScreenshot",
        sessionId: "S1",
        params: { format: "webp" },
      })
    )
    client.send(
      JSON.stringify({ id: 4, method: "Page.captureScreenshot", sessionId: "S2" })
    )
    await expect.poll(() => replies.length).toBe(4)

    expect(browser.received).toEqual([
      { id: -1, method: "Target.activateTarget", params: { targetId: "T1" } },
      {
        id: 3,
        method: "Page.captureScreenshot",
        sessionId: "S1",
        params: { format: "webp" },
      },
      { id: 4, method: "Page.captureScreenshot", sessionId: "S2" },
    ])
    expect(replies.slice(2)).toEqual([
      { id: 3, result: {} },
      { id: 4, result: {} },
    ])
  })

  it("passes large binary frames through unchanged", async () => {
    const browser = await startBrowser()
    const proxy = await startProxy(browser.endpoint)
    const { client } = await connect(proxy.wsEndpoint)
    await expect.poll(() => browser.sockets.length).toBe(1)

    const payload = Buffer.alloc(5 * 1024 * 1024, 7)
    const echoed = once(client, "message")
    browser.sockets[0]!.send(payload, { binary: true })
    const [data, isBinary] = await echoed
    expect(isBinary).toBe(true)
    expect(Buffer.compare(data as Buffer, payload)).toBe(0)
  })

  it("refuses other paths and connections from web pages", async () => {
    const browser = await startBrowser()
    const proxy = await startProxy(browser.endpoint)
    const { origin } = new URL(proxy.wsEndpoint)

    for (const [url, options] of [
      [`${origin}/devtools/browser/guess`, undefined],
      [proxy.wsEndpoint, { origin: "http://localhost:3000" }],
    ] as const) {
      const client = new WebSocket(url, options)
      const [error] = await once(client, "error")
      expect((error as Error).message).toMatch(/Unexpected server response/)
    }
    await delay(50)
    expect(browser.requestUrls).toEqual([])
  })

  it("closes the browser side when the client disconnects", async () => {
    const browser = await startBrowser()
    const proxy = await startProxy(browser.endpoint)
    const { client } = await connect(proxy.wsEndpoint)
    await expect.poll(() => browser.sockets.length).toBe(1)

    const upstreamClosed = once(browser.sockets[0]!, "close")
    client.close()
    await upstreamClosed
  })

  it("closes the client when the browser goes away", async () => {
    const browser = await startBrowser()
    const proxy = await startProxy(browser.endpoint)
    const { client } = await connect(proxy.wsEndpoint)
    await expect.poll(() => browser.sockets.length).toBe(1)

    const clientClosed = once(client, "close")
    browser.sockets[0]!.terminate()
    await clientClosed
  })

  it("closes while connections are open", async () => {
    const browser = await startBrowser()
    const proxy = await startCdpWindowProxy(browser.endpoint)
    const { client } = await connect(proxy.wsEndpoint)
    await expect.poll(() => browser.sockets.length).toBe(1)

    const clientClosed = once(client, "close")
    await proxy.close()
    await clientClosed
  })
})
