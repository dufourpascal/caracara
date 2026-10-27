import { once } from "node:events"
import type { AddressInfo } from "node:net"
import { WebSocket, WebSocketServer, type RawData } from "ws"

// Matches Puppeteer's client limit, so full-page screenshots still fit.
const maxCdpPayloadBytes = 256 * 1024 * 1024

/**
 * Opens every new page in its own window. Headless Chromium stops painting a
 * tab once another tab in its window is in front, and Page.captureScreenshot
 * on that hidden tab never returns. A page that is alone in its window always
 * stays visible.
 */
export function rewriteCdpClientMessage(data: string) {
  let message: unknown
  try {
    message = JSON.parse(data)
  } catch {
    return data
  }
  if (
    typeof message !== "object" ||
    message === null ||
    !("method" in message) ||
    message.method !== "Target.createTarget"
  ) {
    return data
  }

  const params =
    "params" in message &&
    typeof message.params === "object" &&
    message.params !== null
      ? (message.params as Record<string, unknown>)
      : {}
  if (params.newWindow !== undefined) {
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

  const closeBoth = () => {
    client.terminate()
    upstream.terminate()
  }

  client.on("message", (data, isBinary) => {
    const message = isBinary
      ? data
      : Buffer.from(rewriteCdpClientMessage(data.toString()))
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(message, { binary: isBinary })
    } else {
      pending.push({ data: message, isBinary })
    }
  })
  upstream.on("open", () => {
    for (const { data, isBinary } of pending.splice(0)) {
      upstream.send(data, { binary: isBinary })
    }
  })
  upstream.on("message", (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: isBinary })
    }
  })
  client.on("close", closeBoth)
  client.on("error", closeBoth)
  upstream.on("close", closeBoth)
  upstream.on("error", closeBoth)
}

/**
 * Starts a loopback CDP proxy in front of a browser WebSocket endpoint. Every
 * frame passes through unchanged except Target.createTarget, which gains
 * newWindow: true (see rewriteCdpClientMessage).
 */
export async function startCdpWindowProxy(upstreamWsEndpoint: string) {
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    maxPayload: maxCdpPayloadBytes,
    perMessageDeflate: false,
  })
  server.on("connection", (client) => {
    forwardClient(client, upstreamWsEndpoint)
  })
  await once(server, "listening")

  const { port } = server.address() as AddressInfo
  const { pathname } = new URL(upstreamWsEndpoint)

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
