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
  getCheckPassRate,
  getRunHref,
  ProjectSettingsPanel,
  RunEnvironmentFilter,
  ScenarioEditor,
  readStoredPanelLayout,
} from "./project-workspace"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

describe("workspace panel layout", () => {
  it("restores only complete stored layouts", () => {
    const layouts: Record<string, string> = {
      "complete-layout": JSON.stringify({ list: 25, detail: 75 }),
      "incomplete-layout": JSON.stringify({ list: 25 }),
    }
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => layouts[key] ?? null,
      },
    })

    expect(
      readStoredPanelLayout("complete-layout", ["list", "detail"])
    ).toEqual({ list: 25, detail: 75 })
    expect(
      readStoredPanelLayout("incomplete-layout", ["list", "detail"])
    ).toBeUndefined()
    expect(
      readStoredPanelLayout("missing-layout", ["list", "detail"])
    ).toBeUndefined()
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
})

describe("run result metrics", () => {
  it("formats duration and calculates the scenario pass rate", () => {
    expect(formatRunDuration(1_000, 72_000)).toBe("1m 11s")
    expect(formatRunDuration(1_000, null)).toBe("In progress")
    expect(getCheckPassRate(7, 7)).toBe(100)
    expect(getCheckPassRate(5, 7)).toBe(71)
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
