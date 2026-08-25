import { cronJobs } from "convex/server"

import { internal } from "./_generated/api"

const crons = cronJobs()

crons.daily(
  "delete orphaned run evidence",
  { hourUTC: 3, minuteUTC: 15 },
  internal.runEvidence.cleanupOrphans,
  {}
)

export default crons
