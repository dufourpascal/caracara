/**
 * A small in-memory stand-in for the Convex database used by handler tests.
 * The double dot keeps Convex from deploying it as a function module.
 */
import type {
  DefaultFunctionArgs,
  RegisteredMutation,
  RegisteredQuery,
} from "convex/server"

import schema from "./schema"

type Row = Record<string, unknown> & { _id: string; _creationTime: number }
type Condition = { field: string; op: "eq" | "gt" | "gte" | "lt" | "lte"; value: unknown }

function rank(value: unknown) {
  if (value === undefined) return 0
  if (value === null) return 1
  if (typeof value === "number") return 2
  if (typeof value === "boolean") return 3
  return 4
}

function compareValues(left: unknown, right: unknown) {
  const byRank = rank(left) - rank(right)
  if (byRank !== 0) return byRank
  if (typeof left === "number" && typeof right === "number") {
    return left - right
  }
  if (typeof left === "string" && typeof right === "string") {
    return left < right ? -1 : left > right ? 1 : 0
  }
  return 0
}

function matches(row: Row, condition: Condition) {
  const comparison = compareValues(row[condition.field], condition.value)
  switch (condition.op) {
    case "eq":
      return comparison === 0 && rank(row[condition.field]) === rank(condition.value)
    case "gt":
      return comparison > 0
    case "gte":
      return comparison >= 0
    case "lt":
      return comparison < 0
    case "lte":
      return comparison <= 0
  }
}

class FakeQuery {
  private conditions: Condition[] = []
  private sortFields: string[] = []
  private direction: "asc" | "desc" = "asc"

  constructor(
    private readonly tableName: string,
    private readonly rows: () => Row[]
  ) {}

  withIndex(
    indexName: string,
    build?: (query: Record<string, (field: string, value: unknown) => unknown>) => unknown
  ) {
    const table = (schema.tables as Record<string, { " indexes": () => Array<{ indexDescriptor: string; fields: string[] }> }>)[
      this.tableName
    ]
    const index = table?.[" indexes"]().find(
      (candidate) => candidate.indexDescriptor === indexName
    )
    if (!index) {
      throw new Error(`Unknown index ${this.tableName}.${indexName}`)
    }
    this.sortFields = index.fields
    const builder: Record<string, (field: string, value: unknown) => unknown> = {}
    for (const op of ["eq", "gt", "gte", "lt", "lte"] as const) {
      builder[op] = (field, value) => {
        this.conditions.push({ field, op, value })
        return builder
      }
    }
    build?.(builder)
    return this
  }

  order(direction: "asc" | "desc") {
    this.direction = direction
    return this
  }

  private results() {
    const sorted = this.rows()
      .filter((row) => this.conditions.every((condition) => matches(row, condition)))
      .sort((left, right) => {
        for (const field of [...this.sortFields, "_creationTime"]) {
          const comparison = compareValues(left[field], right[field])
          if (comparison !== 0) return comparison
        }
        return 0
      })
    return this.direction === "desc" ? sorted.reverse() : sorted
  }

  async collect() {
    return this.results()
  }

  async first() {
    return this.results()[0] ?? null
  }

  async unique() {
    const results = this.results()
    if (results.length > 1) {
      throw new Error(`unique() found ${results.length} ${this.tableName} rows`)
    }
    return results[0] ?? null
  }

  async take(count: number) {
    return this.results().slice(0, count)
  }

  async *[Symbol.asyncIterator]() {
    for (const row of this.results()) {
      yield row
    }
  }
}

export function createFakeCtx(options: { userId?: string | null } = {}) {
  const tables = new Map<string, Map<string, Row>>()
  let counter = 0
  let userId = options.userId === undefined ? "user-1" : options.userId

  const tableRows = (name: string) => {
    let rows = tables.get(name)
    if (!rows) {
      rows = new Map()
      tables.set(name, rows)
    }
    return rows
  }
  const findRow = (id: string) => {
    for (const rows of tables.values()) {
      const row = rows.get(id)
      if (row) return { rows, row }
    }
    return null
  }

  const db = {
    async get(id: string) {
      const found = findRow(id)
      return found ? { ...found.row } : null
    },
    async insert(tableName: string, value: Record<string, unknown>) {
      counter += 1
      const _id = `${tableName}:${counter}`
      tableRows(tableName).set(_id, {
        ...structuredClone(value),
        _id,
        _creationTime: Date.now() + counter / 1_000,
      })
      return _id
    },
    async patch(id: string, value: Record<string, unknown>) {
      const found = findRow(id)
      if (!found) throw new Error(`patch: missing ${id}`)
      const next = { ...found.row }
      for (const [key, fieldValue] of Object.entries(value)) {
        if (fieldValue === undefined) delete next[key]
        else next[key] = structuredClone(fieldValue)
      }
      found.rows.set(id, next)
    },
    async delete(id: string) {
      const found = findRow(id)
      if (!found) throw new Error(`delete: missing ${id}`)
      found.rows.delete(id)
    },
    query(tableName: string) {
      return new FakeQuery(tableName, () =>
        [...tableRows(tableName).values()].map((row) => ({ ...row }))
      )
    },
    normalizeId(tableName: string, id: string) {
      return id.startsWith(`${tableName}:`) ? id : null
    },
  }

  const ctx = {
    db,
    auth: {
      async getUserIdentity() {
        return userId === null ? null : { subject: userId }
      },
    },
    storage: {
      async delete() {},
    },
  }

  return {
    ctx,
    rows(tableName: string) {
      return [...tableRows(tableName).values()]
    },
    setUser(next: string | null) {
      userId = next
    },
  }
}

export type FakeCtx = ReturnType<typeof createFakeCtx>["ctx"]

/** Calls a registered query or mutation handler directly against a fake ctx. */
export async function call<Args extends DefaultFunctionArgs, Result>(
  fn:
    | RegisteredMutation<"public", Args, Result>
    | RegisteredQuery<"public", Args, Result>,
  ctx: FakeCtx,
  args: Args
): Promise<Awaited<Result>> {
  const handler = (fn as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<Awaited<Result>>
  })._handler
  return await handler(ctx, args)
}
