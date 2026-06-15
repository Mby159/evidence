#!/usr/bin/env node
const path = require('path')
const fs = require('fs')
const { Evidence } = require('./evidence')
const { IPFSStore, PinataIPFS, Web3StorageIPFS } = require('./store')

const args = process.argv.slice(2)
const command = args[0]

function usage() {
  console.log(`
Evidence CLI v0.3

Usage:
  evidence stamp <file>          存证文件（哈希 + 签名 + 本地存储 + IPFS可选）
  evidence verify <file>         验证文件（哈希比对 + 签名校验）
  evidence text <text>           文字存证
  evidence list                  列出所有存证记录
  evidence stats                 查看统计
  evidence chain                 查看本地链状态
  evidence commit                提交待上链记录到本地链
  evidence export [file]         导出 JSON
  evidence import <file>         导入 JSON
  evidence clear                 清空所有记录
  evidence info <file>           查看文件元数据

IPFS:
  evidence ipfs config           查看/设置 IPFS 配置
  evidence ipfs test             测试 IPFS 连接
  evidence ipfs fetch <cid>      从 IPFS 获取文件
  evidence ipfs verify <cid>     验证 CID 是否在 IPFS 上
`)
}

function loadIPFSConfig() {
  const configPath = path.join(process.cwd(), '.evidence', 'ipfs.json')
  if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  return null
}

function saveIPFSConfig(config) {
  const dir = path.join(process.cwd(), '.evidence')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'ipfs.json'), JSON.stringify(config, null, 2))
}

