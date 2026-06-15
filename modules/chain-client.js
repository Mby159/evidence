let _fetch = typeof fetch !== 'undefined' ? fetch : null
if (!_fetch) { try { _fetch = require('node-fetch') } catch { _fetch = null } }
function getFetch() {
  if (!_fetch) throw new Error('fetch not available. Install node-fetch or use Node 18+.')
  return _fetch
}

class ChainClient {
  constructor(baseUrl = 'http://localhost:3456') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async _get(path) {
    const fetch = getFetch()
    const res = await fetch(`${this.baseUrl}${path}`)
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`)
    return await res.json()
  }

  async _post(path, body) {
    const fetch = getFetch()
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(`POST ${path} failed: ${res.status} ${err.error || ''}`)
    }
    return await res.json()
  }

  async health() { return await this._get('/api/health') }

  async getStatus() { return await this._get('/api/chain') }

  async getBlocks(offset = 0, limit = 50) {
    return await this._get(`/api/chain/blocks?offset=${offset}&limit=${limit}`)
  }

  async getBlock(index) { return await this._get(`/api/chain/block/${index}`) }

  async addBlock(records) { return await this._post('/api/chain/blocks', { records }) }

  async search(hash) { return await this._get(`/api/chain/search/${hash}`) }

  async getProof(blockIndex, leafIndex) {
    return await this._get(`/api/chain/proof/${blockIndex}/${leafIndex}`)
  }

  async verifyRecord(record, blockIndex, leafIndex) {
    return await this._post('/api/chain/verify', { record, blockIndex, leafIndex })
  }

  async validate() { return await this._get('/api/chain/validate') }

  async anchor() { return await this._post('/api/anchor', {}) }

  async verifyAnchor(rootHash, txHash) {
    return await this._get(`/api/anchor/verify?rootHash=${rootHash}&txHash=${txHash}`)
  }
}

module.exports = { ChainClient }
