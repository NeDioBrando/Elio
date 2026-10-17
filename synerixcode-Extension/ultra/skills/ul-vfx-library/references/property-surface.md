# ParticleEmitter property surface

**Measured 2026-08-26** by probing a live emitter in Studio with `pcall` reads,
not copied from documentation. 33 candidates tested, 33 exist, 0 missing.

The reason this file exists: the Studio MCP's `get_class_info` and
`get_instance_properties` both report only nine fields for a ParticleEmitter
(`Name`, `ClassName`, `Parent`, `Size`, `Rotation`, `Transparency`, `Color`,
`Enabled`, `Brightness`). That is **6 of 31 real properties**. Anything harvested
through them is silently three quarters empty.

## Measured defaults on a fresh emitter

| Property | Default | Notes |
|---|---|---|
| `Texture` | `rbxasset://textures/particles/sparkles_main.dds` | one of only three stock textures that exist |
| `Rate` | `20` | per second, continuous |
| `Speed` | `5, 5` | NumberRange, studs/s |
| `Lifetime` | `5, 10` | NumberRange, seconds. Far too long for most effects |
| `Shape` | `Box` | Sphere / Cylinder / Disc also valid |
| `EmissionDirection` | `Top` | NormalId |
| `Orientation` | `FacingCamera` | also `VelocityParallel`, `VelocityPerpendicular` |
| `ZOffset` | `0` | pushes toward (+) or away from (-) the camera |
| `Squash` | `0..0` | NumberSequence |

## Full list, by type

**number**: `Brightness`, `Drag`, `LightEmission`, `LightInfluence`, `Rate`,
`TimeScale`, `VelocityInheritance`, `ZOffset`

**boolean**: `Enabled`, `FlipbookStartRandom`, `LockedToPart`, `WindAffectsDrag`

**string**: `Texture`

**Vector3**: `Acceleration`

**Vector2**: `SpreadAngle`

**NumberRange**: `FlipbookFramerate`, `Lifetime`, `RotSpeed`, `Rotation`, `Speed`

**NumberSequence**: `Size`, `Squash`, `Transparency`

**ColorSequence**: `Color`

**EnumItem**: `EmissionDirection` (NormalId), `FlipbookLayout`
(ParticleFlipbookLayout), `FlipbookMode` (ParticleFlipbookMode), `Orientation`
(ParticleOrientation), `Shape` (ParticleEmitterShape), `ShapeInOut`
(ParticleEmitterShapeInOut), `ShapeStyle` (ParticleEmitterShapeStyle)

`LocalTransparencyModifier` also reads but is a client-side render override, not
part of the effect definition, so it is excluded from harvesting.

## Emission volume

There is **no emitter-size property**. `Shape` selects the volume's form and
`ShapeStyle` selects Volume (fill) or Surface (shell), but the volume itself is
approximately unit-sized when the emitter sits under an Attachment. Parent to a
larger BasePart to grow it.

Practical consequence on a character: every particle spawns inside the torso and
is occluded. Cover a body by making particles large enough to overlap the
silhouette, or fast enough to escape it.

## Beam and Trail

`Attachment0` and `Attachment1` are **instance references, not values**. They
cannot be serialised as data and are recorded as `{"Ref": "<full name>"}`. They
are structure to be rebuilt on the target rig, never faked.
