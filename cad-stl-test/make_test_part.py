"""Make a known CAD-style test part as STL at two tessellations.

Part (mm, origin at plate centre, plate bottom at z=0):
  plate 60 x 40 x 6
  4 clearance holes d4.5 through, at (+-24, +-14)
  boss d16, z 0..20, at (0, 0), with a d8 bore through
  slot 16 overall x 6 wide (R3 ends), through, centred at (14, 0), running along y
"""
import sys
import numpy as np
import trimesh
from trimesh.creation import box, cylinder

SLOT_C = (14.0, 0.0)   # slot centre, slot runs along y
SLOT_L, SLOT_W = 16.0, 6.0  # centre-to-centre length 10, width 6


def part(sections: int) -> trimesh.Trimesh:
    plate = box(extents=(60, 40, 6))
    plate.apply_translation((0, 0, 3))
    boss = cylinder(radius=8, height=20, sections=sections)
    boss.apply_translation((0, 0, 10))
    body = trimesh.boolean.union([plate, boss], engine="manifold")
    cutters = []
    for sx in (-24, 24):
        for sy in (-14, 14):
            c = cylinder(radius=2.25, height=30, sections=max(12, sections // 2))
            c.apply_translation((sx, sy, 3))
            cutters.append(c)
    bore = cylinder(radius=4, height=50, sections=sections)
    bore.apply_translation((0, 0, 10))
    cutters.append(bore)
    half = (SLOT_L - SLOT_W) / 2
    for dy in (-half, half):
        c = cylinder(radius=SLOT_W / 2, height=30, sections=max(12, sections // 2))
        c.apply_translation((SLOT_C[0], SLOT_C[1] + dy, 3))
        cutters.append(c)
    mid = box(extents=(SLOT_W, 2 * half, 30))
    mid.apply_translation((SLOT_C[0], SLOT_C[1], 3))
    cutters.append(mid)
    cut = trimesh.boolean.union(cutters, engine="manifold")
    out = trimesh.boolean.difference([body, cut], engine="manifold")
    assert out.is_watertight
    return out


if __name__ == "__main__":
    outdir = sys.argv[1]
    for name, n in (("fine", 96), ("coarse", 32)):
        m = part(n)
        m.export(f"{outdir}/bracket_{name}.stl")
        print(name, len(m.faces), "faces, volume", round(m.volume, 3))
