// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  formatRunDuration,
  formatRunModelLabel,
  formatRunModelTitle,
  getCheckPassRate,
  getRunHref,
  ProjectSettingsPanel,
  readRunSelectionFromLocation,
  RunEnvironmentFilter,
  RunResultDetail,
  ScenarioEditor,
  SuiteEditor,
} from "./project-workspace"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

describe("run model labels", () => {
  it("labels recorded models and hides missing ones", () => {
    expect(
      formatRunModelLabel({ model: "gpt-6.1-sol", reasoningEffort: "high" })
    ).toBe("gpt-6.1-sol · high")
    expect(formatRunModelLabel({ model: "gpt-6.1-sol" })).toBe("gpt-6.1-sol")
    expect(formatRunModelLabel({ model: null, reasoningEffort: "high" })).toBe(
      null
    )
    expect(formatRunModelLabel({})).toBe(null)
    expect(
      formatRunModelTitle({ model: "gpt-6.1-sol", reasoningEffort: "high" })
    ).toBe("Model: gpt-6.1-sol, reasoning effort: high")
    expect(formatRunModelTitle({})).toBe("Model not recorded")
  })
})

describe("run environment filter", () => {
  afterEach(cleanup)

  it("supports all configured run environments", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <RunEnvironmentFilter
        environments={["development", "preview", "production"]}
        value={null}
        onChange={onChange}
      />
    )

    const filter = screen.getByRole("combobox", {
      name: "Filter runs by environment",
    })
    expect(filter.textContent).toContain("All environments")
    expect(filter.textContent).toContain("preview")

    await user.selectOptions(filter, "preview")
    expect(onChange).toHaveBeenCalledWith("preview")
  })

  it("preserves the environment in run detail links", () => {
    expect(
      getRunHref({
        environment: "preview",
        projectSlug: "demo",
        runId: "run-1",
        scenarioSlug: "checkout",
      })
    ).toBe("/projects/demo/runs/run-1?environment=preview&scenario=checkout")
  })

  it("restores the full run selection from browser history", () => {
    expect(
      readRunSelectionFromLocation(
        "/projects/demo/runs/run-1",
        "?environment=preview&scenario=checkout"
      )
    ).toEqual({
      environment: "preview",
      runId: "run-1",
      scenarioSlug: "checkout",
    })
  })
})

describe("run result metrics", () => {
  it("formats duration and calculates the scenario pass rate", () => {
    expect(formatRunDuration(1_000, 72_000)).toBe("1m 11s")
    expect(formatRunDuration(1_000, null)).toBe("In progress")
    expect(getCheckPassRate(7, 7)).toBe(100)
    expect(getCheckPassRate(5, 7)).toBe(71)
  })
})

describe("run result detail", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("shows the reason in place of a missing screenshot", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    )
    const check = (id: string) => ({
      id,
      name: `Check ${id}`,
      expectation: `Expectation ${id}`,
    })
    render(
      <RunResultDetail
        result={{
          scenarioName: "Delete item",
          scenarioSlug: "delete-item",
          status: "completed",
          evaluationChecks: [check("dialog"), check("shown"), check("legacy")],
          checkResults: [
            {
              checkId: "dialog",
              verdict: "failed",
              evidence:
                "Attempted: delete. Failed: the dialog named another item.",
              evidenceUnavailableReason:
                "A native confirm dialog blocked every screenshot.",
            },
            {
              checkId: "shown",
              verdict: "failed",
              evidence: "Attempted: save. Failed: the toast showed an error.",
              evidenceUnavailableReason: null,
            },
            {
              checkId: "legacy",
              verdict: "failed",
              evidence: "Attempted: export. Failed: nothing downloaded.",
            },
          ],
          evidence: [
            {
              id: "evidence-1",
              checkId: "shown",
              kind: "screenshot",
              contentType: "image/webp",
              byteSize: 10,
              sha256: "a".repeat(64),
              createdAt: 1,
            },
          ],
          executionSummary: "Done.",
          failureDetail: null,
          runnerType: "codex",
          startedAt: 1,
          finishedAt: 2,
          submittedAt: 2,
          executionInstructions: "Delete the item.",
        }}
      />
    )

    expect(screen.getAllByText("Screenshot unavailable")).toHaveLength(1)
    expect(
      screen.getByText("A native confirm dialog blocked every screenshot.")
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Open screenshot for Check shown" })
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Open screenshot for Check dialog" })
    ).toBeNull()
  })
})

