/**
 * Proof Bundle (cold path: AILog + LocalChain -> Evidence)
 *
 * A proof bundle is a self-contained JSON document that lets an
 * independent verifier check, without contacting any server, that:
 *
 *   1. The artifact (e.g. an AILog interaction record) hashes to the
 *      stated leaf hash (artifact integrity).
 *   2. That leaf hash participates in a Merkle tree whose root matches
 *      the recorded merkle_root (chain inclusion).
 *   3. The bundle was signed by the holder of a known public key
 *      (claim of observation by user/device/agent).
 *
 * It deliberately does NOT prove:
 *   - that an AI provider produced a specific output,
 *   - that the LocalChain server was honest,
 *   - that the timestamp is wall-clock-correct.
 *
 * Those guarantees require external anchoring, which is left to the
 * existing LocalChain anchor + IPFS layers.
 */

const fs = require('fs')
const path = require('path')
const { sha256 } = require('./merkle')
const {
  generateKeyPair,
  loadKeyPair,
  sign: signData,
  verify: verifySig,
} = require('./sign')

const BUNDLE_VERSION = '0.1'
const BUNDLE_TYPE = 'evidence.proof-bundle'

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']'
  }
  const keys = Object.keys(value).sort()
  const parts = keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k]))
  return '{' + parts.join(',') + '}'
}

function canonicalRecordJson(record) {
  if (typeof record === 'string') return record
  return stableStringify(record)
}

function leafHashOf(record) {
  return sha256(canonicalRecordJson(record))
}

function recomputeRoot(leafHash, proof) {
  let current = leafHash
  for (const step of proof || []) {
    if (step.right) {
      current = sha256(current + step.hash)
    } else {
      current = sha256(step.hash + current)
    }
  }
  return current
}

function resolveKeyPair(keyDir) {
  const privPath = path.join(keyDir, 'private.pem')
  if (fs.existsSync(privPath)) return loadKeyPair(keyDir)
  return generateKeyPair(keyDir)
}

function buildProofBundle(input) {
  if (!input || typeof input !== 'object') throw new Error('input is required')
  if (input.artifact === undefined || input.artifact === null) {
    throw new Error('input.artifact is required')
  }
  if (!input.anchor || typeof input.anchor !== 'object') {
    throw new Error('input.anchor is required')
  }
  if (!input.merkleProof || typeof input.merkleProof !== 'object') {
    throw new Error('input.merkleProof is required (use ChainClient.getProof)')
  }

  const canonical = canonicalRecordJson(input.artifact)
  const computedLeaf = sha256(canonical)
  const recordedLeaf = input.anchor.leaf_hash || input.anchor.leafHash
  if (recordedLeaf && recordedLeaf !== computedLeaf) {
    throw new Error(
      'artifact hash does not match anchor.leaf_hash: computed=' +
      computedLeaf + ' anchor=' + recordedLeaf
    )
  }

  const proof = input.merkleProof.proof || []
  const root = input.merkleProof.merkleRoot || input.merkleProof.root
  if (!root) throw new Error('merkleProof.merkleRoot is required')
  const recomputed = recomputeRoot(computedLeaf, proof)
  if (recomputed !== root) {
    throw new Error(
      'merkle proof does not reconstruct root: computed=' + recomputed +
      ' expected=' + root
    )
  }

  const claim = {
    type: input.claimType || 'ai-interaction-record',
    subject: input.subject || null,
    artifact: {
      canonical,
      hash_algorithm: 'sha-256',
      hash: computedLeaf,
    },
    anchor: {
      block_index: input.anchor.block_index ?? input.anchor.blockIndex,
      leaf_index: input.anchor.leaf_index ?? input.anchor.leafIndex,
      leaf_hash: computedLeaf,
      merkle_root: root,
      proof,
      server_url: input.anchor.server_url || input.anchor.serverUrl || null,
      anchored_at: input.anchor.anchored_at || input.anchor.anchoredAt || null,
    },
    issued_at: new Date().toISOString(),
  }

  let privateKey = input.privateKey
  let publicKey = input.publicKey
  if (!privateKey || !publicKey) {
    const keyDir = input.keyDir || path.join(process.cwd(), '.evidence', 'keys')
    fs.mkdirSync(keyDir, { recursive: true })
    const kp = resolveKeyPair(keyDir)
    privateKey = privateKey || kp.privateKey
    publicKey = publicKey || kp.publicKey
  }

  const claimCanonical = stableStringify(claim)
  const signature = signData(claimCanonical, privateKey)
  const issuerKid = sha256(publicKey).slice(0, 16)

  return {
    bundle_version: BUNDLE_VERSION,
    bundle_type: BUNDLE_TYPE,
    claim,
    issuer: {
      kid: issuerKid,
      public_key: publicKey,
      algorithm: 'sha256-rsa',
    },
    signature: {
      algorithm: 'sha256-rsa',
      value: signature,
      payload_canonical_sha256: sha256(claimCanonical),
    },
  }
}

