"""Subdivide an STL until no edge is longer than max_edge mm (geometry unchanged)."""
import sys, trimesh
from trimesh.remesh import subdivide_to_size
m = trimesh.load(sys.argv[1]); v, f = subdivide_to_size(m.vertices, m.faces, max_edge=float(sys.argv[3]), max_iter=20)
o = trimesh.Trimesh(v, f); o.export(sys.argv[2]); print(len(m.vertices), "->", len(o.vertices), "vertices")
