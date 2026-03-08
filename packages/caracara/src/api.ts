import {
  type ApiError,
  API_VERSION_HEADER,
  createRunRequestSchema,
  createRunResponseSchema,
  finalizeRunRequestSchema,
  finalizeRunResponseSchema,
  orderedActiveScenariosResponseSchema,
  parseApiError,
  projectListResponseSchema,
  singleScenarioResponseSchema,
  submitScenarioResultRequestSchema,
  submitScenarioResultResponseSchema,
  whoAmIResponseSchema,
} from "@workspace/contracts"

function formatApiError(error: ApiError) {
  if (!error.details || Object.keys(error.details).length === 0) {
    return `${error.code}: ${error.message}`
  }

  return `${error.code}: ${error.message}\n${JSON.stringify(error.details, null, 2)}`
}

async function request<T>(args: {
  url: string
  version: string
  accessToken: string
  init?: RequestInit
  schema: { parse: (value: unknown) => T }
}) {
  const response = await fetch(args.url, {
    ...args.init,
    headers: new Headers({
      authorization: `Bearer ${args.accessToken}`,
      [API_VERSION_HEADER]: args.version,
      "content-type": "application/json",
      ...(args.init?.headers instanceof Headers
        ? Object.fromEntries(args.init.headers.entries())
        : Array.isArray(args.init?.headers)
          ? Object.fromEntries(args.init.headers)
          : args.init?.headers ?? {}),
    }),
  })
  const json = await response.json()

  if (!response.ok) {
    const error = parseApiError(json)
    if (error.success) {
      throw new Error(formatApiError(error.data))
    }

    throw new Error(
      `Unexpected API error (${response.status} ${response.statusText}): ${JSON.stringify(json, null, 2)}`,
    )
  }

  return args.schema.parse(json)
}

export async function fetchWhoAmI(apiBaseUrl: string, accessToken: string, version: string) {
  return request({
    url: `${apiBaseUrl}/api/v1/whoami`,
    version,
    accessToken,
    schema: whoAmIResponseSchema,
  })
}

export async function fetchProjects(apiBaseUrl: string, accessToken: string, version: string) {
  return request({
    url: `${apiBaseUrl}/api/v1/projects`,
    version,
    accessToken,
    schema: projectListResponseSchema,
  })
}

export async function fetchOrderedScenarios(args: {
  apiBaseUrl: string
  accessToken: string
  version: string
  projectSlug: string
}) {
  return request({
    url: `${args.apiBaseUrl}/api/v1/projects/${args.projectSlug}/scenarios`,
    version: args.version,
    accessToken: args.accessToken,
    schema: orderedActiveScenariosResponseSchema,
  })
}

export async function fetchSingleScenario(args: {
  apiBaseUrl: string
  accessToken: string
  version: string
  projectSlug: string
  scenarioSlug: string
}) {
  return request({
    url: `${args.apiBaseUrl}/api/v1/projects/${args.projectSlug}/scenarios/${args.scenarioSlug}`,
    version: args.version,
    accessToken: args.accessToken,
    schema: singleScenarioResponseSchema,
  })
}

export async function createRun(args: {
  apiBaseUrl: string
  accessToken: string
  version: string
  projectSlug: string
  payload: Parameters<typeof createRunRequestSchema.parse>[0]
}) {
  return request({
    url: `${args.apiBaseUrl}/api/v1/projects/${args.projectSlug}/runs`,
    version: args.version,
    accessToken: args.accessToken,
    init: {
      method: "POST",
      body: JSON.stringify(createRunRequestSchema.parse(args.payload)),
    },
    schema: createRunResponseSchema,
  })
}

export async function submitScenarioResult(args: {
  apiBaseUrl: string
  accessToken: string
  version: string
  projectSlug: string
  runId: string
  payload: Parameters<typeof submitScenarioResultRequestSchema.parse>[0]
}) {
  return request({
    url: `${args.apiBaseUrl}/api/v1/projects/${args.projectSlug}/runs/${args.runId}/results`,
    version: args.version,
    accessToken: args.accessToken,
    init: {
      method: "POST",
      body: JSON.stringify(submitScenarioResultRequestSchema.parse(args.payload)),
    },
    schema: submitScenarioResultResponseSchema,
  })
}

export async function finalizeRun(args: {
  apiBaseUrl: string
  accessToken: string
  version: string
  projectSlug: string
  runId: string
  payload: Parameters<typeof finalizeRunRequestSchema.parse>[0]
}) {
  return request({
    url: `${args.apiBaseUrl}/api/v1/projects/${args.projectSlug}/runs/${args.runId}/finalize`,
    version: args.version,
    accessToken: args.accessToken,
    init: {
      method: "POST",
      body: JSON.stringify(finalizeRunRequestSchema.parse(args.payload)),
    },
    schema: finalizeRunResponseSchema,
  })
}
