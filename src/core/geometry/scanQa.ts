// SPDX-License-Identifier: AGPL-3.0-only
// What a scan is like before anything is modelled on it: where it is open,
// how noisy it is, and where the first surface lies along an axis over a
// grid — a height map, and with one from each side the thickness through
// the part. A scan whose faces should be parallel and are a degree apart
// shows it here, before every fit on it misses by the lean.

import * as THREE from 'three'
import type { MeshBVH } from 'three-mesh-bvh'
import { symmetricEigen3 } from '../fit/linalg'
import type { MeshGraph, Vec3 } from '../types'
import { circleFromPoints } from '../fit/circle'
import { type MeshGap, type RimLoop } from './openEdges'

/** A grid of parallel rays: one per cell centre, the cell (c, r) starting
 *  at origin + (c + ½)·cell·u + (r + ½)·cell·v and running along `dir` (a
 *  unit vector square to u and v) for `far` mm. */
export interface RayGrid {
  origin: Vec3
  dir: Vec3
  u: Vec3
  v: Vec3
  cell: number
  cols: number
  rows: number
  far: number
}

/** The two axes across `axis`, in the order a grid lays them. */
export const acrossAxes = (axis: 0 | 1 | 2): [number, number] => (axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1])

/** How far each ray runs to the first surface it meets, row by row (row 0
 *  nearest the origin), NaN where it meets none within `far`. */
export function firstHits(bvh: MeshBVH, grid: RayGrid): Float32Array {
  const { origin: o, dir, u, v, cell, cols, rows, far } = grid
  const out = new Float32Array(cols * rows).fill(Number.NaN)
  const origin = new THREE.Vector3()
  const ray = new THREE.Ray(origin, new THREE.Vector3(dir[0], dir[1], dir[2]))
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = (c + 0.5) * cell
      const b = (r + 0.5) * cell
      origin.set(o[0] + a * u[0] + b * v[0], o[1] + a * u[1] + b * v[1], o[2] + a * u[2] + b * v[2])
      const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, far)
      if (hit) out[r * cols + c] = hit.distance
    }
  }
  return out
}

/** The first hits with where on the scan they landed: per ray its
 *  distance (NaN for none), the three corners of the triangle it met
 *  (scan vertex numbers, NO_CORNER for none) and the hit's weight on each
 *  — what a value kept per vertex, the deviation say, is read at the hit
 *  by: Σ weight·value over the three. */
export const NO_CORNER = 0xffffffff

export function firstHitsAt(bvh: MeshBVH, positions: Float32Array, grid: RayGrid): { values: Float32Array; corners: Uint32Array; weights: Float32Array } {
  const { origin: o, dir, u, v, cell, cols, rows, far } = grid
  const n = cols * rows
  const values = new Float32Array(n).fill(Number.NaN)
  const corners = new Uint32Array(3 * n).fill(NO_CORNER)
  const weights = new Float32Array(3 * n)
  const origin = new THREE.Vector3()
  const ray = new THREE.Ray(origin, new THREE.Vector3(dir[0], dir[1], dir[2]))
  const tri = new THREE.Triangle()
  const bary = new THREE.Vector3()
  const at = (i: number, out: THREE.Vector3) => out.set(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2])
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = (c + 0.5) * cell
      const b = (r + 0.5) * cell
      origin.set(o[0] + a * u[0] + b * v[0], o[1] + a * u[1] + b * v[1], o[2] + a * u[2] + b * v[2])
      const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, far)
      if (!hit || !hit.face) continue
      const k = r * cols + c
      values[k] = hit.distance
      const { a: ia, b: ib, c: ic } = hit.face
      at(ia, tri.a)
      at(ib, tri.b)
      at(ic, tri.c)
      if (!tri.getBarycoord(hit.point, bary)) bary.set(1 / 3, 1 / 3, 1 / 3)
      corners[3 * k] = ia
      corners[3 * k + 1] = ib
      corners[3 * k + 2] = ic
      weights[3 * k] = bary.x
      weights[3 * k + 1] = bary.y
      weights[3 * k + 2] = bary.z
    }
  }
  return { values, corners, weights }
}

