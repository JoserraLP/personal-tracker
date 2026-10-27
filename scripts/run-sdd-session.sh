#!/usr/bin/env bash
# =============================================================================
# run-sdd-session.sh — Runs a headless opencode session with stall protection
# and a duration limit (issue #145, iteration 2).
#
# It replaces the old "timeout 5400 opencode run ..." from the workflow
# auto-resolve-issues.yml: if the session fails (free model tokens
# exhausted, rejected push, subagent failure...) opencode could stay alive
# and silent for up to an hour doing nothing, burning free GitHub Actions
# minutes. This script:
#
#   1. Launches opencode in background with setsid (its own process group,
#      so the child tools can also be killed with kill -9 -PID).
#   2. Streams the live log to stdout with tail -f (same behavior as
#      before: the action log shows the session live).
#   3. Watchdog BY REAL ACTIVITY (iteration 2): the stall signal is NOT the
#      size of the raw log (opencode doesn't emit subagent output in the
#      stream, so the log didn't grow while a subagent worked → false
#      positives). Instead, each iteration queries the local opencode DB
#      (dump-session-transcript.py --activity) and considers activity the
#      MAX(time_updated) of messages and parts of ALL sessions in the tree
#      (primary + subagents). The session is only killed if there is NO
#      activity in the whole tree for SESSION_STALL_LIMIT_SEC (default
#      1200 s = 20 min) or if SESSION_TOTAL_LIMIT_SEC (default 5400 s =
#      90 min) is exceeded.
#   4. If the DB is not available (3 consecutive failed probes), it enters
#      DEGRADED MODE: warns with ::warning:: and stops killing for stalls
#      (only the total limit applies) — policy chosen to eliminate false
#      positives at the root (the log-size fallback was precisely what
#      killed the session of issue #135).
#   5. LIVE STREAMING of the subagents: launches dump-session-transcript.py
#      --watch in background, which prints the nested sessions' messages to
#      stdout as they complete (issue #145, iteration 2).
#   6. Always (success or failure) dumps the full session transcript,
#      INCLUDING the subagent logs (dump mode).
#   7. On failure it writes the reason to $SESSION_FAIL_REASON (default
#      session-failure.txt) so the workflow's rollback step includes it in
#      the issue comment.
#   8. Verification of actual completion (issue #314): opencode run --auto
#      returns exit 0 when the model emits its final message, and the free
#      model sometimes emits it IN THE MIDDLE of the SDD flow (e.g. after
#      the security scan, before the publisher): exit 0 but task incomplete.
#      If the session title is "auto: issue #N" (CI automatic sessions),
#      this script checks after the exit 0 the status: * label of the
#      issue: if still in 'status: in-progress' → false success: writes the
#      reason to the failure file and returns exit 1 (the workflow treats
#      it as a session failure: wip-save + automatic relaunch, issue #226).
#      Any other status (needs-review, blocked, done, todo or none) → OK.
#      Local usage (different title) doesn't verify. Deliberately
#      fail-closed: if the state can't be read in an "auto: issue #N"
#      session, it also fails (relaunching is safe; not verifying would
#      reintroduce the false success).
#      Environment note: the session's GITHUB_TOKEN (GitHub App) has no
#      workflows permission, so GitHub rejects pushes/refs modifying
#      .github/workflows/* (verified 2026-08-20: git push and Git Data API).
#      This fix lives in scripts/ (publishable with the session token), not
#      in the workflow.
#
# Environment variables (all with defaults):
#   SESSION_STALL_LIMIT_SEC  seconds without activity (DB) before killing (1200)
#   SESSION_TOTAL_LIMIT_SEC  maximum total session duration (5400)
#   SESSION_WATCH_POLL_SEC   polling interval of the streaming (5)
#   SESSION_AGENT            opencode agent (sdd-master)
#   SESSION_MODEL            opencode model (opencode/deepseek-v4-flash-free)
#   SESSION_VARIANT          model variant (max)
#   SESSION_OUT_LOG          raw output file (opencode-session.log)
#   SESSION_FAIL_REASON      failure reason file (session-failure.txt)
#
# Usage: run-sdd-session.sh <prompt-file> <session-title>
# =============================================================================
set -euo pipefail

# Repo root: allows invoking the script from any directory (e.g. in CI the
# CWD is $GITHUB_WORKSPACE, but it can also be tested locally from /tmp).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PROMPT_FILE="${1:-}"
TITLE="${2:-}"
if [[ -z "$PROMPT_FILE" || -z "$TITLE" ]]; then
  echo "::error::Uso: run-sdd-session.sh <prompt-file> <titulo-sesion>" >&2
  exit 2
fi

