# Public contract, not a guessed internal API
The author's public Emitter2D documentation describes attributes on GUI emitter objects. Inspect the installed version and actual representation first. ClassName="Emitter2D" is an identifying attribute, not the Roblox instance class. Version is plugin-managed; do not write it. An attribute marker does not prove the installed plugin's identity or working client.

## Client and events
Install Client is required for in-game use and again after plugin updates. Do not install automatically or grant script permissions. Public author notice: incompatible with Next Generation Replication / Server Authority due to attribute limitations; check current installed release and project settings, report conflict, never disable security/network settings silently.
Four documented **child BindableEvents**, not emitter methods, RemoteEvents or a constructor/module API:
- Emit:Fire(particleCount: number) — works while Enabled=false.
- TimeStep:Fire(deltaTime: number) — works while Paused=true.
- Clear:Fire() — clears existing particles.
- SetSeeds:Fire(seeds: {[string]: number}) — deterministic property seeds.
Use only after inspecting actual events and client runtime. Their presence is structural evidence, not permission to execute unknown code.
Seed keys include Position, Scale, FlipbookFramerate, SpreadAngle, Color, Speed, EmissionRate, Size, Rotation, Transparency, FlipbookStartRandom, Squash, RotationSpeed, Depth, DepthTransparency and LifeTime.

## Attribute semantics
Types below describe author-facing values, NOT a universal native SetAttribute encoding. Native attributes cannot be assumed to accept every range/sequence type. Observe the installed runtime/plugin serialization; do not decode executable strings or invent encodings.
| Group | Documented properties |
|---|---|
| State | Enabled, TimeScale, Paused, ZIndex, IgnoreGraphicsLevel |
| Emission | EmissionRate (NumberRange, NOT native Rate), EmissionRateScaleByArea, SpreadAngle |
| Shape | EmissionShape: Rectangle/Oval/Point; EmissionShapeStyle: Volume/Surface |
| Direction | EmissionDirection degrees: 0 up, 90 right, 180 down, 270 left; EmissionDirectionMode: FromUp/FromCenter/FromSurface |
| Appearance | Texture asset; Color ColorSequence; Transparency NumberSequence |
| Size | Size NumberRange; Scale NumberSequence; Squash NumberSequence 0..1, neutral 0.5; MasterScale |
| Sizing mode | SizeConstraint: Offset/RelativeYY/RelativeXX/RelativeMin/RelativeMax; UseScreenSize; UseJitterFix |
| Motion | Speed NumberRange; Acceleration Vector2; Drag; Rotation and RotationSpeed NumberRange; LockedToGui; VelocityInheritance |
| Orientation | Normal/VelocityParallel/VelocityPerpendicular |
| Lifetime | LifeTime (exact spelling) NumberRange; Depth NumberRange; DepthTransparency NumberSequence |
| Flipbook | FlipbookLayout: None/Grid2x2/Grid4x4/Grid8x8; FlipbookMode: OneShot/Loop/PingPong/Random; FlipbookFramerate NumberRange; FlipbookStartRandom; FlipbookResolution power-of-two 8..1024 |
| Rendering | ResampleMode; IgnoreClipsDescendants, normally false |
OneShot flipbooks follow lifetime and ignore framerate. EmitCount/EmitDelay are not guaranteed built-in semantics. Do not assume ParticleEmitter properties transfer one-to-one.

## Limits and verification
GUI ImageLabel particles can cost more than native 3D particles. Bound rates, lifetime and simultaneous bursts; test representative mobile UI. No guaranteed native LightEmission/Brightness behavior. Team Create edit previews can add replication/CPU load. Never change global settings or other users' previews as an optimization. SurfaceGui support and richer coding APIs were discussed as plans; inspect the current release, do not promise them. Static inspection is not an FPS, memory, license, installation or visual proof.
