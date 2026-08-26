import type { ReactNode } from "react"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ProjectCreateForm } from "./project-create-form"
import { ProjectCreateScreen } from "./project-create-screen"

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  push: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock("@clerk/nextjs", () => ({
  UserButton: () => null,
}))

vi.mock("convex/react", () => ({
  Authenticated: ({ children }: { children: ReactNode }) => children,
  AuthLoading: () => null,
  useMutation: () => mocks.createProject,
}))

describe("project creation forms", () => {
  afterEach(cleanup)

  beforeEach(() => {
    mocks.createProject.mockReset()
    mocks.push.mockReset()
  })

  it("shows persistent field guidance, mono technical fields, and a readable width", () => {
    render(<ProjectCreateScreen />)

    const form = screen.getByRole("form", { name: "Create project" })
    const slug = screen.getByLabelText("Slug")
    const prompt = screen.getByLabelText("Project prompt")

    expect(form.className).toContain("max-w-3xl")
    expect(slug.className).toContain("font-mono")
    expect(prompt.className).toContain("font-mono")
    expect(
      screen.getByText(/leave blank to derive it from the project name/i)
    ).toBeTruthy()
    expect(screen.getByText(/applied to every scenario run/i)).toBeTruthy()
  })

  it("shows field-specific messages for every project limit", async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<ProjectCreateForm onCreate={onCreate} />)

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "   " },
    })
    await user.click(screen.getByRole("button", { name: "Create project" }))
    expect(screen.getByText("Project name is required.")).toBeTruthy()

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "n".repeat(121) },
    })
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "d".repeat(1_501) },
    })
    fireEvent.change(screen.getByLabelText("Project prompt"), {
      target: { value: "p".repeat(12_001) },
    })
    await user.click(screen.getByRole("button", { name: "Create project" }))

    expect(
      screen.getByText("Project name must be 120 characters or fewer.")
    ).toBeTruthy()
    expect(
      screen.getByText("Description must be 1,500 characters or fewer.")
    ).toBeTruthy()
    expect(
      screen.getByText("Project prompt must be 12,000 characters or fewer.")
    ).toBeTruthy()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it("preserves valid fields, clears corrected messages, and resubmits", async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<ProjectCreateForm onCreate={onCreate} />)

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "  Blank Slug Derivation  " },
    })
    fireEvent.change(screen.getByLabelText("Slug"), {
      target: { value: "   " },
    })
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "d".repeat(1_501) },
    })
    await user.click(screen.getByRole("button", { name: "Create project" }))

    expect(
      (screen.getByLabelText("Project name") as HTMLInputElement).value
    ).toBe("  Blank Slug Derivation  ")
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe(
      "   "
    )
    expect(
      screen.getByText("Description must be 1,500 characters or fewer.")
    ).toBeTruthy()

    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Valid description" },
    })
    expect(
      screen.queryByText("Description must be 1,500 characters or fewer.")
    ).toBeNull()

    await user.click(screen.getByRole("button", { name: "Create project" }))
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        name: "Blank Slug Derivation",
        slug: undefined,
        description: "Valid description",
        projectPrompt: "",
      })
    )
  })
})
