import { describe, expect, it } from "vitest"

import {
  getOwnedEvidenceForServing,
  requireUploadTarget,
} from "./runEvidence"

const args = {
  ownerUserId: "user-1",
  runId: "run-1",
  scenarioResultId: "result-1",
  checkId: "check-1",
} as never

function contextWith(documents: Record<string, unknown>) {
  return {
    db: {
      async get(id: string) {
        return documents[id] ?? null
      },
    },
  } as never
}

describe("run evidence upload targets", () => {
  it("hides foreign targets behind the same error as missing targets", async () => {
    const missing = requireUploadTarget(contextWith({}), args)
    const foreign = requireUploadTarget(
      contextWith({
        "run-1": {
          _id: "run-1",
          ownerUserId: "user-2",
          projectId: "project-1",
        },
        "result-1": { _id: "result-1", runId: "run-1" },
        "project-1": { _id: "project-1", ownerUserId: "user-2" },
      }),
      args
    )

    await expect(missing).rejects.toMatchObject({
      data: { code: "not_found", message: "Run result not found." },
    })
    await expect(foreign).rejects.toMatchObject({
      data: { code: "not_found", message: "Run result not found." },
    })
  })

  it("returns storage metadata only for the owning user", async () => {
    const documents = {
      "evidence-1": {
        _id: "evidence-1",
        projectId: "project-1",
        runId: "run-1",
        storageId: "storage-1",
      },
      "run-1": {
        _id: "run-1",
        ownerUserId: "user-1",
        projectId: "project-1",
      },
      "project-1": { _id: "project-1", ownerUserId: "user-1" },
    }
    await expect(
      getOwnedEvidenceForServing(contextWith(documents), {
        ownerUserId: "user-1",
        evidenceId: "evidence-1",
      } as never)
    ).resolves.toMatchObject({ storageId: "storage-1" })
    await expect(
      getOwnedEvidenceForServing(contextWith(documents), {
        ownerUserId: "user-2",
        evidenceId: "evidence-1",
      } as never)
    ).resolves.toBeNull()
  })
})
