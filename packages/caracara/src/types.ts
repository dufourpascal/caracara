import type {
  CliConfig,
  OrderedScenario,
  OrderedScenario as ScenarioPayload,
  RunnerType,
} from "@workspace/contracts"

export type StoredCliConfig = CliConfig
export type ScenarioToExecute = OrderedScenario | ScenarioPayload
export type InitCommandOptions = {
  apiBaseUrl?: string
  project?: string
  runner?: RunnerType
}

export type RunCommandOptions = {
  apiBaseUrl?: string
  project?: string
  runner?: RunnerType
  scenario?: string
}
