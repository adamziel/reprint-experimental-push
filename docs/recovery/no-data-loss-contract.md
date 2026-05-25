# No-Data-Loss Recovery Contract

This lane treats recovery as a three-state contract:

* `old-remote` for failures that happen before any remote mutation can be
  committed.
* `fully-updated-remote` for successful completion or replay of a completed
  plan.
* `blocked-recovery` when the remote has partial writes or drift and the
  recovery path must preserve artifacts.

The last state is only acceptable when it carries both:

* durable journal artifacts, and
* a classified remote snapshot or equivalent recovery evidence.

Anything else is a release blocker because a partial mutation without recovery
artifacts cannot be safely retried.

The tests in `test/push-planner.test.js` pin this contract across:

* failure before mutation,
* failure after staging,
* failure after dependency validation,
* replay of a completed plan, and
* stale replay of a completed plan on a drifted remote.
