import type {
  CliConfig,
  OrderedScenario,
  OrderedScenario as ScenarioPayload,
  RunnerType,
} from "@workspace/contracts"

import type { ModelReasoningEffort } from "./config.js"

export type StoredCliConfig = CliConfig
export type ScenarioToExecute = OrderedScenario | ScenarioPayload
export type InitCommandOptions = {
  apiBaseUrl?: string
  project?: string
  runner?: RunnerType
  model?: string
  modelReasoningEffort?: ModelReasoningEffort
}

export type RunCommandOptions = {
  apiBaseUrl?: string
  project?: string
  runner?: RunnerType
  environment?: string
  model?: string
  modelReasoningEffort?: string
  scenario?: string
  suite?: string
  phase?: string
  throughPhase?: string
  /** check (default), repair, or skip */
  fixtures?: string
  phases?: string
  keepGoing?: boolean
  json?: boolean
  quiet?: boolean
  plain?: boolean
  heartbeat?: string
  failOn?: string
}

export type ResultsCommandOptions = {
  apiBaseUrl?: string
  project?: string
  environment?: string
  json?: boolean
}
