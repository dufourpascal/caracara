// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { FixtureDetail, FixtureOperation } from "@workspace/contracts"
import { afterEach, describe, expect, it, vi } from "vitest"

import { FixtureEditor } from "./fixture-editor"
import { FixtureHealthBadges, RunFixturesDetail } from "./fixture-status"

const STEP_1 = "00000000-0000-4000-8000-000000000001"
const STEP_2 = "00000000-0000-4000-8000-000000000002"
const CHECK_1 = "00000000-0000-4000-8000-000000000011"
const CHECK_2 = "00000000-0000-4000-8000-000000000012"

function createFixture(overrides: Partial<FixtureDetail> = {}): FixtureDetail {
  return {
    id: "fixture-1",
    projectId: "project-1",
    name: "HET vs HOMO study",
    slug: "het-vs-homo",
    description: "Nine animals with calculated results.",
    locator: "Studies > Caracara Fixture HET vs HOMO",
    protection: "Never delete animals.",
    resetInstructions: null,
    convergeSteps: [
      {
        id: STEP_1,
        name: "Create study",
        instructions: "Create the study.",
        doneWhen: "The study exists.",
      },
      {
        id: STEP_2,
        name: "Import animals",
        instructions: "Import nine animals.",
        doneWhen: "Nine animals are listed.",
      },
    ],
    healthChecks: [
      { id: CHECK_1, name: "Animals", expectation: "Nine animals exist." },
      { id: CHECK_2, name: "Results", expectation: "Results are calculated." },
    ],
    createdAt: 1,
    updatedAt: 2,
    requirements: [
      {
        id: "requirement-1",
        projectId: "project-1",
        fixtureId: "fixture-1",
        phaseId: "phase-1",
        scenarioId: null,
        access: "read",
        mutationScope: null,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "requirement-2",
        projectId: "project-1",
        fixtureId: "fixture-1",
        phaseId: null,
        scenarioId: "scenario-1",
        access: "mutates",
        mutationScope: "Adds slices to animal A1",
        createdAt: 2,
        updatedAt: 2,
      },
    ],
    health: [
      {
        environment: "production",
        status: "healthy",
        operationId: "operation-1",
        checkedAt: 1_700_000_000_000,
        busy: false,
      },
      {
        environment: "preview",
        status: "unknown",
        operationId: null,
        checkedAt: null,
        busy: true,
      },
    ],
    ...overrides,
  }
}

function createOperation(
  overrides: Partial<FixtureOperation> = {}
): FixtureOperation {
  return {
    id: "operation-1",
    projectId: "project-1",
    fixtureId: "fixture-1",
    fixtureSlug: "het-vs-homo",
    fixtureName: "HET vs HOMO study",
    environment: "production",
    targetUrl: "https://app.example.com",
    runId: null,
    kind: "verify",
    executor: "hook",
    status: "failed",
    checkResults: [
      {
        checkId: CHECK_1,
        name: "Animals",
        verdict: "failed",
        evidence: "Only eight animals are listed.",
      },
    ],
    summary: "Animal A9 is missing.",
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_060_000,
    leaseExpiresAt: 1_700_014_400_000,
    ...overrides,
  }
}

function renderEditor(
  props: Partial<React.ComponentProps<typeof FixtureEditor>> = {}
) {
  const fixture = props.fixture ?? createFixture()
  const handlers = {
    onDeleted: vi.fn(),
    removeFixture: vi.fn().mockResolvedValue(null),
    removeRequirement: vi.fn().mockResolvedValue(fixture),
    setRequirement: vi.fn().mockResolvedValue(fixture),
    updateFixture: vi.fn().mockResolvedValue(fixture),
  }

  render(
    <FixtureEditor
      fixture={fixture}
      onDeleted={handlers.onDeleted}
      operations={[createOperation()]}
      phases={[{ id: "phase-1", name: "Setup", order: 1 }]}
      projectId="project-1"
      removeFixture={handlers.removeFixture as never}
      removeRequirement={handlers.removeRequirement as never}
      scenarios={[{ id: "scenario-1", name: "Add slices", slug: "add-slices" }]}
      setRequirement={handlers.setRequirement as never}
      updateFixture={handlers.updateFixture as never}
      {...props}
    />
  )

  return handlers
}

