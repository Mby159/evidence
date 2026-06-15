const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { hash: computeHash } = require('./hash')
const { LocalStore } = require('./store')
const { sign: signData, verify: verifySig, generateKeyPair, loadKeyPair } = require('./sign')
const { LocalChain, PublicAnchor } = require('./chain')
const { ChainClient } = require('./chain-client')

class Evidence {
  constructor(config = {}) {
    this.algorithm = config.algorithm || 'sha-256'
    this.dataDir = config.dataDir || path.join(process.cwd(), '.evidence')
    this.store = config.store || new LocalStore(this.dataDir)
    this.ipfs = config.ipfs || null
    this.keyDir = config.keyDir || path.join(this.dataDir, 'keys')
    this.anchor = config.anchor || new PublicAnchor()
    this._keyPair = null

    // Chain: local or remote API
    if (config.chainUrl) {
      this.chain = null
      this.chainClient = new ChainClient(config.chainUrl)
    } else {
      this.chain = config.chain || new LocalChain(path.join(this.dataDir, 'chain'))
      this.chainClient = null
    }
  }

  _ensureKeys() {
    if (this._keyPair) return this._keyPair
    const privPath = path.join(this.keyDir, 'private.pem')
    if (fs.existsSync(privPath)) {
      this._keyPair = loadKeyPair(this.keyDir)
    } else {
      this._keyPair = generateKeyPair(this.keyDir)
    }
    return this._keyPair
  }

  async stampFile(filePath) {
    const buffer = fs.readFileSync(filePath)
    return this.stampBuffer(buffer, {
      name: path.basename(filePath),
      type: this._guessType(filePath),
    })
  }

  async stampBuffer(buffer, meta = {}) {
    const hash = computeHash(buffer, this.algorithm)
    const keys = this._ensureKeys()
    const signature = signData(hash, keys.privateKey)
    const record = {
      id: crypto.randomUUID(),
      name: meta.name || 'unknown',
      type: meta.type || 'application/octet-stream',
      size: buffer.length,
      hash,
      algorithm: this.algorithm,
      signature,
      timestamp: new Date().toISOString(),
      date: new Date().toISOString().slice(0, 10),
      cid: null,
    }
    if (this.ipfs) {
      try {
        const { cid } = await this.ipfs.upload(buffer)
        record.cid = cid
      } catch (e) {
        record.ipfsError = e.message
      }
    }
    this.store.add(record)
    return record
  }

  async stampString(text) {
    const buffer = Buffer.from(text, 'utf-8')
    return this.stampBuffer(buffer, {
      name: '[text] ' + text.slice(0, 50) + (text.length > 50 ? '...' : ''),
      type: 'text/plain',
    })
  }

  async verifyFile(filePath) {
    const buffer = fs.readFileSync(filePath)
    return this.verifyBuffer(buffer)
  }

  async verifyBuffer(buffer) {
    const hash = computeHash(buffer, this.algorithm)
    const matches = this.store.getByHash(hash)
    let signatureValid = null
    if (matches.length && matches[0].signature) {
      const keys = this._ensureKeys()
      signatureValid = verifySig(hash, matches[0].signature, keys.publicKey)
    }
    return { hash, matches, verified: matches.length > 0, signatureValid }
  }

  verifyRecordSignature(record) {
    if (!record.signature) return false
    const keys = this._ensureKeys()
    return verifySig(record.hash, record.signature, keys.publicKey)
  }

  getPublicKey() { return this._ensureKeys().publicKey }
  getRecords() { return this.store.getAll() }
  getRecord(id) { return this.store.getById(id) }
  getByHash(h) { return this.store.getByHash(h) }
  removeRecord(id) { return this.store.remove(id) }
  clearRecords() { this.store.clear() }
  stats() { return this.store.stats() }

  // ── Chain operations (local or remote) ──

  async commitToChain(records) {
    const target = records || this.store.getAll()
    if (this.chainClient) {
      return await this.chainClient.addBlock(target)
    }
    return this.chain.addRecords(target)
  }

  async getChainRootHash() {
    if (this.chainClient) {
      const status = await this.chainClient.getStatus()
      return status.rootHash
    }
    return this.chain.getRootHash()
  }

  async isChainValid() {
    if (this.chainClient) {
      const result = await this.chainClient.validate()
      return result.valid
    }
    return this.chain.isValid()
  }

  async getChainLength() {
    if (this.chainClient) {
      const status = await this.chainClient.getStatus()
      return status.length
    }
    return this.chain.getChainLength()
  }

  async findRecordOnChain(hash) {
    if (this.chainClient) {
      return await this.chainClient.search(hash)
    }
    return this.chain.findRecord(hash)
  }

  async getChainProof(blockIndex, leafIndex) {
    if (this.chainClient) {
      return await this.chainClient.getProof(blockIndex, leafIndex)
    }
    return this.chain.getProof(blockIndex, leafIndex)
  }

  // ── Anchor ──

  async anchorToPublic() {
    const rootHash = await this.getChainRootHash()
    return await this.anchor.anchor(rootHash)
  }

  async verifyAnchor(rootHash, txHash) {
    return await this.anchor.verify(rootHash, txHash)
  }

  // ── Import/Export ──

  exportJSON(filePath) {
    const data = JSON.stringify(this.store.getAll(), null, 2)
    if (filePath) fs.writeFileSync(filePath, data)
    return data
  }

  importJSON(data) {
    const records = typeof data === 'string' ? JSON.parse(data) : data
    records.forEach(r => this.store.add(r))
    return records.length
  }

  _guessType(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    const types = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp',
      '.mp4': 'video/mp4', '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
      '.pdf': 'application/pdf', '.txt': 'text/plain',
      '.md': 'text/markdown', '.json': 'application/json',
    }
    return types[ext] || 'application/octet-stream'
  }
}

module.exports = { Evidence }
