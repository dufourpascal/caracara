/* eslint-disable no-control-regex */
const ANSI_ESCAPE =
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-_]/g
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g
const SGR_AT_START = /^\u001b\[[0-?]*[ -/]*[@-~]/
/* eslint-enable no-control-regex */

/**
 * Makes untrusted text (agent output, slugs, error messages) safe for one
 * terminal line: escape sequences and control characters are removed and
 * whitespace runs collapse to one space.
 */
export function toSingleLine(text: string) {
  return text
    .replace(ANSI_ESCAPE, "")
    .replace(/\s+/g, " ")
    .replace(CONTROL_CHARACTERS, "")
    .trim()
}

/** Removes escape sequences so the remaining text can be measured. */
export function stripAnsi(text: string) {
  return text.replace(ANSI_ESCAPE, "")
}

function isWide(codePoint: number) {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  )
}

function isZeroWidth(codePoint: number) {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
  )
}

function cellWidth(codePoint: number) {
  return isZeroWidth(codePoint) ? 0 : isWide(codePoint) ? 2 : 1
}

/** Approximate number of terminal cells the text occupies. */
export function displayWidth(text: string) {
  let width = 0
  for (const character of stripAnsi(text)) {
    width += cellWidth(character.codePointAt(0)!)
  }
  return width
}

/**
 * Cuts plain text (no escape sequences) to at most `maxWidth` cells, ending
 * with "…" when anything was removed.
 */
export function truncateToWidth(text: string, maxWidth: number) {
  if (maxWidth <= 0) {
    return ""
  }
  if (displayWidth(text) <= maxWidth) {
    return text
  }
  let result = ""
  let width = 0
  for (const character of text) {
    const codePoint = character.codePointAt(0)!
    const characterWidth = cellWidth(codePoint)
    if (width + characterWidth > maxWidth - 1) {
      break
    }
    result += character
    width += characterWidth
  }
  return `${result}…`
}

/**
 * Cuts a line that may contain SGR color codes to `maxWidth` visible cells.
 * Color codes are kept, and a reset is appended when the line was cut.
 */
export function truncateStyledLine(line: string, maxWidth: number) {
  if (displayWidth(line) <= maxWidth) {
    return line
  }
  let result = ""
  let width = 0
  let index = 0
  while (index < line.length) {
    if (line[index] === "\u001b") {
      const match = SGR_AT_START.exec(line.slice(index))
      if (match) {
        result += match[0]
        index += match[0].length
        continue
      }
    }
    const character = String.fromCodePoint(line.codePointAt(index)!)
    const codePoint = character.codePointAt(0)!
    const characterWidth = cellWidth(codePoint)
    if (width + characterWidth > maxWidth - 1) {
      break
    }
    result += character
    width += characterWidth
    index += character.length
  }
  return line.includes("\u001b") ? `${result}…\u001b[0m` : `${result}…`
}
