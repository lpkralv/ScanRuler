# CAD-exported STL test part

`bracket_fine.stl` (1,772 triangles) and `bracket_coarse.stl` (620) are one known part,
made with trimesh and manifold3d by `make_test_part.py`: a 60 x 40 x 6 mm plate, four
4.5 mm through holes at (±24, ±14), a 16 mm boss 20 mm tall at the origin with an 8 mm
bore, and a 6 mm slot with R3 ends centred at (14, ±5). True volume 15298.21 mm³.

`densify.py` subdivides an STL until no edge is longer than a given length.
These files are here for the linked issue and are not meant to be merged.