STALL_LIMIT_SEC="${SESSION_STALL_LIMIT_SEC:-1200}"
TOTAL_LIMIT_SEC="${SESSION_TOTAL_LIMIT_SEC:-5400}"
WATCH_POLL_SEC="${SESSION_WATCH_POLL_SEC:-5}"
AGENT="${SESSION_AGENT:-sdd-master}"
MODEL="${SESSION_MODEL:-opencode/deepseek-v4-flash-free}"
VARIANT="${SESSION_VARIANT:-max}"
OUT="${SESSION_OUT_LOG:-opencode-session.log}"
FAIL_REASON_FILE="${SESSION_FAIL_REASON:-session-failure.txt}"

echo "=== run-sdd-session.sh: lanzando sesión '$TITLE' ==="
echo "  agente: $AGENT | modelo: $MODEL | variante: $VARIANT"
echo "  límite de estancamiento: ${STALL_LIMIT_SEC}s sin actividad (BD de opencode)"
echo "  límite total: ${TOTAL_LIMIT_SEC}s"
echo "  streaming subagentes: polling ${WATCH_POLL_SEC}s"
echo "  salida cruda: $OUT | motivo de fallo: $FAIL_REASON_FILE"
echo "==================================================================="

START_TS="$(date +%s)"
START_TS_MS="$(date +%s%N | cut -c1-13)"
rm -f "$OUT" "$FAIL_REASON_FILE"
: > "$OUT"

# Launch in its own process group (setsid): kill -9 -PID also kills the child
# tools (e.g. a bash tool running npm install).
setsid opencode run \
  --agent "$AGENT" \
  -m "$MODEL" \
  --variant "$VARIANT" \
  --auto \
  --format default \
  --title "$TITLE" \
  "$(cat "$PROMPT_FILE")" > "$OUT" 2>&1 &
PID=$!

# Stream the session log live into the action log.
tail -n +1 -f "$OUT" >&1 &
TAIL_PID=$!

# Live streaming of the subagents (best-effort): prints the nested sessions'
# messages as they complete. Ends with SIGTERM.
python3 "$ROOT/scripts/dump-session-transcript.py" --watch "$TITLE" "$START_TS_MS" "$WATCH_POLL_SEC" >&1 &
WATCH_PID=$!
# Safety net: if the script dies (e.g. because of set -e), the background
# processes are cleaned up (log tail + subagent watcher).
trap 'kill "$TAIL_PID" 2>/dev/null || true; kill "$WATCH_PID" 2>/dev/null || true' EXIT

# ---- Watchdog --------------------------------------------------------------
# Activity = MAX(time_updated) of messages/parts of ALL sessions in the tree
# (primary + subagents), via a probe to the opencode DB.
LAST_ACTIVITY_TS=0
LAST_ACTIVE="$START_TS"
LAST_HEARTBEAT="$START_TS"
DB_PROBE_FAILURES=0
DEGRADED=0
FAILURE_REASON=""

probe_activity() {
  # Activity probe. Returns (on stdout) the epoch_ms of the latest change in
  # the DB, or fails (exit 1) if the DB is unavailable. Best-effort.
  python3 "$ROOT/scripts/dump-session-transcript.py" --activity "$TITLE" "$START_TS_MS" 2>/dev/null
}

