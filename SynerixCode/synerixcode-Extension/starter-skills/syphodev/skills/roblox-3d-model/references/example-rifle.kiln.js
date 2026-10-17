// Knockback rifle: trial prop for the roblox-3d-model hard-surface route.
// Kiln frame: +X forward (muzzle), +Y up, +Z right. Units metres.

const meta = { name: 'KnockbackRifle', category: 'prop' };

// Hex in the material name so the colour survives the GLB (hard-surface-route.md).
function mat(label, hex, opts) {
  const m = gameMaterial(hex, opts);
  m.name = `${label}_${hex.toString(16).toUpperCase().padStart(6, '0')}`;
  return m;
}

function build() {
  const root = createRoot('KnockbackRifle');

  const body = mat('Body', 0x2b2f36, { roughness: 0.6 });
  const metal = mat('Metal', 0x8f8f94, { metalness: 0.7, roughness: 0.4 });
  const accent = mat('Accent', 0x19a7ff, { emissive: 0x19a7ff, emissiveIntensity: 0.6 });
  const grip = mat('Grip', 0x1a1a1a, { roughness: 0.9 });

  // Receiver: the main block everything hangs off.
  createPart('Receiver', boxGeo(0.34, 0.09, 0.06), body, { position: [0, 0.2, 0], parent: root });
  // Upper rail sits on top of the receiver.
  createPart('TopRail', boxGeo(0.3, 0.015, 0.03), metal, { position: [0.01, 0.2525, 0], parent: root });

  // Barrel shroud and barrel, forward along +X.
  createPart('Shroud', boxGeo(0.22, 0.065, 0.055), body, { position: [0.28, 0.205, 0], parent: root });
  createPart('Barrel', cylinderXGeo(0.012, 0.012, 0.2, 12), metal, { position: [0.48, 0.21, 0], parent: root });
  createPart('Muzzle', cylinderXGeo(0.022, 0.022, 0.05, 12), metal, { position: [0.595, 0.21, 0], parent: root });

  // Glowing energy strip down each side of the shroud (reads the knockback theme).
  for (const side of [-1, 1]) {
    createPart(side > 0 ? 'StripR' : 'StripL', boxGeo(0.18, 0.012, 0.004), accent, {
      position: [0.28, 0.215, side * 0.0295],
      parent: root,
    });
  }

  // Pistol grip, raked back.
  createPart('Grip', boxGeo(0.04, 0.12, 0.045), grip, {
    position: [-0.06, 0.11, 0],
    rotation: [0, 0, -15],
    parent: root,
  });
  // Trigger guard.
  createPart('TriggerGuard', boxGeo(0.07, 0.008, 0.02), metal, { position: [0.0, 0.14, 0], parent: root });

  // Magazine / energy cell.
  createPart('Cell', boxGeo(0.05, 0.1, 0.04), accent, { position: [0.08, 0.11, 0], parent: root });

  // Stock.
  createPart('Stock', boxGeo(0.2, 0.07, 0.05), body, { position: [-0.27, 0.18, 0], parent: root });
  createPart('ButtPad', boxGeo(0.02, 0.09, 0.052), grip, { position: [-0.38, 0.175, 0], parent: root });

  // Scope.
  createPart('Scope', cylinderXGeo(0.02, 0.02, 0.14, 16), metal, { position: [0.02, 0.285, 0], parent: root });
  createPart('ScopeLens', cylinderXGeo(0.017, 0.017, 0.004, 16), accent, { position: [0.092, 0.285, 0], parent: root });

  return root;
}
