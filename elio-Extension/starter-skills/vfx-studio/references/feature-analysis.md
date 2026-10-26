# What helps an AI, and what does not
- Highest value: selecting and reusing textures, meshes and existing saved effects from the real installed library. This avoids needless recreation but still requires rights and visual inspection.
- Useful: bounded emission/preview and flipbook setup; saving/reopening a user's own presets; reviewing the resulting particles and attachment behavior. Observe current controls rather than assuming an older tutorial's layout.
- Usually faster natively: colors, sizes, NumberSequence/ColorSequence, lifetime, rate, attachment properties and owned hierarchy changes. Use the plugin when its panel encodes behavior not yet understood.
- Conditional: curves, generated code, modules, camera shake and timeline-related panels. Inspect the actual export and code first. Do not require unknown modules, introduce gameplay authority or add distracting effects by default.
- Low priority for automation: plugin themes and UI convenience controls unrelated to the requested effect.

Limits: publicly indexed documentation does not establish a supported machine API. Some reference pages explicitly label advanced examples as AI-generated demonstrations. They must not become executable assumptions. Tutorial chapters establish broad feature categories, not a current automation contract. The separate Sytranom GitHub catalog has restrictive terms and its identity/relationship to the exact installed plugin has not been established; do not bundle it or generalize its agreement to every asset in the plugin.

This integration is an Elio-authored workflow plus a read-only exported-asset inspector. It is not a reverse-engineered plugin connector, bundled asset library, proof of live plugin testing or a promise that every UI feature is automated.
