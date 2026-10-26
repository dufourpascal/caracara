import { z } from "zod"

// Zod 4 measures string `.min()`/`.max()` in Unicode code points, while Zod 3
// and the CLI releases built on it count UTF-16 code units, like
// `String.prototype.length` and HTML `maxlength`. Bounded strings use these
// checks instead so a value the server accepts stays parseable by those
// clients. Issues keep the built-in `too_small`/`too_big` shape and messages.
export function minUtf16Length(minimum: number, message?: string) {
  return z.superRefine<string>((value, ctx) => {
    if (value.length < minimum) {
      ctx.addIssue({
        code: "too_small",
        origin: "string",
        minimum,
        inclusive: true,
        input: value,
        ...(message === undefined ? {} : { message }),
      })
    }
  })
}

export function maxUtf16Length(maximum: number, message?: string) {
  return z.superRefine<string>((value, ctx) => {
    if (value.length > maximum) {
      ctx.addIssue({
        code: "too_big",
        origin: "string",
        maximum,
        inclusive: true,
        input: value,
        ...(message === undefined ? {} : { message }),
      })
    }
  })
}
