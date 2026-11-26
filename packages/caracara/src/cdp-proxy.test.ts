import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import type { Duplex } from "node:stream"
import { setTimeout as delay } from "node:timers/promises"
import { afterEach, describe, expect, it } from "vitest"
import { WebSocket, WebSocketServer } from "ws"

import {
  GRANTED_BROWSER_PERMISSIONS,
  rewriteCdpClientMessage,
  startCdpWindowProxy,
} from "./cdp-proxy.js"

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

/** The clipboard setup the proxy sends, with the ids it is expected to use. */
function clipboardSetup(ids: [number, number], browserContextId?: string) {
  return GRANTED_BROWSER_PERMISSIONS.map((permission, index) => ({
    id: ids[index],
    method: "Browser.setPermission",
    params: {
      permission,
      setting: "granted",
      ...(browserContextId ? { browserContextId } : {}),
    },
  }))
}

describe("startCdpWindowProxy", () => {
  const cleanups: (() => Promise<void> | void)[] = []

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup()
    }
  })

  // A fake browser that records each command and answers it, after an
  // optional handshake delay.
  async function startBrowser(
    input: { handshakeDelayMs?: number; setupReplyDelayMs?: number } = {}
  ) {
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
    // Socket 0 is the proxy's own setup connection; clients follow.
    const bySocket: Record<string, unknown>[][] = []
    const requestUrls: string[] = []
    const sockets: WebSocket[] = []
    server.on("connection", (socket, request) => {
      const received: Record<string, unknown>[] = []
      bySocket.push(received)
      sockets.push(socket)
      requestUrls.push(request.url ?? "")
      const isSetupSocket = sockets.length === 1
      socket.on("message", async (data) => {
        const message = JSON.parse(data.toString())
        received.push(message)
        if (isSetupSocket && input.setupReplyDelayMs) {
          await delay(input.setupReplyDelayMs)
        }
        // Answer the proxy's own commands with an error, as Chromium does for
        // a session that isn't a page.
        socket.send(
          JSON.stringify(
            message.id < 0
              ? {
                  id: message.id,
                  error: { code: -32000, message: "Not a page" },
                  sessionId: message.sessionId,
                }
              : {
                  id: message.id,
                  result:
                    message.method === "Target.createBrowserContext"
                      ? { browserContextId: "CTX1" }
                      : {},
                }
          )
        )
      })
    })
    const { port } = server.address() as AddressInfo
    return {
      endpoint: `ws://127.0.0.1:${port}/devtools/browser/abc`,
      bySocket,
      /** What the browser received on the first client's connection. */
      get received() {
        return bySocket[1] ?? []
      },
      /** What the browser received on the proxy's setup connection. */
      get setup() {
        return bySocket[0] ?? []
      },
      requestUrls,
      sockets,
    }
  }

  async function startProxy(
    endpoint: string,
    options?: Parameters<typeof startCdpWindowProxy>[1]
  ) {
    const proxy = await startCdpWindowProxy(endpoint, options)
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

    expect(browser.requestUrls).toEqual([
      "/devtools/browser/abc",
      "/devtools/browser/abc",
    ])
    expect(browser.setup).toEqual(clipboardSetup([1, 2]))
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

  it("brings a page to the front before its screenshot and hides the proxy's reply", async () => {
    const browser = await startBrowser({ handshakeDelayMs: 100 })
    const proxy = await startProxy(browser.endpoint)
    const { client, replies } = await connect(proxy.wsEndpoint)

    client.send(
      JSON.stringify({
        id: 3,
        method: "Page.captureScreenshot",
        sessionId: "S1",
        params: { format: "webp" },
      })
    )
    client.send(JSON.stringify({ id: 4, method: "Page.captureScreenshot" }))
    await expect.poll(() => replies.length).toBe(2)

    expect(browser.received).toEqual([
      { id: -1, method: "Page.bringToFront", sessionId: "S1" },
      {
        id: 3,
        method: "Page.captureScreenshot",
        sessionId: "S1",
        params: { format: "webp" },
      },
      { id: 4, method: "Page.captureScreenshot" },
    ])
    expect(replies).toEqual([
      { id: 3, result: {} },
      { id: 4, result: {} },
    ])
  })

  it("gives a new browser context the downloads directory and clipboard access", async () => {
    const browser = await startBrowser()
    const proxy = await startProxy(browser.endpoint, {
      downloadsDirectory: "/tmp/run/downloads",
    })
    const { client, replies } = await connect(proxy.wsEndpoint)

    client.send(
      JSON.stringify({ id: 7, method: "Target.createBrowserContext" })
    )
    await expect.poll(() => browser.setup.length).toBe(5)

    expect(browser.received).toEqual([
      { id: 7, method: "Target.createBrowserContext" },
    ])
    expect(browser.setup.slice(2)).toEqual([
      {
        id: 3,
        method: "Browser.setDownloadBehavior",
        params: {
          behavior: "allow",
          downloadPath: "/tmp/run/downloads",
          browserContextId: "CTX1",
        },
      },
      ...clipboardSetup([4, 5], "CTX1"),
    ])
    // The client sees only the reply to its own command.
    expect(replies).toEqual([{ id: 7, result: { browserContextId: "CTX1" } }])
  })

  it("keeps the setup on its own connection when clients leave", async () => {
    const browser = await startBrowser()
    const proxy = await startProxy(browser.endpoint, {
      downloadsDirectory: "/tmp/run/downloads",
    })
    const first = await connect(proxy.wsEndpoint)
    first.client.send(
      JSON.stringify({ id: 1, method: "Target.createBrowserContext" })
    )
    await expect.poll(() => browser.setup.length).toBe(5)
    const firstUpstreamClosed = once(browser.sockets[1]!, "close")
    first.client.close()
    await firstUpstreamClosed

    // Chromium drops overrides when the connection that set them closes. The
    // setup connection stays open, so the next scenario's client still finds
    // the isolated context set up.
    await connect(proxy.wsEndpoint)
    await expect.poll(() => browser.sockets.length).toBe(3)
    expect(browser.sockets[0]!.readyState).toBe(WebSocket.OPEN)
    expect(browser.setup).toHaveLength(5)
  })

  it("holds a new context's reply until its setup is acknowledged", async () => {
    const browser = await startBrowser({ setupReplyDelayMs: 300 })
    const proxy = await startProxy(browser.endpoint, {
      downloadsDirectory: "/tmp/run/downloads",
    })
    const { client, replies } = await connect(proxy.wsEndpoint)

    client.send(
      JSON.stringify({ id: 1, method: "Target.createBrowserContext" })
    )
    client.send(JSON.stringify({ id: 2, method: "Target.getTargets" }))
    await expect.poll(() => browser.setup.length).toBe(5)
    await delay(100)
    // The browser answered both, but the context reply waits for its setup,
    // and the later reply keeps its order behind it.
    expect(replies).toEqual([])
    await expect.poll(() => replies.length).toBe(2)
    expect(replies.map((reply) => reply.id)).toEqual([1, 2])
  })

  it("reconnects the setup connection and sets every context up again", async () => {
    const browser = await startBrowser()
    const proxy = await startProxy(browser.endpoint, {
      downloadsDirectory: "/tmp/run/downloads",
    })
    const { client } = await connect(proxy.wsEndpoint)
    client.send(
      JSON.stringify({ id: 1, method: "Target.createBrowserContext" })
    )
    await expect.poll(() => browser.setup.length).toBe(5)

    browser.sockets[0]!.terminate()
    await expect.poll(() => browser.sockets.length).toBe(3)
    const resent = browser.bySocket[2]!
    await expect.poll(() => resent.length).toBe(5)
    expect(
      resent.map((message) => [
        message.method,
        (message.params as { browserContextId?: string }).browserContextId,
      ])
    ).toEqual([
      ["Browser.setPermission", undefined],
      ["Browser.setPermission", undefined],
      ["Browser.setDownloadBehavior", "CTX1"],
      ["Browser.setPermission", "CTX1"],
      ["Browser.setPermission", "CTX1"],
    ])
  })

  it("fails to start when the browser never finishes the handshake", async () => {
    // Accepts the TCP connection and never answers the upgrade request.
    const server = createServer()
    const stalled: Duplex[] = []
    server.on("upgrade", (_request, socket) => {
      stalled.push(socket)
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    cleanups.push(() => {
      for (const socket of stalled) {
        socket.destroy()
      }
      return new Promise<void>((resolve) => server.close(() => resolve()))
    })
    const { port } = server.address() as AddressInfo

    await expect(
      startCdpWindowProxy(`ws://127.0.0.1:${port}/devtools/browser/abc`, {
        setupConnectTimeoutMs: 200,
      })
    ).rejects.toThrow(/handshake has timed out/)
  })

  it("passes large binary frames through unchanged", async () => {
    const browser = await startBrowser()
    const proxy = await startProxy(browser.endpoint)
    const { client } = await connect(proxy.wsEndpoint)
    await expect.poll(() => browser.sockets.length).toBe(2)

    const payload = Buffer.alloc(5 * 1024 * 1024, 7)
    const echoed = once(client, "message")
    browser.sockets[1]!.send(payload, { binary: true })
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
    // Only the proxy's own setup connection reached the browser.
    expect(browser.requestUrls).toEqual(["/devtools/browser/abc"])
  })

  it("closes the browser side when the client disconnects", async () => {
    const browser = await startBrowser()
    const proxy = await startProxy(browser.endpoint)
    const { client } = await connect(proxy.wsEndpoint)
    await expect.poll(() => browser.sockets.length).toBe(2)

    const upstreamClosed = once(browser.sockets[1]!, "close")
    client.close()
    await upstreamClosed
  })

  it("closes the client when the browser goes away", async () => {
    const browser = await startBrowser()
    const proxy = await startProxy(browser.endpoint)
    const { client } = await connect(proxy.wsEndpoint)
    await expect.poll(() => browser.sockets.length).toBe(2)

    const clientClosed = once(client, "close")
    browser.sockets[1]!.terminate()
    await clientClosed
  })

  it("closes while connections are open", async () => {
    const browser = await startBrowser()
    const proxy = await startCdpWindowProxy(browser.endpoint)
    const { client } = await connect(proxy.wsEndpoint)
    await expect.poll(() => browser.sockets.length).toBe(2)

    const clientClosed = once(client, "close")
    await proxy.close()
    await clientClosed
  })
})