/** The direction most of a surface faces, either way along it — a plate's
 *  faces: the leading eigenvector of Σ w·n·nᵀ over the normals given, then
 *  again over the normals within 20° of it, so the sides fall out. Each
 *  normal counts once, or by its weight — a triangle's area, where the
 *  points are too few and too unevenly spread to stand for the surface. */
export function dominantFacing(normals: Float32Array, weights?: ArrayLike<number>): Vec3 | null {
  const lead = (keep: (i: number) => boolean): Vec3 | null => {
    const m = new Float64Array(9)
    let n = 0
    for (let i = 0; i + 2 < normals.length; i += 3) {
      if (!keep(i)) continue
      const w = weights ? weights[i / 3] : 1
      if (!(w > 0)) continue
      const x = normals[i], y = normals[i + 1], z = normals[i + 2]
      m[0] += w * x * x; m[1] += w * x * y; m[2] += w * x * z
      m[4] += w * y * y; m[5] += w * y * z; m[8] += w * z * z
      n++
    }
    if (n < 3) return null
    m[3] = m[1]; m[6] = m[2]; m[7] = m[5]
    return symmetricEigen3(m).vectors[2]
  }
  const first = lead(() => true)
  if (!first) return null
  const cos = Math.cos((20 * Math.PI) / 180)
  return lead((i) => Math.abs(normals[i] * first[0] + normals[i + 1] * first[1] + normals[i + 2] * first[2]) >= cos) ?? first
}

/** A rim's best circle, where one holds: its centre, the axis square to
 *  the plane the rim lies in, the radius, and the rim's scatter off the
 *  circle (rms of the distance in 3D, mm). */
export interface RimCircle {
  center: Vec3
  axis: Vec3
  radius: number
  rms: number
}

/** A rim placed and numbered: `index` is its place among all the scan's
 *  rims, longest first — what scanRim takes back. */
export interface ScanRim extends MeshGap {
  index: number
  circle?: RimCircle
}

/** The fewest vertices round a rim for a circle to be read off it. */
const RIM_CIRCLE_MIN = 8
/** How far a rim may scatter off its circle and still be read as one, a
 *  share of the radius: a jagged scan edge round a hole stays well under
 *  it, a square opening (about 0.12) does not. */
const RIM_ROUND = 0.08

/** The rims of the scan, longest first, each with its loop. */
function rimsByLength(positions: Float32Array, loops: RimLoop[]): { loop: RimLoop; gap: MeshGap }[] {
  const out = loops.map((loop) => {
    const v = loop.vertices
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    const sum = [0, 0, 0]
    let length = 0
    for (let i = 0; i < v.length; i++) {
      for (let k = 0; k < 3; k++) {
        const x = positions[v[i] * 3 + k]
        sum[k] += x
        if (x < lo[k]) lo[k] = x
        if (x > hi[k]) hi[k] = x
      }
      if (i + 1 < v.length || loop.closed) {
        const a = v[i] * 3
        const b = v[(i + 1) % v.length] * 3
        length += Math.hypot(positions[a] - positions[b], positions[a + 1] - positions[b + 1], positions[a + 2] - positions[b + 2])
      }
    }
    const n = v.length
    const gap: MeshGap = { at: [sum[0] / n, sum[1] / n, sum[2] / n], edges: loop.triangles.length, size: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), length }
    return { loop, gap }
  })
  return out.sort((a, b) => b.gap.length - a.gap.length || a.loop.vertices[0] - b.loop.vertices[0])
}

/** The circle through a rim, where its vertices lie on one within
 *  RIM_ROUND of the radius; undefined otherwise. */
function rimCircle(positions: Float32Array, loop: RimLoop): RimCircle | undefined {
  if (!loop.closed || loop.vertices.length < RIM_CIRCLE_MIN) return undefined
  const points: Vec3[] = Array.from(loop.vertices, (v) => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]])
  try {
    const c = circleFromPoints(points)
    if (!(c.sigma <= RIM_ROUND * c.radius)) return undefined
    return { center: c.center, axis: c.normal, radius: c.radius, rms: c.sigma }
  } catch {
    // Points in a line, or on top of each other: no circle.
    return undefined
  }
}

/** The open rims of the scan, longest first: how many, all their length,
 *  the `keep` longest, and up to `circles` more that a circle fits — the
 *  holes. Each rim answered with its circle where one holds. */
