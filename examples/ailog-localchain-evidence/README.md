# AILog + LocalChain + Evidence example

This is a small end-to-end kit that demonstrates the cold path:

```text
AILog interaction -> LocalChain anchor/proof -> Evidence proof bundle -> offline verify
```

It is an example, not a new core API and not a product workflow. The goal is to keep the bricks visible.

## What it proves

The generated proof bundle verifies that:

- the canonical AILog-derived artifact hashes to the recorded leaf hash,
- the artifact is included in the LocalChain Merkle root via the returned proof,
- the Evidence issuer key signed the canonical claim envelope,
- tampering with the artifact breaks verification.

It does **not** prove that an AI provider generated the text. It proves local observation/signing/fixation of an artifact hash.

## Prerequisites

- Node.js 18+
- Python 3.10+
- `curl`
- sibling checkouts by default:

```text
../ailog
../local-chain
../evidence
```

You can override paths:

```bash
AILOG_REPO=/path/to/ailog \
LOCAL_CHAIN_REPO=/path/to/local-chain \
./examples/ailog-localchain-evidence/run.sh
```

## Run

From the `evidence` repo root:

```bash
./examples/ailog-localchain-evidence/run.sh
```

By default outputs are written to:

```text
examples/ailog-localchain-evidence/out/
```

Override:

```bash
OUT_DIR=/path/to/out ./examples/ailog-localchain-evidence/run.sh
```

## Output files

```text
sample.ailog            minimal AILog file created by the example
anchor-result.json      output of `ailog anchor --json`
artifact.json           canonical record handed to Evidence
anchor.json             LocalChain anchor metadata from AILog
proof.json              LocalChain Merkle proof
bundle.json             Evidence proof bundle
verify-clean.json       expected ok=true verification result
bundle-tampered.json    bundle with modified canonical artifact
verify-tampered.json    expected ok=false verification result
localchain/             temporary LocalChain data for this run
.evidence/keys/         example-local signing keypair for this output dir
```

The script intentionally keeps the generated example keypair under the output directory:

```text
out/.evidence/keys/
```

Do not treat this keypair as a real identity key.

## Expected result

Clean verification:

```json
{
  "ok": true,
  "checks": {
    "bundle_shape": true,
    "artifact_hash": true,
    "merkle_proof": true,
    "signature": true,
    "expected_root": null
  },
  "errors": []
}
```

Tampered verification:

```text
ok=false
exit code 1
```

This is expected and demonstrates that artifact/signature/proof tampering is detected.