function createIPFSStore() {
  const config = loadIPFSConfig()
  if (!config) return null
  if (config.provider === 'pinata') return new IPFSStore({ provider: new PinataIPFS(config) })
  if (config.provider === 'web3storage') return new IPFSStore({ provider: new Web3StorageIPFS(config) })
  return null
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

async function main() {
  const ev = new Evidence({ dataDir: path.join(process.cwd(), '.evidence') })
  const ipfsStore = createIPFSStore()

  if (!command || command === 'help') { usage(); return }

  switch (command) {
    case 'stamp': {
      const filePath = args[1]
      if (!filePath) { console.error('Error: provide file path'); process.exit(1) }
      const abs = path.resolve(filePath)
      if (!fs.existsSync(abs)) { console.error(`Error: file not found: ${abs}`); process.exit(1) }

      if (ipfsStore) {
        ev.ipfs = ipfsStore
        console.log('  ⏳ Uploading to IPFS...')
      }

      const record = await ev.stampFile(abs)
      console.log(`\n  ✓ 存证成功\n`)
      console.log(`  文件: ${record.name}`)
      console.log(`  类型: ${record.type}`)
      console.log(`  大小: ${formatSize(record.size)}`)
      console.log(`  哈希: ${record.hash}`)
      console.log(`  签名: ${record.signature}`)
      console.log(`  时间: ${record.timestamp}`)
      if (record.cid) console.log(`  IPFS: ${record.cid}`)
      else if (record.ipfsError) console.log(`  IPFS: ⚠ ${record.ipfsError}`)
      break
    }

    case 'verify': {
      const filePath = args[1]
      if (!filePath) { console.error('Error: provide file path'); process.exit(1) }
      const abs = path.resolve(filePath)
      if (!fs.existsSync(abs)) { console.error(`Error: file not found: ${abs}`); process.exit(1) }
      const result = await ev.verifyFile(abs)
      if (result.verified) {
        console.log(`\n  ✓ 验证通过`)
        console.log(`  匹配: ${result.matches.length} 条记录`)
        console.log(`  签名: ${result.signatureValid ? '✓ 有效' : '✗ 无效'}`)
        console.log(`  哈希: ${result.hash}`)
        result.matches.forEach((m, i) => {
          console.log(`\n  [${i + 1}] ${m.name} — ${m.timestamp}`)
        })
      } else {
        console.log(`\n  ✗ 未找到匹配存证`)
        console.log(`  哈希: ${result.hash}`)
      }
      break
    }

    case 'text': {
      const text = args.slice(1).join(' ')
      if (!text) { console.error('Error: provide text'); process.exit(1) }
      const record = await ev.stampString(text)
      console.log(`\n  ✓ 文字存证成功`)
      console.log(`  内容: ${record.name}`)
      console.log(`  哈希: ${record.hash}`)
      console.log(`  签名: ${record.signature}`)
      break
    }

    case 'list': {
      const records = ev.getRecords()
      if (!records.length) { console.log('\n  暂无存证记录'); break }
      console.log(`\n  共 ${records.length} 条记录:\n`)
      records.forEach((r, i) => {
        console.log(`  [${i + 1}] ${r.name}`)
        console.log(`      ${r.type} · ${formatSize(r.size)} · ${r.timestamp}`)
        console.log(`      hash: ${r.hash}`)
        if (r.blockIndex !== null) console.log(`      ⛓ block #${r.blockIndex}`)
        console.log('')
      })
      break
    }

    case 'stats': {
      const s = ev.stats()
      const chain = ev.getChainInfo()
      console.log(`\n  总记录: ${s.total}`)
      console.log(`  今日: ${s.today}`)
      console.log(`  链区块: ${chain.length}`)
      console.log(`  链有效: ${chain.valid ? '✓' : '✗'}`)
      break
    }

    case 'chain': {
      const info = ev.getChainInfo()
      console.log(`\n  区块数: ${info.length}`)
      console.log(`  根哈希: ${info.rootHash}`)
      console.log(`  链有效: ${info.valid ? '✓ VALID' : '✗ INVALID'}`)
      break
    }

    case 'commit': {
      const block = ev.commitToChain()
      if (block) console.log(`\n  ✓ 已提交到链，区块 #${block.index}`)
      else console.log('\n  没有新记录需要提交')
      break
    }

    case 'export': {
      const filePath = args[1] || `evidence-${new Date().toISOString().slice(0, 10)}.json`
      ev.exportJSON(path.resolve(filePath))
      console.log(`\n  ✓ 已导出到 ${filePath}`)
      break
    }

    case 'import': {
      const filePath = args[1]
      if (!filePath) { console.error('Error: provide file path'); process.exit(1) }
      const data = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf-8'))
      const count = ev.importJSON(data)
      console.log(`\n  ✓ 已导入 ${count} 条记录`)
      break
    }

    case 'clear': {
      ev.clearRecords()
      console.log('\n  ✓ 已清空所有记录')
      break
    }

    case 'info': {
      const filePath = args[1]
      if (!filePath) { console.error('Error: provide file path'); process.exit(1) }
      const { extractFile } = require('./metadata')
      const meta = extractFile(path.resolve(filePath))
      console.log('\n  文件元数据:')
      Object.entries(meta).forEach(([k, v]) => {
        console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      })
      break
    }

    case 'ipfs': {
      const sub = args[1]
      if (sub === 'config') {
        const config = loadIPFSConfig()
        if (config) {
          console.log(`\n  Provider: ${config.provider}`)
          if (config.provider === 'pinata') console.log(`  API Key: ${config.apiKey ? '***' + config.apiKey.slice(-4) : 'not set'}`)
          if (config.provider === 'web3storage') console.log(`  Token: ${config.token ? '***' + config.token.slice(-4) : 'not set'}`)
        } else {
          console.log('\n  未配置 IPFS。设置方法：')
          console.log('  Pinata:')
          console.log('    echo \'{"provider":"pinata","jwt":"YOUR_JWT"}\' > .evidence/ipfs.json')
          console.log('  Web3.Storage:')
          console.log('    echo \'{"provider":"web3storage","token":"YOUR_TOKEN"}\' > .evidence/ipfs.json')
        }
      } else if (sub === 'test') {
        if (!ipfsStore) { console.error('\n  未配置 IPFS'); process.exit(1) }
        console.log('  ⏳ Testing IPFS connection...')
        const testBuffer = Buffer.from('evidence-test-' + Date.now())
        try {
          const { cid } = await ipfsStore.upload(testBuffer, 'test.txt')
          console.log(`  ✓ 连接成功`)
          console.log(`  CID: ${cid}`)
          console.log(`  Gateway: https://ipfs.io/ipfs/${cid}`)
        } catch (e) {
          console.log(`  ✗ 连接失败: ${e.message}`)
        }
      } else if (sub === 'fetch') {
        const cid = args[2]
        if (!cid) { console.error('Error: provide CID'); process.exit(1) }
        if (!ipfsStore) { console.error('  未配置 IPFS'); process.exit(1) }
        console.log(`  ⏳ Fetching ${cid}...`)
        const buffer = await ipfsStore.fetch(cid)
        const outPath = args[3] || cid
        fs.writeFileSync(path.resolve(outPath), buffer)
        console.log(`  ✓ 已保存到 ${outPath} (${formatSize(buffer.length)})`)
      } else if (sub === 'verify') {
        const cid = args[2]
        if (!cid) { console.error('Error: provide CID'); process.exit(1) }
        if (!ipfsStore) { console.error('  未配置 IPFS'); process.exit(1) }
        const ok = await ipfsStore.verify(cid)
        console.log(ok ? `  ✓ CID ${cid} 存在于 IPFS` : `  ✗ CID ${cid} 未找到`)
      } else {
        console.error(`Unknown ipfs subcommand: ${sub}`)
        console.log('  ipfs config | ipfs test | ipfs fetch <cid> | ipfs verify <cid>')
      }
      break
    }

    default:
      console.error(`Unknown command: ${command}`)
      usage()
      process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
