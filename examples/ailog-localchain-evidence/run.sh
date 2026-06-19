#!/usr/bin/env bash
set -euo pipefail

# AILog -> LocalChain -> Evidence proof-bundle example.
# Run from the evidence repo root:
#   ./examples/ailog-localchain-evidence/run.sh

ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
EXAMPLE_DIR="$ROOT_DIR/examples/ailog-localchain-evidence"
OUT_DIR=${OUT_DIR:-"$EXAMPLE_DIR/out"}

AILOG_REPO=${AILOG_REPO:-"$(cd "$ROOT_DIR/.." && pwd)/ailog"}
LOCAL_CHAIN_REPO=${LOCAL_CHAIN_REPO:-"$(cd "$ROOT_DIR/.." && pwd)/local-chain"}

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }
}

need node
need python
need curl

if [ ! -f "$AILOG_REPO/ailog/cli.py" ]; then
  echo "AILOG_REPO not found or invalid: $AILOG_REPO" >&2
  echo "Set AILOG_REPO=/path/to/ailog" >&2
  exit 1
fi

if [ ! -f "$LOCAL_CHAIN_REPO/packages/server/index.js" ]; then
  echo "LOCAL_CHAIN_REPO not found or invalid: $LOCAL_CHAIN_REPO" >&2
  echo "Set LOCAL_CHAIN_REPO=/path/to/local-chain" >&2
  exit 1
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

PORT=$(python - <<'PY'
import socket
s = socket.socket()
s.bind(('127.0.0.1', 0))
print(s.getsockname()[1])
s.close()
PY
)

cleanup() {
  if [ -n "${LOCALCHAIN_PID:-}" ]; then
    kill "$LOCALCHAIN_PID" >/dev/null 2>&1 || true
    wait "$LOCALCHAIN_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

cat > "$OUT_DIR/bootstrap-localchain.js" <<EOF
const { createServer } = require('$LOCAL_CHAIN_REPO/packages/server')
createServer('$OUT_DIR/localchain', { port: $PORT }).listen()
EOF

node "$OUT_DIR/bootstrap-localchain.js" > "$OUT_DIR/localchain.log" 2>&1 &
LOCALCHAIN_PID=$!
echo "$LOCALCHAIN_PID" > "$OUT_DIR/localchain.pid"

# Wait for server.
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
curl -fsS "http://127.0.0.1:$PORT/api/health" > "$OUT_DIR/localchain-health.json"

echo "[1/6] Create sample .ailog"
PYTHONPATH="$AILOG_REPO" python - "$OUT_DIR" <<'PY'
from pathlib import Path
import sys
from ailog.core.models import (
    AILogFile,
    AILogFileMetadata,
    Interaction,
    Message,
    Role,
    ContentType,
)

out = Path(sys.argv[1])
ailog = AILogFile(
    ailog_version='0.1',
    metadata=AILogFileMetadata(
        source_platform='example',
        export_timestamp='2026-06-18T00:00:00Z',
        exporter='evidence/examples/ailog-localchain-evidence',
        tags=['example', 'proof-bundle'],
    ),
    interactions=[
        Interaction(
            id='example-1',
            timestamp='2026-06-18T00:00:01Z',
            session_id='example-session',
            turn_index=0,
            messages=[
                Message(role=Role.USER, content_type=ContentType.TEXT, content='Please anchor this example interaction.'),
                Message(role=Role.ASSISTANT, content_type=ContentType.TEXT, content='Anchoring creates a tamper-evident record.'),
            ],
            custom={'example': 'ailog-localchain-evidence'},
        )
    ],
)
(out / 'sample.ailog').write_text(ailog.to_json(), encoding='utf-8')
PY

echo "[2/6] Anchor with AILog -> LocalChain"
PYTHONPATH="$AILOG_REPO" python -m ailog.cli anchor "$OUT_DIR/sample.ailog" \
  --server "http://127.0.0.1:$PORT" \
  --json > "$OUT_DIR/anchor-result.json"

echo "[3/6] Export artifact, anchor, and LocalChain proof"
PYTHONPATH="$AILOG_REPO" python -m ailog.cli export-anchor-artifact "$OUT_DIR/sample.ailog" \
  --interaction example-1 \
  --artifact-out "$OUT_DIR/artifact.json" \
  --anchor-out "$OUT_DIR/anchor.json" \
  > "$OUT_DIR/export-anchor-artifact.log"

python - "$OUT_DIR" "$PORT" <<'PY'
import json
import sys
import urllib.request
from pathlib import Path

out = Path(sys.argv[1])
port = sys.argv[2]
anchor = json.loads((out / 'anchor.json').read_text(encoding='utf-8'))
url = f"http://127.0.0.1:{port}/api/chain/proof/{anchor['block_index']}/{anchor['leaf_index']}"
proof = json.loads(urllib.request.urlopen(url, timeout=5).read().decode('utf-8'))
(out / 'proof.json').write_text(json.dumps(proof, ensure_ascii=False, indent=2), encoding='utf-8')
PY

echo "[4/6] Build Evidence proof bundle"
node "$ROOT_DIR/modules/cli.js" bundle "$OUT_DIR/artifact.json" \
  --anchor "$OUT_DIR/anchor.json" \
  --proof "$OUT_DIR/proof.json" \
  --subject '{"owner":"example-user","agent":"example-script","purpose":"AILog + LocalChain + Evidence example"}' \
  --out "$OUT_DIR/bundle.json" \
  2> "$OUT_DIR/bundle.stderr"

echo "[5/6] Verify clean bundle"
node "$ROOT_DIR/modules/cli.js" verify-bundle "$OUT_DIR/bundle.json" > "$OUT_DIR/verify-clean.json"

if ! grep -q '"ok": true' "$OUT_DIR/verify-clean.json"; then
  echo "Clean verification did not pass" >&2
  cat "$OUT_DIR/verify-clean.json" >&2
  exit 1
fi

echo "[6/6] Verify tampered bundle fails"
python - "$OUT_DIR" <<'PY'
import json
import sys
from pathlib import Path

out = Path(sys.argv[1])
bundle = json.loads((out / 'bundle.json').read_text(encoding='utf-8'))
bundle['claim']['artifact']['canonical'] = bundle['claim']['artifact']['canonical'].replace('example-1', 'example-HACKED')
(out / 'bundle-tampered.json').write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding='utf-8')
PY

set +e
node "$ROOT_DIR/modules/cli.js" verify-bundle "$OUT_DIR/bundle-tampered.json" > "$OUT_DIR/verify-tampered.json"
TAMPER_RC=$?
set -e

if [ "$TAMPER_RC" -eq 0 ]; then
  echo "Tampered verification unexpectedly passed" >&2
  cat "$OUT_DIR/verify-tampered.json" >&2
  exit 1
fi

echo
cat <<EOF
Done.

Output directory:
  $OUT_DIR

Clean verification:
  ok=true

Tampered verification:
  failed as expected (exit $TAMPER_RC)

Key material:
  $OUT_DIR/.evidence/keys/
  (example-local only; do not treat as a real identity key)
EOF