describe("fixture editor", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders the definition, requirements, health and operations", async () => {
    const user = userEvent.setup()
    renderEditor()

    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "HET vs HOMO study"
    )
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe(
      "het-vs-homo"
    )
    expect(
      (screen.getByLabelText("How to find it") as HTMLTextAreaElement).value
    ).toBe("Studies > Caracara Fixture HET vs HOMO")
    expect(
      (
        screen.getByLabelText(
          "Rules for evaluation runs"
        ) as HTMLTextAreaElement
      ).value
    ).toBe("Never delete animals.")
    expect(
      (screen.getByLabelText("Reset instructions") as HTMLTextAreaElement).value
    ).toBe("")
    expect(
      (
        screen.getByLabelText(
          "Converge step 2 done when"
        ) as HTMLTextAreaElement
      ).value
    ).toBe("Nine animals are listed.")
    expect(
      (
        screen.getByLabelText(
          "Health check 1 expectation"
        ) as HTMLTextAreaElement
      ).value
    ).toBe("Nine animals exist.")

    expect(screen.getAllByText("Phase 1: Setup").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Add slices").length).toBeGreaterThan(0)
    expect(
      screen.getByText("May change: Adds slices to animal A1")
    ).toBeTruthy()
    expect(screen.getByText(".caracara/fixtures.json")).toBeTruthy()
    expect(
      screen.getByRole("img", { name: "Operation running in preview" })
    ).toBeTruthy()

    expect(screen.queryByText("Only eight animals are listed.")).toBeNull()
    const operation = screen.getByRole("button", { name: /verify/i })
    expect(operation.getAttribute("aria-expanded")).toBe("false")
    await user.click(operation)
    expect(operation.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByText("Only eight animals are listed.")).toBeTruthy()
    expect(screen.getByText("Animal A9 is missing.")).toBeTruthy()
  })

  it("keeps existing step and check IDs and sends new entries with null IDs", async () => {
    const user = userEvent.setup()
    const { updateFixture } = renderEditor()

    await user.click(screen.getByRole("button", { name: "Add step" }))
    fireEvent.change(screen.getByLabelText("Converge step 3 name"), {
      target: { value: "Calculate results" },
    })
    fireEvent.change(screen.getByLabelText("Converge step 3 instructions"), {
      target: { value: "Run the calculation." },
    })
    fireEvent.change(screen.getByLabelText("Converge step 3 done when"), {
      target: { value: "Results are shown." },
    })
    await user.click(
      screen.getByRole("button", { name: "Move converge step 3 up" })
    )
    await user.click(
      screen.getByRole("button", { name: "Remove converge step 1" })
    )

    await user.click(
      screen.getByRole("button", { name: "Move health check 2 up" })
    )
    await user.click(screen.getByRole("button", { name: "Add check" }))
    fireEvent.change(screen.getByLabelText("Health check 3 name"), {
      target: { value: "Model" },
    })
    fireEvent.change(screen.getByLabelText("Health check 3 expectation"), {
      target: { value: "The TRAP model is selected." },
    })
    await user.click(
      screen.getByRole("button", { name: "Remove health check 2" })
    )

    fireEvent.change(screen.getByLabelText("Reset instructions"), {
      target: { value: "Delete extra slices." },
    })
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(updateFixture).toHaveBeenCalledWith({
      projectId: "project-1",
      fixtureId: "fixture-1",
      name: "HET vs HOMO study",
      slug: "het-vs-homo",
      description: "Nine animals with calculated results.",
      locator: "Studies > Caracara Fixture HET vs HOMO",
      protection: "Never delete animals.",
      resetInstructions: "Delete extra slices.",
      convergeSteps: [
        {
          id: null,
          name: "Calculate results",
          instructions: "Run the calculation.",
          doneWhen: "Results are shown.",
        },
        {
          id: STEP_2,
          name: "Import animals",
          instructions: "Import nine animals.",
          doneWhen: "Nine animals are listed.",
        },
      ],
      healthChecks: [
        {
          id: CHECK_2,
          name: "Results",
          expectation: "Results are calculated.",
        },
        { id: null, name: "Model", expectation: "The TRAP model is selected." },
      ],
    })
  })

  it("moves keyboard focus with a reordered step", async () => {
    const user = userEvent.setup()
    renderEditor()

    const moveDown = screen.getByRole("button", {
      name: "Move converge step 1 down",
    })
    moveDown.focus()
    await user.keyboard("{Enter}")

    expect(
      (screen.getByLabelText("Converge step 2 name") as HTMLInputElement).value
    ).toBe("Create study")
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe(
        "Move converge step 2 up"
      )
    )
  })

  it("blocks saving incomplete steps and shows server conflicts without losing edits", async () => {
    const user = userEvent.setup()
    const updateFixture = vi.fn().mockRejectedValue({
      data: {
        code: "conflict",
        message: "A run is in progress. Wait for it to finish before editing.",
      },
    })
    renderEditor({ updateFixture: updateFixture as never })

    await user.click(screen.getByRole("button", { name: "Add step" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(updateFixture).not.toHaveBeenCalled()
    expect(
      screen.getByText("Fix the highlighted fields before saving.")
    ).toBeTruthy()

    await user.click(
      screen.getByRole("button", { name: "Remove converge step 3" })
    )
    const name = screen.getByLabelText("Name") as HTMLInputElement
    fireEvent.change(name, { target: { value: "Renamed fixture" } })
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(
      await screen.findByText(
        "A run is in progress. Wait for it to finish before editing."
      )
    ).toBeTruthy()
    expect(name.value).toBe("Renamed fixture")
  })

  it("locks the definition while a save is pending so no edit is lost", async () => {
    const user = userEvent.setup()
    let finish: (value: FixtureDetail) => void = () => undefined
    const updateFixture = vi.fn(
      () =>
        new Promise<FixtureDetail>((resolve) => {
          finish = resolve
        })
    )
    renderEditor({ updateFixture: updateFixture as never })

    const name = screen.getByLabelText("Name") as HTMLInputElement
    fireEvent.change(name, { target: { value: "Renamed fixture" } })
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(updateFixture).toHaveBeenCalledOnce()
    expect(name.matches(":disabled")).toBe(true)
    expect(
      screen.getByRole("button", { name: "Add step" }).matches(":disabled")
    ).toBe(true)
    expect(
      (screen.getByRole("button", { name: /Delete/ }) as HTMLButtonElement)
        .disabled
    ).toBe(true)

    finish({ ...createFixture(), name: "Renamed fixture", updatedAt: 99 })
    await waitFor(() => expect(name.matches(":disabled")).toBe(false))
    expect(name.value).toBe("Renamed fixture")
  })

  it("requires a mutation scope for mutating requirements", async () => {
    const user = userEvent.setup()
    const { setRequirement } = renderEditor()

    await user.selectOptions(
      screen.getByLabelText("Phase or scenario"),
      "phase:phase-1"
    )
    expect(
      screen.getByRole("button", { name: "Update requirement" })
    ).toBeTruthy()
    await user.click(screen.getByRole("radio", { name: "Mutates" }))
    await user.click(screen.getByRole("button", { name: "Update requirement" }))

    expect(setRequirement).not.toHaveBeenCalled()
    expect(
      screen.getByText("Describe what the scenarios may change.")
    ).toBeTruthy()

    await user.type(screen.getByLabelText("Mutation scope"), "Adds slices")
    await user.click(screen.getByRole("button", { name: "Update requirement" }))

    expect(setRequirement).toHaveBeenCalledWith({
      projectId: "project-1",
      fixtureId: "fixture-1",
      phaseId: "phase-1",
      access: "mutates",
      mutationScope: "Adds slices",
    })
  })

  it("adds read requirements without a scope and removes requirements", async () => {
    const user = userEvent.setup()
    const { removeRequirement, setRequirement } = renderEditor({
      fixture: createFixture({ requirements: [] }),
    })

    await user.selectOptions(
      screen.getByLabelText("Phase or scenario"),
      "scenario:scenario-1"
    )
    await user.click(screen.getByRole("button", { name: "Add requirement" }))
    expect(setRequirement).toHaveBeenCalledWith({
      projectId: "project-1",
      fixtureId: "fixture-1",
      scenarioId: "scenario-1",
      access: "read",
    })

    cleanup()
    renderEditor({ removeRequirement: removeRequirement as never })
    await user.click(
      screen.getByRole("button", { name: "Remove requirement for Add slices" })
    )
    expect(removeRequirement).toHaveBeenCalledWith({
      projectId: "project-1",
      fixtureId: "fixture-1",
      scenarioId: "scenario-1",
    })
  })

  it("deletes the fixture only after confirmation", async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false)
    const { onDeleted, removeFixture } = renderEditor()

    await user.click(screen.getByRole("button", { name: "Delete" }))
    expect(removeFixture).not.toHaveBeenCalled()

    confirm.mockReturnValueOnce(true)
    await user.click(screen.getByRole("button", { name: "Delete" }))
    expect(removeFixture).toHaveBeenCalledWith({
      projectId: "project-1",
      fixtureId: "fixture-1",
    })
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
  })
})

