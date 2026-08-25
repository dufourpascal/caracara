import { describe, expect, it } from "vitest"

import { readBytesWithLimit } from "./http"

describe("run evidence request bodies", () => {
  it("stops reading when the byte limit is exceeded", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.enqueue(new Uint8Array([4, 5, 6]))
        controller.close()
      },
    })

    await expect(readBytesWithLimit(body, 4)).resolves.toBeNull()
  })
})
