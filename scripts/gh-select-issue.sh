#!/usr/bin/env bash
# =============================================================================
# gh-select-issue.sh — Automatic selection of the issue to solve (issue #81).
#
# Used by the workflow .github/workflows/auto-resolve-issues.yml: given the
# GitHub Issues backlog, it picks the issue the automatic OpenCode session
# must solve, applying the criteria of issue #81:
#
#   1. Only issues with the "ai" label (agent issue marker).
#   2. By default only issues in "status: todo" (--all-states for debug).
#      Issues with "status: needs-info" or "status: blocked" are NEVER chosen
#      even if they carry the "ai" label.
#   3. Dependencies: if the body mentions "depende de #N" / "bloqueada por #N"
#      ("depends on #N" / "blocked by #N" or equivalents), the issue is only
#      eligible if ALL dependencies are resolved (closed or labeled
#      "status: done").
#   4. Ranking (lower = better):
#      - Priority: very high > high > medium > low > very low (no label →
#        last).
#      - Priority tie → type: bug > question > style > content >
#        refactor > feature (no label → last).
#      - Tie → oldest first (created_at; tiebreak by number).
#
# Usage:
#   scripts/gh-select-issue.sh                → JSON of the chosen one or "NONE"
#   scripts/gh-select-issue.sh --dry-run      → full ranking with reasons
#   scripts/gh-select-issue.sh --issue <N>    → forces issue N (exit 2 if it
#                                               is not eligible)
#   scripts/gh-select-issue.sh --all-states   → includes in-progress/needs-review
#
# Output:
#   - One-line JSON: {"number":N,"title":...,"body":...,"labels":[...],
#     "comments":[...]} (comments only for the chosen one) or the string "NONE".
#   - Exit codes: 0 selection/NONE, 1 API error, 2 invalid usage or forced
#     issue not eligible.
#   - NEVER prints tokens: consumes GH_TOKEN from the environment without echo.
# =============================================================================
set -euo pipefail

REPO="${GH_REPO:-}" # If empty, gh uses the repo of the current directory.

# -----------------------------------------------------------------------------
# Utilities
# -----------------------------------------------------------------------------
usage() {
  sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

gh_() {
  if [[ -n "$REPO" ]]; then
    gh --repo "$REPO" "$@"
  else
    gh "$@"
  fi
}

DRY_RUN=0
FORCED_ISSUE=""
ALL_STATES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)     DRY_RUN=1; shift ;;
    --issue)       FORCED_ISSUE="${2:-}"; shift 2 ;;
    --all-states)  ALL_STATES=1; shift ;;
    -h|--help)     usage ;;
    *) echo "ERROR: argumento desconocido '$1'" >&2; usage ;;
  esac
done

if [[ -n "$FORCED_ISSUE" && ! "$FORCED_ISSUE" =~ ^[0-9]+$ ]]; then
  echo "ERROR: número de issue inválido: '$FORCED_ISSUE'" >&2
  exit 2
fi

# -----------------------------------------------------------------------------
# Loading and filtering in python3 (all the business logic)
# -----------------------------------------------------------------------------
python3 - "$REPO" "$DRY_RUN" "$FORCED_ISSUE" "$ALL_STATES" <<'PYEOF'
import json, re, subprocess, sys

repo = sys.argv[1]
dry_run = sys.argv[2] == "1"
forced = sys.argv[3] or None
all_states = sys.argv[4] == "1"

def gh(args, as_json=True):
    cmd = ["gh", "--repo", repo] if repo else ["gh"]
    cmd += args
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args)} falló: {out.stderr.strip()}")
    if as_json:
        return json.loads(out.stdout)
    return out.stdout.strip()

# 1. Listing of open issues with labels.
issues = gh(["issue", "list", "--state", "open", "--limit", "100",
             "--json", "number,title,body,createdAt,labels,url"])

PRIORITY = {"priority: very high": 0, "priority: high": 1, "priority: medium": 2,
            "priority: low": 3, "priority: very low": 4}
TYPE_ORDER = {"type: bug": 0, "type: question": 1, "type: style": 2,
              "type: content": 3, "type: refactor": 4, "type: feature": 5}

# Dependency regex over the body (case-insensitive). Conservative: if the
# pattern appears in prose it is interpreted as a dependency (fail-safe: exclude).
DEP_RE = re.compile(
    r"(?:depende de|bloqueada por|depends? on|blocked by)\s+#(\d+)",
    re.IGNORECASE,
)

def labels_of(issue):
    return {l["name"] for l in (issue.get("labels") or [])}

def status_of(labels):
    for l in sorted(labels):
        if l.startswith("status: "):
            return l[len("status: "):]
    return None

