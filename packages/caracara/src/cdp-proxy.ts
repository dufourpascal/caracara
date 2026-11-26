import { once } from "node:events"
import type { IncomingMessage } from "node:http"
import type { AddressInfo } from "node:net"
import { WebSocket, WebSocketServer, type RawData } from "ws"

import { writeDiagnostic } from "./diagnostics.js"

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

/**
 * Clipboard access the agent needs to check "copy link" round trips. Set one
 * permission at a time: Browser.grantPermissions would deny every permission
 * it does not list (notifications, geolocation, wake lock and more).
 */
export const GRANTED_BROWSER_PERMISSIONS = [
  { name: "clipboard-read" },
  { name: "clipboard-write", allowWithoutSanitization: true },
]

export type CdpProxyOptions = {
  /** Where every browser context saves downloads, including isolated ones. */
  downloadsDirectory?: string
}

/**
 * Commands that give a browser context the run's downloads directory and
 * clipboard access. The default context gets its downloads directory from the
 * profile preferences; an isolated context (chrome-devtools new_page with
 * isolatedContext) ignores those and denies the clipboard unless granted.
 */
export function buildBrowserContextSetup(
  options: CdpProxyOptions,
  browserContextId?: string
) {
  const context = browserContextId ? { browserContextId } : {}
  return [
    ...(browserContextId && options.downloadsDirectory
      ? [
          {
            method: "Browser.setDownloadBehavior",
            params: {
              behavior: "allow",
              downloadPath: options.downloadsDirectory,
              ...context,
            },
          },
        ]
      : []),
    ...GRANTED_BROWSER_PERMISSIONS.map((permission) => ({
      method: "Browser.setPermission",
      params: { permission, setting: "granted", ...context },
    })),
  ]
}

/** The browserContextId of a Target.createBrowserContext reply, if this is one we wait for. */
function readCreatedBrowserContext(
  data: RawData,
  waitingIds: Set<number>
): string | undefined {
  if (waitingIds.size === 0 || !Buffer.isBuffer(data)) {
    return undefined
  }
  const match = /^\{"id":(\d+)/.exec(data.subarray(0, 24).toString())
  const id = match ? Number(match[1]) : undefined
  if (id === undefined || !waitingIds.delete(id)) {
    return undefined
  }
  const result = parseCdpMessage(data.toString()) as
    { result?: { browserContextId?: unknown } } | undefined
  const contextId = result?.result?.browserContextId
  return typeof contextId === "string" ? contextId : undefined
}

/**
 * Holds the browser context setup for the whole run. Chromium drops a
 * context's permission and download overrides when the DevTools connection
 * that set them closes, and every scenario's MCP server connects and leaves
 * again, so the proxy sets them on a connection of its own.
 */
async function openContextSetupConnection(
  upstreamWsEndpoint: string,
  options: CdpProxyOptions
) {
  const control = new WebSocket(upstreamWsEndpoint, {
    maxPayload: maxCdpPayloadBytes,
    perMessageDeflate: false,
  })
  let nextId = 1
  // Replies (errors included, such as for a context that is gone) need no action.
  control.on("message", () => undefined)
  control.on("error", (error) => {
    writeDiagnostic(
      `Chrome DevTools setup connection error: ${error.message}\n`
    )
  })
  await once(control, "open")

  const setUp = (browserContextId?: string) => {
    if (control.readyState !== WebSocket.OPEN) {
      return
    }
    for (const command of buildBrowserContextSetup(options, browserContextId)) {
      control.send(JSON.stringify({ id: nextId++, ...command }))
    }
  }
  setUp()

  return {
    setUp,
    close() {
      control.terminate()
    },
  }
}

/** Relays one client connection; reports each browser context it creates. */
function forwardClient(
  client: WebSocket,
  upstreamWsEndpoint: string,
  onBrowserContextCreated: (browserContextId: string) => void
) {
  const upstream = new WebSocket(upstreamWsEndpoint, {
    maxPayload: maxCdpPayloadBytes,
    perMessageDeflate: false,
  })
  const pending: { data: RawData; isBinary: boolean }[] = []
  // Negative ids never collide with the client's, which count up from 1.
  let nextProxyId = -1
  // Client ids of Target.createBrowserContext calls whose reply is pending.
  const browserContextRequests = new Set<number>()

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
    if (
      message?.method === "Target.createBrowserContext" &&
      typeof message.id === "number"
    ) {
      browserContextRequests.add(message.id)
    }
    if (
      message?.method === "Page.captureScreenshot" &&
      typeof message.sessionId === "string"
    ) {
      // A popup from window.open or a target=_blank link still shares its
      // opener's window and hides it. Bring the page to the front first, so
      // the screenshot gets a frame. A popup hidden this way comes back with
      // its own next screenshot.
      sendUpstream(
        JSON.stringify({
          id: nextProxyId--,
          method: "Page.bringToFront",
          sessionId: message.sessionId,
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
    // Chromium writes the id first, so a reply to a proxy-sent command starts
    // with a negative id. The client never asked for it.
    if (
      !isBinary &&
      Buffer.isBuffer(data) &&
      data.subarray(0, 7).toString() === '{"id":-'
    ) {
      return
    }
    const createdContext = isBinary
      ? undefined
      : readCreatedBrowserContext(data, browserContextRequests)
    if (createdContext) {
      // Before the reply, so the context is set up before the client uses it.
      onBrowserContextCreated(createdContext)
    }
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
 * Starts a loopback CDP proxy in front of a browser WebSocket endpoint. Frames
 * pass through unchanged except that Target.createTarget opens a new window
 * (see rewriteCdpClientMessage), a screenshot first brings its page to
 * the front, and every browser context gets the run's downloads directory and
 * clipboard access (see buildBrowserContextSetup).
 *
 * Like Chromium itself, the proxy only accepts the browser's unguessable path
 * and refuses connections that carry an Origin, so a web page in the browser
 * cannot connect to it.
 */
export async function startCdpWindowProxy(
  upstreamWsEndpoint: string,
  options: CdpProxyOptions = {}
) {
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
  await once(server, "listening")
  let contextSetup: Awaited<ReturnType<typeof openContextSetupConnection>>
  try {
    contextSetup = await openContextSetupConnection(upstreamWsEndpoint, options)
  } catch (error) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw error
  }
  server.on("connection", (client) => {
    forwardClient(client, upstreamWsEndpoint, contextSetup.setUp)
  })
  // Keep a listener so a later accept failure cannot crash the run; the
  // affected connection fails and the MCP server reports it.
  server.on("error", (error) => {
    writeDiagnostic(`Chrome DevTools proxy error: ${error.message}\n`)
  })

  const { port } = server.address() as AddressInfo

  return {
    wsEndpoint: `ws://127.0.0.1:${port}${pathname}`,
    async close() {
      contextSetup.close()
      for (const client of server.clients) {
        client.terminate()
      }
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
