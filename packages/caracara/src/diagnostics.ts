import process from "node:process"

type DiagnosticWriter = (text: string) => void

const writeToStderr: DiagnosticWriter = (text) => {
  process.stderr.write(text)
}

let diagnosticWriter: DiagnosticWriter = writeToStderr

/**
 * Writes a warning or diagnostic line meant for stderr. During a run the live
 * status panel hooks this so the line lands above the panel instead of
 * corrupting it.
 */
export function writeDiagnostic(text: string) {
  diagnosticWriter(text)
}

/** Replaces the diagnostic writer; pass null to restore plain stderr. */
export function setDiagnosticWriter(writer: DiagnosticWriter | null) {
  diagnosticWriter = writer ?? writeToStderr
}
