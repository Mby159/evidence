const path = require('path')
const fs = require('fs')
const { hash, hashString, algorithms } = require('../hash')
const { LocalStore } = require('../store')
const { generateKeyPair, sign, verify, signHash } = require('../sign')
const { Block, LocalChain, PublicAnchor, MockAnchorProvider } = require('../chain')
const { Evidence } = require('../evidence')

let passed = 0
let failed = 0

function assert(name, condition) {
  if (condition) { console.log(`  ✓ ${name}`); passed++ }
  else { console.log(`  ✗ ${name}`); failed++ }
}
function assertThrows(name, fn) {
  try { fn(); assert(name, false) } catch { assert(name, true) }
}

const tmpDir = path.join(__dirname, '__tmp_test__')
if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true })

// ── Hash ──
console.log('\n[Hash]')
assert('deterministic', hash('a') === hash('a'))
assert('different', hash('a') !== hash('b'))
assert('64 chars', hash('x').length === 64)
assert('hashString', hashString('x') === hash('x'))
assert('algorithms', algorithms().includes('sha-256'))
assert('SHA-512', hash('x', 'sha-512').length === 128)
assert('SHA3-256', hash('x', 'sha3-256').length === 64)
assertThrows('rejects bad algo', () => hash('x', 'md5'))

// ── Sign ──
console.log('\n[Sign]')
const keys = generateKeyPair()
assert('generates keys', keys.privateKey && keys.publicKey)
assert('private PEM', keys.privateKey.includes('BEGIN PRIVATE KEY'))
assert('public PEM', keys.publicKey.includes('BEGIN PUBLIC KEY'))
const sig = sign('test', keys.privateKey)
assert('sign base64', /^[A-Za-z0-9+/=]+$/.test(sig))
assert('verify valid', verify('test', sig, keys.publicKey))
assert('verify wrong data', !verify('wrong', sig, keys.publicKey))
assert('verify wrong key', !verify('test', sig, generateKeyPair().publicKey))

// ── Store ──
console.log('\n[Store]')
const store = new LocalStore(path.join(tmpDir, 'store'))
assert('starts empty', store.getAll().length === 0)
store.add({ id: '1', hash: 'abc', name: 't', size: 10, date: '2026-06-15' })
assert('add', store.getAll().length === 1)
assert('getByHash', store.getByHash('abc').length === 1)
assert('getById', store.getById('1').name === 't')
assert('remove', store.remove('1'))
store.clear()
assert('clear', store.getAll().length === 0)

// ── Chain ──
console.log('\n[Chain]')

const chain = new LocalChain(path.join(tmpDir, 'chain1'))
assert('genesis block', chain.getChainLength() === 1)
assert('chain valid', chain.isValid())

const block1 = chain.addRecords([{ hash: 'aaa', name: 'f1.txt' }])
assert('add records', chain.getChainLength() === 2)
assert('block has hash', block1.hash.length === 64)
assert('block links prev', block1.previousHash === chain.getBlockByIndex(0).hash)

const block2 = chain.addRecords([{ hash: 'bbb', name: 'f2.txt' }])
assert('add second', chain.getChainLength() === 3)
assert('chain still valid', chain.isValid())
assert('getRootHash', chain.getRootHash().length === 64)
assert('getLatestBlock', chain.getLatestBlock().index === 2)

// Persistence
const chain2 = new LocalChain(path.join(tmpDir, 'chain1'))
assert('persists', chain2.getChainLength() === 3)

// Mining
const chain3 = new LocalChain(path.join(tmpDir, 'chain_mine'), { difficulty: 2 })
chain3.addRecords([{ hash: 'xxx' }])
const minedBlock = chain3.getLatestBlock()
assert('mined block hash starts 00', minedBlock.hash.startsWith('00'))

// Public anchor (sync setup only)
console.log('\n[PublicAnchor]')
const mockProvider = new MockAnchorProvider()
const anchor = new PublicAnchor({ provider: mockProvider })

const noProvider = new PublicAnchor()

// ── Evidence Core ──
console.log('\n[Evidence]')
const ev = new Evidence({ dataDir: path.join(tmpDir, 'ev') })
const testDir = path.join(tmpDir, 'files')
fs.mkdirSync(testDir, { recursive: true })
fs.writeFileSync(path.join(testDir, 'hello.txt'), 'Hello, Evidence!')
fs.writeFileSync(path.join(testDir, 'photo.bin'), Buffer.from([0x89, 0x50]))

async function run() {
  const r = await ev.stampFile(path.join(testDir, 'hello.txt'))
  assert('stampFile', r.hash.length === 64)
  assert('stampFile signature', typeof r.signature === 'string')

  const v = await ev.verifyFile(path.join(testDir, 'hello.txt'))
  assert('verifyFile match', v.verified && v.signatureValid)

  const rb = await ev.stampFile(path.join(testDir, 'photo.bin'))
  assert('stamp binary', rb.hash.length === 64)

  const rs = await ev.stampString('中文证据')
  assert('stampString', rs.hash.length === 64)

  // Chain integration
  const committed = await ev.commitToChain()
  assert('commitToChain', committed.hash.length === 64)
  assert('chain length', await ev.getChainLength() === 2)
  assert('chain root hash', (await ev.getChainRootHash()).length === 64)
  assert('chain valid', await ev.isChainValid())

  // Public anchor via Evidence
  ev.anchor = new PublicAnchor({ provider: mockProvider })
  const anchored = await ev.anchorToPublic()
  assert('anchorToPublic', anchored.success)
  assert('anchor txHash', anchored.txHash.startsWith('0x'))

  const anchorVerify = await ev.verifyAnchor(await ev.getChainRootHash(), anchored.txHash)
  assert('verifyAnchor', anchorVerify.verified)

  const badAnchor = await noProvider.anchor('test')
  assert('no provider fails', !badAnchor.success && badAnchor.simulated)

  // Export/Import
  const json = ev.exportJSON()
  assert('exportJSON', typeof json === 'string')
  assert('getPublicKey', ev.getPublicKey().includes('BEGIN PUBLIC KEY'))

  // Record signature
  const record = ev.getRecords()[0]
  assert('verifyRecordSignature', ev.verifyRecordSignature(record, ev.getPublicKey()))

  // Cleanup
  ev.clearRecords()
  assert('clearRecords', ev.getRecords().length === 0)

  console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══\n`)
  fs.rmSync(tmpDir, { recursive: true, force: true })
  process.exit(failed > 0 ? 1 : 0)
}

run().catch(e => { console.error(e); process.exit(1) })
