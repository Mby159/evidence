const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const DEFAULT_OPTS = { modulusLength: 2048 }

function generateKeyPair(outputDir, opts = {}) {
  const options = { ...DEFAULT_OPTS, ...opts }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: options.modulusLength,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  if (outputDir) {
    fs.mkdirSync(outputDir, { recursive: true })
    const privPath = path.join(outputDir, 'private.pem')
    const pubPath = path.join(outputDir, 'public.pem')
    fs.writeFileSync(privPath, privateKey)
    fs.writeFileSync(pubPath, publicKey)
    return { privateKey, publicKey, privPath, pubPath }
  }

  return { privateKey, publicKey }
}

function loadKeyPair(keyDir) {
  const privPath = path.join(keyDir, 'private.pem')
  const pubPath = path.join(keyDir, 'public.pem')
  if (!fs.existsSync(privPath)) throw new Error(`Private key not found: ${privPath}`)
  if (!fs.existsSync(pubPath)) throw new Error(`Public key not found: ${pubPath}`)
  return {
    privateKey: fs.readFileSync(privPath, 'utf-8'),
    publicKey: fs.readFileSync(pubPath, 'utf-8'),
  }
}

function sign(data, privateKey) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const signature = crypto.sign('sha256', buf, privateKey)
  return signature.toString('base64')
}

function verify(data, signatureBase64, publicKey) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const sig = Buffer.from(signatureBase64, 'base64')
  return crypto.verify('sha256', buf, publicKey, sig)
}

function signFile(filePath, privateKey) {
  const buffer = fs.readFileSync(filePath)
  return sign(buffer, privateKey)
}

function signHash(hash, privateKey) {
  return sign(hash, privateKey)
}

module.exports = { generateKeyPair, loadKeyPair, sign, verify, signFile, signHash }
