/**
 * Tests for proof-bundle.js
 *
 * Two layers:
 *   - in-process tests against a hand-rolled Merkle proof,
 *   - optional integration test against the real LocalChain Node server
 *     (sibling repo at ../local-chain or LOCAL_CHAIN_REPO env var).
 */

const path = require('path')
const fs = require('fs')
const os = require('os')
const http = require('http')
const { spawn } = require('child_process')
const net = require('net')

const {
  buildProofBundle,
  verifyProofBundle,
  stableStringify,
  leafHashOf,
  recomputeRoot,
} = require('../proof-bundle')
const { sha256 } = require('../merkle')
const { generateKeyPair } = require('../sign')

let passed = 0
let failed = 0

function assert(name, cond, detail) {
  if (cond) { console.log('  \u2713 ' + name); passed += 1 }
  else { console.log('  \u2717 ' + name + (detail ? ' \u2014 ' + detail : '')); failed += 1 }
}

function section(name) { console.log('\n[' + name + ']') }

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

function buildHandRolledMerkle(records) {
  const leaves = records.map(r => sha256(stableStringify(r)))
  const layers = [leaves.slice()]
  let current = leaves.slice()
  while (current.length > 1) {
    const next = []
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) next.push(sha256(current[i] + current[i + 1]))
      else next.push(current[i])
    }
    layers.push(next)
    current = next
  }
  const root = layers[layers.length - 1][0] || sha256('')

  function proof(leafIndex) {
    const out = []
    let index = leafIndex
    for (let layer = 0; layer < layers.length - 1; layer++) {
      const isRight = index % 2 === 1
      const pairIndex = isRight ? index - 1 : index + 1
      const layerArr = layers[layer]
      if (pairIndex < layerArr.length) {
        out.push({ hash: layerArr[pairIndex], right: !isRight })
      }
      index = Math.floor(index / 2)
    }
    return out
  }
  return { leaves, root, proof }
}

function tmpKeyDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-test-keys-'))
  generateKeyPair(dir)
  return dir
}

function testStableStringifyOrderInvariant() {
  section('stableStringify')
  const a = stableStringify({ b: 1, a: 2, c: { y: 1, x: 2 } })
  const b = stableStringify({ a: 2, b: 1, c: { x: 2, y: 1 } })
  assert('order-invariant', a === b, a + ' vs ' + b)
  assert('arrays preserved', stableStringify([3, 2, 1]) === '[3,2,1]')
  assert('null handled', stableStringify(null) === 'null')
}

function testBuildAndVerify() {
  section('build + verify (hand-rolled Merkle)')
  const records = [
    { id: 'r0', value: 'first' },
    { id: 'r1', value: 'second' },
    { id: 'r2', value: 'third' },
  ]
  const tree = buildHandRolledMerkle(records)
  const leafIndex = 1
  const artifact = records[leafIndex]
  const leaf = leafHashOf(artifact)
  assert('leafHashOf agrees with tree leaf', leaf === tree.leaves[leafIndex])

  const proofSteps = tree.proof(leafIndex)
  const recomputed = recomputeRoot(leaf, proofSteps)
  assert('recomputeRoot matches tree.root', recomputed === tree.root)

  const keyDir = tmpKeyDir()
  try {
    const bundle = buildProofBundle({
      artifact,
      anchor: {
        block_index: 1,
        leaf_index: leafIndex,
        leaf_hash: leaf,
        server_url: 'http://test-server',
        anchored_at: new Date().toISOString(),
      },
      merkleProof: { proof: proofSteps, merkleRoot: tree.root },
      keyDir,
      subject: { owner: 'test-user', device: 'termux-pad' },
    })

    assert('bundle has expected type', bundle.bundle_type === 'evidence.proof-bundle')
    assert('issuer kid present', !!bundle.issuer && !!bundle.issuer.kid)
    assert('signature present', !!bundle.signature && !!bundle.signature.value)

    const v1 = verifyProofBundle(bundle)
    assert('verify ok', v1.ok === true, JSON.stringify(v1.errors))
    assert('artifact_hash check', v1.checks.artifact_hash === true)
    assert('merkle_proof check', v1.checks.merkle_proof === true)
    assert('signature check', v1.checks.signature === true)

    const v2 = verifyProofBundle(bundle, { expectedRoot: tree.root })
    assert('expectedRoot match', v2.ok === true && v2.checks.expected_root === true)

    const v3 = verifyProofBundle(bundle, { expectedRoot: 'deadbeef'.repeat(8) })
    assert('expectedRoot mismatch flagged', v3.ok === false && v3.checks.expected_root === false)
  } finally {
    fs.rmSync(keyDir, { recursive: true, force: true })
  }
}

