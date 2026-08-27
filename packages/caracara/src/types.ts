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
  scenario?: string
  suite?: string
  phase?: string
  throughPhase?: string
}
