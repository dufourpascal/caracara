import { verifyToken } from "@clerk/backend"
import { fetchMutation, fetchQuery } from "convex/nextjs"
import { NextResponse } from "next/server"

import {
  apiErrorSchema,
  createRunRequestSchema,
  createVersionMismatchDetails,
  finalizeRunRequestSchema,
  isCliVersionSupported,
  oauthAuthorizeRequestSchema,
  oauthTokenRequestSchema,
  projectDetailResponseSchema,
  projectListResponseSchema,
  submitScenarioResultRequestSchema,
  whoAmIResponseSchema,
  API_VERSION_HEADER,
} from "@workspace/contracts"

import { api } from "@/convex/_generated/api"

export class ApiRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code:
      | "unauthenticated"
      | "unauthorized"
      | "not_found"
      | "validation_error"
      | "version_mismatch"
      | "conflict"
      | "internal_error",
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
  }
}

function statusForApiErrorCode(
  code:
    | "unauthenticated"
    | "unauthorized"
    | "not_found"
    | "validation_error"
    | "version_mismatch"
    | "conflict"
    | "internal_error"
) {
  switch (code) {
    case "unauthenticated":
      return 401
    case "unauthorized":
      return 403
    case "not_found":
      return 404
    case "validation_error":
      return 400
    case "version_mismatch":
    case "conflict":
      return 409
    case "internal_error":
      return 500
  }
}

function jsonError(error: ApiRouteError) {
  return NextResponse.json(
    apiErrorSchema.parse({
      code: error.code,
      message: error.message,
      details: error.details,
    }),
    { status: error.status }
  )
}

function extractStructuredApiError(error: unknown) {
  const data =
    typeof error === "object" && error !== null && "data" in error
      ? (error as { data?: unknown }).data
      : undefined
  const parsedData = apiErrorSchema.safeParse(data)

  if (parsedData.success) {
    return new ApiRouteError(
      statusForApiErrorCode(parsedData.data.code),
      parsedData.data.code,
      parsedData.data.message,
      parsedData.data.details
    )
  }

  if (!(error instanceof Error)) {
    return null
  }

  const jsonStart = error.message.indexOf("{")
  const jsonEnd = error.message.lastIndexOf("}")

  if (jsonStart === -1 || jsonEnd <= jsonStart) {
    return null
  }

  try {
    const parsedMessage = apiErrorSchema.safeParse(
      JSON.parse(error.message.slice(jsonStart, jsonEnd + 1))
    )

    if (!parsedMessage.success) {
      return null
    }

    return new ApiRouteError(
      statusForApiErrorCode(parsedMessage.data.code),
      parsedMessage.data.code,
      parsedMessage.data.message,
      parsedMessage.data.details
    )
  } catch {
    return null
  }
}

function getInternalErrorDetails(error: unknown) {
  if (process.env.NODE_ENV === "production") {
    return undefined
  }

  if (error instanceof Error) {
    return {
      reason: error.message,
      stack: error.stack ?? null,
    }
  }

  return {
    reason: typeof error === "string" ? error : JSON.stringify(error),
  }
}

export function handleApiError(error: unknown) {
  if (error instanceof ApiRouteError) {
    return jsonError(error)
  }

  const structured = extractStructuredApiError(error)
  if (structured) {
    return jsonError(structured)
  }

  if (error instanceof Error && error.message.includes("Authentication")) {
    return jsonError(new ApiRouteError(401, "unauthenticated", error.message))
  }

  if (error instanceof Error && error.message.includes("not found")) {
    return jsonError(new ApiRouteError(404, "not_found", error.message))
  }

  if (error instanceof Error && error.message.includes("access")) {
    return jsonError(new ApiRouteError(403, "unauthorized", error.message))
  }

  console.error("Unhandled API route error", error)

  return jsonError(
    new ApiRouteError(
      500,
      "internal_error",
      "Unexpected server error.",
      getInternalErrorDetails(error)
    )
  )
}

