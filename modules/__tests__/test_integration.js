const path = require('path')
const fs = require('fs')
const http = require('http')
const crypto = require('crypto')
const { Evidence } = require('../evidence')
const { PublicAnchor, MockAnchorProvider } = require('../chain')

let passed = 0
let failed = 0

function assert(name, condition) {
  if (condition) { console.log(`  ✓ ${name}`); passed++ }
  else { console.log(`  ✗ ${name}`); failed++ }
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')) }
      catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function createMockChainServer() {
  const state = {
    blocks: [{ index: 0, hash: sha256('genesis'), data: { type: 'genesis' } }],
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { status: 'ok', chain: state.blocks.length, valid: true })
    }

    if (req.method === 'GET' && url.pathname === '/api/chain') {
      return json(res, 200, {
        length: state.blocks.length,
        rootHash: sha256(state.blocks.map(b => b.hash).join('')),
        valid: true,
        latest: state.blocks[state.blocks.length - 1],
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/chain/blocks') {
      const body = await parseBody(req)
      if (!Array.isArray(body.records) || body.records.length === 0) {
        return json(res, 400, { error: 'records array required' })
      }
      const previous = state.blocks[state.blocks.length - 1]
      const merkleRoot = sha256(body.records.map(r => JSON.stringify(r)).join('|'))
      const block = {
        index: state.blocks.length,
        timestamp: new Date().toISOString(),
        previousHash: previous.hash,
        data: { type: 'evidence_batch', records: body.records, merkleRoot },
        merkleRoot,
      }
      block.hash = sha256(`${block.index}${block.timestamp}${JSON.stringify(block.data)}${block.previousHash}`)
      state.blocks.push(block)
      return json(res, 201, block)
    }

    if (req.method === 'GET' && url.pathname === '/api/chain/validate') {
      return json(res, 200, { valid: true })
    }

    const searchMatch = url.pathname.match(/^\/api\/chain\/search\/(.+)$/)
    if (req.method === 'GET' && searchMatch) {
      const hash = decodeURIComponent(searchMatch[1])
      for (const block of state.blocks) {
        const records = block.data.records || []
        const leafIndex = records.findIndex(r => r.hash === hash)
        if (leafIndex !== -1) return json(res, 200, { blockIndex: block.index, leafIndex, record: records[leafIndex] })
      }
      return json(res, 404, { error: 'Record not found' })
    }

    const proofMatch = url.pathname.match(/^\/api\/chain\/proof\/(\d+)\/(\d+)$/)
    if (req.method === 'GET' && proofMatch) {
      const block = state.blocks[Number(proofMatch[1])]
      if (!block || !block.data.records) return json(res, 404, { error: 'Proof not found' })
      return json(res, 200, { proof: [], merkleRoot: block.merkleRoot })
    }

    if (req.method === 'POST' && url.pathname === '/api/anchor') {
      return json(res, 200, { success: true, txHash: '0x' + sha256('anchor'), chain: 'mock' })
    }

    return json(res, 404, { error: 'Not found' })
  })

  return {
    listen(port) { return new Promise(resolve => server.listen(port, '127.0.0.1', resolve)) },
    close() { return new Promise(resolve => server.close(resolve)) },
  }
}

const tmpDir = path.join(__dirname, '__tmp_integration__')
if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true })

async function run() {
  const port = 14567 + Math.floor(Math.random() * 1000)
  const srv = createMockChainServer()
  await srv.listen(port)

  const ev = new Evidence({
    dataDir: path.join(tmpDir, 'evidence'),
    chainUrl: `http://127.0.0.1:${port}`,
    anchor: new PublicAnchor({ provider: new MockAnchorProvider() }),
  })

  const testDir = path.join(tmpDir, 'files')
  fs.mkdirSync(testDir, { recursive: true })
  fs.writeFileSync(path.join(testDir, 'photo.jpg'), Buffer.from([0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x10]))
  fs.writeFileSync(path.join(testDir, 'doc.txt'), 'Important evidence document')

  console.log('\n[Integration: Evidence + LocalChain HTTP contract]')

  const r1 = await ev.stampFile(path.join(testDir, 'photo.jpg'))
  assert('stamp file', r1.hash.length === 64)
  assert('stamp has signature', !!r1.signature)

  const r2 = await ev.stampString('关键证据：2026-06-16 拍摄的照片')
  assert('stamp text', r2.hash.length === 64)

  const v1 = await ev.verifyFile(path.join(testDir, 'photo.jpg'))
  assert('verify file match', v1.verified === true)
  assert('verify signature valid', v1.signatureValid === true)

  const committed = await ev.commitToChain()
  assert('commit to chain via HTTP API', !!committed)
  assert('block has merkle', !!committed.merkleRoot)

  const length = await ev.getChainLength()
  assert('chain length via API', length === 2)

  const rootHash = await ev.getChainRootHash()
  assert('chain root hash via API', rootHash.length === 64)

  const valid = await ev.isChainValid()
  assert('chain valid via API', valid === true)

  const found = await ev.findRecordOnChain(r1.hash)
  assert('find record on chain', found !== null)
  assert('found in correct block', found.blockIndex === 1)

  const proof = await ev.getChainProof(1, 0)
  assert('get merkle proof via API', !!proof)

  const chainVerify = ev.verifyRecordSignature(r1)
  assert('verify record signature', chainVerify === true)

  const anchorResult = await ev.anchorToPublic()
  assert('anchor to public', anchorResult.success === true)
  assert('anchor has txHash', !!anchorResult.txHash)

  const s = ev.stats()
  assert('stats total', s.total === 2)

  await srv.close()
  console.log(`\n═══ Integration Results: ${passed} passed, ${failed} failed ═══\n`)
  fs.rmSync(tmpDir, { recursive: true, force: true })
  process.exit(failed > 0 ? 1 : 0)
}

run().catch(async e => {
  console.error(e)
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  process.exit(1)
})
