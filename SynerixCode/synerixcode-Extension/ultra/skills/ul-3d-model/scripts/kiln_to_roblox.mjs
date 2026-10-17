// Kiln GLB -> Roblox-ready GLB. The hard-surface route's only post-step.
//
//   node scripts/kiln_to_roblox.mjs in.glb out.glb [--studs-per-m 3.571] [--no-rotate] [--no-join]
//
// What it does, and why each step exists:
//   1. ROTATE +X forward -> -Z forward. Kiln's frame is +X forward, +Y up. An
//      imported Roblox asset's front is -Z (a Blender -Y door lands at -Z);
//      without this the gun points out of the character's side.
//   2. SCALE metres -> studs. Kiln authors in metres; 1 stud = 0.28 m, so x3.571.
//      A Kiln rifle is ~1 m long and would import as a 1-stud toy.
//   3. JOIN meshes by material. Kiln emits one mesh per named part (the trial rifle
//      had 14), and Import 3D makes one MeshPart per mesh. Joining leaves one mesh per
//      colour, each named after its hex-coded material ("Body_2B2F36"), so Studio gets
//      a handful of MeshParts whose colour is readable off the name.
//   4. GATE on the MeshPart triangle cap (20,000 per mesh). Exits 1 if any mesh is over.
//
// Needs @gltf-transform from the Kiln install: set KILN_HOME to the folder you
// ran `npm install` in (see LOCAL.md). No other dependencies.

import { createRequire } from 'node:module';
import path from 'node:path';

const KILN_HOME = process.env.KILN_HOME;
if (!KILN_HOME) {
  console.error('KILN_HOME is not set. Point it at your Kiln install folder (the one containing node_modules/@gltf-transform).');
  process.exit(2);
}
const req = createRequire(path.join(KILN_HOME, 'package.json'));
const { NodeIO } = req('@gltf-transform/core');
const { KHRONOS_EXTENSIONS } = req('@gltf-transform/extensions');
const { flatten, join, prune, dedup } = req('@gltf-transform/functions');

const TRI_CAP = 20000;
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? Number(args[args.indexOf(n) + 1]) : d);
const [inPath, outPath] = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--studs'));
if (!inPath || !outPath) {
  console.error('usage: node kiln_to_roblox.mjs in.glb out.glb [--studs-per-m N] [--no-rotate] [--no-join]');
  process.exit(2);
}
const studsPerM = opt('--studs-per-m', 1 / 0.28);

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const doc = await io.read(inPath);
const root = doc.getRoot();
const scene = root.getDefaultScene() || root.listScenes()[0];

// Wrap every scene root in one parent carrying the rotation + scale, then flatten
// so the transform is baked into each mesh's world matrix before joining.
const wrap = doc.createNode('RobloxFrame');
const s = Math.sin(Math.PI / 4); // +90 deg about Y maps +X to -Z
wrap.setRotation(flag('--no-rotate') ? [0, 0, 0, 1] : [0, s, 0, s]);
wrap.setScale([studsPerM, studsPerM, studsPerM]);
for (const child of scene.listChildren()) {
  scene.removeChild(child);
  wrap.addChild(child);
}
scene.addChild(wrap);

await doc.transform(flatten(), ...(flag('--no-join') ? [] : [join({ keepNamed: false })]), dedup(), prune({ keepAttributes: true, logger: false }));

// After join, name each mesh (and its node) after its material so Import 3D's
// MeshPart names carry the hex colour.
let worst = 0;
const report = [];
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  let tris = 0;
  let matName = '';
  for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices();
    tris += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
    matName = p.getMaterial()?.getName() || matName;
  }
  if (!flag('--no-join') && matName) {
    node.setName(matName);
    mesh.setName(matName);
  }
  worst = Math.max(worst, tris);
  report.push({ mesh: node.getName(), material: matName, tris });
}

await io.write(outPath, doc);

const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION');
    for (let i = 0; i < pos.getCount(); i++) {
      const [x, y, z] = pos.getElement(i, []);
      const w = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
      for (let k = 0; k < 3; k++) {
        b.min[k] = Math.min(b.min[k], w[k]);
        b.max[k] = Math.max(b.max[k], w[k]);
      }
    }
  }
}
const size = b.max.map((v, k) => +(v - b.min[k]).toFixed(3));
const r3 = (a) => a.map((v) => +v.toFixed(3));
console.log(JSON.stringify({ out: outPath, meshes: report, sizeStuds: size, boundsStuds: { min: r3(b.min), max: r3(b.max) }, frontAxis: flag('--no-rotate') ? '+X' : '-Z', worstTris: worst, triCap: TRI_CAP }, null, 1));
if (worst > TRI_CAP) {
  console.error(`FAIL: a mesh has ${worst} tris, over the ${TRI_CAP} MeshPart cap. Simplify the program or split parts.`);
  process.exit(1);
}
