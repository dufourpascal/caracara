/**
 * Browser rules shared by evaluation, blocked-retry and fixture prompts. They
 * keep chrome-devtools waits and element references from stalling a run: a
 * wait_for that never matches costs its whole timeout, and a stale uid costs a
 * failed call plus a new snapshot.
 */
export const BROWSER_WAITING_GUIDANCE = [
  "Waiting: wait_for matches exact, case-sensitive text and only returns early when that text appears, so a miss costs its whole timeout. Copy the text from the latest snapshot.",
  "Put every outcome you expect, success and failure, in one wait_for text list, so it returns on whichever appears.",
  "Never use wait_for for text that appears only if something goes wrong, or to wait for something to disappear. Take one snapshot instead.",
  "Do not wait for short-lived states such as Saving or Calculating. Wait for the end state that follows them.",
  "Keep wait_for timeouts at 10 seconds or less. Use a longer timeout only while processing, an upload or an export is running, with its end state and failure text in the list. After a timeout, take a snapshot before waiting again: the page may already show another end state.",
  "Element uids are valid only for the latest snapshot. After the page changes, use includeSnapshot or take a new snapshot before using a uid.",
  "Set the viewport size with resize_page, not emulate.",
]
