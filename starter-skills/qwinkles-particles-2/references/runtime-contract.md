# Documented runtime contract — verify installed version before calling
Source: official QwinkleTee/Qwinkles-Particles-2-Module README. This is an API summary, not redistributed runtime implementation. No engine is bundled or auto-required by Elio.

The module is commonly called Part_Icles, but plugin/docs mention different insertion locations; discover exact live path and dependencies instead of assuming ReplicatedStorage or ServerScriptService. Plugin-managed module and standalone snapshot can have different versions. The plugin UI stops for Play/Run; game playback requires runtime code in the correct server/client composition root. Local player camera/UI effects usually require the appropriate client context; authority/damage remains server-owned.

After source review and confirmation of the actual API:
- Particle:Activate() starts the engine. One lifecycle owner per server/client; reuse an existing activated shared engine rather than activate per click/particle.
- Particle:AbsoluteEmit(root) fires a tree once, including custom and native emitters. Do not also manually emit every descendant.
- Particle:AbsoluteEnable(root) starts continuous behavior; Particle:AbsoluteDisable(root) is the targeted stop for that owned root.
- Particle:AbsoluteEmitAt(root, originCF, options?) is documented in v39+; verify support and coordinate type. It is not a replacement for importing/Transforming a tree.
- Particle:AbsoluteSetTimescale(root, scale, duration?, permanent?) and Particle:AbsoluteClearTimescale(root) affect a tree; do not leave a zero-time-scale effect stuck indefinitely.
- Particle:Preload(root, force?) / Particle:Deload(root, force?) pin/unpin textures. Use bounded selected bundles, not every texture in the remote Inventory.
- Particle:Deactivate() shuts down the engine, pools/listeners and LinkService. Only the lifecycle owner may do this when no other feature depends on that engine. For a shared engine preview, disable the owned root without global teardown.
- Particle.await(n) is DOT syntax, not colon. Emit methods may return nil for effectively infinite effects, and await(nil) is a no-op, NOT confirmation particles are done. Always apply a separate finite preview timeout/cancellation and explicit stop/cleanup.

Use the observed Emit Code output as a version-specific reference; inspect it, don't blindly execute it or grant event trust. Cleanup must cover Stop, error, cancellation, death/respawn and repeated previews. Verify no accumulated connections, orphan clones, template references or audio. Pooling default/performance claims in vendor docs are not a measured guarantee in this project; do not enable Pool globally. Measure on representative devices.
