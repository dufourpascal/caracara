import { setTimeout as delay } from "node:timers/promises"

import {
  type ApiError,
  API_NAMESPACE,
  API_VERSION_HEADER,
  authoringRequestSchema,
  authoringResponseSchema,
  createRunRequestSchema,
  createRunResponseSchema,
  executionPlanResponseSchema,
  finalizeRunRequestSchema,
  finalizeRunResponseSchema,
  parseApiError,
  projectListResponseSchema,
  runEvidenceUploadResponseSchema,
  singleScenarioResponseSchema,
  startScenarioExecutionRequestSchema,
  startScenarioExecutionResponseSchema,
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

const TRANSIENT_RETRY_DELAYS_MS = [250, 1_000]

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500
}

async function fetchWithTransientRetries(input: string, init: RequestInit) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      init.signal?.throwIfAborted()
      const response = await fetch(input, init)
      if (
        isRetryableStatus(response.status) &&
        attempt < TRANSIENT_RETRY_DELAYS_MS.length
      ) {
        await delay(TRANSIENT_RETRY_DELAYS_MS[attempt], undefined, {
          signal: init.signal ?? undefined,
        })
        continue
      }
      return response
    } catch (error) {
      if (init.signal?.aborted || attempt >= TRANSIENT_RETRY_DELAYS_MS.length) {
        throw error
      }
      await delay(TRANSIENT_RETRY_DELAYS_MS[attempt], undefined, {
        signal: init.signal ?? undefined,
      })
    }
  }
}

async function request<T>(args: {
  url: string
  version: string
  accessToken: string
  init?: RequestInit
  retryTransient?: boolean
  schema: { parse: (value: unknown) => T }
}) {
  const init = {
    ...args.init,
    headers: new Headers({
      authorization: `Bearer ${args.accessToken}`,
      [API_VERSION_HEADER]: args.version,
      "content-type": "application/json",
      ...(args.init?.headers instanceof Headers
        ? Object.fromEntries(args.init.headers.entries())
        : Array.isArray(args.init?.headers)
          ? Object.fromEntries(args.init.headers)
          : (args.init?.headers ?? {})),
    }),
  }
  const response = args.retryTransient
    ? await fetchWithTransientRetries(args.url, init)
    : await fetch(args.url, init)
  const json = await response.json()

  if (!response.ok) {
    const error = parseApiError(json)
    if (error.success) {
      throw new Error(formatApiError(error.data))
    }

    throw new Error(
      `Unexpected API error (${response.status} ${response.statusText}): ${JSON.stringify(json, null, 2)}`
    )
  }

  return args.schema.parse(json)
}

export async function fetchWhoAmI(
  apiBaseUrl: string,
  accessToken: string,
  version: string
) {
  return request({
    url: `${apiBaseUrl}/api/${API_NAMESPACE}/whoami`,
    version,
    accessToken,
    schema: whoAmIResponseSchema,
  })
}

export async function fetchProjects(
  apiBaseUrl: string,
  accessToken: string,
  version: string
) {
  return request({
    url: `${apiBaseUrl}/api/${API_NAMESPACE}/projects`,
    version,
    accessToken,
    schema: projectListResponseSchema,
  })
}

export async function fetchExecutionPlan(args: {
  apiBaseUrl: string
  accessToken: string
  version: string
  projectSlug: string
  suiteSlug?: string
  signal?: AbortSignal
}) {
  const search = args.suiteSlug
    ? `?${new URLSearchParams({ suite: args.suiteSlug })}`
    : ""

  return request({
    url: `${args.apiBaseUrl}/api/${API_NAMESPACE}/projects/${args.projectSlug}/scenarios${search}`,
    version: args.version,
    accessToken: args.accessToken,
    init: { signal: args.signal },
    schema: executionPlanResponseSchema,
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
    url: `${args.apiBaseUrl}/api/${API_NAMESPACE}/projects/${args.projectSlug}/scenarios/${args.scenarioSlug}`,
    version: args.version,
    accessToken: args.accessToken,
    schema: singleScenarioResponseSchema,
  })
}

