const fs = require('fs')
const path = require('path')
const { extract, extractFile } = require('../metadata')

let passed = 0
let failed = 0

function assert(name, condition) {
  if (condition) { console.log(`  ✓ ${name}`); passed++ }
  else { console.log(`  ✗ ${name}`); failed++ }
}

const tmpDir = path.join(__dirname, '__tmp_meta__')
fs.mkdirSync(tmpDir, { recursive: true })

// ── Image Detection ──
console.log('\n[Image Detection]')

// Minimal JPEG (SOI + APP1 marker)
const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x10])
assert('JPEG detected', extract(jpeg, 'test.jpg').format === 'JPEG')
assert('JPEG hasExif', extract(jpeg, 'test.jpg').hasExif === true)

const jpegNoExif = Buffer.from([0xFF, 0xD8, 0xFF, 0xDA, 0x00, 0x08])
assert('JPEG no EXIF', extract(jpegNoExif, 'photo.jpg').hasExif === false)

// PNG header + IHDR
const png = Buffer.alloc(33)
png.writeUInt32BE(0x89504e47, 0)  // PNG sig part 1
png.writeUInt32BE(0x0d0a1a0a, 4)  // PNG sig part 2
png.writeUInt32BE(13, 8)          // IHDR length
png.write('IHDR', 12)
png.writeUInt32BE(1920, 16)       // width
png.writeUInt32BE(1080, 20)       // height
png[24] = 8                        // bit depth
png[25] = 2                        // color type (RGB)
assert('PNG detected', extract(png, 'img.png').format === 'PNG')
assert('PNG width', extract(png, 'img.png').width === 1920)
assert('PNG height', extract(png, 'img.png').height === 1080)

// GIF
const gif = Buffer.alloc(13)
gif.write('GIF89a', 0)
gif.writeUInt16LE(640, 6)
gif.writeUInt16LE(480, 8)
assert('GIF detected', extract(gif, 'anim.gif').format === 'GIF89a')
assert('GIF width', extract(gif, 'anim.gif').width === 640)

// BMP
const bmp = Buffer.alloc(30)
bmp.write('BM', 0)
bmp.writeInt32LE(800, 18)
bmp.writeInt32LE(600, 22)
bmp.writeUInt16LE(24, 28)
assert('BMP detected', extract(bmp, 'img.bmp').format === 'BMP')
assert('BMP width', extract(bmp, 'img.bmp').width === 800)

// ── Document Detection ──
console.log('\n[Document Detection]')

const pdf = Buffer.from('%PDF-1.4 some content')
assert('PDF detected', extract(pdf, 'doc.pdf').format === 'PDF')
assert('PDF version', extract(pdf, 'doc.pdf').version === '1.4')

const zip = Buffer.alloc(10)
zip.writeUInt32LE(0x04034b50, 0)
assert('ZIP detected', extract(zip, 'archive.zip').format === 'ZIP')
assert('ZIP as DOCX', extract(zip, 'file.docx').format === 'ZIP')

// ── Video Detection ──
console.log('\n[Video Detection]')

const mp4 = Buffer.alloc(12)
mp4.write('ftyp', 4)
assert('MP4 detected', extract(mp4, 'video.mp4').format === 'MP4')

// ── WebP Detection ──
console.log('\n[WebP Detection]')

const webp = Buffer.alloc(20)
webp.write('RIFF', 0)
webp.writeUInt32LE(100, 4)
webp.write('WEBP', 8)
webp.write('VP8 ', 12)
assert('WebP detected', extract(webp, 'img.webp').format === 'WebP')

// ── TIFF Detection ──
console.log('\n[TIFF Detection]')

const tiffLE = Buffer.from([0x49, 0x49, 0x2A, 0x00])
assert('TIFF LE detected', extract(tiffLE, 'img.tiff').format === 'TIFF')
assert('TIFF byte order', extract(tiffLE, 'img.tiff').byteOrder === 'little-endian')

const tiffBE = Buffer.from([0x4D, 0x4D, 0x00, 0x2A])
assert('TIFF BE detected', extract(tiffBE, 'img.tif').byteOrder === 'big-endian')

// ── Fallback ──
console.log('\n[Fallback]')

const unknown = Buffer.from('random data here')
const result = extract(unknown, 'data.xyz')
assert('unknown returns meta', result.filename === 'data.xyz')
assert('unknown returns size', result.size === 16)

// ── extractFile ──
console.log('\n[extractFile]')

fs.writeFileSync(path.join(tmpDir, 'test.png'), png)
const fileMeta = extractFile(path.join(tmpDir, 'test.png'))
assert('extractFile works', fileMeta.format === 'PNG')
assert('extractFile has filename', fileMeta.filename === 'test.png')

// ── Edge Cases ──
console.log('\n[Edge Cases]')

assert('empty buffer returns meta', extract(Buffer.alloc(0), 'x.jpg') !== null)
assert('tiny buffer returns meta', extract(Buffer.from([0xFF]), 'x.jpg') !== null)
assert('no extension', extract(png, 'noext') !== null)

console.log(`\n═══ Metadata Results: ${passed} passed, ${failed} failed ═══\n`)

fs.rmSync(tmpDir, { recursive: true, force: true })
process.exit(failed > 0 ? 1 : 0)
