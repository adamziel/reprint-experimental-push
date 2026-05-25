# No Data Loss Durable Journal State Summary

The atomic apply lane accepts only three post-failure states:

1. `old-remote`
2. `fully-updated-remote`
3. `blocked-recovery`

## State meaning

- `old-remote`: no remote mutation is durable, so the remote still matches the pre-apply envelope.
- `fully-updated-remote`: every planned mutation is already present and replay must stay read-only.
- `blocked-recovery`: the system cannot prove the remote is fully old or fully updated, so recovery artifacts are required.

## Durable journal rule

- The journal must retain append-only evidence for boundary inspection.
- A completed replay must remain inert when retried against the same completed journal.
- A completed replay that sees drift must not collapse into `old-remote`.
- A retry must not duplicate inserts or resurrect stale local data.

## Release blocker

- Any partial remote mutation without recovery artifacts is a release blocker.
- JSON fixtures or lab evidence are useful for proving the model, but they do not replace durable production journal rows or crash-safe files.
- The production path still needs durable storage semantics such as persistence, flush discipline, and recovery inspection before partial writes can be treated as recoverable.