function testTamperedArtifactDetected() {
  section('tampered artifact rejected')
  const records = [{ id: 'r0', body: 'real' }, { id: 'r1', body: 'real-2' }]
  const tree = buildHandRolledMerkle(records)
  const leaf = leafHashOf(records[0])
  const proof = tree.proof(0)
  const keyDir = tmpKeyDir()
  try {
    const bundle = buildProofBundle({
      artifact: records[0],
      anchor: { block_index: 1, leaf_index: 0, leaf_hash: leaf },
      merkleProof: { proof, merkleRoot: tree.root },
      keyDir,
    })
    bundle.claim.artifact.canonical = stableStringify({ id: 'r0', body: 'fake' })
    const v = verifyProofBundle(bundle)
    assert('tamper -> not ok', v.ok === false)
    assert('artifact_hash or merkle_proof check fails',
      v.checks.artifact_hash === false || v.checks.merkle_proof === false)
  } finally {
    fs.rmSync(keyDir, { recursive: true, force: true })
  }
}

function testTamperedSignatureDetected() {
  section('tampered signature rejected')
  const records = [{ id: 'r0' }]
  const tree = buildHandRolledMerkle(records)
  const proof = tree.proof(0)
  const keyDir = tmpKeyDir()
  try {
    const bundle = buildProofBundle({
      artifact: records[0],
      anchor: { block_index: 1, leaf_index: 0 },
      merkleProof: { proof, merkleRoot: tree.root },
      keyDir,
    })
    const sig = Buffer.from(bundle.signature.value, 'base64')
    sig[0] ^= 0xff
    bundle.signature.value = sig.toString('base64')
    const v = verifyProofBundle(bundle)
    assert('signature tamper -> not ok', v.ok === false)
    assert('signature check fails', v.checks.signature === false)
  } finally {
    fs.rmSync(keyDir, { recursive: true, force: true })
  }
}

function testBuildRejectsHashMismatch() {
  section('build rejects mismatched anchor.leaf_hash')
  const records = [{ id: 'r0' }]
  const tree = buildHandRolledMerkle(records)
  const proof = tree.proof(0)
  const keyDir = tmpKeyDir()
  let threw = false
  try {
    try {
      buildProofBundle({
        artifact: records[0],
        anchor: { block_index: 1, leaf_index: 0, leaf_hash: 'not-the-right-hash' },
        merkleProof: { proof, merkleRoot: tree.root },
        keyDir,
      })
    } catch (e) {
      threw = /does not match anchor/.test(e.message)
    }
    assert('threw on hash mismatch', threw === true)
  } finally {
    fs.rmSync(keyDir, { recursive: true, force: true })
  }
}

function testBuildRejectsBadProof() {
  section('build rejects mismatched merkle proof')
  const records = [{ id: 'a' }, { id: 'b' }]
  const tree = buildHandRolledMerkle(records)
  const proof = tree.proof(0)
  const keyDir = tmpKeyDir()
  let threw = false
  try {
    try {
      buildProofBundle({
        artifact: records[0],
        anchor: { block_index: 1, leaf_index: 0 },
        merkleProof: { proof, merkleRoot: 'cafebabe'.repeat(8) },
        keyDir,
      })
    } catch (e) {
      threw = /does not reconstruct root/.test(e.message)
    }
    assert('threw on bad root', threw === true)
  } finally {
    fs.rmSync(keyDir, { recursive: true, force: true })
  }
}

// ── Optional integration with real LocalChain ──

function findLocalChainRepo() {
  const env = process.env.LOCAL_CHAIN_REPO
  if (env && fs.existsSync(path.join(env, 'packages', 'server', 'index.js'))) return env
  const sibling = path.resolve(__dirname, '..', '..', '..', 'local-chain')
  if (fs.existsSync(path.join(sibling, 'packages', 'server', 'index.js'))) return sibling
  return null
}

