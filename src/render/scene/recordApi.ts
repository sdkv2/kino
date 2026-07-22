// recordApi: the api.* surface as a scene-graph RECORDER. Handles are plain mutable structs the
// runner snapshots per frame; nothing here renders. Same member names/contracts the page api had —
// the .scene.js surface is the seam, this file + kino_render.py are its Blender implementation.
// Determinism: no wall clock, no Math.random here — seeded mulberry32 only.

export type ObjectType =
  | "box" | "sphere" | "plane" | "cylinder" | "torus" | "roundedBox"
  | "devicePhone" | "gltf" | "text3d" | "particles" | "group" | "layer"
  | "dirLight" | "ambient" | "hemi" | "contactShadow";

export interface MaterialSpec {
  kind: "pbr" | "basic" | "emissive";
  color: string; // palette name resolved to hex here, using the beat theme
  metalness?: number;
  roughness?: number;
  envMapIntensity?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  transparent?: boolean;
  opacity?: number;
}

export interface TimelineObject {
  id: string;
  type: ObjectType;
  opts: Record<string, unknown>;
  material?: MaterialSpec;
  parent?: string;
}

export interface CameraSnapshot {
  p: [number, number, number];
  lookAt: [number, number, number] | null;
  fov: number;
  zoom: number;
}

export interface FrameTransform {
  p: [number, number, number];
  r: [number, number, number];
  s: [number, number, number];
  visible: boolean;
  opacity?: number;
}

/** Seeded PRNG (mulberry32) — the only randomness allowed in scene code; same seed ⇒ same stream. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Opaque marker: api.param("x") resolves to baseParams.x at asset-load time (deferred binding). */
class ParamRef {
  constructor(readonly name: string) {}
}
interface TextureHandle {
  path: string;
  frames?: number; // animated screen: PNG-sequence dir with this many f%05d.png frames
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}
interface ScaleVec extends Vec3 {
  setScalar(v: number): void;
}
interface BBox {
  min: Vec3;
  max: Vec3;
}
/** The mutable choreography surface a builder returns; the runner snapshots it every frame. */
interface Handle {
  position: Vec3;
  rotation: Vec3;
  scale: ScaleVec;
  visible: boolean;
  material?: MaterialSpec;
  geometry?: { computeBoundingBox(): void; boundingBox: BBox | null }; // text3d only
}

