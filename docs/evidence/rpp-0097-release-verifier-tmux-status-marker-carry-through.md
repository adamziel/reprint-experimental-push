# RPP-0097 release verifier tmux status marker carry-through

RPP-0097 has evidence toward the near release-gates verifier path for carrying a verifier stdout status marker into the `tmux-status-marker` release-gate evidence object.

## Focused check

- Focused command: `umask 0022 && node --test test/release-verifier-tmux-status-marker-carry-through-focused-regression.test.js test/release-gate-tmux-status-marker-focused-regression.test.js test/release-gate-tmux-status-marker-generated.test.js test/release-gate-cli.test.js test/release-gates.test.js`
- Observed status: `pass`; release gate marker evidence scenarios: `verifier-marker+malformed-carried-marker`.
- Verifier marker carried into gate evidence: `[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]`

## Evidence captured

- The verifier proof exits before live verifier server startup, ends stdout with the bracketed status marker, and records `mutationAttempted: false`.
- The release-gate CLI accepts that bracketed verifier marker as final `tmuxStatusMarker` evidence and preserves the exact gate evidence object with `observed` set to the verifier marker.
- A stripped carried marker fails closed with `TMUX_STATUS_MARKER_REQUIRED`, the exact reason `The tmux stdout status marker is missing or not bracketed.`, and the exact failed evidence object.
- The focused assertion also confirms no configured credential sentinel is echoed in verifier or release-gate stdout/stderr.

Focused checks passed but the checklist item remains unchecked.
