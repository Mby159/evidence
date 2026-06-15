const fs = require('fs')
const path = require('path')

let _fetch = typeof fetch !== 'undefined' ? fetch : null
if (!_fetch) {
  try { _fetch = require('node-fetch') } catch { _fetch = null }
}
function getFetch() {
  if (!_fetch) throw new Error('fetch not available. Install node-fetch or use Node 18+.')
  return _fetch
}

class LocalStore {
  constructor(dataDir) {
    this.dataDir = dataDir
    this.recordsFile = path.join(dataDir, 'records.json')
    this.filesDir = path.join(dataDir, 'files')
    fs.mkdirSync(dataDir, { recursive: true })
    fs.mkdirSync(this.filesDir, { recursive: true })
    this._load()
  }

  _load() {
    if (fs.existsSync(this.recordsFile)) {
      this.records = JSON.parse(fs.readFileSync(this.recordsFile, 'utf-8'))
    } else {
      this.records = []
    }
  }

  _save() {
    fs.writeFileSync(this.recordsFile, JSON.stringify(this.records, null, 2))
  }

  add(record) { this.records.unshift(record); this._save(); return record }
  getAll() { return [...this.records] }
  getById(id) { return this.records.find(r => r.id === id) || null }
  getByHash(hash) { return this.records.filter(r => r.hash === hash) }

  remove(id) {
    const idx = this.records.findIndex(r => r.id === id)
    if (idx === -1) return false
    this.records.splice(idx, 1)
    this._save()
    return true
  }

  clear() { this.records = []; this._save() }

  stats() {
    return {
      total: this.records.length,
      today: this.records.filter(r => r.date === new Date().toISOString().slice(0, 10)).length,
      totalSize: this.records.reduce((s, r) => s + (r.size || 0), 0),
    }
  }
}

class PinataIPFS {
  constructor(config = {}) {
    this.apiKey = config.apiKey || null
    this.secretKey = config.secretKey || null
    this.jwt = config.jwt || null
    this.gateway = config.gateway || 'https://gateway.pinata.cloud/ipfs'
    this.apiUrl = 'https://api.pinata.cloud'
  }

  _headers() {
    if (this.jwt) return { Authorization: `Bearer ${this.jwt}` }
    if (this.apiKey && this.secretKey) return { pinata_api_key: this.apiKey, pinata_secret_api_key: this.secretKey }
    throw new Error('Pinata: need jwt or apiKey+secretKey')
  }

  async upload(buffer, filename = 'evidence-file') {
    const fetch = getFetch()
    const form = new FormData()
    form.append('file', new Blob([buffer]), filename)

    const metadata = JSON.stringify({ name: filename })
    form.append('pinataMetadata', metadata)

    const options = JSON.stringify({ cidVersion: 1 })
    form.append('pinataOptions', options)

    const res = await fetch(`${this.apiUrl}/pinning/pinFileToIPFS`, {
      method: 'POST',
      headers: this._headers(),
      body: form,
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Pinata upload failed (${res.status}): ${err}`)
    }

    const data = await res.json()
    return { cid: data.IpfsHash, size: data.PinSize, timestamp: data.Timestamp }
  }

  async fetch(cid) {
    const fetch = getFetch()
    const res = await fetch(`${this.gateway}/${cid}`)
    if (!res.ok) throw new Error(`IPFS fetch failed: ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }

  async pin(cid) {
    const fetch = getFetch()
    const res = await fetch(`${this.apiUrl}/pinning/pinByHash`, {
      method: 'POST',
      headers: { ...this._headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashToPin: cid }),
    })
    if (!res.ok) throw new Error(`Pinata pin failed: ${res.status}`)
    return await res.json()
  }

  async unpin(cid) {
    const fetch = getFetch()
    const res = await fetch(`${this.apiUrl}/pinning/unpin/${cid}`, {
      method: 'DELETE',
      headers: this._headers(),
    })
    if (!res.ok) throw new Error(`Pinata unpin failed: ${res.status}`)
    return true
  }

  async listpins({ status = 'pinned', limit = 100, offset = 0 } = {}) {
    const fetch = getFetch()
    const params = new URLSearchParams({ status, limit: String(limit), offset: String(offset) })
    const res = await fetch(`${this.apiUrl}/data/pinList?${params}`, { headers: this._headers() })
    if (!res.ok) throw new Error(`Pinata list failed: ${res.status}`)
    return await res.json()
  }

  async verify(cid) {
    try {
      const fetch = getFetch()
      const res = await fetch(`${this.gateway}/${cid}`, { method: 'HEAD' })
      return res.ok
    } catch { return false }
  }
}

class Web3StorageIPFS {
  constructor(config = {}) {
    this.token = config.token
    this.gateway = config.gateway || 'https://w3s.link/ipfs'
    if (!this.token) throw new Error('Web3.Storage: token required')
  }

  _headers() {
    return { Authorization: `Bearer ${this.token}` }
  }

  async upload(buffer, filename = 'evidence-file') {
    const fetch = getFetch()
    const form = new FormData()
    form.append('file', new Blob([buffer]), filename)

    const res = await fetch('https://api.web3.storage/upload', {
      method: 'POST',
      headers: this._headers(),
      body: form,
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Web3.Storage upload failed (${res.status}): ${err}`)
    }

    const data = await res.json()
    return { cid: data.cid, size: buffer.length }
  }

  async fetch(cid) {
    const fetch = getFetch()
    const res = await fetch(`${this.gateway}/${cid}`)
    if (!res.ok) throw new Error(`IPFS fetch failed: ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }

  async verify(cid) {
    try {
      const fetch = getFetch()
      const res = await fetch(`${this.gateway}/${cid}`, { method: 'HEAD' })
      return res.ok
    } catch { return false }
  }
}

class IPFSStore {
  constructor(config = {}) {
    this.provider = config.provider || null
    this.gateway = config.gateway || 'https://ipfs.io'
  }

  async upload(buffer, filename) {
    if (!this.provider) throw new Error('No IPFS provider configured')
    return await this.provider.upload(buffer, filename)
  }

  async fetch(cid) {
    if (this.provider && this.provider.fetch) return await this.provider.fetch(cid)
    const fetch = getFetch()
    const res = await fetch(`${this.gateway}/ipfs/${cid}`)
    if (!res.ok) throw new Error(`IPFS fetch failed: ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }

  async pin(cid) {
    if (this.provider && this.provider.pin) return await this.provider.pin(cid)
    throw new Error('Pin not supported by current provider')
  }

  async verify(cid) {
    if (this.provider && this.provider.verify) return await this.provider.verify(cid)
    const fetch = getFetch()
    const res = await fetch(`${this.gateway}/ipfs/${cid}`, { method: 'HEAD' })
    return res.ok
  }

  async unpin(cid) {
    if (this.provider && this.provider.unpin) return await this.provider.unpin(cid)
    throw new Error('Unpin not supported by current provider')
  }
}

module.exports = { LocalStore, IPFSStore, PinataIPFS, Web3StorageIPFS }