export function scanRims(positions: Float32Array, loops: RimLoop[], keep: number, circles = 12): { count: number; total: number; largest: ScanRim[]; circles: ScanRim[]; moreCircles: number } {
  const all = rimsByLength(positions, loops)
  const placed = (i: number): ScanRim => {
    const circle = rimCircle(positions, all[i].loop)
    return { ...all[i].gap, index: i, ...(circle ? { circle } : {}) }
  }
  const largest = all.slice(0, keep).map((_, i) => placed(i))
  const round: ScanRim[] = []
  for (let i = keep; i < all.length; i++) {
    const r = placed(i)
    if (r.circle) round.push(r)
  }
  return { count: all.length, total: all.reduce((s, g) => s + g.gap.length, 0), largest, circles: round.slice(0, circles), moreCircles: Math.max(0, round.length - circles) }
}

/** One rim by its number among the scan's rims (scanRims' index): its
 *  loop's vertices in order with their places, the corners of the
 *  triangle along each edge (three a vertex, the edge that leaves it), and
 *  its circle where one holds. Null past the last rim. */
export function scanRim(positions: Float32Array, indices: Uint32Array, loops: RimLoop[], index: number): { vertices: Uint32Array; positions: Float32Array; corners: Uint32Array; closed: boolean; length: number; circle?: RimCircle } | null {
  const all = rimsByLength(positions, loops)
  const r = all[index]
  if (!r) return null
  const v = r.loop.vertices
  const at = new Float32Array(v.length * 3)
  for (let i = 0; i < v.length; i++) at.set(positions.subarray(v[i] * 3, v[i] * 3 + 3), i * 3)
  const t = r.loop.triangles
  const corners = new Uint32Array(v.length * 3)
  for (let i = 0; i < v.length; i++) corners.set(indices.subarray(t[Math.min(i, t.length - 1)] * 3, t[Math.min(i, t.length - 1)] * 3 + 3), i * 3)
  const circle = rimCircle(positions, r.loop)
  return { vertices: Uint32Array.from(v), positions: at, corners, closed: r.loop.closed, length: r.gap.length, ...(circle ? { circle } : {}) }
}

/** How a mesh is tessellated. `span` is the median of each triangle's
 *  longest edge, weighed by its area — what a point read off the mesh is
 *  from the next one across a face — and `spacing` the side of the square
 *  each vertex has to itself; `coplanar` the share of the area in triangles
 *  lying flat against a neighbour (within 0.05°), which a CAD export's faces
 *  do and a scan's do not; `facing` the direction most of its area faces
 *  (dominantFacing, by triangle). `sparse` when its triangles run a
 *  twentieth of the part's size or more: a CAD export, its points only on
 *  edges and rims and none inside a face — a scan, or a mesh made dense,
 *  has its triangles a hundredth of that. */
export interface Tessellation {
  sparse: boolean
  span: number
  spacing: number
  coplanar: number
  facing: Vec3 | null
}

/** Triangles spanning this much of the part's diagonal make a mesh sparse:
 *  the bracket of issue #42 exported from CAD runs 0.5, a fine scan 0.005,
 *  and the same bracket densified to Mesh Tools' default 0.013. */
const SPARSE_SPAN = 0.05
const COPLANAR_COS = Math.cos((0.05 * Math.PI) / 180)
/** The triangles the span is read over, at most. */
const TESSELLATION_SAMPLE = 20_000

