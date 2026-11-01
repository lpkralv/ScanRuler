// SPDX-License-Identifier: AGPL-3.0-only
// Densify on the bracket of issue #42 as a CAD export tessellates it, and on
// a box of two triangles a face: the surface, its volume and its bounds as
// they were, every old point where it was under its own number, no edge
// left longer than asked, the mesh still closed — and the refusals: nothing
// to split, and a mesh that would grow past its limit, with a length that
// fits.
import { describe, expect, it } from 'vitest'
import { buildMeshGraph } from '../../../src/core/geometry/buildGraph'
import { tetraVolume6 } from '../../../src/core/geometry/centroid'
import { extentOf } from '../../../src/core/geometry/bounds'
import { boxMesh } from '../../../tests/helpers'
import { cadBracket } from '../../../tests/cadBracket'
import { closedness } from '../core/boolean'
import { defaultDensifyEdge, densifyMesh, longestEdge } from '../core/densify'

const volume = (p: Float32Array, idx: Uint32Array) => {
  let six = 0
  for (let t = 0; t < idx.length; t += 3) six += tetraVolume6(p, idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3)
  return six / 6
}

describe('densify', () => {
  it('fills the bracket’s faces with points and leaves its shape as it was', async () => {
    const { positions, indices } = await cadBracket()
    const n = positions.length / 3
    expect([n, indices.length / 3]).toEqual([876, 1772])
    const d = densifyMesh(positions, indices, n, { maxEdge: 1 })
    const m = d.positions.length / 3

    // No edge longer than asked — but for the rounding of a double to a float.
    expect(d.report.longestBefore).toBeGreaterThan(60)
    expect(longestEdge(d.positions, d.indices)).toBeLessThanOrEqual(1 + 1e-5)
    expect(d.report).toMatchObject({ maxEdge: 1, verticesBefore: 876, trianglesBefore: 1772, vertices: m, triangles: d.indices.length / 3 })
    expect(m).toBeGreaterThan(50 * n)

    // The same solid: volume and bounds, and closed as it was.
    expect(volume(d.positions, d.indices)).toBeCloseTo(volume(positions, indices), 3)
    const before = extentOf(positions, n)
    const after = extentOf(d.positions, m)
    for (let k = 0; k < 3; k++) {
      expect(after.min[k]).toBeCloseTo(before.min[k], 5)
      expect(after.max[k]).toBeCloseTo(before.max[k], 5)
    }
    expect(closedness(indices, n)).toMatchObject({ open: 0, bad: 0 })
    expect(closedness(d.indices, m)).toMatchObject({ open: 0, bad: 0 })

    // Every old point where it was, under its own number — the bore's rim
    // still on its 4 mm circle.
    expect(Array.from(d.vertexMap)).toEqual(Array.from({ length: n }, (_, v) => v))
    expect(Array.from(d.positions.subarray(0, n * 3))).toEqual(Array.from(positions))
    let onRim = 0
    for (let v = 0; v < n; v++) {
      const r = Math.hypot(positions[v * 3], positions[v * 3 + 1])
      if (Math.abs(r - 4) < 0.01) {
        expect(Math.hypot(d.positions[v * 3], d.positions[v * 3 + 1])).toBeCloseTo(4, 5)
        onRim++
      }
    }
    expect(onRim).toBeGreaterThanOrEqual(2 * 96)

  })

  it('makes every new point on the face it was made on', () => {
    // Twelve triangles of a 10 mm box, two a face, split down to 0.7 mm.
    const soup = boxMesh(10, 1)
    const box = buildMeshGraph({ kind: 'soup', positions: soup })
    expect(box.triangleCount).toBe(12)
    const d = densifyMesh(box.positions, box.indices, box.vertexCount, { maxEdge: 0.7 })
    expect(longestEdge(d.positions, d.indices)).toBeLessThanOrEqual(0.7 + 1e-5)
    for (let v = 0; v < d.positions.length / 3; v++) {
      const p = [d.positions[v * 3], d.positions[v * 3 + 1], d.positions[v * 3 + 2]].map(Math.abs)
      // On a face: one coordinate at the half-size, none past it.
      expect(Math.max(...p)).toBeCloseTo(5, 5)
    }
    expect(volume(d.positions, d.indices)).toBeCloseTo(1000, 3)
    expect(closedness(d.indices, d.positions.length / 3)).toMatchObject({ open: 0, bad: 0 })
  })

  it('refuses with nothing to split, and past the limit names a length that fits', async () => {
    const { positions, indices } = await cadBracket()
    const n = positions.length / 3
    expect(() => densifyMesh(positions, indices, n, { maxEdge: 100 })).toThrow(/No edge is longer than 100 mm — the longest is 60\.3 mm/)
    expect(() => densifyMesh(positions, indices, n, { maxEdge: 0 })).toThrow(/more than zero/)

    let message = ''
    try {
      densifyMesh(positions, indices, n, { maxEdge: 1, maxVertices: 20_000 })
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toMatch(/^Densifying to 1 mm would make (about|more than) [\d,]+ points, and a mesh may have 20,000 here — take an edge of [\d.]+ mm or longer\.$/)
    const fits = Number(/edge of ([\d.]+) mm/.exec(message)![1])
    expect(fits).toBeGreaterThan(1)
    const d = densifyMesh(positions, indices, n, { maxEdge: fits, maxVertices: 20_000 })
    expect(d.report.vertices).toBeLessThanOrEqual(20_000)
    expect(longestEdge(d.positions, d.indices)).toBeLessThanOrEqual(fits + 1e-5)
  })

  it('starts at a hundredth of the part, on the 1-2-5 steps', () => {
    // The bracket's diagonal, 76.7 mm, and a part ten times its size.
    expect(defaultDensifyEdge(Math.hypot(60, 40, 26))).toBe(1)
    expect(defaultDensifyEdge(767)).toBe(10)
    expect(defaultDensifyEdge(150)).toBe(2)
  })
})
