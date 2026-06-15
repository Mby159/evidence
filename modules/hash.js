const crypto = require('crypto')

const ALGORITHMS = {
  'sha-256': { algo: 'sha256', size: 32, name: 'SHA-256' },
  'sha-512': { algo: 'sha512', size: 64, name: 'SHA-512' },
  'sha3-256': { algo: 'sha3-256', size: 32, name: 'SHA3-256' },
}

function hex(buffer) {
  return Buffer.from(buffer).toString('hex')
}

function hash(data, algorithm = 'sha-256') {
  const config = ALGORITHMS[algorithm]
  if (!config) throw new Error(`Unsupported algorithm: ${algorithm}. Supported: ${Object.keys(ALGORITHMS).join(', ')}`)
  const buf = typeof data === 'string' ? Buffer.from(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)
  return hex(crypto.createHash(config.algo).update(buf).digest())
}

function hashFile(filePath, algorithm = 'sha-256') {
  const fs = require('fs')
  const buffer = fs.readFileSync(filePath)
  return { hash: hash(buffer, algorithm), size: buffer.length }
}

function hashString(str, algorithm = 'sha-256') {
  return hash(Buffer.from(str, 'utf-8'), algorithm)
}

function algorithms() {
  return Object.keys(ALGORITHMS)
}

module.exports = { hash, hashFile, hashString, algorithms, ALGORITHMS }