export function tessellation(g: MeshGraph): Tessellation {
  const { positions: p, indices } = g
  const T = g.triangleCount
  const areas = new Float64Array(T)
  const longest = new Float64Array(T)
  const normals = new Float32Array(T * 3)
  let area = 0
  for (let t = 0; t < T; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz)
    areas[t] = l / 2
    area += l / 2
    if (l > 0) {
      normals[t * 3] = nx / l
      normals[t * 3 + 1] = ny / l
      normals[t * 3 + 2] = nz / l
    }
    const wx = p[c] - p[b], wy = p[c + 1] - p[b + 1], wz = p[c + 2] - p[b + 2]
    longest[t] = Math.sqrt(Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz, wx * wx + wy * wy + wz * wz))
  }
  // The area-weighted median of the longest edges, over an even sample of
  // the triangles — a scan's millions need not all be sorted.
  const step = Math.max(1, Math.floor(T / TESSELLATION_SAMPLE))
  const order: number[] = []
  let sampled = 0
  for (let t = 0; t < T; t += step) {
    order.push(t)
    sampled += areas[t]
  }
  order.sort((x, y) => longest[x] - longest[y])
  let span = 0
  for (let k = 0, run = 0; k < order.length; k++) {
    run += areas[order[k]]
    if (run >= sampled / 2) {
      span = longest[order[k]]
      break
    }
  }
  const spacing = g.vertexCount > 0 ? Math.sqrt(area / g.vertexCount) : 0
  const sparse = T > 0 && span >= SPARSE_SPAN * g.bboxDiag
  // Flat against a neighbour across an edge — read only on a mesh already
  // sparse, where the triangles are few: a scan's millions are spared the
  // edge map, and its share is not reported.
  let coplanar = 0
  if (sparse) {
    const across = new Map<number, number>()
    const flat = new Uint8Array(T)
    const n = g.vertexCount
    for (let t = 0; t < T; t++) {
      for (let e = 0; e < 3; e++) {
        const a = indices[t * 3 + e], b = indices[t * 3 + ((e + 1) % 3)]
        const key = a < b ? a * n + b : b * n + a
        const o = across.get(key)
        if (o === undefined) {
          across.set(key, t)
          continue
        }
        const dot = normals[t * 3] * normals[o * 3] + normals[t * 3 + 1] * normals[o * 3 + 1] + normals[t * 3 + 2] * normals[o * 3 + 2]
        if (dot >= COPLANAR_COS) flat[t] = flat[o] = 1
      }
    }
    for (let t = 0; t < T; t++) if (flat[t]) coplanar += areas[t]
    coplanar = area > 0 ? coplanar / area : 0
  }
  return { sparse, span, spacing, coplanar, facing: dominantFacing(normals, areas) }
}

/** How noisy the surface is: over a sample of vertices spread through the
 *  scan, a plane fitted to each one's two rings of neighbours, and the
 *  scatter off it (rms, mm) — its median, and the 90th percentile. Edges
 *  and rounds fit a plane badly; the median is the faces'.
 *
 *  That holds while most vertices lie inside a face. On a sparse
 *  tessellation (see tessellation) every vertex is on an edge or a rim, its
 *  two rings reach tens of millimetres across onto the faces round the
 *  corner, and the median is the part's shape — 1.6 mm on a plain
 *  bracket. There, with `sparse`, each vertex is read over the one face it
 *  is a corner of the most of: the triangles round it within 20° of the
 *  largest of them, and their corners. */
export function localNoise(g: MeshGraph, sample: number, sparse = false): { median: number; p90: number; sampled: number } {
  const step = Math.max(1, Math.floor(g.vertexCount / sample))
  const p = g.positions
  const rms: number[] = []
  const ring = new Set<number>()
  const cov = new Float64Array(9)
  const around = sparse ? trianglesAround(g) : null
  const cos20 = Math.cos((20 * Math.PI) / 180)
  for (let v = 0; v < g.vertexCount; v += step) {
    ring.clear()
    ring.add(v)
    if (around) {
      const { offsets, list, normals, areas } = around
      let big = -1
      for (let k = offsets[v]; k < offsets[v + 1]; k++) if (big < 0 || areas[list[k]] > areas[big]) big = list[k]
      if (big < 0) continue
      for (let k = offsets[v]; k < offsets[v + 1]; k++) {
        const t = list[k]
        if (normals[t * 3] * normals[big * 3] + normals[t * 3 + 1] * normals[big * 3 + 1] + normals[t * 3 + 2] * normals[big * 3 + 2] < cos20) continue
        for (let c = 0; c < 3; c++) ring.add(g.indices[t * 3 + c])
      }
      if (ring.size < 4) continue
    } else {
      for (let e = g.adjOffsets[v]; e < g.adjOffsets[v + 1]; e++) {
        const u = g.adjList[e]
        ring.add(u)
        for (let f = g.adjOffsets[u]; f < g.adjOffsets[u + 1] && ring.size < 48; f++) ring.add(g.adjList[f])
      }
      if (ring.size < 8) continue
    }
    let cx = 0, cy = 0, cz = 0
    for (const u of ring) {
      cx += p[u * 3]
      cy += p[u * 3 + 1]
      cz += p[u * 3 + 2]
    }
    const n = ring.size
    cx /= n
    cy /= n
    cz /= n
    cov.fill(0)
    for (const u of ring) {
      const x = p[u * 3] - cx, y = p[u * 3 + 1] - cy, z = p[u * 3 + 2] - cz
      cov[0] += x * x
      cov[1] += x * y
      cov[2] += x * z
      cov[4] += y * y
      cov[5] += y * z
      cov[8] += z * z
    }
    cov[3] = cov[1]
    cov[6] = cov[2]
    cov[7] = cov[5]
    rms.push(Math.sqrt(Math.max(0, symmetricEigen3(cov).values[0]) / n))
  }
  rms.sort((a, b) => a - b)
  const at = (q: number) => (rms.length ? rms[Math.min(rms.length - 1, Math.floor(q * rms.length))] : 0)
  return { median: at(0.5), p90: at(0.9), sampled: rms.length }
}

