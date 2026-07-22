// The 3D scene seam: everything a *.scene.js file may touch. Scene code gets `api` only —
// three.js is an implementation detail behind this file, and the future backend-swap point.
// Keep this surface small and fully documented; agents read THIS file (and docs/3d-scenes.md),
// not three. Determinism: no wall clock, no Math.random here — seeded mulberry32 only.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FontLoader, type Font, type FontData } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
// Vendored: three@0.185's npm tarball omits examples/fonts, so the typeface lives beside this file.
import typefaceDefault from "./helvetiker_regular.typeface.json";

// --- pending-load registry (module-level: the engine's settle awaits across all live scenes) ---
const pending = new Set<Promise<unknown>>();
function track<T>(p: Promise<T>): Promise<T> {
  pending.add(p); // rejection surfaces when settleScene awaits it (engine reports via __kinoError)
  return p;
}
/** Await all in-flight asset loads across every scene; true if anything was pending (re-settle once), false if idle. */
export async function settleScene(): Promise<boolean> {
  if (!pending.size) return false;
  const batch = [...pending];
  pending.clear();
  await Promise.all(batch); // a rejected load throws → engine surfaces it
  return true;
}

// --- URL-keyed caches: beats remount per Sequence; identical loads must not repeat -------------
const textureCache = new Map<string, Promise<THREE.Texture>>();
const gltfCache = new Map<string, Promise<THREE.Group>>();
let fontCache: Font | null = null;

/** Asset-loader seam (injectable for tests); default uses three loaders behind the URL caches. */
export interface SceneLoaders {
  texture(url: string): Promise<THREE.Texture>;
  gltf(url: string): Promise<THREE.Group>;
}
const defaultLoaders: SceneLoaders = {
  texture: (url) =>
    new THREE.TextureLoader().loadAsync(url).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }),
  gltf: (url) => new GLTFLoader().loadAsync(url).then((g) => g.scene),
};

