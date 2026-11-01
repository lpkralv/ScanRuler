// SPDX-License-Identifier: AGPL-3.0-only
// Densify: triangles split until no edge is longer than a length. An STL
// exported from CAD has its vertices only on edges and rims — a flat face is
// a few long triangles from one rim to the next, with no point inside it —
// and everything that reads a surface off its vertices sees nothing there:
// a plane fitted round a vertex spans a crease, a region grown over the
// points has none to grow on. The same surface with points spread over it
// reads as what it is.
//
// Every new point is the middle of an edge, so it lies on the triangles it
// was made on: the surface does not move, nor the volume it encloses, and
// a vertex on a rim — on the circle a bore was tessellated from — stays
// exactly where it was. Each round splits at its middle every edge that is
// the longest side of a triangle and longer than the length, once for all
// the triangles on it, so the mesh stays conforming (no point lands on
// another triangle's edge without being one of its corners); a triangle
// then becomes two, three or four by how many of its edges split. This is
// longest-edge bisection (M.-C. Rivara, 1984), written from the paper's
// description.

import type { EditedMesh } from './edit'
import { round125 } from './reduce'

export interface DensifySettings {
  /** No edge longer than this is left, mm. */
  maxEdge: number
  /** The most vertices the result may have — the refusal's threshold. */
  maxVertices?: number
}

export interface DensifyReport {
  maxEdge: number
  verticesBefore: number
  trianglesBefore: number
  vertices: number
  triangles: number
  /** The longest edge before and after, mm. */
  longestBefore: number
  longestAfter: number
  /** Rounds of splitting it took. */
  rounds: number
}

/** The most vertices a densified mesh may have, unless asked: about the
 *  size of a fine scan, which the worker, the viewport and every fit
 *  handle — four million triangles, give or take. */
export const DENSIFY_VERTEX_LIMIT = 2_000_000

/** Rounds of splitting before giving up: every two or three halve the
 *  longest edges, so a hundred go from a kilometre to well under a
 *  micrometre. */
const MAX_ROUNDS = 100

/** The edge length a densify starts with: a hundredth of the part's
 *  diagonal, on the 1-2-5 steps — 1 mm on a part a hand's width across,
 *  dense enough that a plane fitted round a point sees a face and a region
 *  has points to grow over. */
export function defaultDensifyEdge(bboxDiagonal: number): number {
  return round125(bboxDiagonal / 100)
}

/** The vertices a densify to `maxEdge` makes, roughly: every edge is
 *  halved until it is short enough, which leaves it in pieces between half
 *  the length and the length, and the faces between are filled. A CAD
 *  export is mostly long slivers fanned from rim to rim, and splitting a
 *  sliver's long sides makes slivers again, a point inside it for every one
 *  on its sides — so the edges count twice; the faces add about four points
 *  to the length's square. Both weights are read off CAD exports densified
 *  from 5 mm down to 0.25 mm, which this lands within a factor of two of. */
export function densifyEstimate(positions: Float32Array, indices: Uint32Array, vertexCount: number, maxEdge: number): number {
  let area = 0
  let edges = 0
  for (let t = 0; t < indices.length; t += 3) {
    area += triangleArea(positions, indices[t], indices[t + 1], indices[t + 2])
    for (let e = 0; e < 3; e++) {
      // Each edge is met from both its triangles: half of it from each.
      const l = Math.sqrt(dist2f(positions, indices[t + e], indices[t + ((e + 1) % 3)]))
      if (l > maxEdge) edges += (Math.pow(2, Math.ceil(Math.log2(l / maxEdge))) - 1) / 2
    }
  }
  return Math.round(vertexCount + 2 * edges + (4 * area) / (maxEdge * maxEdge))
}

/** The shortest edge on the 1-2-5 steps, from `maxEdge` up, whose densify
 *  comes in under `limit` vertices with room `margin` to spare. */
function fittingEdge(positions: Float32Array, indices: Uint32Array, vertexCount: number, maxEdge: number, limit: number, margin: number): number {
  let edge = round125(maxEdge * 1.0001)
  for (let i = 0; i < 30 && densifyEstimate(positions, indices, vertexCount, edge) * margin > limit; i++) edge = round125(edge * 1.5)
  return edge
}

