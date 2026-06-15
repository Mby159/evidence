const path = require('path')
const fs = require('fs')
const http = require('http')
const { createServer } = require('../../../local-chain/packages/server/index')
const { MockAnchorProvider } = require('../../../local-chain/packages/anchor')
const { Evidence } = require('../evidence')
const { PublicAnchor } = require('../chain')

let passed = 0
let failed = 0

function assert(name, condition) {
  if (condition) { console.log(`  ✓ ${name}`); passed++ }
  else { console.log(`  ✗ ${name}`); failed++ }
}

const tmpDir = path.join(__dirname, '__tmp_integration__')
if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true })

async function run() {
  // Start Local Chain server
  const port = 14567 + Math.floor(Math.random() * 1000)
  const srv = createServer(path.join(tmpDir, 'chain'), {
    port,
    anchor: { provider: new MockAnchorProvider() },
  })
  await srv.listen()

  // Create Evidence connected to remote chain
  const ev = new Evidence({
    dataDir: path.join(tmpDir, 'evidence'),
    chainUrl: `http://localhost:${port}`,
    anchor: new PublicAnchor({ provider: new MockAnchorProvider() }),
  })

  const testDir = path.join(tmpDir, 'files')
  fs.mkdirSync(testDir, { recursive: true })
  fs.writeFileSync(path.join(testDir, 'photo.jpg'), Buffer.from([0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x10]))
  fs.writeFileSync(path.join(testDir, 'doc.txt'), 'Important evidence document')

  console.log('\n[Integration: Evidence + Local Chain API]')

  // 1. Stamp file
  const r1 = await ev.stampFile(path.join(testDir, 'photo.jpg'))
  assert('stamp file', r1.hash.length === 64)
  assert('stamp has signature', !!r1.signature)

  // 2. Stamp text
  const r2 = await ev.stampString('关键证据：2026-06-16 拍摄的照片')
  assert('stamp text', r2.hash.length === 64)

  // 3. Verify file locally
  const v1 = await ev.verifyFile(path.join(testDir, 'photo.jpg'))
  assert('verify file match', v1.verified === true)
  assert('verify signature valid', v1.signatureValid === true)

  // 4. Commit to chain (via REST API)
  const committed = await ev.commitToChain()
  assert('commit to chain via API', !!committed)
  assert('block has merkle', !!committed.merkleRoot)

  // 5. Check chain status
  const length = await ev.getChainLength()
  assert('chain length via API', length === 2)

  const rootHash = await ev.getChainRootHash()
  assert('chain root hash via API', rootHash.length === 64)

  const valid = await ev.isChainValid()
  assert('chain valid via API', valid === true)

  // 6. Find record on chain
  const found = await ev.findRecordOnChain(r1.hash)
  assert('find record on chain', found !== null)
  assert('found in correct block', found.blockIndex === 1)

  // 7. Get Merkle proof
  const proof = await ev.getChainProof(1, 0)
  assert('get merkle proof via API', !!proof)

  // 8. Verify record signature
  const chainVerify = ev.verifyRecordSignature(r1)
  assert('verify record signature', chainVerify === true)

  // 9. Anchor to public chain (mock)
  const anchorResult = await ev.anchorToPublic()
  assert('anchor to public', anchorResult.success === true)
  assert('anchor has txHash', !!anchorResult.txHash)

  // 10. Stats
  const s = ev.stats()
  assert('stats total', s.total === 2)

  // Done
  await srv.close()
  console.log(`\n═══ Integration Results: ${passed} passed, ${failed} failed ═══\n`)
  fs.rmSync(tmpDir, { recursive: true, force: true })
  process.exit(failed > 0 ? 1 : 0)
}

run().catch(e => { console.error(e); process.exit(1) })
