# No Data Loss Recovery

This lane defines the recovery envelope for atomic apply and the durable
journal boundary that backs it.

## Accepted post-failure states

An interrupted or replayed apply must resolve to exactly one of:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

Anything else is a contract failure.

## What each state means

- `old-remote`: no remote mutation became durable. The remote stays on the pre-apply snapshot and the journal records the interruption boundary.
- `fully-updated-remote`: every planned mutation is already present on the remote and the completed journal can be replayed without duplicating inserts or reviving stale local data.
- `blocked-recovery`: the remote cannot be classified safely from the journal alone. The recovery artifact must preserve both the journal and the observed remote so inspection can decide the next action.

## Boundary coverage

The apply contract treats these boundaries as the minimum durable proof set:

- failure before mutation
- failure after staging
- failure after dependency validation
- replay of a completed plan

The first three boundaries must stay `old-remote`. A completed replay must stay `fully-updated-remote`. If a retry or inspect step observes drift, the recovery result must become `blocked-recovery` with artifacts.

The durable journal is the executable proof surface for those boundaries. A
passing run must leave either:

- the old remote with a recoverable journal after an interrupted apply
- the fully updated remote with a completed journal after replay
- a blocked recovery state with both journal and remote artifacts after drift

Anything else means the atomic apply boundary lost information.

## Release rule

A partial remote mutation without a recovery artifact is a release blocker.

Retrying a completed plan must not duplicate inserts, resurrect stale local data,
or expand the journal with new mutation work. Recovery inspect must be able to
classify the persisted journal without relying on hidden in-memory state.
