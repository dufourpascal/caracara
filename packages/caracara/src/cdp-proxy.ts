import { once } from "node:events"
import type { IncomingMessage } from "node:http"
import type { AddressInfo } from "node:net"
import { WebSocket, WebSocketServer, type RawData } from "ws"

// Matches Puppeteer's client limit, so full-page screenshots still fit.
const maxCdpPayloadBytes = 256 * 1024 * 1024

type CdpMessage = {
  id?: unknown
  method?: unknown
  sessionId?: unknown
  params?: Record<string, unknown>
}

function parseCdpMessage(data: string): CdpMessage | undefined {
  try {
    const message: unknown = JSON.parse(data)
    return typeof message === "object" && message !== null
      ? (message as CdpMessage)
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Opens every new page in its own window. Headless Chromium stops painting a
 * tab once another tab in its window is in front, and Page.captureScreenshot
 * on that hidden tab never returns. A page that is alone in its window always
 * stays visible.
 */
export function rewriteCdpClientMessage(data: string) {
  const message = parseCdpMessage(data)
  if (message?.method !== "Target.createTarget") {
    return data
  }

  const params =
    typeof message.params === "object" && message.params !== null
      ? message.params
      : {}
  // Chromium rejects hidden targets in a new window.
  if (params.newWindow !== undefined || params.hidden === true) {
    return data
  }

  return JSON.stringify({ ...message, params: { ...params, newWindow: true } })
}

function forwardClient(client: WebSocket, upstreamWsEndpoint: string) {
  const upstream = new WebSocket(upstreamWsEndpoint, {
    maxPayload: maxCdpPayloadBytes,
    perMessageDeflate: false,
  })
  const pending: { data: RawData; isBinary: boolean }[] = []
  // Page sessions by sessionId, learned from the browser's attach events.
  const pageTargets = new Map<string, string>()
  // Negative ids never collide with the client's, which count up from 1.
  let nextProxyId = -1

  const closeBoth = () => {
    client.terminate()
    upstream.terminate()
  }
  const sendUpstream = (data: RawData | string, isBinary: boolean) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary })
    } else {
      pending.push({
        data: typeof data === "string" ? Buffer.from(data) : data,
        isBinary,
      })
    }
  }

  client.on("message", (data, isBinary) => {
    if (isBinary) {
      sendUpstream(data, true)
      return
    }

    const text = rewriteCdpClientMessage(data.toString())
    const message = parseCdpMessage(text)
    const targetId =
      message?.method === "Page.captureScreenshot" &&
      typeof message.sessionId === "string"
        ? pageTargets.get(message.sessionId)
        : undefined
    if (targetId) {
      // A popup from window.open or a target=_blank link still shares its
      // opener's window and hides it. Bring the page to the front first, so
      // the screenshot gets a frame.
      sendUpstream(
        JSON.stringify({
          id: nextProxyId--,
          method: "Target.activateTarget",
          params: { targetId },
        }),
        false
      )
    }
    sendUpstream(text, false)
  })
  upstream.on("open", () => {
    for (const { data, isBinary } of pending.splice(0)) {
      upstream.send(data, { binary: isBinary })
    }
  })
  upstream.on("message", (data, isBinary) => {
    if (!isBinary) {
      const text = data.toString()
      if (text.startsWith('{"id":-')) {
        // The reply to a proxy-sent command; the client never asked for it.
        return
      }
      if (
        text.includes('"Target.attachedToTarget"') ||
        text.includes('"Target.detachedFromTarget"')
      ) {
        trackPageSession(text)
      }
    }
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: isBinary })
    }
  })
  client.on("close", closeBoth)
  client.on("error", closeBoth)
  upstream.on("close", closeBoth)
  upstream.on("error", closeBoth)

  function trackPageSession(text: string) {
    const message = parseCdpMessage(text)
    const params = message?.params
    if (typeof params?.sessionId !== "string") {
      return
    }
    if (message?.method === "Target.detachedFromTarget") {
      pageTargets.delete(params.sessionId)
      return
    }
    const targetInfo = params.targetInfo as
      | { targetId?: unknown; type?: unknown }
      | undefined
    if (
      message?.method === "Target.attachedToTarget" &&
      targetInfo?.type === "page" &&
      typeof targetInfo.targetId === "string"
    ) {
      pageTargets.set(params.sessionId, targetInfo.targetId)
    }
  }
}

/**
 * Starts a loopback CDP proxy in front of a browser WebSocket endpoint. Frames
 * pass through unchanged except that Target.createTarget opens a new window
 * (see rewriteCdpClientMessage) and a screenshot first activates its page.
 *
 * Like Chromium itself, the proxy only accepts the browser's unguessable path
 * and refuses connections that carry an Origin, so a web page in the browser
 * cannot connect to it.
 */
export async function startCdpWindowProxy(upstreamWsEndpoint: string) {
  const { pathname } = new URL(upstreamWsEndpoint)
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    path: pathname,
    maxPayload: maxCdpPayloadBytes,
    perMessageDeflate: false,
    verifyClient: ({ req }: { req: IncomingMessage }) =>
      req.headers.origin === undefined,
  })
  server.on("connection", (client) => {
    forwardClient(client, upstreamWsEndpoint)
  })
  await once(server, "listening")
  // Keep a listener so a later accept failure cannot crash the run; the
  // affected connection fails and the MCP server reports it.
  server.on("error", (error) => {
    process.stderr.write(`Chrome DevTools proxy error: ${error.message}\n`)
  })

  const { port } = server.address() as AddressInfo

  return {
    wsEndpoint: `ws://127.0.0.1:${port}${pathname}`,
    async close() {
      for (const client of server.clients) {
        client.terminate()
      }
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
