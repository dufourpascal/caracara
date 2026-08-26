import { afterEach, describe, expect, it, vi } from "vitest"

import {
  fetchProjects,
  submitAuthoringOperation,
  submitScenarioResult,
  uploadRunEvidence,
} from "./api.js"

describe("api client", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("includes structured API error details in thrown messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({
          code: "internal_error",
          message: "Unexpected server error.",
          details: {
            reason: "Database insert failed",
          },
        }),
      }))
    )

    await expect(
      fetchProjects("https://example.com", "token", "0.2.0")
    ).rejects.toThrowError(
      /internal_error: Unexpected server error\.\n\{\n {2}"reason": "Database insert failed"\n\}/
    )
  })

  it("uploads WebP evidence with its run identity and digest", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        evidence: {
          id: "evidence-1",
          checkId: "00000000-0000-4000-8000-000000000001",
          contentType: "image/webp",
          byteSize: 12,
          sha256: "a".repeat(64),
        },
      }),
    }))
    vi.stubGlobal("fetch", fetchMock)
    const bytes = Buffer.from("RIFF0000WEBP", "ascii")

    await uploadRunEvidence({
      uploadUrl: "https://example.convex.site/run-evidence",
      accessToken: "token",
      runId: "run-1",
      scenarioResultId: "result-1",
      checkId: "00000000-0000-4000-8000-000000000001",
      sha256: "a".repeat(64),
      bytes,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.convex.site/run-evidence",
      expect.objectContaining({
        method: "POST",
        body: bytes,
        headers: expect.objectContaining({
          authorization: "Bearer token",
          "content-type": "image/webp",
          "x-caracara-run-id": "run-1",
          "x-caracara-result-id": "result-1",
          "x-caracara-byte-size": "12",
        }),
      })
    )
  })

  it("submits a validated authoring operation", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        operation: "removePhase",
        result: {
          deletedPhaseId: "phase-1",
          deletedPhaseName: "Setup",
          unassignedScenarioCount: 1,
        },
      }),
    }))
    vi.stubGlobal("fetch", fetchMock)

    await submitAuthoringOperation({
      apiBaseUrl: "https://example.com",
      accessToken: "token",
      version: "0.4.0",
      projectSlug: "demo",
      payload: { operation: "removePhase", phaseId: "phase-1" },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/api/v3/projects/demo/authoring",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          operation: "removePhase",
          phaseId: "phase-1",
        }),
      })
    )
  })

  it("retries transient evidence upload failures", async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection reset"))
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          evidence: {
            id: "evidence-1",
            checkId: "00000000-0000-4000-8000-000000000001",
            contentType: "image/webp",
            byteSize: 12,
            sha256: "a".repeat(64),
          },
        }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const upload = uploadRunEvidence({
      uploadUrl: "https://example.convex.site/run-evidence",
      accessToken: "token",
      runId: "run-1",
      scenarioResultId: "result-1",
      checkId: "00000000-0000-4000-8000-000000000001",
      sha256: "a".repeat(64),
      bytes: Buffer.from("RIFF0000WEBP", "ascii"),
    })
    await vi.runAllTimersAsync()

    await expect(upload).resolves.toMatchObject({
      evidence: { id: "evidence-1" },
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("retries a terminal result after a lost response", async () => {
    vi.useFakeTimers()
    const checkId = "00000000-0000-4000-8000-000000000001"
    const response = {
      run: {
        id: "run-1",
        status: "running",
        finishedAt: null,
        updatedAt: 2,
      },
      result: {
        id: "result-1",
        runId: "run-1",
        scenarioId: "scenario-1",
        scenarioSlug: "scenario",
        scenarioName: "Scenario",
        executionInstructions: "Test it",
        evaluationChecks: [
          { id: checkId, name: "Check", expectation: "It works" },
        ],
        checkResults: [
          {
            checkId,
            verdict: "passed",
            evidence: "It worked",
          },
        ],
        phaseId: null,
        phaseName: null,
        phaseOrder: null,
        sequenceIndex: 0,
        status: "completed",
        runnerType: "codex",
        executionSummary: "Complete",
        failureDetail: null,
        startedAt: 1,
        finishedAt: 2,
        submittedAt: 2,
      },
    }
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("Response lost"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => response,
      })
    vi.stubGlobal("fetch", fetchMock)

    const submission = submitScenarioResult({
      apiBaseUrl: "https://example.com",
      accessToken: "token",
      version: "0.3.0",
      projectSlug: "project",
      runId: "run-1",
      payload: {
        runId: "run-1",
        result: {
          scenarioId: "scenario-1",
          status: "completed",
          checkResults: response.result.checkResults,
          executionSummary: "Complete",
          failureDetail: null,
          finishedAt: 2,
        },
      },
    })
    await vi.runAllTimersAsync()

    await expect(submission).resolves.toEqual(response)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