/** The triangles round each vertex, with their unit normals and areas. */
function trianglesAround(g: MeshGraph): { offsets: Uint32Array; list: Uint32Array; normals: Float32Array; areas: Float32Array } {
  const { positions: p, indices } = g
  const T = g.triangleCount
  const offsets = new Uint32Array(g.vertexCount + 1)
  for (let i = 0; i < T * 3; i++) offsets[indices[i] + 1]++
  for (let v = 0; v < g.vertexCount; v++) offsets[v + 1] += offsets[v]
  const fill = offsets.slice(0, g.vertexCount)
  const list = new Uint32Array(T * 3)
  const normals = new Float32Array(T * 3)
  const areas = new Float32Array(T)
  for (let t = 0; t < T; t++) {
    for (let c = 0; c < 3; c++) list[fill[indices[t * 3 + c]]++] = t
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz)
    areas[t] = l / 2
    if (l > 0) {
      normals[t * 3] = nx / l
      normals[t * 3 + 1] = ny / l
      normals[t * 3 + 2] = nz / l
    }
  }
  return { offsets, list, normals, areas }
}

/** A plane z = a + b·u + c·v through the points, the worst of them left out
 *  round by round (past 2.5 robust sigma) — the faces of a plate read past
 *  its holes and bosses. Null with too few points. */
export function robustPlane(us: ArrayLike<number>, vs: ArrayLike<number>, zs: ArrayLike<number>): { a: number; b: number; c: number; used: number; rms: number } | null {
  let keep = Array.from({ length: zs.length }, (_, i) => i)
  let fit: { a: number; b: number; c: number } | null = null
  for (let round = 0; round < 4; round++) {
    if (keep.length < 6) return null
    // Normal equations about the kept points' mean, for a stable solve.
    let mu = 0, mv = 0, mz = 0
    for (const i of keep) {
      mu += us[i]
      mv += vs[i]
      mz += zs[i]
    }
    mu /= keep.length
    mv /= keep.length
    mz /= keep.length
    let suu = 0, suv = 0, svv = 0, suz = 0, svz = 0
    for (const i of keep) {
      const u = us[i] - mu, v = vs[i] - mv, z = zs[i] - mz
      suu += u * u
      suv += u * v
      svv += v * v
      suz += u * z
      svz += v * z
    }
    const det = suu * svv - suv * suv
    if (!(Math.abs(det) > 1e-12)) return null
    const b = (suz * svv - svz * suv) / det
    const c = (svz * suu - suz * suv) / det
    fit = { a: mz - b * mu - c * mv, b, c }
    const res = keep.map((i) => zs[i] - (fit!.a + b * us[i] + c * vs[i]))
    const sorted = res.map(Math.abs).sort((x, y) => x - y)
    const sigma = Math.max(1.4826 * sorted[sorted.length >> 1], 1e-6)
    const next = keep.filter((_, k) => Math.abs(res[k]) <= 2.5 * sigma)
    if (next.length === keep.length) break
    keep = next
  }
  if (!fit) return null
  let ss = 0
  for (const i of keep) ss += (zs[i] - (fit.a + fit.b * us[i] + fit.c * vs[i])) ** 2
  return { ...fit, used: keep.length, rms: Math.sqrt(ss / Math.max(1, keep.length)) }
}
