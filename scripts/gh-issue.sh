#!/usr/bin/env bash
# =============================================================================
# gh-issue.sh — Integration of GitHub Issues with the SDD workflow.
#
# AI agents use this helper to:
#   - Query issues (todo, completed, by type, in review...).
#   - Get the detail of an issue to build the local task.
#   - Sync the issue labels with the SDD task state
#     (status: todo, status: in-progress, status: needs-review, status:
#     blocked, status: done).
#   - Fix the type label if it is misclassified
#     (type: feature|bug|style|refactor|content).
#
# Business rule: the agent MUST only tackle issues with the "ai" label
# (usually with state "status: todo"). Issues without that label are
# user issues.
#
# Usage:
#   scripts/gh-issue.sh list [--all|--todo|--review|--blocked|--done|--type <type>]
#   scripts/gh-issue.sh show <NUMBER>
#   scripts/gh-issue.sh set-state <NUMBER> "status: <todo|in-progress|needs-review|blocked|done>"
#   scripts/gh-issue.sh set-type <NUMBER> <feature|bug|style|refactor|content>
#   scripts/gh-issue.sh help
#   - set-state automatically clears the residual "ai-*" labels of the old
#     scheme (via API). The "ai" label (agent issue marker) is never added nor
#     removed from this script.
#   - The transition to "status: done" (and issue close) is applied by the
#     workflow .github/workflows/issues-done-on-dev.yml when merging the PR into
#     dev; this script remains a manual fallback path.
# =============================================================================
set -euo pipefail

# Whitelists (other labels are untouched). NOTE: the values have a space →
# always quote ("$label", "${STATUS_STATES[@]}").
STATUS_STATES=("status: todo" "status: in-progress" "status: needs-review" "status: blocked" "status: done")
TYPES=("feature" "bug" "style" "refactor" "content")

REPO="${GH_REPO:-}" # If empty, gh uses the repo of the current directory.

# -----------------------------------------------------------------------------
# Utilities
# -----------------------------------------------------------------------------
usage() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

in_list() {
  local needle="$1"
  shift
  for item in "$@"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

# Comma-list with ALL elements except the one about to be added.
# IMPORTANT: gh 2.45 processes remove-label before add-label; if the target
# label is also in the removal list, it removes it and does NOT re-add it.
# That's why the target label is excluded from the removal list.
excluding() {
  local target="$1"
  shift
  local out=()
  for item in "$@"; do
    if [[ "$item" != "$target" ]]; then
      out+=("$item")
    fi
  done
  local IFS=,
  echo "${out[*]}"
}

# gh wrapper with --repo if defined
gh_() {
  if [[ -n "$REPO" ]]; then
    gh --repo "$REPO" "$@"
  else
    gh "$@"
  fi
}

# -----------------------------------------------------------------------------
# list — issue query
# -----------------------------------------------------------------------------
cmd_list() {
  local filter="${1:-ai}" # default: open issues with the ai label
  local state="open"
  local label_filter=""
  local python_filter=""

  case "$filter" in
    ai|--ai)
      python_filter="ai"
      ;;
    --all)
      python_filter="all"
      ;;
    --todo)
      label_filter="status: todo"
      python_filter="ai"
      ;;
    --review)
      label_filter="status: needs-review"
      python_filter="ai"
      ;;
    --blocked)
      label_filter="status: blocked"
      python_filter="ai"
      ;;
    --done)
      state="all"
      label_filter="status: done"
      python_filter="ai"
      ;;
    --type)
      local t="${2:-}"
      if ! in_list "$t" "${TYPES[@]}"; then
        echo "ERROR: tipo inválido '$t'. Válidos: ${TYPES[*]}" >&2
        exit 2
      fi
      label_filter="type: $t"
      ;;
    *)
      echo "ERROR: filtro desconocido '$filter'. Usa --all, --todo, --review, --blocked, --done o --type <tipo>." >&2
      exit 2
      ;;
  esac

  local json
  json="$(gh_ issue list --state "$state" --limit 100 --json number,title,labels,state 2>/dev/null)" || {
    echo "ERROR: no se pudo listar issues. ¿Está 'gh' autenticado (gh auth status)?" >&2
    exit 1
  }

  python3 - "$json" "$python_filter" "$label_filter" <<'PYEOF'
import json, sys

