# map-placement

Use when: placing models, parts or terrain in a world, building a map, or a prop looks wrong in position, size or direction.

- Nothing sits on y=0. Studio draws its editor grid at y=0, and any surface there is
  painted with a square pattern. Keep your builds above y=0. Terrain snaps to a 4-stud
  grid, so a small lift is rounded away: lift by a multiple of 4.
- A Model is placed by its pivot. The pivot is the bounding-box centre only while the
  Model has no PrimaryPart. Setting one moves the pivot to that part. So do not trust the
  pivot: measure the world bounding box from the part corners before you place a model.
- Check the front of an imported model. A model made in Blender with its front on -Y can
  end up with its front on Roblox -Z. Clone it, move it to the origin, and read where the
  door or front part is.
- Mesh first for organic shapes. Trees, rocks, bushes, houses, stalls, carts and fences
  should be meshes, not parts. Use parts only where you state the reason.
- Stop players leaving the map with an invisible barrier wall: one part per side.
- Verify after every build: check the y values and the measured bounds, not your
  assumptions.
