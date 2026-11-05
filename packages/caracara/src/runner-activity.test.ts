import { describe, expect, it } from "vitest"

import type { CodexItemEvent } from "./codex-exec.js"
import { describeCodexItemEvent, formatCommandLabel } from "./execution.js"

const secrets = { CARACARA_SECRET_PASSWORD: "hunter2-very-secret" }

function event(
  type: CodexItemEvent["type"],
  item: CodexItemEvent["item"]
): CodexItemEvent {
  return { type, item }
}

describe("describeCodexItemEvent", () => {
  it("names MCP tools by server and tool, without arguments", () => {
    const activity = describeCodexItemEvent(
      event("item.started", {
        id: "item_1",
        type: "mcp_tool_call",
        server: "chrome-devtools",
        tool: "fill",
        arguments: { value: secrets.CARACARA_SECRET_PASSWORD },
        status: "in_progress",
      }),
      secrets
    )

    expect(activity).toEqual({
      id: "item_1",
      label: "chrome-devtools.fill",
      toolCall: true,
      status: "started",
    })
    expect(JSON.stringify(activity)).not.toContain("hunter2")
  })

  it("maps step types to labels and ignores the rest", () => {
    const label = (type: string, eventType: CodexItemEvent["type"]) =>
      describeCodexItemEvent(event(eventType, { id: "x", type }), secrets)

    expect(label("web_search", "item.started")).toMatchObject({
      label: "web search",
      toolCall: true,
    })
    expect(label("file_change", "item.completed")).toMatchObject({
      label: "editing files",
      toolCall: true,
      status: "completed",
    })
    expect(label("reasoning", "item.completed")).toMatchObject({
      label: "thinking",
      toolCall: false,
    })
    expect(label("agent_message", "item.completed")).toMatchObject({
      label: "writing result",
      toolCall: false,
    })
    expect(label("todo_list", "item.started")).toBeNull()
    expect(label("error", "item.completed")).toBeNull()
  })

  it("never exposes reasoning text", () => {
    const activity = describeCodexItemEvent(
      event("item.completed", {
        id: "r",
        type: "reasoning",
        text: `the password is ${secrets.CARACARA_SECRET_PASSWORD}`,
      }),
      secrets
    )
    expect(activity?.label).toBe("thinking")
  })

  it("removes terminal control sequences from tool names", () => {
    const activity = describeCodexItemEvent(
      event("item.started", {
        id: "t",
        type: "mcp_tool_call",
        server: "chrome\u001b[2Jdevtools",
        tool: "click\u0007",
      }),
      secrets
    )
    expect(activity?.label).toBe("chromedevtools.click")
  })
})

describe("formatCommandLabel", () => {
  it("unwraps the shell wrapper and keeps the first line", () => {
    expect(
      formatCommandLabel("/bin/bash -lc 'ls -la\nrm -rf tmp'", secrets)
    ).toBe("$ ls -la")
  })

  it("redacts secrets before the command is cut", () => {
    const longPrefix = "x".repeat(70)
    const label = formatCommandLabel(
      `bash -lc 'echo ${longPrefix} ${secrets.CARACARA_SECRET_PASSWORD}'`,
      secrets
    )
    expect(label).not.toContain("hunter2")
    expect(label.length).toBeLessThanOrEqual(82)
  })

  it("redacts a secret that spans lines and URL-encoded secrets", () => {
    const multiline = { CARACARA_SECRET_KEY: "line-one\nline-two" }
    expect(formatCommandLabel(`printf 'line-one\nline-two'`, multiline)).toBe(
      "$ printf '[REDACTED]'"
    )

    const encoded = { CARACARA_SECRET_TOKEN: "a b&c" }
    expect(
      formatCommandLabel("curl https://x.test/?t=a%20b%26c", encoded)
    ).toBe("$ curl https://x.test/?t=[REDACTED]")
  })
})
