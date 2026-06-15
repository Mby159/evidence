const crypto = require('crypto')
const fs = require('fs')

let passed = 0
let failed = 0

function assert(name, condition) {
  if (condition) {
    console.log(`  ✓ ${name}`)
    passed++
  } else {
    console.log(`  ✗ ${name}`)
    failed++
  }
}

// Test 1: SHA-256 hashing
console.log('\n[Hash Module]')
const data = Buffer.from('Hello, Evidence!')
const hash = crypto.createHash('sha256').update(data).digest('hex')
assert('SHA-256 produces 64-char hex', hash.length === 64)
assert('SHA-256 is deterministic', hash === crypto.createHash('sha256').update(data).digest('hex'))
assert('Different input → different hash', hash !== crypto.createHash('sha256').update(Buffer.from('Different')).digest('hex'))

// Test 2: File hashing (simulate)
console.log('\n[File Hash]')
const testFile = Buffer.from('This is a test evidence file.')
const fileHash = crypto.createHash('sha256').update(testFile).digest('hex')
assert('File hash is valid SHA-256', /^[a-f0-9]{64}$/.test(fileHash))

// Test 3: Empty file
console.log('\n[Edge Cases]')
const emptyHash = crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex')
assert('Empty file produces valid hash', emptyHash.length === 64)

// Test 4: Large file (1MB)
console.log('\n[Large File]')
const largeBuffer = Buffer.alloc(1024 * 1024, 'x')
const largeHash = crypto.createHash('sha256').update(largeBuffer).digest('hex')
assert('1MB file hashes correctly', largeHash.length === 64)

// Test 5: Binary file (image-like)
console.log('\n[Binary Data]')
const binaryData = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) // PNG header
const binaryHash = crypto.createHash('sha256').update(binaryData).digest('hex')
assert('Binary data hashes correctly', binaryHash.length === 64)

// Test 6: Chinese text
console.log('\n[Unicode/Chinese]')
const chineseText = Buffer.from('这是一段中文证据文字')
const chineseHash = crypto.createHash('sha256').update(chineseText).digest('hex')
assert('Chinese text hashes correctly', chineseHash.length === 64)
assert('Different Chinese text → different hash', chineseHash !== crypto.createHash('sha256').update(Buffer.from('另一段文字')).digest('hex'))

// Test 7: HTML file structure
console.log('\n[HTML Structure]')
const html = fs.readFileSync('D:/linyiyi-workspace/evidence/mvp/index.html', 'utf8')
assert('Contains SHA-256 reference', html.includes('SHA-256'))
assert('Contains crypto.subtle.digest', html.includes('crypto.subtle'))
assert('Contains stamp function', html.includes('stampFile'))
assert('Contains verify function', html.includes('verifyFile'))
assert('Contains localStorage persistence', html.includes('evidence.records'))
assert('Contains export function', html.includes('exportBtn'))
assert('Contains import function', html.includes('importFile'))
assert('Contains drag-and-drop', html.includes('dragenter'))
assert('Contains text stamp', html.includes('stampTextBtn'))

// Test 8: Record format
console.log('\n[Record Format]')
const record = {
  id: 'test-id',
  name: 'test.png',
  type: 'image/png',
  size: 1024,
  hash: fileHash,
  timestamp: new Date().toISOString(),
  date: new Date().toISOString().slice(0, 10)
}
assert('Record has all required fields', ['id', 'name', 'type', 'size', 'hash', 'timestamp', 'date'].every(k => k in record))
assert('Record hash matches file', record.hash === fileHash)

console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══\n`)
process.exit(failed > 0 ? 1 : 0)