function makeHandle(material?: MaterialSpec, pos?: [number, number, number]): Handle {
  const scale: ScaleVec = { x: 1, y: 1, z: 1, setScalar(v: number) { this.x = this.y = this.z = v; } };
  return {
    position: { x: pos?.[0] ?? 0, y: pos?.[1] ?? 0, z: pos?.[2] ?? 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale,
    visible: true,
    material,
  };
}

const q = (v: number) => Math.round(v * 1e6) / 1e6; // 6-decimal quantize — kills float drift across platforms

export interface Recorder {
  api: Record<string, unknown>;
  objects: TimelineObject[];
  world(): "studio" | "night" | "none";
  post(): { bloom?: { strength: number; radius: number; threshold: number } } | null;
  /** One frame's transforms + camera, read from the live handles AFTER update(env) ran. */
  snapshot(): { transforms: Record<string, FrameTransform>; camera: CameraSnapshot };
}

/** Build the recording api + its record store. Returned to runScene, which drives update() per frame. */
export function createRecordApi(opts: {
  baseParams: Record<string, number | string>;
  palette: Record<string, string>;
  screens?: Record<string, { dir: string; frames: number }>;
  layers?: Record<string, { path: string; aspect: number }>;
}): Recorder {
  const { baseParams, palette, screens = {}, layers = {} } = opts;
  const records: { obj: TimelineObject; handle: Handle }[] = [];
  const cam: CameraSnapshot = { p: [0, 0, 6], lookAt: null, fov: 40, zoom: 1 };
  let world: "studio" | "night" | "none" = "none";
  let postConfig: { bloom?: { strength: number; radius: number; threshold: number } } | null = null;

  // Palette names ("mint"/"green"/"night"/"white"/"gold") resolve; anything else is a raw CSS color.
  const color = (v: string | number | undefined, fallback = "#ffffff"): string => {
    if (v === undefined) return fallback;
    if (typeof v === "number") return "#" + (v & 0xffffff).toString(16).padStart(6, "0");
    return palette[v] ?? v;
  };
  const resolvePathRel = (p: string | ParamRef): string => {
    const rel = p instanceof ParamRef ? String(baseParams[p.name] ?? "") : p;
    // Staging already copies scene assets into _public; python resolves this RELATIVE path against
    // publicDir. A ParamRef that resolved to nothing is a beat misconfiguration — fail loud.
    if (!rel) throw new Error(`scene asset path resolved empty${p instanceof ParamRef ? ` (param "${p.name}")` : ""}`);
    return rel;
  };
  const record = (type: ObjectType, opts: Record<string, unknown>, handle: Handle): Handle => {
    const obj: TimelineObject = { id: `${type}-${records.length}`, type, opts };
    if (handle.material) obj.material = handle.material; // shared ref: material.opacity mutations snapshot per frame
    records.push({ obj, handle });
    return handle;
  };

  // --- materials -------------------------------------------------------------------------------
  const pbr = (o: {
    color?: string | number; metalness?: number; roughness?: number; envMapIntensity?: number;
    transparent?: boolean; opacity?: number; clearcoat?: number; clearcoatRoughness?: number;
  } = {}): MaterialSpec => {
    const m: MaterialSpec = {
      kind: "pbr",
      color: color(o.color),
      metalness: o.metalness ?? 0.1,
      roughness: o.roughness ?? 0.6,
      envMapIntensity: o.envMapIntensity ?? 1,
      transparent: o.transparent ?? false,
      opacity: o.opacity ?? 1,
    };
    if (o.clearcoat !== undefined || o.clearcoatRoughness !== undefined) {
      m.clearcoat = o.clearcoat ?? 0;
      m.clearcoatRoughness = o.clearcoatRoughness ?? 0;
    }
    return m;
  };
  const basic = (o: { color?: string | number; transparent?: boolean; opacity?: number } = {}): MaterialSpec => ({
    kind: "basic",
    color: color(o.color),
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
  });
  const emissive = (o: { color?: string | number } = {}): MaterialSpec => ({ kind: "emissive", color: color(o.color) });

  // --- meshes ----------------------------------------------------------------------------------
  const mesh = (type: ObjectType, opts: Record<string, unknown>, material?: unknown) =>
    record(type, opts, makeHandle((material as MaterialSpec) ?? pbr()));
  const box = (o: { size?: [number, number, number]; material?: unknown } = {}) =>
    mesh("box", { size: o.size ?? [1, 1, 1] }, o.material);
  const sphere = (o: { radius?: number; material?: unknown } = {}) =>
    mesh("sphere", { radius: o.radius ?? 0.5 }, o.material);
  const plane = (o: { size?: [number, number]; material?: unknown } = {}) =>
    mesh("plane", { size: o.size ?? [1, 1] }, o.material);
  const cylinder = (o: { radius?: number; height?: number; material?: unknown } = {}) =>
    mesh("cylinder", { radius: o.radius ?? 0.5, height: o.height ?? 1 }, o.material);
  const torus = (o: { radius?: number; tube?: number; material?: unknown } = {}) =>
    mesh("torus", { radius: o.radius ?? 0.5, tube: o.tube ?? 0.2 }, o.material);
  const roundedBox = (o: { size?: [number, number, number]; radius?: number; material?: unknown } = {}) =>
    mesh("roundedBox", { size: o.size ?? [1, 1, 1], radius: o.radius ?? 0.1 }, o.material);

  /** Re-parent objects under one group; children get parent=group.id (the group is the transform handle). */
  const group = (...children: Handle[]) => {
    const g = record("group", {}, makeHandle());
    const gid = records[records.length - 1].obj.id;
    for (const c of children) {
      const rec = records.find((r) => r.handle === c);
      if (rec) rec.obj.parent = gid;
    }
    return g;
  };

  // --- lights ----------------------------------------------------------------------------------
  const dirLight = (o: { color?: string | number; intensity?: number; position?: [number, number, number] } = {}) => {
    const pos = o.position ?? [3, 5, 2];
    return record("dirLight", { color: color(o.color), intensity: o.intensity ?? 1, position: pos }, makeHandle(undefined, pos));
  };
  const ambient = (o: { color?: string | number; intensity?: number } = {}) =>
    record("ambient", { color: color(o.color), intensity: o.intensity ?? 0.4 }, makeHandle());
  const hemi = (o: { sky?: string | number; ground?: string | number; intensity?: number } = {}) =>
    record("hemi", { sky: color(o.sky), ground: color(o.ground ?? "night"), intensity: o.intensity ?? 0.6 }, makeHandle());

  const env = (preset: "studio" | "night" | "none") => { world = preset; };

  /** Fake blurred ground shadow (no light coupling). Animate .material.opacity / .scale / .position. */
  const contactShadow = (o: { radius?: number; opacity?: number; y?: number } = {}) => {
    const opacity = o.opacity ?? 0.35;
    const mat = basic({ color: 0x000000, transparent: true, opacity });
    return record("contactShadow", { radius: o.radius ?? 1.4, opacity, y: o.y ?? -1 }, makeHandle(mat, [0, o.y ?? -1, 0]));
  };

  const post = (cfg: { bloom?: { strength?: number; radius?: number; threshold?: number } }) => {
    postConfig = cfg.bloom
      ? { bloom: { strength: cfg.bloom.strength ?? 1, radius: cfg.bloom.radius ?? 0.4, threshold: cfg.bloom.threshold ?? 0.85 } }
      : null;
  };

  // --- camera rig (ABSOLUTE setters; each writes final state from its args, never reads prior) -----
  const camera = (o: { fov?: number; near?: number; far?: number; position?: [number, number, number] } = {}) => {
    if (o.fov !== undefined) cam.fov = o.fov;
    if (o.position) { cam.p[0] = o.position[0]; cam.p[1] = o.position[1]; cam.p[2] = o.position[2]; }
    const rig = {
      orbit(p: { radius: number; y?: number; angle?: number }) {
        const a = p.angle ?? 0;
        cam.p = [Math.sin(a) * p.radius, p.y ?? 0, Math.cos(a) * p.radius];
        cam.lookAt = [0, 0, 0];
        return rig;
      },
      dolly(z: number) { cam.p[2] = z; return rig; },
      lookAt(x: number, y: number, z: number) { cam.lookAt = [x, y, z]; return rig; },
      zoom(f: number) { cam.zoom = f; return rig; },
    };
    return rig;
  };

  // --- assets ----------------------------------------------------------------------------------
  const texture = (pathOrParam: string | ParamRef): TextureHandle => ({ path: resolvePathRel(pathOrParam) });

  /** Animated html screen (rasterized sequence) or static texture passthrough for non-html paths. */
  const screen = (pathOrParam: string | ParamRef): TextureHandle => {
    const rel = resolvePathRel(pathOrParam);
    if (!rel.toLowerCase().endsWith(".html")) return { path: rel };
    const r = screens[rel];
    if (!r) throw new Error(`api.screen("${rel}") has no rasterized sequence — the pre-raster pass must run before runScene`);
    return { path: r.dir, frames: r.frames };
  };

  /** One rasterized SVG element as its own plane; per-layer depth/material/keyframes. */
  const layerZs: number[] = [];
  const layer = (pathOrParam: string | ParamRef, o: {
    x?: number; y?: number; z?: number; width?: number;
    material?: "unlit" | "emissive"; emission?: number;
  } = {}) => {
    const rel = resolvePathRel(pathOrParam);
    const r = layers[rel];
    if (!r) throw new Error(`api.layer("${rel}") has no rasterized png — the pre-raster pass must run before runScene`);
    const z = o.z ?? 0;
    for (const prev of layerZs) {
      if (Math.abs(prev - z) < 0.02) {
        throw new Error(`api.layer z ${z} is within 0.02 of another layer (z-fighting) — separate layer depths by >= 0.02`);
      }
    }
    layerZs.push(z);
    const h = makeHandle(basic({ transparent: true, opacity: 1 }), [o.x ?? 0, o.y ?? 0, z]);
    return record("layer", {
      path: r.path,
      aspect: r.aspect,
      width: o.width ?? 1,
      material: o.material ?? "unlit",
      emission: o.emission ?? 1,
    }, h);
  };

  const gltf = (pathOrParam: string | ParamRef) =>
    record("gltf", { path: resolvePathRel(pathOrParam) }, makeHandle());

  /**
   * Centered extruded 3D text. The geometry.boundingBox shim approximates a proportional-font glyph
   * run: x extent ≈ 0.62·size·length, y extent ≈ size (presets read width only, to fit the mark to
   * the frame). It is a coarse advance estimate — no per-glyph metrics — good enough for a fit scale.
   */
  const text3d = (str: string, o: { size?: number; depth?: number; bevel?: boolean; material?: unknown } = {}) => {
    const size = o.size ?? 1;
    const depth = o.depth ?? 0.3;
    const h = makeHandle((o.material as MaterialSpec) ?? pbr());
    h.geometry = {
      boundingBox: null,
      computeBoundingBox() {
        const w = 0.62 * size * str.length;
        this.boundingBox = { min: { x: -w / 2, y: -size / 2, z: -depth / 2 }, max: { x: w / 2, y: size / 2, z: depth / 2 } };
      },
    };
    return record("text3d", { text: str, size, depth, bevel: o.bevel ?? true }, h);
  };

  /** InstancedMesh of `count` small spheres seeded by mulberry32 inside a ±spread cube — positions HERE. */
  const particles = (count: number, o: { spread?: number; size?: number; color?: string | number; seed?: number } = {}) => {
    const spread = o.spread ?? 10;
    const rand = mulberry32(o.seed ?? 1);
    const positions: [number, number, number][] = [];
    for (let i = 0; i < count; i++)
      positions.push([(rand() * 2 - 1) * spread, (rand() * 2 - 1) * spread, (rand() * 2 - 1) * spread]);
    const h = makeHandle(pbr({ color: o.color ?? "white" }));
    return record("particles", { count, spread, size: o.size ?? 0.06, seed: o.seed ?? 1, positions }, h);
  };

  /** Rounded-slab phone: dark clearcoat body + unlit screen showing the `screen` texture. */
  const devicePhone = (o: { screen: TextureHandle | string; width?: number; height?: number; depth?: number; radius?: number }) => {
    const screenTex = typeof o.screen === "string" ? { path: o.screen } : o.screen ?? { path: "" };
    return record("devicePhone", {
      screen: screenTex.path,
      ...(screenTex.frames ? { screenFrames: screenTex.frames } : {}),
      width: o.width ?? 1,
      height: o.height ?? 2.16,
      depth: o.depth ?? 0.08,
      radius: o.radius ?? 0.09,
    }, makeHandle());
  };

  const api = {
    box, sphere, plane, cylinder, torus, roundedBox,
    pbr, basic, emissive,
    group, dirLight, ambient, hemi, env, contactShadow, post, camera,
    texture, screen, layer, gltf, text3d, particles, devicePhone,
    /** Seeded PRNG factory: api.random(seed)() → next float in [0,1). */
    random: (seed: number) => mulberry32(seed),
    /** Deferred param reference; pass to texture/gltf to resolve baseParams[name] at load time. */
    param: (name: string) => new ParamRef(name),
    /** Linear interpolate a→b by t (0..1). */
    lerp: (a: number, b: number, t: number) => a + (b - a) * t,
    /** Frame-rate-independent smoothing toward a target (x, y, lambda, dt). */
    damp: (x: number, y: number, lambda: number, dt: number) => x + (y - x) * (1 - Math.exp(-lambda * dt)),
    /** Readonly resolved beat params (e.g. api.params.text) — build-time reads. */
    params: baseParams as Readonly<Record<string, number | string>>,
  };

  return {
    api,
    // Getter: body executes AFTER createRecordApi returns, pushing into `records` during api.* calls.
    get objects() {
      return records.map((r) => r.obj);
    },
    world: () => world,
    post: () => postConfig,
    snapshot() {
      const transforms: Record<string, FrameTransform> = {};
      for (const { obj, handle } of records) {
        const t: FrameTransform = {
          p: [q(handle.position.x), q(handle.position.y), q(handle.position.z)],
          r: [q(handle.rotation.x), q(handle.rotation.y), q(handle.rotation.z)],
          s: [q(handle.scale.x), q(handle.scale.y), q(handle.scale.z)],
          visible: handle.visible,
        };
        if (handle.material && typeof handle.material.opacity === "number") t.opacity = q(handle.material.opacity);
        transforms[obj.id] = t;
      }
      return { transforms, camera: { p: [q(cam.p[0]), q(cam.p[1]), q(cam.p[2])], lookAt: cam.lookAt ? [q(cam.lookAt[0]), q(cam.lookAt[1]), q(cam.lookAt[2])] : null, fov: q(cam.fov), zoom: q(cam.zoom) } };
    },
  };
}
