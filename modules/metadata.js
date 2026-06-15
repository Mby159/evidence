const fs = require('fs')
const path = require('path')

function extractJFIF(buffer) {
  if (buffer.length < 2 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) return null
  const meta = { format: 'JPEG', hasExif: false }
  let offset = 2
  while (offset < buffer.length - 1) {
    if (buffer[offset] !== 0xFF) break
    const marker = buffer[offset + 1]
    if (marker === 0xE1) { meta.hasExif = true; break }
    if (marker === 0xDA || marker === 0xD9) break
    const segLen = buffer.readUInt16BE(offset + 2)
    offset += 2 + segLen
  }
  return meta
}

function extractPNG(buffer) {
  if (buffer.length < 8) return null
  const sig = buffer.slice(0, 8).toString('hex')
  if (sig !== '89504e470d0a1a0a') return null
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  const bitDepth = buffer[24]
  const colorType = buffer[25]
  return { format: 'PNG', width, height, bitDepth, colorType }
}

function extractGIF(buffer) {
  if (buffer.length < 6) return null
  const sig = buffer.slice(0, 3).toString('ascii')
  if (sig !== 'GIF') return null
  const version = buffer.slice(3, 6).toString('ascii')
  const width = buffer.readUInt16LE(6)
  const height = buffer.readUInt16LE(8)
  return { format: `GIF${version}`, width, height }
}

function extractBMP(buffer) {
  if (buffer.length < 26) return null
  const sig = buffer.slice(0, 2).toString('ascii')
  if (sig !== 'BM') return null
  const width = buffer.readInt32LE(18)
  const height = Math.abs(buffer.readInt32LE(22))
  const bpp = buffer.readUInt16LE(28)
  return { format: 'BMP', width, height, bitsPerPixel: bpp }
}

function extractMP4(buffer) {
  if (buffer.length < 8) return null
  for (let i = 0; i < buffer.length - 4; i++) {
    if (buffer.slice(i + 4, i + 8).toString('ascii') === 'ftyp') {
      return { format: 'MP4', ftyp: buffer.slice(i + 8, i + 12).toString('ascii') }
    }
    if (i > 1024) break
  }
  return { format: 'MP4' }
}

function extractWEBP(buffer) {
  if (buffer.length < 12) return null
  if (buffer.slice(0, 4).toString('ascii') !== 'RIFF') return null
  if (buffer.slice(8, 12).toString('ascii') !== 'WEBP') return null
  const chunk = buffer.slice(12, 16).toString('ascii')
  if (chunk === 'VP8 ' && buffer.length >= 30) {
    return { format: 'WebP', variant: 'lossy' }
  }
  if (chunk === 'VP8L' && buffer.length >= 25) {
    return { format: 'WebP', variant: 'lossless' }
  }
  return { format: 'WebP', variant: chunk }
}

function extractTIFF(buffer) {
  if (buffer.length < 4) return null
  const le = buffer[0] === 0x49 && buffer[1] === 0x49
  const be = buffer[0] === 0x4D && buffer[1] === 0x4D
  if (!le && !be) return null
  return { format: 'TIFF', byteOrder: le ? 'little-endian' : 'big-endian' }
}

function extractPDF(buffer) {
  if (buffer.length < 5) return null
  const sig = buffer.slice(0, 5).toString('ascii')
  if (sig !== '%PDF-') return null
  const version = buffer.slice(5, 8).toString('ascii')
  return { format: 'PDF', version: version.trim() }
}

function extractZip(buffer) {
  if (buffer.length < 4) return null
  const sig = buffer.readUInt32LE(0)
  if (sig !== 0x04034b50) return null
  return { format: 'ZIP' }
}

function extract(buffer, filename) {
  if (!buffer || buffer.length < 4) {
    return { filename, size: buffer ? buffer.length : 0, extractedAt: new Date().toISOString() }
  }
  const ext = path.extname(filename).toLowerCase()
  const meta = { filename, size: buffer.length, extractedAt: new Date().toISOString() }

  const detectors = [
    { fn: extractJFIF, exts: ['.jpg', '.jpeg'] },
    { fn: extractPNG, exts: ['.png'] },
    { fn: extractGIF, exts: ['.gif'] },
    { fn: extractBMP, exts: ['.bmp'] },
    { fn: extractMP4, exts: ['.mp4', '.m4v'] },
    { fn: extractWEBP, exts: ['.webp'] },
    { fn: extractTIFF, exts: ['.tiff', '.tif'] },
    { fn: extractPDF, exts: ['.pdf'] },
    { fn: extractZip, exts: ['.zip', '.docx', '.xlsx', '.pptx', '.apk'] },
  ]

  for (const det of detectors) {
    if (det.exts.includes(ext)) {
      const result = det.fn(buffer)
      if (result) Object.assign(meta, result)
      break
    }
  }

  return meta
}

function extractFile(filePath) {
  const buffer = fs.readFileSync(filePath)
  return extract(buffer, path.basename(filePath))
}

module.exports = { extract, extractFile }
