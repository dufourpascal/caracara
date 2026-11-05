// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { FixtureEditor, RunFixturePreflight } from "./fixture-editor"

const STEP_ID = "00000000-0000-4000-8000-000000000001"

function renderEditor() {
  const fixture = {
    id: "fixture-1",
    projectId: "project-1",
    name: "Seeded account",
    slug: "seeded-account",
    description: "",
    locator: "Admin > Users",
    protection: "",
    convergeSteps: [
      {
        id: STEP_ID,
        name: "Sign up",
        instructions: "Sign up.",
        doneWhen: "Signed in.",
      },
    ],
    healthChecks: [],
    requirements: [],
    createdAt: 1,
    updatedAt: 1,
  }
  const mutations = {
    updateFixture: vi.fn(async (args: Record<string, unknown>) => ({
      ...fixture,
      ...args,
      id: fixture.id,
      updatedAt: 2,
    })),
    removeFixture: vi.fn(),
    setRequirement: vi.fn(async () => fixture),
    removeRequirement: vi.fn(),
  }
  render(
    <FixtureEditor
      fixture={fixture}
      onDeleted={vi.fn()}
      phases={[{ id: "phase-1", name: "Setup", order: 1 }]}
      projectId="project-1"
      removeFixture={mutations.removeFixture as never}
      removeRequirement={mutations.removeRequirement as never}
      scenarios={[{ id: "scenario-1", name: "Checkout", slug: "checkout" }]}
      setRequirement={mutations.setRequirement as never}
      updateFixture={mutations.updateFixture as never}
    />
  )
  return mutations
}

describe("fixture editor", () => {
  afterEach(cleanup)

  it("saves the whole definition with new items carrying IDs", async () => {
    const user = userEvent.setup()
    const { updateFixture } = renderEditor()

    await user.clear(screen.getByLabelText("How to find it"))
    await user.type(screen.getByLabelText("How to find it"), "Admin")
    await user.click(screen.getByRole("button", { name: "Add health check" }))
    await user.type(screen.getByLabelText("Check 1 name"), "Exists")
    await user.type(
      screen.getByLabelText("Check 1 expectation"),
      "The user exists."
    )
    await user.click(screen.getByRole("button", { name: "Remove step 1" }))
    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(updateFixture).toHaveBeenCalledTimes(1))
    const payload = updateFixture.mock.calls[0]![0]
    expect(payload).toMatchObject({
      projectId: "project-1",
      fixtureId: "fixture-1",
      name: "Seeded account",
      slug: "seeded-account",
      locator: "Admin",
      convergeSteps: [],
      healthChecks: [
        {
          id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          name: "Exists",
          expectation: "The user exists.",
        },
      ],
    })
  })

  it("shows server errors in the editor and on the rejected fields", async () => {
    const user = userEvent.setup()
    const { updateFixture } = renderEditor()
    updateFixture.mockRejectedValueOnce({
      data: {
        code: "validation_error",
        message: "Check the highlighted fixture fields.",
        fieldErrors: { slug: ["Slug must be 120 characters or fewer."] },
      },
    })

    await user.type(screen.getByLabelText("Slug"), "-x")
    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(
        screen.getAllByRole("alert").map((alert) => alert.textContent)
      ).toEqual([
        "Check the highlighted fixture fields.",
        "Slug must be 120 characters or fewer.",
      ])
    )
  })

  it("blocks saving incomplete items", async () => {
    const user = userEvent.setup()
    const { updateFixture } = renderEditor()

    await user.click(screen.getByRole("button", { name: "Add health check" }))
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(screen.getByRole("alert").textContent).toContain(
      "Every item needs all of its fields filled in."
    )
    expect(updateFixture).not.toHaveBeenCalled()
  })

  it("requires a scope for mutating requirements", async () => {
    const user = userEvent.setup()
    const { setRequirement } = renderEditor()

    await user.selectOptions(
      screen.getByLabelText("Requirement target"),
      "scenario:scenario-1"
    )
    await user.selectOptions(
      screen.getByLabelText("Requirement access"),
      "mutates"
    )
    await user.click(screen.getByRole("button", { name: "Add" }))
    expect(screen.getByRole("alert").textContent).toBe(
      "Describe what the scenarios may change."
    )
    expect(setRequirement).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText("Mutation scope"), " Its cart ")
    await user.click(screen.getByRole("button", { name: "Add" }))
    await waitFor(() =>
      expect(setRequirement).toHaveBeenCalledWith({
        projectId: "project-1",
        fixtureId: "fixture-1",
        scenarioId: "scenario-1",
        access: "mutates",
        mutationScope: "Its cart",
      })
    )
  })
})

describe("run fixture preflight", () => {
  afterEach(cleanup)

  it("lists each fixture's access, outcome, and executor", () => {
    render(
      <RunFixturePreflight
        entries={[
          {
            fixtureId: "fixture-1",
            fixtureSlug: "seeded-account",
            fixtureName: "Seeded account",
            access: "mutates",
            outcome: "repaired",
            executor: "hook",
          },
          {
            fixtureId: "fixture-2",
            fixtureSlug: "catalog",
            fixtureName: "Catalog",
            access: "read",
            outcome: "skipped",
            executor: null,
          },
        ]}
      />
    )

    const rows = screen.getAllByRole("listitem").map((row) => row.textContent)
    expect(rows).toEqual([
      "Seeded accountrepairedmutates · hook",
      "Catalogskippedread · none",
    ])
  })

  it("renders nothing for runs without a preflight", () => {
    const { container } = render(<RunFixturePreflight entries={undefined} />)
    expect(container.textContent).toBe("")
  })
})
