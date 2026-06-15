const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { MerkleTree, sha256 } = require('./merkle')

class Block {
  constructor(index, data, previousHash = '') {
    this.index = index
    this.timestamp = new Date().toISOString()
    this.data = data
    this.previousHash = previousHash
    this.nonce = 0
    this.hash = this.computeHash()
  }

  computeHash() {
    const payload = this.index + this.timestamp + JSON.stringify(this.data) + this.previousHash + this.nonce
    return crypto.createHash('sha256').update(payload).digest('hex')
  }

  mineBlock(difficulty = 0) {
    if (difficulty === 0) return
    const prefix = '0'.repeat(difficulty)
    while (!this.hash.startsWith(prefix)) {
      this.nonce++
      this.hash = this.computeHash()
    }
  }
}

class LocalChain {
  constructor(chainDir, opts = {}) {
    this.chainDir = chainDir
    this.chainFile = path.join(chainDir, 'chain.json')
    this.difficulty = opts.difficulty || 0
    fs.mkdirSync(chainDir, { recursive: true })
    this._load()
  }

  _load() {
    if (fs.existsSync(this.chainFile)) {
      this.chain = JSON.parse(fs.readFileSync(this.chainFile, 'utf-8'))
    } else {
      this.chain = [this._createGenesis()]
    }
  }

  _save() {
    fs.writeFileSync(this.chainFile, JSON.stringify(this.chain, null, 2))
  }

  _createGenesis() {
    const genesis = new Block(0, { type: 'genesis', message: 'Evidence Chain Genesis' }, '0')
    return { index: 0, timestamp: genesis.timestamp, data: genesis.data, previousHash: '0', hash: genesis.hash, nonce: 0 }
  }

  addRecords(records) {
    const lastBlock = this.chain[this.chain.length - 1]
    const tree = new MerkleTree(records.map(r => JSON.stringify(r)))
    const merkleRoot = tree.getRoot()
    const block = new Block(lastBlock.index + 1, { type: 'evidence_batch', records, merkleRoot }, lastBlock.hash)
    block.mineBlock(this.difficulty)
    const blockData = { index: block.index, timestamp: block.timestamp, data: block.data, previousHash: block.previousHash, hash: block.hash, nonce: block.nonce, merkleRoot }
    this.chain.push(blockData)
    this._save()
    return blockData
  }

  getProof(blockIndex, leafIndex) {
    const block = this.chain[blockIndex]
    if (!block || !block.data.records) return null
    const tree = new MerkleTree(block.data.records.map(r => JSON.stringify(r)))
    return tree.getProof(leafIndex)
  }

  verifyRecordInBlock(record, blockIndex, leafIndex) {
    const block = this.chain[blockIndex]
    if (!block || !block.merkleRoot) return false
    const proof = this.getProof(blockIndex, leafIndex)
    if (!proof) return false
    const leafHash = sha256(JSON.stringify(record))
    return MerkleTree.verifyProof(leafHash, proof, block.merkleRoot)
  }

  findRecord(hash) {
    for (const block of this.chain) {
      if (!block.data.records) continue
      const idx = block.data.records.findIndex(r => r.hash === hash)
      if (idx !== -1) return { blockIndex: block.index, leafIndex: idx, record: block.data.records[idx] }
    }
    return null
  }

  getBlockByIndex(index) { return this.chain[index] || null }
  getLatestBlock() { return this.chain[this.chain.length - 1] }
  getChainLength() { return this.chain.length }

  getRootHash() {
    const hashes = this.chain.map(b => b.hash)
    return crypto.createHash('sha256').update(hashes.join('')).digest('hex')
  }

  isValid() {
    for (let i = 1; i < this.chain.length; i++) {
      const current = this.chain[i]
      const previous = this.chain[i - 1]
      if (current.previousHash !== previous.hash) return false
      const payload = current.index + current.timestamp + JSON.stringify(current.data) + current.previousHash + current.nonce
      const recomputed = crypto.createHash('sha256').update(payload).digest('hex')
      if (recomputed !== current.hash) return false
    }
    return true
  }

  getAllBlocks() { return [...this.chain] }
}

class PublicAnchor {
  constructor(config = {}) {
    this.provider = config.provider || null
    this.chain = config.chain || 'ethereum-l2'
    this.apiKey = config.apiKey || null
    this.endpoint = config.endpoint || null
  }

  async anchor(rootHash) {
    if (!this.provider) return { success: false, error: 'No provider configured', txHash: null, simulated: true }
    try { return await this.provider.anchor(rootHash, this) }
    catch (e) { return { success: false, error: e.message, txHash: null } }
  }

  async verify(rootHash, txHash) {
    if (!this.provider) return { verified: false, error: 'No provider configured' }
    return await this.provider.verify(rootHash, txHash, this)
  }
}

class MockAnchorProvider {
  constructor() { this.anchored = [] }

  async anchor(rootHash, ctx) {
    const txHash = '0x' + crypto.randomBytes(32).toString('hex')
    this.anchored.push({ rootHash, txHash, chain: ctx.chain, timestamp: new Date().toISOString() })
    return { success: true, txHash, chain: ctx.chain }
  }

  async verify(rootHash, txHash) {
    const match = this.anchored.find(a => a.rootHash === rootHash && a.txHash === txHash)
    return { verified: !!match, match: match || null }
  }
}

module.exports = { Block, LocalChain, PublicAnchor, MockAnchorProvider }