export async function submitAuthoringOperation(args: {
  apiBaseUrl: string
  accessToken: string
  version: string
  projectSlug: string
  payload: Parameters<typeof authoringRequestSchema.parse>[0]
}) {
  return request({
    url: `${args.apiBaseUrl}/api/${API_NAMESPACE}/projects/${args.projectSlug}/authoring`,
    version: args.version,
    accessToken: args.accessToken,
    init: {
      method: "POST",
      body: JSON.stringify(authoringRequestSchema.parse(args.payload)),
    },
    schema: authoringResponseSchema,
  })
}

export async function createRun(args: {
  apiBaseUrl: string
  accessToken: string
  version: string
  projectSlug: string
  payload: Parameters<typeof createRunRequestSchema.parse>[0]
  signal?: AbortSignal
}) {
  return request({
    url: `${args.apiBaseUrl}/api/${API_NAMESPACE}/projects/${args.projectSlug}/runs`,
    version: args.version,
    accessToken: args.accessToken,
    init: {
      method: "POST",
      body: JSON.stringify(createRunRequestSchema.parse(args.payload)),
      signal: args.signal,
    },
    retryTransient: true,
    schema: createRunResponseSchema,
  })
}

export async function startScenarioExecution(args: {
  apiBaseUrl: string
  accessToken: string
  version: string
  projectSlug: string
  runId: string
  payload: Parameters<typeof startScenarioExecutionRequestSchema.parse>[0]
  signal?: AbortSignal
}) {
  return request({
    url: `${args.apiBaseUrl}/api/${API_NAMESPACE}/projects/${args.projectSlug}/runs/${args.runId}/results/start`,
    version: args.version,
    accessToken: args.accessToken,
    init: {
      method: "POST",
      body: JSON.stringify(
        startScenarioExecutionRequestSchema.parse(args.payload)
      ),
      signal: args.signal,
    },
    schema: startScenarioExecutionResponseSchema,
  })
}

export async function submitScenarioResult(args: {
  apiBaseUrl: string
  accessToken: string
  version: string
  projectSlug: string
  runId: string
  payload: Parameters<typeof submitScenarioResultRequestSchema.parse>[0]
  signal?: AbortSignal
}) {
  return request({
    url: `${args.apiBaseUrl}/api/${API_NAMESPACE}/projects/${args.projectSlug}/runs/${args.runId}/results`,
    version: args.version,
    accessToken: args.accessToken,
    init: {
      method: "POST",
      body: JSON.stringify(
        submitScenarioResultRequestSchema.parse(args.payload)
      ),
      signal: args.signal,
    },
    retryTransient: true,
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
  signal?: AbortSignal
}) {
  return request({
    url: `${args.apiBaseUrl}/api/${API_NAMESPACE}/projects/${args.projectSlug}/runs/${args.runId}/finalize`,
    version: args.version,
    accessToken: args.accessToken,
    init: {
      method: "POST",
      body: JSON.stringify(finalizeRunRequestSchema.parse(args.payload)),
      signal: args.signal,
    },
    retryTransient: true,
    schema: finalizeRunResponseSchema,
  })
}

export async function uploadRunEvidence(args: {
  uploadUrl: string
  accessToken: string
  runId: string
  scenarioResultId: string
  checkId: string
  sha256: string
  bytes: Uint8Array
  signal?: AbortSignal
}) {
  const response = await fetchWithTransientRetries(args.uploadUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${args.accessToken}`,
      "content-type": "image/webp",
      "x-caracara-run-id": args.runId,
      "x-caracara-result-id": args.scenarioResultId,
      "x-caracara-check-id": args.checkId,
      "x-caracara-byte-size": String(args.bytes.byteLength),
      "x-caracara-sha256": args.sha256,
    },
    body: args.bytes as BodyInit,
    signal: args.signal,
  })
  const json = await response.json()
  if (!response.ok) {
    const error = parseApiError(json)
    throw new Error(
      error.success
        ? formatApiError(error.data)
        : `Unexpected evidence upload error (${response.status} ${response.statusText}).`
    )
  }

  return runEvidenceUploadResponseSchema.parse(json)
}
