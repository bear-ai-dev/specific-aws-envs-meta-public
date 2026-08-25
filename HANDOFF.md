# Reproduction and reviewer handoff

The repository is both a review package and a runnable Harbor sample. The
commands below assume macOS or Linux, Docker, Python 3.11+, `uv`, and a clean
clone.

## Recorded runtime

| Component | Tasks 2, 4, 5 | Task 14 |
| --- | --- | --- |
| Orchestrator | Harbor 0.18.0 | Harbor 0.18.0 |
| Agent | mini-SWE-agent 2.4.5 | mini-SWE-agent 2.4.5 |
| Muse route | `openrouter/meta/muse-spark-1.2` | `meta/responses/muse-spark-1.2` |
| Opus route | `bedrock/us.anthropic.claude-opus-5` | `bedrock/us.anthropic.claude-opus-5` |
| Reasoning setting | high | high |
| Attempts | 8 per model per task | 8 per model |

The stored evidence was produced in managed AWS sandboxes. The included
reproduction config uses Daytona so a reviewer can launch the same public task
packages without access to that internal runner.

## 1. Install and configure

Install Harbor 0.18.0 and copy the environment template:

```sh
uv tool install 'harbor==0.18.0'
cp .env.example .env
```

Fill only the credentials required for the run. Never commit `.env`.

- `DAYTONA_API_KEY` provisions isolated task sandboxes.
- `OPENROUTER_API_KEY` is needed for the original Muse cohort.
- `META_API_KEY` is needed for the direct Meta Responses route on Task 14.
- The AWS variables authenticate the Opus Bedrock route.

The task images provide separate fake credentials and a loopback
`AWS_ENDPOINT_URL` for their local AWS-compatible services. The adapter checks
that endpoint before the first model request. Bedrock provider credentials are
placed in a separate named profile; they do not replace the task credentials.

## 2. Run deterministic controls

Docker controls need no model-provider credentials:

```sh
harbor run --config harness/controls.json --yes
```

The expected result is four oracle rewards of `1.0` and four no-op rewards of
`0.0`, with no exceptions. The recorded publication controls and normalized
task digests are in
[`sample-run/manifests/public-controls-validation.json`](sample-run/manifests/public-controls-validation.json).
Task 14's recorded control comes from a byte-identical executable task tree;
the current package differs only in README documentation.

## 3. Launch the repeated cohort

```sh
set -a
. ./.env
set +a
PYTHONPATH="$PWD" harbor run --config harness/cohort.json --yes
PYTHONPATH="$PWD" harbor run --config harness/task14-cohort.json --yes
```

The two configs fix their tasks, routes, versions, reasoning setting, attempt
count, and concurrency. The original Muse cohort is capped at three concurrent
trials; the Task 14 reproduction runs up to eight trials per model. Provider or
infrastructure failures should be preserved as unscored evidence and refilled;
they must not be converted to model failures.

## 4. Build indexes and freeze evidence

Point the indexer at one or more Harbor job directories:

```sh
python3 harness/summarize_cohort.py
python3 harness/freeze_manifest.py
python3 harness/export_trial_metrics.py
```

A trial is admitted only when the agent phase started, the verifier produced a
numeric reward, no Harbor exception occurred, and its native trajectory, ATIF
trajectory, verifier report, and reward are present. Raw solves and pass@k stay
separate.

## 5. Final QC

```sh
python3 harness/redact_artifacts.py --check
python3 harness/export_trial_metrics.py --check
python3 harness/validate_publication.py
git status --short
```

The publication validator checks task headings and digests, the eight 8-attempt
cells, all 64 evidence paths, result/reward agreement, reproducible metrics,
controls, local Markdown links, selected JSON documents, and privacy patterns.

## Recorded-evidence boundary

The public artifacts preserve the recorded model behavior and scores, but a
new run may differ because providers, inference systems, and model aliases can
change. The eight displayed Task 5 Opus trials are a documented subset of 24
measured attempts (23/24 overall), not a fresh estimate. See the
[analysis](sample-run/analysis.md#evidence-boundary) before drawing broader
conclusions.