data = json.loads(sys.argv[1])
python_filter = sys.argv[2]
label_filter = sys.argv[3]

def ai_status(labels):
    for l in labels:
        if l["name"].startswith("status: "):
            return l["name"][len("status: "):]
    return None

def type_label(labels):
    for l in labels:
        if l["name"].startswith("type: "):
            return l["name"][6:]
    return "-"

rows = []
counts = {"ai": 0, "user": 0}
for issue in data:
    names = [l["name"] for l in issue["labels"]]
    if label_filter and label_filter not in names:
        continue
    if python_filter == "ai" and "ai" not in names:
        continue
    st = ai_status(issue["labels"]) or "-"
    ty = type_label(issue["labels"])
    agent = "ai" in names
    user = not agent
    if agent:
        counts["ai"] += 1
    else:
        counts["user"] += 1
    flag = "AGENTE" if agent else "USUARIO"
    state_marker = "" if str(issue["state"]).lower() == "open" else " [CERRADA]"
    rows.append(f"#{issue['number']:<4} [{ty:<8}] {issue['title']}  (estado: {st})  {flag}{state_marker}")

if rows:
    for r in sorted(rows, key=lambda x: int(x.split(']')[0].lstrip('#').split()[0])):
        print(r)
else:
    print("(sin resultados para el filtro actual)")

print(f"\nResumen: {counts['ai']} para agente, {counts['user']} de usuario.")
PYEOF
}

# -----------------------------------------------------------------------------
# show — detail of an issue
# -----------------------------------------------------------------------------
cmd_show() {
  local n="${1:-}"
  [[ "$n" =~ ^[0-9]+$ ]] || { echo "ERROR: número de issue inválido: '$n'" >&2; exit 2; }
  local json
  json="$(gh_ issue view "$n" --json number,title,body,state,url,labels,comments 2>/dev/null)" || {
    echo "ERROR: no se pudo leer la issue #$n." >&2
    exit 1
  }
  python3 - "$json" <<'PYEOF'
import json, sys

issue = json.loads(sys.argv[1])
labels = [l["name"] for l in issue["labels"]]
agent = [l for l in labels if l == "ai"]
st = [l for l in labels if l.startswith("status: ")]
residual = [l for l in labels if l.startswith("ai-")]
ty = [l for l in labels if l.startswith("type: ")]
other = [l for l in labels if l not in agent and not l.startswith("status: ") and not l.startswith("ai-") and not l.startswith("type: ")]

print(f"# {issue['number']} — {issue['title']}")
print(f"Estado: {issue['state'].lower()} | URL: {issue['url']}")
print(f"Label agente: {agent if agent else '(ninguna)'}")
print(f"Estado: {st if st else '(sin estado)'}")
print(f"Residuales ai-*: {residual if residual else '(ninguna)'}")
print(f"Tipo: {ty if ty else '(sin tipo)'}")
print(f"Otras labels: {other if other else '(ninguna)'}")
print("---")
print(issue.get("body") or "(sin descripción)")
if issue.get("comments"):
    print("--- COMENTARIOS ---")
    for c in issue["comments"]:
        print(f"[{c['author']['login']}]: {c['body']}")
PYEOF
}

