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
npm run test:mvp
```

## Privacy note

Raw prompts, model outputs, files, and rich metadata should stay in their owning archive by default. Ledger/proof records should prefer compact hashes, references, timestamps, and signatures.
