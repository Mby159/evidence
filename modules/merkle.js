const crypto = require('crypto')

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function hashPair(left, right) {
  return sha256(left + right)
}

class MerkleTree {
  constructor(leaves) {
    this.leaves = leaves.map(l => (typeof l === 'string' ? sha256(l) : l))
    this.layers = this._build(this.leaves)
    this.root = this.layers[this.layers.length - 1][0] || sha256('')
  }

  _build(leaves) {
    if (leaves.length === 0) return [[sha256('')]]
    const layers = [leaves]
    let current = leaves
    while (current.length > 1) {
      const next = []
      for (let i = 0; i < current.length; i += 2) {
        if (i + 1 < current.length) {
          next.push(hashPair(current[i], current[i + 1]))
        } else {
          next.push(current[i])
        }
      }
      layers.push(next)
      current = next
    }
    return layers
  }

  getProof(leafIndex) {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) return null
    const proof = []
    let index = leafIndex
    for (let layer = 0; layer < this.layers.length - 1; layer++) {
      const currentLayer = this.layers[layer]
      const isRight = index % 2 === 1
      const pairIndex = isRight ? index - 1 : index + 1
      if (pairIndex < currentLayer.length) {
        proof.push({ hash: currentLayer[pairIndex], right: !isRight })
      }
      index = Math.floor(index / 2)
    }
    return proof
  }

  static verifyProof(leafHash, proof, root) {
    let current = leafHash
    for (const { hash, right } of proof) {
      current = right ? hashPair(current, hash) : hashPair(hash, current)
    }
    return current === root
  }

  getLeaves() { return [...this.leaves] }
  getRoot() { return this.root }
  getHeight() { return this.layers.length }
}

function buildFromRecords(records) {
  const leaves = records.map(r => sha256(JSON.stringify(r)))
  return new MerkleTree(leaves)
}

module.exports = { MerkleTree, sha256, hashPair, buildFromRecords }
