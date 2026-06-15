const path = require('path')
const fs = require('fs')
const { MerkleTree, sha256, buildFromRecords } = require('../merkle')
const { Block, LocalChain, PublicAnchor, MockAnchorProvider } = require('../chain')
const { hash, hashString, algorithms } = require('../hash')
const { LocalStore } = require('../store')
const { generateKeyPair, sign, verify } = require('../sign')
const { Evidence } = require('../evidence')

let passed = 0
let failed = 0

function assert(name, condition) {
  if (condition) { console.log(`  ✓ ${name}`); passed++ }
  else { console.log(`  ✗ ${name}`); failed++ }
}

const tmpDir = path.join(__dirname, '__tmp_merkle__')
if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true })

// ── Merkle Tree ──
console.log('\n[Merkle Tree]')

const t1 = new MerkleTree(['a', 'b', 'c', 'd'])
assert('4 leaves root', t1.getRoot().length === 64)
assert('height is 3', t1.getHeight() === 3)

const proof0 = t1.getProof(0)
assert('proof 0 exists', proof0 !== null && proof0.length > 0)
assert('proof verify', MerkleTree.verifyProof(sha256('a'), proof0, t1.getRoot()))
assert('proof reject wrong', !MerkleTree.verifyProof(sha256('x'), proof0, t1.getRoot()))

const t2 = new MerkleTree(['only-one'])
assert('single leaf', t2.getLeaves().length === 1)
assert('single leaf root', t2.getRoot() === sha256('only-one'))

const t3 = new MerkleTree([])
assert('empty tree', t3.getLeaves().length === 0)
assert('empty tree root', t3.getRoot().length === 64)

const t4 = new MerkleTree(['a', 'b', 'c'])
assert('odd leaves', t4.getLeaves().length === 3)
assert('odd leaves root', t4.getRoot().length === 64)
const proofLast = t4.getProof(2)
assert('odd tree last proof', MerkleTree.verifyProof(sha256('c'), proofLast, t4.getRoot()))

const t5 = new MerkleTree(['x'.repeat(10000)])
assert('large leaf', t5.getRoot().length === 64)

const bf = buildFromRecords([{ hash: 'abc', name: 'f1' }, { hash: 'def', name: 'f2' }])
assert('buildFromRecords', bf.getRoot().length === 64)
assert('buildFromRecords 2 leaves', bf.getLeaves().length === 2)

// ── Chain with Merkle ──
console.log('\n[Chain + Merkle]')

const chain = new LocalChain(path.join(tmpDir, 'chain1'))
assert('genesis', chain.getChainLength() === 1)

const block1 = chain.addRecords([{ hash: 'aaa', name: 'f1.txt' }, { hash: 'bbb', name: 'f2.txt' }])
assert('addRecords has merkleRoot', !!block1.merkleRoot)
assert('merkleRoot is 64 hex', block1.merkleRoot.length === 64)

const proof = chain.getProof(1, 0)
assert('getProof', proof !== null)
assert('getProof is array', Array.isArray(proof))

const record0 = block1.data.records[0]
assert('verifyRecordInBlock true', chain.verifyRecordInBlock(record0, 1, 0))

const wrongRecord = { hash: 'zzz', name: 'nope' }
assert('verifyRecordInBlock false', !chain.verifyRecordInBlock(wrongRecord, 1, 0))

const found = chain.findRecord('aaa')
assert('findRecord found', found !== null)
assert('findRecord blockIndex', found.blockIndex === 1)
assert('findRecord leafIndex', found.leafIndex === 0)
assert('findRecord not found', chain.findRecord('zzz') === null)

const block2 = chain.addRecords([{ hash: 'ccc' }, { hash: 'ddd' }, { hash: 'eee' }])
assert('second block merkle', !!block2.merkleRoot)
assert('chain still valid', chain.isValid())

// Persistence
const chain2 = new LocalChain(path.join(tmpDir, 'chain1'))
assert('persists', chain2.getChainLength() === 3)
assert('persisted merkle', chain2.getBlockByIndex(1).merkleRoot.length === 64)
assert('persisted findRecord', chain2.findRecord('aaa') !== null)
assert('persisted proof', chain2.getProof(1, 0) !== null)

// ── Full Evidence Integration ──
console.log('\n[Evidence + Merkle]')

const ev = new Evidence({ dataDir: path.join(tmpDir, 'ev') })
const testDir = path.join(tmpDir, 'files')
fs.mkdirSync(testDir, { recursive: true })
fs.writeFileSync(path.join(testDir, 'doc.txt'), 'Test evidence')

async function run() {
  const r1 = await ev.stampFile(path.join(testDir, 'doc.txt'))
  const r2 = await ev.stampString('second evidence')

  const committed = ev.commitToChain()
  assert('commitToChain with merkle', committed.merkleRoot.length === 64)

  const found = ev.chain.findRecord(r1.hash)
  assert('chain findRecord', found !== null)
  assert('chain verifyRecord', ev.chain.verifyRecordInBlock(found.record, found.blockIndex, found.leafIndex))

  console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══\n`)
  fs.rmSync(tmpDir, { recursive: true, force: true })
  process.exit(failed > 0 ? 1 : 0)
}

run().catch(e => { console.error(e); process.exit(1) })