export function requireCliVersion(request: Request) {
  const version = request.headers.get(API_VERSION_HEADER)

  if (!version || !isCliVersionSupported(version)) {
    throw new ApiRouteError(409, "version_mismatch", "CLI upgrade required.", {
      ...createVersionMismatchDetails(),
    })
  }

  return version
}

export function parseBearerToken(request: Request) {
  const header = request.headers.get("authorization")
  if (!header?.startsWith("Bearer ")) {
    throw new ApiRouteError(401, "unauthenticated", "Missing bearer token.")
  }

  return header.slice("Bearer ".length)
}

export async function requireVerifiedToken(request: Request) {
  const token = parseBearerToken(request)

  try {
    await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    })
  } catch (error) {
    throw new ApiRouteError(
      401,
      "unauthenticated",
      "Invalid or expired token.",
      {
        reason: error instanceof Error ? error.message : "unknown",
      }
    )
  }

  return token
}

export async function parseJsonBody<T>(
  request: Request,
  schema: { parse: (value: unknown) => T }
) {
  try {
    return schema.parse(await request.json())
  } catch (error) {
    throw new ApiRouteError(
      400,
      "validation_error",
      "Invalid request payload.",
      {
        reason: error instanceof Error ? error.message : "unknown",
      }
    )
  }
}

export async function getViewer(token: string) {
  const viewer = await fetchQuery(api.users.viewer, {}, { token })
  const parsed = whoAmIResponseSchema.safeParse({
    userId: viewer?.subject ?? "",
    email: viewer?.email ?? null,
  })

  if (!parsed.success) {
    throw new ApiRouteError(
      401,
      "unauthenticated",
      "Unable to resolve authenticated user."
    )
  }

  return parsed.data
}

export async function getProjectBySlug(token: string, projectSlug: string) {
  const project = await fetchQuery(
    api.projects.getBySlug,
    { slug: projectSlug },
    { token }
  )
  return projectDetailResponseSchema.parse({ project })
}

export async function getProjectList(token: string) {
  const projects = await fetchQuery(api.projects.list, {}, { token })
  return projectListResponseSchema.parse({ projects })
}

export async function createRun(
  token: string,
  args: { projectSlug: string; body: unknown }
) {
  const payload = createRunRequestSchema.parse(args.body)
  const { project } = await getProjectBySlug(token, args.projectSlug)
  const run = await fetchMutation(
    api.runs.create,
    {
      projectId: project.id as never,
      mode: payload.mode,
      runnerType: payload.runnerType,
      requestedScenarioSlug: payload.requestedScenarioSlug ?? null,
      startedAt: payload.startedAt,
    },
    { token }
  )

  return { run }
}

export async function submitScenarioResult(args: {
  token: string
  projectSlug: string
  runId: string
  body: unknown
}) {
  const payload = submitScenarioResultRequestSchema.parse(args.body)
  if (payload.runId !== args.runId) {
    throw new ApiRouteError(
      400,
      "validation_error",
      "Run ID in URL does not match request body."
    )
  }
  const { project } = await getProjectBySlug(args.token, args.projectSlug)

  return await fetchMutation(
    api.runs.submitScenarioResult,
    {
      projectId: project.id as never,
      runId: args.runId as never,
      result: {
        ...payload.result,
        scenarioId: payload.result.scenarioId as never,
        improvementInstruction: payload.result.improvementInstruction,
      },
    },
    { token: args.token }
  )
}

export async function finalizeRun(args: {
  token: string
  projectSlug: string
  runId: string
  body: unknown
}) {
  const payload = finalizeRunRequestSchema.parse(args.body)
  const { project } = await getProjectBySlug(args.token, args.projectSlug)

  return await fetchMutation(
    api.runs.finalize,
    {
      projectId: project.id as never,
      runId: args.runId as never,
      status: payload.status,
      finishedAt: payload.finishedAt,
    },
    { token: args.token }
  )
}

export const routeSchemas = {
  createRunRequestSchema,
  finalizeRunRequestSchema,
  oauthAuthorizeRequestSchema,
  oauthTokenRequestSchema,
  submitScenarioResultRequestSchema,
}