describe("fixture status", () => {
  afterEach(cleanup)

  it("shows compact health per environment", () => {
    render(<FixtureHealthBadges health={createFixture().health} />)

    expect(screen.getByText("production · healthy")).toBeTruthy()
    expect(screen.getByText("preview · unknown")).toBeTruthy()
    expect(
      screen.getByRole("img", { name: "Operation running in preview" })
    ).toBeTruthy()
  })

  it("renders run preflight entries and linked operations", async () => {
    const user = userEvent.setup()
    render(
      <RunFixturesDetail
        operations={[
          createOperation({
            id: "operation-2",
            kind: "reset",
            executor: "agent",
            status: "succeeded",
            runId: "run-1",
            checkResults: [],
            summary: "Removed the extra slices.",
          }),
        ]}
        preflight={[
          {
            fixtureId: "fixture-1",
            fixtureSlug: "het-vs-homo",
            fixtureName: "HET vs HOMO study",
            access: "mutates",
            outcome: "repaired",
            operationId: "operation-1",
          },
        ]}
      />
    )

    const preflight = screen.getByRole("region", { name: "Fixture preflight" })
    expect(preflight.textContent).toContain("HET vs HOMO study")
    expect(preflight.textContent).toContain("mutates")
    expect(preflight.textContent).toContain("repaired")

    const operations = screen.getByRole("region", {
      name: "Fixture operations",
    })
    expect(operations.textContent).toContain("agent · production")
    expect(operations.textContent).toContain("succeeded")
    await user.click(screen.getByRole("button", { name: /reset/i }))
    expect(screen.getByText("Removed the extra slices.")).toBeTruthy()
  })
})