function verifyProofBundle(bundle, opts = {}) {
  const errors = []
  const checks = {
    bundle_shape: false,
    artifact_hash: false,
    merkle_proof: false,
    signature: false,
    expected_root: null,
  }

  if (!bundle || bundle.bundle_type !== BUNDLE_TYPE) {
    errors.push('not a recognized proof bundle')
    return { ok: false, checks, errors }
  }
  if (!bundle.claim || !bundle.claim.artifact || !bundle.claim.anchor) {
    errors.push('claim/artifact/anchor missing')
    return { ok: false, checks, errors }
  }
  checks.bundle_shape = true

  const canonical = bundle.claim.artifact.canonical
  const claimedLeaf = bundle.claim.artifact.hash
  const computedLeaf = sha256(canonical)
  if (claimedLeaf !== computedLeaf) {
    errors.push(
      'artifact.hash does not match canonical SHA-256 (claimed=' +
      claimedLeaf + ' computed=' + computedLeaf + ')'
    )
  } else {
    checks.artifact_hash = true
  }

  const proof = bundle.claim.anchor.proof || []
  const root = bundle.claim.anchor.merkle_root
  const recomputed = recomputeRoot(computedLeaf, proof)
  if (recomputed !== root) {
    errors.push(
      'merkle proof does not reconstruct anchor.merkle_root (computed=' +
      recomputed + ' expected=' + root + ')'
    )
  } else {
    checks.merkle_proof = true
  }

  if (opts.expectedRoot) {
    if (root !== opts.expectedRoot) {
      errors.push(
        'anchor.merkle_root does not match expected root (bundle=' +
        root + ' expected=' + opts.expectedRoot + ')'
      )
      checks.expected_root = false
    } else {
      checks.expected_root = true
    }
  }

  if (!bundle.issuer || !bundle.issuer.public_key || !bundle.signature) {
    errors.push('issuer/signature missing')
    return { ok: false, checks, errors }
  }
  const claimCanonical = stableStringify(bundle.claim)
  let sigOk = false
  try {
    sigOk = verifySig(claimCanonical, bundle.signature.value, bundle.issuer.public_key)
  } catch (e) {
    errors.push('signature verification threw: ' + e.message)
  }
  if (!sigOk) {
    errors.push('signature does not verify against bundle.issuer.public_key')
  } else {
    checks.signature = true
  }

  const ok =
    checks.bundle_shape &&
    checks.artifact_hash &&
    checks.merkle_proof &&
    checks.signature &&
    (opts.expectedRoot ? checks.expected_root === true : true)

  return { ok, checks, errors }
}

module.exports = {
  BUNDLE_VERSION,
  BUNDLE_TYPE,
  stableStringify,
  canonicalRecordJson,
  leafHashOf,
  recomputeRoot,
  buildProofBundle,
  verifyProofBundle,
}