/** Opaque marker: api.param("x") resolves to baseParams.x at asset-load time (deferred binding). */
class ParamRef {
  constructor(readonly name: string) {}
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

/** Post-processing config an api.post() call stores; Scene3D reads it to choose the render path. */
export interface PostConfig {
  bloom?: { strength?: number; radius?: number; threshold?: number };
}

/**
 * Deterministic radial-alpha texture (RGBA, black, alpha = smoothstepped falloff center→edge).
 * Drawn from fixed math — no canvas, no randomness — so it works headless (tests) and page-side.
 * Used as the contact-shadow disc's map: a fake soft ground shadow, no light coupling.
 */
function radialAlphaTexture(size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / c; // 0 center → 1 at the inscribed edge
      const t = Math.min(1, Math.max(0, 1 - d));
      const a = t * t * (3 - 2 * t); // smoothstep for a soft, non-linear falloff
      const i = (y * size + x) * 4;
      data[i + 3] = Math.round(a * 255); // RGB stays 0 (black shadow); alpha carries the shape
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Deterministic vertical-gradient texture (1×N, `top`→`bottom` linear ramp). Backs the studio env
 * dome so reflections carry a soft top-down falloff. No canvas — DataTexture from fixed math.
 */
function verticalGradientTexture(top: THREE.Color, bottom: THREE.Color, h = 64): THREE.DataTexture {
  const data = new Uint8Array(h * 4);
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    const r = bottom.r + (top.r - bottom.r) * t;
    const g = bottom.g + (top.g - bottom.g) * t;
    const b = bottom.b + (top.b - bottom.b) * t;
    const i = y * 4;
    data[i] = Math.round(r * 255);
    data[i + 1] = Math.round(g * 255);
    data[i + 2] = Math.round(b * 255);
    data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, 1, h);
  tex.needsUpdate = true;
  return tex;
}

/** Build the curated scene API + its three.js scene graph. Returned to Scene3D (Task 5). */
export function createSceneApi(opts: {
  baseParams: Record<string, number | string>;
  palette: Record<string, string>;
  width: number;
  height: number;
  loaders?: SceneLoaders;
}) {
  const { baseParams, palette, width, height } = opts;
  const loaders = opts.loaders ?? defaultLoaders;
  const root = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(40, width / height, 0.1, 200);
  cam.position.set(0, 0, 6);
  let envPreset: "studio" | "night" | "none" = "none";
  /** Post-processing declared by api.post(); read once by Scene3D to pick the render path. */
  let postConfig: PostConfig | null = null;

  // Palette names ("mint"/"green"/"night"/"white"/"gold") resolve; anything else is a raw CSS color.
  const color = (v: string | number | undefined, fallback = "#ffffff") =>
    new THREE.Color(typeof v === "string" ? palette[v] ?? v : v ?? fallback);
  const resolvePath = (p: string | ParamRef): string => {
    const rel = p instanceof ParamRef ? String(baseParams[p.name] ?? "") : p;
    if (!rel) throw new Error(`scene asset path resolved empty${p instanceof ParamRef ? ` (param "${p.name}")` : ""}`);
    return "/public/" + rel.split("/").map(encodeURIComponent).join("/");
  };
  const add = <T extends THREE.Object3D>(o: T): T => {
    root.add(o);
    return o;
  };

  // --- materials -------------------------------------------------------------------------------
  /**
   * Physically-based material; color name resolved from palette. Setting `clearcoat` or
   * `clearcoatRoughness` upgrades to MeshPhysicalMaterial (a glossy lacquer coat over the base —
   * the "wet"/premium sheen of a phone body); otherwise MeshStandardMaterial as before. All other
   * options carry over either way (Physical extends Standard).
   */
  const pbr = (o: {
    color?: string | number;
    metalness?: number;
    roughness?: number;
    envMapIntensity?: number;
    transparent?: boolean;
    opacity?: number;
    map?: THREE.Texture;
    clearcoat?: number;
    clearcoatRoughness?: number;
  } = {}) => {
    const base = {
      color: color(o.color),
      metalness: o.metalness ?? 0.1,
      roughness: o.roughness ?? 0.6,
      envMapIntensity: o.envMapIntensity ?? 1,
      transparent: o.transparent ?? false,
      opacity: o.opacity ?? 1,
      ...(o.map ? { map: o.map } : {}),
    };
    if (o.clearcoat !== undefined || o.clearcoatRoughness !== undefined)
      return new THREE.MeshPhysicalMaterial({ ...base, clearcoat: o.clearcoat ?? 0, clearcoatRoughness: o.clearcoatRoughness ?? 0 });
    return new THREE.MeshStandardMaterial(base);
  };
  /** Unlit material (ignores lighting) — use for screenshots/emissive-flat surfaces. */
  const basic = (o: { color?: string | number; map?: THREE.Texture; transparent?: boolean; opacity?: number } = {}) =>
    new THREE.MeshBasicMaterial({
      color: color(o.color),
      transparent: o.transparent ?? false,
      opacity: o.opacity ?? 1,
      ...(o.map ? { map: o.map } : {}),
    });
  /** Self-lit material that glows without a light; color is the emission. */
  const emissive = (o: { color?: string | number; intensity?: number } = {}) =>
    new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: color(o.color),
      emissiveIntensity: o.intensity ?? 1,
    });

  // --- meshes (each builds geometry from opts, defaults to pbr, and is added to root) -----------
  const mesh = (geo: THREE.BufferGeometry, material?: THREE.Material) => add(new THREE.Mesh(geo, material ?? pbr()));
  /** Box mesh; size is [x,y,z] (default unit cube). */
  const box = (o: { size?: [number, number, number]; material?: THREE.Material } = {}) =>
    mesh(new THREE.BoxGeometry(...(o.size ?? [1, 1, 1])), o.material);
  /** Sphere mesh of the given radius. */
  const sphere = (o: { radius?: number; material?: THREE.Material } = {}) =>
    mesh(new THREE.SphereGeometry(o.radius ?? 0.5, 32, 16), o.material);
  /** Flat plane mesh; size is [width,height]. */
  const plane = (o: { size?: [number, number]; material?: THREE.Material } = {}) =>
    mesh(new THREE.PlaneGeometry(...(o.size ?? [1, 1])), o.material);
  /** Cylinder mesh (uniform radius). */
  const cylinder = (o: { radius?: number; height?: number; material?: THREE.Material } = {}) =>
    mesh(new THREE.CylinderGeometry(o.radius ?? 0.5, o.radius ?? 0.5, o.height ?? 1, 32), o.material);
  /** Torus (ring) mesh; radius is the ring, tube is its thickness. */
  const torus = (o: { radius?: number; tube?: number; material?: THREE.Material } = {}) =>
    mesh(new THREE.TorusGeometry(o.radius ?? 0.5, o.tube ?? 0.2, 16, 48), o.material);
  /** Rounded-corner box mesh; size is [x,y,z], radius is corner rounding. */
  const roundedBox = (o: { size?: [number, number, number]; radius?: number; material?: THREE.Material } = {}) => {
    const [x, y, z] = o.size ?? [1, 1, 1];
    return mesh(new RoundedBoxGeometry(x, y, z, 4, o.radius ?? 0.1), o.material);
  };

  /** Re-parent objects under one Group (added to root); the group is the transform handle. */
  const group = (...children: THREE.Object3D[]) => {
    const g = new THREE.Group();
    for (const c of children) g.add(c); // three removes c from its previous parent (root)
    return add(g);
  };

  // --- lights ----------------------------------------------------------------------------------
  /** Directional (sun) light with position and intensity. */
  const dirLight = (o: { color?: string | number; intensity?: number; position?: [number, number, number] } = {}) => {
    const l = new THREE.DirectionalLight(color(o.color).getHex(), o.intensity ?? 1);
    l.position.set(...(o.position ?? [3, 5, 2]));
    return add(l);
  };
  /** Ambient fill light (uniform, no direction). */
  const ambient = (o: { color?: string | number; intensity?: number } = {}) =>
    add(new THREE.AmbientLight(color(o.color).getHex(), o.intensity ?? 0.4));
  /** Hemisphere light: sky color above, ground color below. */
  const hemi = (o: { sky?: string | number; ground?: string | number; intensity?: number } = {}) =>
    add(new THREE.HemisphereLight(color(o.sky).getHex(), color(o.ground ?? "night").getHex(), o.intensity ?? 0.6));

  /** Select the image-based environment; realised once per renderer by applyEnv (Scene3D calls it). */
  const env = (preset: "studio" | "night" | "none") => {
    envPreset = preset;
  };

  /**
   * Fake blurred ground shadow: a flat disc with a radial-alpha texture, laid in the XZ plane under
   * the subject. Grounds a product shot cheaply. It is NOT light-coupled — it doesn't move with any
   * light, doesn't respect occluders, and casts nothing; position/size/opacity are all you control.
   * Returns the mesh (animate `.material.opacity` / `.scale` / `.position` from update(env)).
   */
  const contactShadow = (o: { radius?: number; opacity?: number; y?: number } = {}) => {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      map: radialAlphaTexture(),
      transparent: true,
      opacity: o.opacity ?? 0.35,
      depthWrite: false, // a ground shadow must never occlude the subject in the depth buffer
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(o.radius ?? 1.4, 48), mat);
    disc.rotation.x = -Math.PI / 2; // face up: lie flat on the ground plane
    disc.position.y = o.y ?? -1;
    disc.renderOrder = -1; // draw before the subject so its transparency composites underneath
    return add(disc);
  };

  /** Declare post-processing (opt-in). Scene3D uses EffectComposer+UnrealBloomPass when bloom is set. */
  const post = (cfg: PostConfig) => {
    postConfig = cfg;
  };

  /** Camera rig over the single scene camera: orbit/dolly/lookAt/zoom, plus `.three` for raw access. */
  const camera = (o: { fov?: number; near?: number; far?: number; position?: [number, number, number] } = {}) => {
    if (o.fov !== undefined) cam.fov = o.fov;
    if (o.near !== undefined) cam.near = o.near;
    if (o.far !== undefined) cam.far = o.far;
    if (o.position) cam.position.set(...o.position);
    cam.updateProjectionMatrix();
    // Every rig method is an ABSOLUTE setter (writes final state from its args, never reads prior
    // camera state). update(env) must be a pure function of env — kino reruns it every frame, so a
    // relative op (e.g. translateZ) would accumulate across frames and make position frame-history-
    // dependent. Same call twice ⇒ same camera.
    const rig = {
      three: cam,
      /** Place camera on a horizontal ring of `radius` at height `y`, angle in radians, looking at origin. */
      orbit(p: { radius: number; y?: number; angle?: number }) {
        const a = p.angle ?? 0;
        cam.position.set(Math.sin(a) * p.radius, p.y ?? 0, Math.cos(a) * p.radius);
        cam.lookAt(0, 0, 0);
        return rig;
      },
      /** Set the camera's world-Z distance (absolute, not relative — larger z pulls back from origin). */
      dolly(z: number) {
        cam.position.z = z;
        return rig;
      },
      /** Aim the camera at a world point. */
      lookAt(x: number, y: number, z: number) {
        cam.lookAt(x, y, z);
        return rig;
      },
      /** Zoom factor (>1 magnifies); updates the projection. */
      zoom(f: number) {
        cam.zoom = f;
        cam.updateProjectionMatrix();
        return rig;
      },
    };
    return rig;
  };

  // --- assets ----------------------------------------------------------------------------------
  /** Load an image as a texture (cached per URL, settled by settleScene); usable as a material map immediately. */
  const texture = (pathOrParam: string | ParamRef): THREE.Texture => {
    const url = resolvePath(pathOrParam);
    let load = textureCache.get(url);
    if (!load) {
      load = loaders.texture(url);
      textureCache.set(url, load);
    }
    const tex = new THREE.Texture(); // stable placeholder; GPU upload happens when the image resolves
    track(
      load.then((loaded) => {
        tex.image = (loaded as THREE.Texture).image;
        tex.colorSpace = (loaded as THREE.Texture).colorSpace ?? THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        return tex;
      }),
    );
    return tex;
  };
  /** Load a glTF model (cached per URL); returns a Group added to root now, filled in when the load settles. */
  const gltf = (pathOrParam: string | ParamRef): THREE.Group => {
    const url = resolvePath(pathOrParam);
    let load = gltfCache.get(url);
    if (!load) {
      load = loaders.gltf(url);
      gltfCache.set(url, load);
    }
    const proxy = add(new THREE.Group()); // transform this now; the loaded scene is cloned in under it later
    track(load.then((g) => proxy.add(g.clone(true))));
    return proxy;
  };

  /** Centered, extruded 3D text (bundled Helvetiker font); added to root. */
  const text3d = (
    str: string,
    o: { size?: number; depth?: number; bevel?: boolean; material?: THREE.Material } = {},
  ) => {
    fontCache ??= new FontLoader().parse(typefaceDefault as unknown as FontData);
    const depth = o.depth ?? 0.3;
    const geo = new TextGeometry(str, {
      font: fontCache,
      size: o.size ?? 1,
      depth,
      bevelEnabled: o.bevel ?? true,
      bevelThickness: depth * 0.08,
      bevelSize: depth * 0.06,
    });
    geo.center();
    return mesh(geo, o.material);
  };

  /** InstancedMesh of `count` small spheres seeded by mulberry32 inside a ±spread cube. */
  const particles = (
    count: number,
    o: { spread?: number; size?: number; color?: string | number; seed?: number } = {},
  ) => {
    const spread = o.spread ?? 10;
    const geo = new THREE.SphereGeometry(o.size ?? 0.06, 6, 6);
    const inst = new THREE.InstancedMesh(geo, pbr({ color: o.color ?? "white" }), count);
    const rand = mulberry32(o.seed ?? 1);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      m.makeTranslation((rand() * 2 - 1) * spread, (rand() * 2 - 1) * spread, (rand() * 2 - 1) * spread);
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    return add(inst);
  };

  /** A device-phone prop: rounded dark body + an unlit screen plane showing `screen` (not tone-mapped). */
  const devicePhone = (o: {
    screen: THREE.Texture;
    width?: number;
    height?: number;
    depth?: number;
    radius?: number;
  }) => {
    const w = o.width ?? 1;
    const h = o.height ?? 2.16;
    const d = o.depth ?? 0.08;
    const g = new THREE.Group();
    // Clearcoat on the body: the glossy lacquer sheen of a real device shell (physical material).
    g.add(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, o.radius ?? 0.09), pbr({ color: "#101216", metalness: 0.6, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.25 })));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.94, h * 0.94), new THREE.MeshBasicMaterial({ map: o.screen, toneMapped: false }));
    screen.position.z = d / 2 + 0.001;
    g.add(screen);
    return add(g);
  };

  const api = {
    box,
    sphere,
    plane,
    cylinder,
    torus,
    roundedBox,
    pbr,
    basic,
    emissive,
    group,
    dirLight,
    ambient,
    hemi,
    env,
    contactShadow,
    post,
    camera,
    texture,
    gltf,
    text3d,
    particles,
    devicePhone,
    /** Seeded PRNG factory: api.random(seed)() → next float in [0,1). */
    random: (seed: number) => mulberry32(seed),
    /** Deferred param reference; pass to texture/gltf to resolve baseParams[name] at load time. */
    param: (name: string) => new ParamRef(name),
    /** Linear interpolate a→b by t (0..1). */
    lerp: THREE.MathUtils.lerp,
    /** Frame-rate-independent smoothing toward a target (x, y, lambda, dt). */
    damp: THREE.MathUtils.damp,
    /** Readonly resolved beat params (e.g. api.params.text) — presets may read at build time. */
    params: baseParams as Readonly<Record<string, number | string>>,
  };

  /**
   * Procedural softbox studio: a dim vertical-gradient dome (soft top-down falloff in reflections)
   * plus bright **strip** softboxes — narrow tall cards, key + side rims + a back edge — as unlit
   * HDR-bright planes. PMREM'd into an env map for shaped speculars on metal/clearcoat. Strips (not
   * broad cards) are deliberate: a flat metal face mirrors a wide card as a full-face white wash that
   * bloom then blows to a blob, whereas a narrow strip only ever reflects as a thin highlight streak
   * at any rotation — the premium "studio glint" look, bloom-safe. Fully deterministic (fixed
   * geometry + DataTexture gradient); no HDR asset, no randomness. "night" reuses the same env at
   * 0.35 environmentIntensity (dimmer reflections, same shapes).
   */
  function buildStudioEnv(): THREE.Scene {
    const s = new THREE.Scene();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(40, 24, 12),
      new THREE.MeshBasicMaterial({ map: verticalGradientTexture(new THREE.Color(0x2a3240), new THREE.Color(0x05070c)), side: THREE.BackSide }),
    );
    s.add(dome);
    // A strip softbox: unlit plane whose color exceeds 1 (HDR-bright) so PMREM reads it as a light.
    const strip = (w: number, h: number, pos: [number, number, number], intensity: number) => {
      const card = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(intensity, intensity, intensity) }),
      );
      card.position.set(...pos);
      card.lookAt(0, 0, 0);
      s.add(card);
    };
    strip(2.4, 11, [6, 3, 7], 4); // key: tall strip, front-right
    strip(1.8, 10, [-8, 2, 3], 2.6); // left rim strip
    strip(1.8, 10, [8, 1, -3], 2.6); // right rim strip
    strip(2.6, 9, [-1, 5, -9], 3); // back-top edge strip
    return s;
  }

  /** Build the PMREM environment map for this renderer (Scene3D calls once after renderer creation). */
  function applyEnv(renderer: THREE.WebGLRenderer): void {
    if (envPreset === "none") return;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = buildStudioEnv();
    root.environment = pmrem.fromScene(envScene, 0.04).texture;
    root.environmentIntensity = envPreset === "night" ? 0.35 : 1;
    pmrem.dispose(); // the generator's scratch targets; the produced env texture outlives it
  }

  return { api, root, camera: () => cam, applyEnv, post: () => postConfig };
}
