# Recovery Post-Failure States

`applyPlan()` only has three acceptable post-failure outcomes:

- `old-remote`: no remote mutation is allowed to land, and the journal must
  carry the plan metadata needed for recovery inspection.
- `fully-updated-remote`: every planned mutation already exists, replay is
  inert, and the recovery state only needs the completed journal artifact.
- `blocked-recovery`: a partial mutation or drifted state was observed, and the
  recovery state must retain both journal and remote artifacts so the operator
  can inspect the boundary instead of guessing.

The recovery model is intentionally stricter than a "best effort rollback"
claim. A partial remote mutation without artifacts is a blocker, not a safe
completion.

Durable journal evidence is the production requirement. Lab JSON evidence can
help prove the model, but it is not a substitute for a persisted journal,
fsync-backed writes, fencing, or restartable inspection.
