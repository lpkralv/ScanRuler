// SPDX-License-Identifier: AGPL-3.0-only
// The bracket of issue #42 as a CAD export tessellates it: a 60 × 40 × 6 mm
// plate on the XY plane, four 4.5 mm holes through it at (±24, ±14), a boss
// 16 mm across standing 20 mm tall at the origin with an 8 mm bore through,
// and a slot 6 mm wide with round ends, 16 mm overall, centred at (14, 0)
// along y. Made with Manifold, as the issue's own file was, so its points lie
// only on edges and rims — a flat face is a fan of long slivers from one rim
// to the next, with no point inside.

import Module from 'manifold-3d'

/** The bracket as an indexed mesh and as a triangle soup, its round edges
 *  in `sections` facets (the issue's fine file has 96, its coarse 32). */
export async function cadBracket(sections = 96): Promise<{ positions: Float32Array; indices: Uint32Array; soup: Float32Array }> {
  const wasm = await Module()
  wasm.setup()
  const { Manifold } = wasm
  const small = Math.max(12, sections / 2)
  const rod = (r: number, n: number, x: number, y: number) => Manifold.cylinder(40, r, r, n, true).translate([x, y, 3])
  let body = Manifold.cube([60, 40, 6], true).translate([0, 0, 3]).add(Manifold.cylinder(20, 8, 8, sections))
  const cutters = [
    ...[-24, 24].flatMap((x) => [-14, 14].map((y) => rod(2.25, small, x, y))),
    rod(4, sections, 0, 0),
    rod(3, small, 14, -5),
    rod(3, small, 14, 5),
    Manifold.cube([6, 10, 40], true).translate([14, 0, 3]),
  ]
  for (const c of cutters) body = body.subtract(c)
  const mesh = body.getMesh()
  const n = mesh.vertProperties.length / mesh.numProp
  const positions = new Float32Array(n * 3)
  for (let v = 0; v < n; v++) for (let k = 0; k < 3; k++) positions[v * 3 + k] = mesh.vertProperties[v * mesh.numProp + k]
  const indices = Uint32Array.from(mesh.triVerts)
  const soup = new Float32Array(indices.length * 3)
  for (let i = 0; i < indices.length; i++) for (let k = 0; k < 3; k++) soup[i * 3 + k] = positions[indices[i] * 3 + k]
  return { positions, indices, soup }
}
