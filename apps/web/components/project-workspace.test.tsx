import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ProjectSettingsPanel, ScenarioEditor } from "./project-workspace"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

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