# -----------------------------------------------------------------------------
# set-state — sets exactly one status: * label
# -----------------------------------------------------------------------------
cmd_set_state() {
  local n="${1:-}"
  local label="${2:-}"
  [[ "$n" =~ ^[0-9]+$ ]] || { echo "ERROR: número de issue inválido: '$n'" >&2; exit 2; }
  if ! in_list "$label" "${STATUS_STATES[@]}"; then
    echo "ERROR: estado inválido '$label'. Válidos: status: todo|in-progress|needs-review|blocked|done" >&2
    exit 2
  fi
  local is_pr
  is_pr="$(gh_ api "repos/{owner}/{repo}/issues/$n" --jq '.pull_request != null' 2>/dev/null)" || {
    echo "ERROR: no se pudo leer la issue #$n." >&2
    exit 1
  }
  if [[ "$is_pr" == "true" ]]; then
    echo "ERROR: #$n es un Pull Request, no una issue. No se modifican sus labels." >&2
    exit 2
  fi
  local state
  state="$(gh_ issue view "$n" --json state --jq .state 2>/dev/null)" || {
    echo "ERROR: no se pudo leer la issue #$n." >&2
    exit 1
  }
  state="${state,,}"   # normalize to lowercase (issue #145)
  if [[ "$state" == "closed" ]]; then
    if [[ "$label" == "status: done" ]]; then
      echo "OK: issue #$n CERRADA → aplicando estado terminal 'status: done'."
    else
      echo "AVISO: la issue #$n está CERRADA; solo se permite la transición a 'status: done'." >&2
      exit 3
    fi
  fi
  # Issue's current labels (names only; note: '.labels[].name').
  local current
  current="$(gh_ issue view "$n" --json labels --jq '.labels[].name' 2>/dev/null)" || {
    echo "ERROR: no se pudo leer las labels de la issue #$n." >&2
    exit 1
  }
  # The target label is never removed (gh 2.45 processes remove-label before
  # add-label; by excluding it by construction, the transition is idempotent).
  local remove_status=() remove_residual=() l
  while IFS= read -r l; do
    [[ -z "$l" ]] && continue
    [[ "$l" == "$label" ]] && continue
    if [[ "$l" == "status: "* ]]; then
      remove_status+=("$l")
    elif [[ "$l" == "ai-"* ]]; then
      # Residuals of the old scheme (labels with the "ai-" prefix). The exact
      # label "ai" does NOT start with "ai-" → never touched (intentional).
      remove_residual+=("$l")
    fi
  done <<< "$current"
  # Removal of other status: * in a single batch (labels existing in the repo).
  if [[ "${#remove_status[@]}" -gt 0 ]]; then
    local remove_list
    remove_list="$(IFS=,; echo "${remove_status[*]}")"
    gh_ issue edit "$n" --remove-label "$remove_list" >/dev/null
  fi
  # ai-* residuals via API (gh 2.45 fails with --remove-label if the label no
  # longer exists in the repo; DELETE API tolerates/no-ops). The ai-* names have
  # no spaces → no URL-encoding. The || true is needed because of set -e.
  for l in "${remove_residual[@]}"; do
    gh_ api -X DELETE "repos/{owner}/{repo}/issues/$n/labels/$l" >/dev/null 2>&1 || true
  done
  # Add of the target label (no-op if already present: idempotent).
  gh_ issue edit "$n" --add-label "$label" >/dev/null
  echo "OK: issue #$n → label '$label'"
}

# -----------------------------------------------------------------------------
# set-type — sets exactly one type label
# -----------------------------------------------------------------------------
cmd_set_type() {
  local n="${1:-}"
  local t="${2:-}"
  [[ "$n" =~ ^[0-9]+$ ]] || { echo "ERROR: número de issue inválido: '$n'" >&2; exit 2; }
  if ! in_list "$t" "${TYPES[@]}"; then
    echo "ERROR: tipo inválido '$t'. Válidos: ${TYPES[*]}" >&2
    exit 2
  fi
  local is_pr
  is_pr="$(gh_ api "repos/{owner}/{repo}/issues/$n" --jq '.pull_request != null' 2>/dev/null)" || {
    echo "ERROR: no se pudo leer la issue #$n." >&2
    exit 1
  }
  if [[ "$is_pr" == "true" ]]; then
    echo "ERROR: #$n es un Pull Request, no una issue. No se modifican sus labels." >&2
    exit 2
  fi
  local state
  state="$(gh_ issue view "$n" --json state --jq .state 2>/dev/null)" || {
    echo "ERROR: no se pudo leer la issue #$n." >&2
    exit 1
  }
  state="${state,,}"   # normalize to lowercase (issue #145)
  if [[ "$state" == "closed" ]]; then
    echo "AVISO: la issue #$n está CERRADA; no se modifican sus labels." >&2
    exit 3
  fi
  local remove
  remove="$(excluding "type: $t" "${TYPES[@]/#/type: }")"
  gh_ issue edit "$n" --remove-label "$remove" --add-label "type: $t" >/dev/null
  echo "OK: issue #$n → tipo 'type: $t'"
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
cmd="${1:-help}"
case "$cmd" in
  list)      shift; cmd_list "$@" ;;
  show)      shift; cmd_show "${1:-}" ;;
  set-state) shift; cmd_set_state "${1:-}" "${2:-}" ;;
  set-type)  shift; cmd_set_type "${1:-}" "${2:-}" ;;
  help|-h|--help) usage ;;
  *) echo "ERROR: subcomando desconocido '$cmd'"; usage ;;
esac