def type_of(labels):
    for l in labels:
        if l in TYPE_ORDER:
            return l
    return None

def priority_of(labels):
    for l in labels:
        if l in PRIORITY:
            return l
    return None

def dep_resolved(num):
    """Is dependence #num resolved? (closed or status: done)."""
    try:
        d = gh(["issue", "view", str(num), "--json", "state,labels"])
    except RuntimeError:
        return False  # The issue doesn't exist → can't be verified → not resolved.
    labels = {l["name"] for l in (d.get("labels") or [])}
    return (d.get("state") or "").lower() == "closed" or "status: done" in labels

def excluded_reason(issue):
    """Devuelve motivo de exclusión o None si es elegible."""
    labels = labels_of(issue)
    if "ai" not in labels:
        return "sin label 'ai'"
    st = status_of(labels)
    if st in ("needs-info", "blocked"):
        return f"estado prohibido 'status: {st}'"
    # With --issue any state may be forced (debug); the rest of the criteria
    # are still validated. Without --issue, only "status: todo" by default.
    if not forced and not all_states and st != "todo":
        return f"no está en 'status: todo' (está: {st})"
    body = issue.get("body") or ""
    deps = [int(m) for m in DEP_RE.findall(body)]
    if deps:
        unresolved = [n for n in deps if not dep_resolved(n)]
        if unresolved:
            return f"dependencia(s) sin resolver: #{', #'.join(str(n) for n in unresolved)}"
    return None

def rank_key(issue):
    labels = labels_of(issue)
    p = PRIORITY.get(priority_of(labels), 5)
    t = TYPE_ORDER.get(type_of(labels), 6)
    return (p, t, issue.get("createdAt") or "", issue["number"])

# 2. Filtering.
candidates = []
for issue in issues:
    if issue.get("pull_request"):
        continue  # Anti-PR safeguard.
    reason = excluded_reason(issue)
    if dry_run:
        label_names = sorted(labels_of(issue))
        status_mark = status_of(label_names) or "-"
        if reason:
            print(f"  EXCLUIDA  #{issue['number']:<4} [{status_mark}] {issue['title']}  → {reason}")
        else:
            candidates.append(issue)
    elif reason is None:
        candidates.append(issue)

# 3. Forced issue.
if forced:
    try:
        forced_issue = gh(["issue", "view", forced, "--json",
                           "number,title,body,createdAt,labels,url"])
    except RuntimeError:
        sys.stderr.write(f"ERROR: no se pudo leer la issue #{forced}.\n")
        sys.exit(1)
    if forced_issue.get("pull_request"):
        sys.stderr.write(f"ERROR: #{forced} es un Pull Request, no una issue.\n")
        sys.exit(2)
    reason = excluded_reason(forced_issue)
    if reason:
        sys.stderr.write(f"ERROR: la issue #{forced} no es elegible: {reason}\n")
        sys.exit(2)
    candidates = [forced_issue]

# 4. Sorting.
candidates.sort(key=rank_key)

if dry_run:
    for issue in candidates:
        label_names = sorted(labels_of(issue))
        p = PRIORITY.get(priority_of(label_names), 5)
        t = TYPE_ORDER.get(type_of(label_names), 6)
        print(f"  ELEGIBLE  #{issue['number']:<4} [{status_of(label_names) or '-'}] "
              f"(prio {p}, tipo {t}, creada {issue.get('createdAt') or '-'}) {issue['title']}")
    print("\n(Sin issues elegibles)" if not candidates else
          f"\nElegida: #{candidates[0]['number']} — {candidates[0]['title']}")
    sys.exit(0)

if not candidates:
    print("NONE")
    sys.exit(0)

# 5. The chosen one: attach comments and emit one-line JSON.
chosen = candidates[0]
try:
    detail = gh(["issue", "view", str(chosen["number"]), "--json",
                 "number,title,body,createdAt,labels,url,comments"])
except RuntimeError:
    sys.stderr.write(f"ERROR: no se pudo leer los comentarios de la issue #{chosen['number']}.\n")
    sys.exit(1)

out = {
    "number": chosen["number"],
    "title": chosen["title"],
    "body": chosen.get("body") or "",
    "labels": sorted(labels_of(chosen)),
    "createdAt": chosen.get("createdAt") or "",
    "url": chosen.get("url") or "",
    "comments": [
        {"author": c.get("author", {}).get("login", "?"),
         "createdAt": c.get("createdAt", ""),
         "body": c.get("body", "")}
        for c in (detail.get("comments") or [])
    ],
}
print(json.dumps(out, ensure_ascii=False))
sys.exit(0)
PYEOF