# -----------------------------------------------------------------------------
# verify_completion (issue #314): only for CI automatic sessions (title
# "auto: issue #N"). After an exit 0 from opencode, it checks that the task
# was actually completed: the issue must have left 'status: in-progress'
# (the normal SDD flow ends in needs-review via the publisher, or in
# blocked/todo if it decides to stop). If still in-progress → false success.
# Returns 0 = OK (or not applicable); 1 = false success / unverifiable
# (writes the reason to $FAIL_REASON_FILE).
# -----------------------------------------------------------------------------
verify_completion() {
  local N LABELS STATUS REASON
  # Opt-in by title: workflow sessions use "auto: issue #N"; local usage
  # carries arbitrary titles and does NOT verify.
  if [[ "$TITLE" =~ ^auto:\ issue\ #([0-9]+)$ ]]; then
    N="${BASH_REMATCH[1]}"
  else
    return 0
  fi
  if ! LABELS="$(gh issue view "$N" --json labels --jq '.labels[].name' 2>/dev/null)"; then
    REASON="no se pudo verificar el estado de la issue #$N tras la sesión (fallo de lectura; issue #314)"
    echo "$REASON" > "$FAIL_REASON_FILE"
    echo "::error::Falso éxito no verificable (issue #314): $REASON" >&2
    return 1
  fi
  STATUS=""
  if echo "$LABELS" | grep -q "^status: "; then
    STATUS="$(echo "$LABELS" | grep '^status: ' | sed 's/^status: //' | head -1)"
  fi
  if [[ "$STATUS" == "in-progress" ]]; then
    REASON="la sesión terminó con éxito aparente pero la issue #$N sigue en status: in-progress (falso éxito: el modelo emitió su mensaje final antes de completar el flujo SDD, issue #314)"
    echo "$REASON" > "$FAIL_REASON_FILE"
    echo "::error::Falso éxito detectado (issue #314): $REASON" >&2
    return 1
  fi
  echo "Verificación OK: la issue #$N quedó en status: ${STATUS:-ninguno} tras la sesión."
  return 0
}

while kill -0 "$PID" 2>/dev/null; do
  NOW="$(date +%s)"
  ELAPSED=$((NOW - START_TS))

  # Real-activity DB probe (only if not degraded).
  if [ "$DEGRADED" -eq 0 ]; then
    if ACTIVITY_TS="$(probe_activity)"; then
      DB_PROBE_FAILURES=0
      # Sanitize: digits only (a "0" is valid: no session in the DB yet).
      ACTIVITY_TS="${ACTIVITY_TS//[^0-9]/}"
      ACTIVITY_TS="${ACTIVITY_TS:-0}"
      if [ "$ACTIVITY_TS" -gt "$LAST_ACTIVITY_TS" ]; then
        LAST_ACTIVITY_TS="$ACTIVITY_TS"
        LAST_ACTIVE="$NOW"
      fi
    else
      DB_PROBE_FAILURES=$((DB_PROBE_FAILURES + 1))
      if [ "$DB_PROBE_FAILURES" -ge 3 ]; then
        DEGRADED=1
        echo "::warning::BD de opencode no disponible; modo degradado: sin kill por estancamiento (solo límite total ${TOTAL_LIMIT_SEC}s)."
      fi
    fi
  fi

  IDLE=$((NOW - LAST_ACTIVE))

  if [ "$DEGRADED" -eq 0 ] && [ "$IDLE" -ge "$STALL_LIMIT_SEC" ]; then
    echo ""
    echo "::error::Sesión estancada: sin actividad en la BD de opencode durante ${IDLE}s (límite ${STALL_LIMIT_SEC}s). Matando la sesión."
    kill -9 -"$PID" 2>/dev/null || true
    FAILURE_REASON="estancada sin actividad durante ${IDLE}s"
    break
  fi
  if [ "$ELAPSED" -ge "$TOTAL_LIMIT_SEC" ]; then
    echo ""
    echo "::error::Tiempo total agotado: ${ELAPSED}s (límite ${TOTAL_LIMIT_SEC}s). Matando la sesión."
    kill -9 -"$PID" 2>/dev/null || true
    FAILURE_REASON="tiempo total agotado (${ELAPSED}s)"
    break
  fi
  if [ $((NOW - LAST_HEARTBEAT)) -ge 120 ]; then
    LAST_HEARTBEAT="$NOW"
    if [ "$DEGRADED" -eq 1 ]; then
      echo "watchdog: sesión en curso (${ELAPSED}s transcurridos, modo degradado sin estancamiento, log: $(stat -c %s "$OUT" 2>/dev/null || echo 0) bytes)"
    else
      echo "watchdog: sesión en curso (${ELAPSED}s transcurridos, ${IDLE}s sin actividad, última actividad BD: $(date -u -d @"$((LAST_ACTIVITY_TS / 1000))" +%H:%M:%S 2>/dev/null || echo '?') UTC)"
    fi
  fi
  sleep 5
done

# Collect the exit code (with set +e so we don't abort before the dump).
set +e
wait "$PID"
CODE=$?
set -e
kill "$TAIL_PID" 2>/dev/null || true
wait "$TAIL_PID" 2>/dev/null || true
kill "$WATCH_PID" 2>/dev/null || true
wait "$WATCH_PID" 2>/dev/null || true

# ---- Transcript (always: success or failure) --------------------------------
echo ""
echo "==============================================================="
echo "=== Transcripción completa de la sesión (incluye subagentes) ==="
echo "==============================================================="
python3 "$ROOT/scripts/dump-session-transcript.py" "$TITLE" "$START_TS_MS" || \
  echo "(aviso: no se pudo volcar la transcripción; ver opencode-session.log)" >&2

# ---- Outcome -----------------------------------------------------------------
if [ -n "$FAILURE_REASON" ]; then
  echo "$FAILURE_REASON" > "$FAIL_REASON_FILE"
  echo "::error::FALLO de la sesión automática: $FAILURE_REASON."
  exit 1
fi
if [ "$CODE" -ne 0 ]; then
  REASON="opencode terminó con exit code $CODE"
  echo "$REASON" > "$FAIL_REASON_FILE"
  echo ""
  echo "=== Últimas 80 líneas de la salida cruda de la sesión ==="
  tail -n 80 "$OUT" || true
  echo "::error::FALLO de la sesión automática: $REASON."
  exit 1
fi

# Verification of actual completion (issue #314): opencode may end with
# exit 0 in the middle of the SDD flow (false success). If the issue is
# still in 'status: in-progress', it is treated as a failure (writes to
# $FAIL_REASON_FILE and exit 1 → the workflow triggers the failure machinery:
# wip-save + relaunch).
if ! verify_completion; then
  echo "::error::FALLO de la sesión automática: $(cat "$FAIL_REASON_FILE")"
  exit 1
fi

echo ""
echo "run-sdd-session.sh: sesión completada con éxito (exit 0)."
exit 0