function httpJson(opts, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(opts, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString()
        try { resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

async function waitForHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastErr = null
  while (Date.now() < deadline) {
    try {
      const res = await httpJson({ hostname: '127.0.0.1', port, path: '/api/health', method: 'GET' })
      if (res.status === 200) return true
    } catch (e) { lastErr = e }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('server never came up: ' + (lastErr ? lastErr.message : 'timeout'))
}

async function runRealServerIntegration() {
  const repo = findLocalChainRepo()
  if (!repo) {
    section('real LocalChain integration')
    console.log('  - skipped (no local-chain repo found)')
    return
  }

  section('real LocalChain integration')
  const port = await freePort()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-lc-'))
  const bootstrap = path.join(tmp, 'bootstrap.js')
  const serverPath = path.resolve(repo, 'packages', 'server')
  fs.writeFileSync(
    bootstrap,
    "const { createServer } = require(" + JSON.stringify(serverPath) + ")\n" +
    "const port = " + port + "\n" +
    "const dir = " + JSON.stringify(path.join(tmp, 'chain')) + "\n" +
    "createServer(dir, { port }).listen()\n"
  )

  const proc = spawn('node', [bootstrap], { stdio: ['ignore', 'pipe', 'pipe'] })
  let early = ''
  proc.stdout.on('data', d => { early += d.toString() })
  proc.stderr.on('data', d => { early += d.toString() })

  try {
    await waitForHealth(port, 15000)

    // Add a block of AILog-like records (sorted-key JSON via stableStringify is
    // what the AILog bridge already sends, so this matches production flow).
    const records = [
      { type: 'ailog.interaction', id: 'a-0', n: 0 },
      { type: 'ailog.interaction', id: 'a-1', n: 1 },
      { type: 'ailog.interaction', id: 'a-2', n: 2 },
    ]
    // LocalChain stores records as-given and hashes JSON.stringify(record).
    // Our stableStringify yields the same string when keys are already
    // sorted; we sort here to be safe.
    const sortedRecords = records.map(r => JSON.parse(stableStringify(r)))

    const addRes = await httpJson(
      { hostname: '127.0.0.1', port, path: '/api/chain/blocks', method: 'POST',
        headers: { 'Content-Type': 'application/json' } },
      { records: sortedRecords }
    )
    assert('block added', addRes.status === 201, JSON.stringify(addRes))
    const blockIndex = addRes.body.index
    const merkleRoot = addRes.body.merkleRoot
    assert('block has merkleRoot', !!merkleRoot)

    // Get proof for leaf 1.
    const leafIndex = 1
    const proofRes = await httpJson(
      { hostname: '127.0.0.1', port,
        path: '/api/chain/proof/' + blockIndex + '/' + leafIndex, method: 'GET' }
    )
    assert('proof fetched', proofRes.status === 200, JSON.stringify(proofRes))
    const merkleProof = { proof: proofRes.body.proof, merkleRoot: proofRes.body.merkleRoot }
    assert('proof root matches block root', merkleProof.merkleRoot === merkleRoot)

    // Build & verify bundle entirely offline.
    const keyDir = tmpKeyDir()
    try {
      const bundle = buildProofBundle({
        artifact: sortedRecords[leafIndex],
        anchor: {
          block_index: blockIndex,
          leaf_index: leafIndex,
          server_url: 'http://127.0.0.1:' + port,
          anchored_at: new Date().toISOString(),
        },
        merkleProof,
        keyDir,
        subject: { owner: 'integration-test' },
      })
      const v = verifyProofBundle(bundle, { expectedRoot: merkleRoot })
      assert('real-server bundle verifies', v.ok === true, JSON.stringify(v.errors))
      assert('expected_root match', v.checks.expected_root === true)
    } finally {
      fs.rmSync(keyDir, { recursive: true, force: true })
    }
  } catch (e) {
    console.log('  ERROR: ' + e.message)
    if (early) console.log('  server output: ' + early.slice(0, 400))
    failed += 1
  } finally {
    proc.kill('SIGTERM')
    await new Promise(r => proc.on('close', r) || setTimeout(r, 1000))
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

async function main() {
  testStableStringifyOrderInvariant()
  testBuildAndVerify()
  testTamperedArtifactDetected()
  testTamperedSignatureDetected()
  testBuildRejectsHashMismatch()
  testBuildRejectsBadProof()
  await runRealServerIntegration()

  console.log('\n=== ' + passed + ' passed, ' + failed + ' failed ===')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