export function densifyMesh(
  positions: Float32Array,
  indices: Uint32Array,
  vertexCount: number,
  settings: DensifySettings,
  onProgress?: (text: string) => void,
): EditedMesh & { report: DensifyReport } {
  const { maxEdge } = settings
  const limit = settings.maxVertices ?? DENSIFY_VERTEX_LIMIT
  if (!(maxEdge > 0) || !Number.isFinite(maxEdge)) throw new Error('The edge length must be more than zero.')
  const longestBefore = longestEdge(positions, indices)
  if (!(longestBefore > maxEdge)) {
    throw new Error(`No edge is longer than ${fmt(maxEdge)} — the longest is ${fmt(longestBefore)}; there is nothing to densify.`)
  }
  // Refused up front, by the estimate, before a byte is spent on it — and
  // past the limit on the way, should the estimate have fallen short — with
  // the length that would fit said, so the next try lands.
  const refuse = (vertices: string, margin: number): never => {
    const fits = fittingEdge(positions, indices, vertexCount, maxEdge, limit, margin)
    throw new Error(
      `Densifying to ${fmt(maxEdge)} would make ${vertices} points, and a mesh may have ${limit.toLocaleString('en-US')} here — take an edge of ${fmt(fits)} or longer.`,
    )
  }
  const estimate = densifyEstimate(positions, indices, vertexCount, maxEdge)
  if (estimate > limit) refuse(`about ${estimate.toLocaleString('en-US')}`, 2)

  // Points kept in doubles while edges are halved and halved again, so a
  // point made on a point made does not drift off the face; out as floats.
  let cap = Math.max(vertexCount * 2, 1024)
  let pos = new Float64Array(cap * 3)
  for (let i = 0; i < vertexCount * 3; i++) pos[i] = positions[i]
  let count = vertexCount
  let tris = indices.slice()
  const limit2 = maxEdge * maxEdge
  let rounds = 0

  for (;;) {
    const mids = new Map<number, number>()
    const base = count
    // Keyed on the round's own count: both ends of an edge are older than
    // anything the round makes.
    const key = (a: number, b: number) => (a < b ? a * base + b : b * base + a)
    // The middle of a–b, made once for every triangle on the edge.
    const mid = (a: number, b: number): number => {
      const k = key(a, b)
      const known = mids.get(k)
      if (known !== undefined) return known
      if (count >= limit) refuse(`more than ${limit.toLocaleString('en-US')}`, (2 * limit) / Math.max(estimate, 1))
      if (count === cap) {
        cap *= 2
        const grown = new Float64Array(cap * 3)
        grown.set(pos)
        pos = grown
      }
      for (let c = 0; c < 3; c++) pos[count * 3 + c] = (pos[a * 3 + c] + pos[b * 3 + c]) / 2
      mids.set(k, count)
      return count++
    }
    // Each triangle whose longest edge is too long has that edge split —
    // longest-edge bisection: the cut runs from the middle of the longest
    // side to the corner across it, so no angle gets much sharper than it
    // was and each round halves the triangles it touches rather than
    // quartering them, landing closer to the length asked. An edge marked by
    // the triangle on one side is split for the one on the other too.
    const marked = new Set<number>()
    const v = [0, 0, 0]
    const longestOf = (): number => {
      let best = 0
      let worst = -1
      for (let e = 0; e < 3; e++) {
        const d = dist2(pos, v[e], v[(e + 1) % 3])
        if (d > worst) {
          worst = d
          best = e
        }
      }
      return worst > limit2 ? best : -1
    }
    for (let t = 0; t < tris.length; t += 3) {
      v[0] = tris[t]
      v[1] = tris[t + 1]
      v[2] = tris[t + 2]
      const e = longestOf()
      if (e >= 0) marked.add(key(v[e], v[(e + 1) % 3]))
    }
    if (marked.size === 0) break
    const out: number[] = []
    for (let t = 0; t < tris.length; t += 3) {
      v[0] = tris[t]
      v[1] = tris[t + 1]
      v[2] = tris[t + 2]
      // A marked edge is longer than the length, so the triangle's own
      // longest is longer still and marked: any split starts from it.
      const r = longestOf()
      if (r < 0 || !marked.has(key(v[r], v[(r + 1) % 3]))) {
        out.push(v[0], v[1], v[2])
        continue
      }
      // Turned so the longest edge is a–b, split at m, joined to c; each
      // half then has its other marked edge, if any, split towards m.
      const a = v[r], b = v[(r + 1) % 3], c = v[(r + 2) % 3]
      const m = mid(a, b)
      if (marked.has(key(b, c))) {
        const bc = mid(b, c)
        out.push(m, b, bc, m, bc, c)
      } else out.push(m, b, c)
      if (marked.has(key(c, a))) {
        const ca = mid(c, a)
        out.push(a, m, ca, m, c, ca)
      } else out.push(a, m, c)
    }
    tris = Uint32Array.from(out)
    rounds++
    onProgress?.(`Densifying — ${count.toLocaleString('en-US')} points…`)
    if (rounds >= MAX_ROUNDS) throw new Error('Densifying did not settle — the mesh has an edge far longer than the part.')
  }

  const outPositions = new Float32Array(count * 3)
  for (let i = 0; i < count * 3; i++) outPositions[i] = pos[i]
  // The old vertices keep their numbers; the new ones follow them.
  const vertexMap = new Int32Array(vertexCount)
  for (let i = 0; i < vertexCount; i++) vertexMap[i] = i
  return {
    positions: outPositions,
    indices: tris,
    vertexMap,
    report: {
      maxEdge,
      verticesBefore: vertexCount,
      trianglesBefore: indices.length / 3,
      vertices: count,
      triangles: tris.length / 3,
      longestBefore,
      longestAfter: longestEdge(outPositions, tris),
      rounds,
    },
  }
}

const fmt = (mm: number) => `${Number(mm.toPrecision(3))} mm`

function dist2(p: Float64Array, a: number, b: number): number {
  const dx = p[a * 3] - p[b * 3], dy = p[a * 3 + 1] - p[b * 3 + 1], dz = p[a * 3 + 2] - p[b * 3 + 2]
  return dx * dx + dy * dy + dz * dz
}

function dist2f(p: Float32Array, a: number, b: number): number {
  const dx = p[a * 3] - p[b * 3], dy = p[a * 3 + 1] - p[b * 3 + 1], dz = p[a * 3 + 2] - p[b * 3 + 2]
  return dx * dx + dy * dy + dz * dz
}

function triangleArea(p: Float32Array, a: number, b: number, c: number): number {
  const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2]
  const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2]
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
}

/** The mesh's longest edge, mm. */
export function longestEdge(p: Float32Array, indices: Uint32Array): number {
  let worst = 0
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e] * 3, b = indices[t + ((e + 1) % 3)] * 3
      const d = (p[a] - p[b]) ** 2 + (p[a + 1] - p[b + 1]) ** 2 + (p[a + 2] - p[b + 2]) ** 2
      if (d > worst) worst = d
    }
  }
  return Math.sqrt(worst)
}