describe("suite editor", () => {
  afterEach(cleanup)

  it("renders ordered phase labels and saves membership", async () => {
    const user = userEvent.setup()
    const updateSuite = vi.fn().mockResolvedValue({
      id: "suite-1",
      name: "Public surfaces",
      slug: "public-surfaces",
      phaseIds: ["phase-1", "phase-4"],
    })

    render(
      <SuiteEditor
        onError={vi.fn()}
        phases={[
          { id: "phase-1", name: "Landing page", order: 1 },
          { id: "phase-4", name: "Demo", order: 4 },
        ]}
        projectId="project-1"
        removeSuite={vi.fn() as never}
        setSelectedSuiteId={vi.fn()}
        suite={{
          id: "suite-1",
          name: "Public surfaces",
          slug: "public-surfaces",
          phaseIds: ["phase-1"],
        }}
        updateSuite={updateSuite as never}
      />
    )

    expect(screen.getByText("Phase 1: Landing page")).toBeTruthy()
    await user.click(screen.getByText("Phase 4: Demo"))
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(updateSuite).toHaveBeenCalledWith({
      projectId: "project-1",
      suiteId: "suite-1",
      name: "Public surfaces",
      slug: "public-surfaces",
      phaseIds: ["phase-1", "phase-4"],
    })
  })
})

describe("scenario dependency feedback", () => {
  afterEach(cleanup)

  it("shows a backend cycle message without losing unsaved form state", async () => {
    const user = userEvent.setup()
    const updateScenario = vi.fn().mockRejectedValue({
      data: {
        code: "validation_error",
        message: "Scenario dependencies would create a cycle.",
      },
    })

    render(
      <ScenarioEditor
        allPhases={[{ id: "phase-1", name: "Core", order: 1 }]}
        allScenarios={[
          {
            id: "scenario-1",
            name: "Original scenario",
            slug: "original-scenario",
            dependencyIds: [],
            phaseId: "phase-1",
          },
        ]}
        createScenario={vi.fn() as never}
        projectId={"project-1" as never}
        projectSlug="project"
        scenario={{
          id: "scenario-1",
          name: "Original scenario",
          slug: "original-scenario",
          status: "draft",
          instructions: "Run the scenario.",
          evaluationChecks: [],
          phaseId: "phase-1",
          dependencyIds: [],
        }}
        updateScenario={updateScenario as never}
      />
    )

    const name = screen.getByPlaceholderText("Scenario name")
    fireEvent.change(name, { target: { value: "Unsaved scenario name" } })
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Scenario dependencies would create a cycle."
    )
    await waitFor(() =>
      expect((name as HTMLInputElement).value).toBe("Unsaved scenario name")
    )
  })
})

describe("project settings validation", () => {
  afterEach(cleanup)

  it("shows client and server validation errors without losing edits", async () => {
    const user = userEvent.setup()
    const updateProject = vi.fn().mockRejectedValue({
      data: {
        code: "validation_error",
        message: "The server rejected these project settings.",
      },
    })

    render(
      <ProjectSettingsPanel
        onProjectDeleted={vi.fn()}
        project={{
          id: "project-1",
          name: "Original project",
          slug: "original-project",
          description: "Description",
          projectPrompt: "Prompt",
        }}
        removeProject={vi.fn() as never}
        updateProject={updateProject as never}
      />
    )

    const name = screen.getByDisplayValue("Original project")
    fireEvent.change(name, { target: { value: "n".repeat(121) } })
    await user.click(screen.getByRole("button", { name: "Save project" }))

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Project name must be 120 characters or fewer."
    )
    expect(updateProject).not.toHaveBeenCalled()
    expect((name as HTMLInputElement).value).toBe("n".repeat(121))

    fireEvent.change(name, { target: { value: "Updated project" } })
    expect(screen.queryByRole("alert")).toBeNull()
    await user.click(screen.getByRole("button", { name: "Save project" }))

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The server rejected these project settings."
    )
    expect((name as HTMLInputElement).value).toBe("Updated project")
  })
})
