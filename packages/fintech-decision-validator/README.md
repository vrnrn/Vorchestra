# Fintech decision validator

This package is the deterministic, proposal-only boundary for the v0.4 fintech
reference workflow. It validates one decision candidate against exactly six
named source reports, independently hashes each report's canonical JSON, checks
freshness and provenance, and atomically writes the candidate only after every
check passes.

It does not connect to a broker, stage an order, submit an order, or interpret a
validated proposal as execution authority.

## Evidence bundle CLI

`vorchestra-fintech-report-bundle` is the deterministic bridge between six raw
research artifacts and the Chief Decision Agent. It reads one JSON object from
stdin with `reports` and `policy` fields. Both maps must contain exactly the six
required report names. A policy entry gives the durable source name and selects
the report timestamp field:

```json
{
  "reports": {
    "reddit": { "asOf": "2026-07-16T20:00:00.000Z", "items": [] },
    "x": { "asOf": "2026-07-16T20:00:00.000Z", "items": [] },
    "perplexity_finance": {
      "asOf": "2026-07-16T20:00:00.000Z",
      "items": []
    },
    "tradingview_a": {
      "observed_at": "2026-07-16T20:00:00.000Z",
      "symbol": "NVDA"
    },
    "tradingview_b": {
      "observed_at": "2026-07-16T20:00:00.000Z",
      "symbol": "SPX"
    },
    "tradingview_c": {
      "observed_at": "2026-07-16T20:00:00.000Z",
      "symbol": "BTCUSD"
    }
  },
  "policy": {
    "reddit": { "source": "reddit-research", "observed_at_field": "asOf" },
    "x": { "source": "x-research", "observed_at_field": "asOf" },
    "perplexity_finance": {
      "source": "perplexity-finance",
      "observed_at_field": "asOf"
    },
    "tradingview_a": {
      "source": "tradingview-nvda",
      "observed_at_field": "observed_at"
    },
    "tradingview_b": {
      "source": "tradingview-spx",
      "observed_at_field": "observed_at"
    },
    "tradingview_c": {
      "source": "tradingview-btcusd",
      "observed_at_field": "observed_at"
    }
  }
}
```

```sh
vorchestra-fintech-report-bundle < raw-reports-and-policy.json > evidence-bundle.json
```

It emits only canonical JSON shaped as `{ "reports": { ... } }`. Each wrapped
report contains the configured `source`, extracted `observed_at`, independently
computed `report_hash`, and unchanged raw `report`. Chief copies those exact
three provenance fields into `candidate.source_reports`; the validator then
recomputes and verifies them.

## Decision validator CLI

The CLI reads one JSON envelope from stdin. The envelope has exactly two fields:
`candidate` and `reports`. The reports object must contain `reddit`, `x`,
`perplexity_finance`, `tradingview_a`, `tradingview_b`, and `tradingview_c`.
Each named report contains:

```json
{
  "source": "bounded-reddit-research",
  "observed_at": "2026-07-16T20:00:00.000Z",
  "report_hash": "<sha256 of canonical JSON in report>",
  "report": { "symbols": ["NVDA"] }
}
```

For direct generic-workflow wiring, the validator also accepts the exact shape
`{ "candidate": ..., "report_bundle": { "reports": ... } }` emitted by the
evidence-bundle block. These are the only two accepted envelope shapes;
`report_bundle` cannot contain additional fields.

The candidate's `source_reports` map repeats the exact `source`, `observed_at`,
and `report_hash` for every named report. Hashes may be 64 lowercase or
uppercase hexadecimal characters and may use a `sha256:` prefix.

```sh
vorchestra-fintech-decision-validator \
  --output ./signals-and-orders.json \
  --allowed-symbol NVDA \
  --allowed-symbol SPX \
  --max-age-ms 900000 < decision-envelope.json
```

On success, the CLI atomically replaces the output through a temporary file in
the same directory and prints the canonical candidate JSON to stdout. On
failure, it writes a canonical `{code, reason, nextAction}` object to stderr,
exits non-zero, and never writes the destination.

## API

Use `buildReportBundle(input)` to produce the evidence bundle,
`hashReport(report)` to compute report hashes,
`validateDecisionEnvelope(envelope, policy)` for validation without I/O, or
`validateAndWriteDecision(envelope, options)` for validated atomic output. Tests
can inject `now` in the policy to make freshness checks hermetic.

The validator preserves `conflicts` and `missing_or_stale_sources` exactly as
the candidate supplied them. It rejects missing or extra reports, malformed
schemas, non-finite or negative numbers, unknown symbols, stale or future data,
hash/provenance mismatches, and any status or authority outside the explicit
`proposal_only` / `none` / `paper` boundary.
