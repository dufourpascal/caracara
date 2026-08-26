export function getErrorData(error: unknown) {
  if (typeof error !== "object" || error === null || !("data" in error)) {
    return null
  }

  return typeof error.data === "object" && error.data !== null
    ? error.data
    : null
}

export function getErrorMessage(error: unknown) {
  const data = getErrorData(error)

  if (data && "message" in data && typeof data.message === "string") {
    return data.message
  }

  return error instanceof Error ? error.message : "Something went wrong."
}
