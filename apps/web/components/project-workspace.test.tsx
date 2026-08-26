import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ScenarioEditor } from "./project-workspace"

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
