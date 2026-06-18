# Evidence

Electronic evidence toolkit for hashing, signing, verifying, and packaging proof records.

## Scope

Evidence is the proof and attestation layer. It is intended to help prove that an artifact hash was observed, signed, fixed, exported, or verified at a given time by a user/device/agent identity.

For AI/agent interaction products, Evidence should support copyright-oriented proof workflows, but it does not automatically decide legal ownership and cannot prove a provider generated a response unless the provider signs that response. It can prove that a local user/device/agent observed, recorded, signed, and fixed a specific artifact hash.

## Boundary with AILog and LocalChain

Preferred split:

```text
AILog      = AI/agent interaction product record layer
LocalChain = fast tamper-evident local ledger layer
Evidence   = digital attestation / copyright claim / proof bundle / verification layer
```

Preferred hot path:

```text
AILog -> LocalChain
```

Evidence should not be a mandatory hot-path middle layer for every AILog record. Evidence is used when generating stronger claims, proof bundles, certificates, exports, or verification reports:

```text
AILog + LocalChain -> Evidence
```

## Chain modes

Evidence supports two chain styles:

1. Embedded fallback chain — useful for local MVP/offline testing.
2. HTTP `chainUrl` mode — preferred for integration with an independent LocalChain service.

Example:

```js
const { Evidence } = require('./modules/evidence')

const ev = new Evidence({
  chainUrl: 'http://127.0.0.1:3456'
})
```

The HTTP mode keeps Evidence from loading LocalChain internals directly and lets LocalChain evolve independently as a fast ledger service.

## Tests

```bash
npm test
```

Individual tests:

```bash
npm run test:core
npm run test:merkle
npm run test:metadata
npm run test:integration
npm run test:bundle    # proof-bundle (cold path)
npm run test:mvp
```

`test:bundle` will additionally exercise an end-to-end proof-bundle round trip
against a real LocalChain Node server when `LOCAL_CHAIN_REPO` is set or a
sibling `../local-chain` checkout exists; otherwise it skips that one section.

## Proof bundle (cold path: AILog + LocalChain -> Evidence)

A proof bundle is a self-contained, offline-verifiable JSON document that
packs together:

- the canonical artifact (e.g. an AILog interaction record),
- the Merkle proof and root from LocalChain,
- a local signature over the whole claim,

and can be verified later without contacting any server.

### Build a bundle from an already-anchored AILog record

Assuming you have:

- `artifact.json` — the canonical record that LocalChain hashed (e.g. produced
  by AILog's `anchor` command),
- `anchor.json`  — the `{ block_index, leaf_index, leaf_hash, server_url, anchored_at }`
  metadata stored on the AILog interaction,
- `proof.json`   — the Merkle proof returned by LocalChain at
  `GET /api/chain/proof/<block>/<leaf>` (`{ proof, merkleRoot }`),

you can build a bundle:

```bash
node modules/cli.js bundle artifact.json \
  --anchor anchor.json \
  --proof  proof.json \
  --subject '{"owner":"alice","device":"laptop-1"}' \
  --out    bundle.json
```

Key material is lazily generated on first use. For `bundle`, the default is
`<directory-of---out>/.evidence/keys/{private,public}.pem` when `--out` is
provided; otherwise it falls back to the current working directory's
`.evidence/keys`. The CLI prints `Using keyDir: ...` to stderr so accidental
identity material is visible. You can override with `--keyDir`.

### Verify a bundle (offline)

```bash
node modules/cli.js verify-bundle bundle.json
node modules/cli.js verify-bundle bundle.json --expected-root <hex>
```

The verifier checks:

- artifact canonical SHA-256 matches the recorded leaf hash,
- the Merkle proof reconstructs the recorded root,
- the issuer's public key signed the canonical claim envelope,
- (optional) the recorded root matches an `--expected-root` you trust
  externally (e.g. from a public-chain anchor or a copy on another device).

### What a bundle does and does not prove

Proves:

- the artifact was observed and recorded by the holder of the issuer
  public key,
- the artifact participates in a Merkle tree with the recorded root,
- the claim has not been altered since signing.

Does not prove:

- that an AI provider produced the artifact (only that the local user/agent
  observed and recorded it),
- that the Merkle root is globally trusted unless externally anchored
  (LocalChain anchor / IPFS pin / public-chain commit),
- that the timestamp is wall-clock-correct.

## Privacy note

Raw prompts, model outputs, files, and rich metadata should stay in their owning archive by default. Ledger/proof records should prefer compact hashes, references, timestamps, and signatures.
