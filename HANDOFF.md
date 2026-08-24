# Reproduction and reviewer handoff

The repository is both a review package and a runnable Harbor sample. The
commands below assume macOS or Linux, Docker, Python 3.11+, and a clean clone.

## Recorded runtime

| Component | Recorded value |
| --- | --- |
| Orchestrator | Harbor 0.18.0 |
| Agent | mini-SWE-agent 2.4.5 |
| Muse route | `openrouter/meta/muse-spark-1.2` |
| Opus route | `bedrock/us.anthropic.claude-opus-5` |
| Reasoning setting | high |
| Attempts | 8 per model per task |

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
- `OPENROUTER_API_KEY` is needed for Muse.
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

The expected result is three oracle rewards of `1.0` and three no-op rewards of
`0.0`, with no exceptions. The publication records for the normalized task
digests are in
[`sample-run/manifests/public-controls-validation.json`](sample-run/manifests/public-controls-validation.json).

## 3. Launch the repeated cohort

```sh
set -a
. ./.env
set +a
PYTHONPATH="$PWD" harbor run --config harness/cohort.json --yes
```

The config fixes the tasks, routes, versions, reasoning setting, attempt count,
and concurrency. Muse is capped at three concurrent trials to accommodate
provider rate limits. Provider or infrastructure failures should be retained
as unscored evidence and refilled; they must not be converted to model
failures.

## 4. Build indexes and freeze evidence

Point the indexer at one or more Harbor job directories:

```sh
python3 harness/summarize_cohort.py sample-run/raw/<job-dir> [sample-run/raw/<job-dir> ...]
python3 harness/freeze_manifest.py
```

A trial is admitted only when the agent phase started, the verifier produced a
numeric reward, no pre-agent Harbor exception occurred, and its trajectory and
verifier artifacts are present. Raw solves and pass@k stay separate.

## 5. Final QC

```sh
python3 harness/redact_artifacts.py --check
python3 harness/validate_publication.py
git status --short
```

The publication validator checks task headings and digests, the six 8-attempt
cells, all 48 evidence paths, result/reward agreement, controls, local Markdown
links, selected JSON documents, and privacy patterns.

## Recorded-evidence boundary

The public artifacts preserve the recorded model behavior and scores, but a
new run may differ because providers, inference systems, and model aliases can
change. The stored Task 5 Opus cell is an explicitly retained eight-trial slice
from 24 measured attempts (23/24 overall), not a fresh estimate. See the
[analysis](sample-run/analysis.md#evidence-boundary) before drawing broader
conclusions.
