"""kino_render.py — fixed Blender translator for Kino 3D beats (Task 13).

Invocation (Node spawns this; never hand-edited per beat — all variability is the timeline JSON):

    blender -b --factory-startup -noaudio -P scripts/kino_render.py -- timeline.json outDir publicDir

Reads a timeline JSON (produced by src/render/scene/runScene.ts), builds the scene once, then
renders one PNG per frame to <outDir>/f00001.png, f00002.png, ...

Coordinate convention: the timeline is authored in three.js/Kino Y-up space; Blender is Z-up.
We keep every object's LOCAL axes as authored and only relabel which axis is "up" once, via a
fixed per-vector remap applied consistently to positions, lookAt targets, scales and eulers:

    position/lookAt : (x, y, z)   -> (x, -z, y)
    scale           : (sx,sy,sz)  -> (sx, sz, sy)
    euler (XYZ)     : (rx,ry,rz)  -> (rx, rz, ry)

A pure kino-Y rotation (spin around "up") becomes a pure Blender-Z rotation (also "up") — the
case every preset actually uses. Multi-axis rotations are a documented approximation (see the
Blender backend design doc); no preset currently needs more than single-axis spin.

Compatibility: written against Blender >= 4.2 (Principled BSDF v2 socket names, EEVEE Next/EEVEE,
compositor Glare bloom). Blender 5.0 renamed several APIs (EEVEE engine id, scene compositor
node tree, Glare node params, Material.blend_method); every such spot below tries the current
name first and falls back to the older one, so this one file runs unmodified on 4.2..5.x.

Exits nonzero with a full traceback on any exception (Node/execa surfaces stderr).
"""

import math
import os
import sys
import traceback


# ---------------------------------------------------------------------------
# Pure helpers (no bpy) — kept dependency-free so `python3 kino_render.py --selftest` can check
# the coordinate/color math without a Blender install.
# ---------------------------------------------------------------------------

def kino_to_blender_pos(p):
    x, y, z = p
    return (x, -z, y)


def kino_to_blender_scale(s):
    x, y, z = s
    return (x, z, y)


def kino_to_blender_euler(r):
    x, y, z = r
    return (x, z, y)


def srgb_to_linear_channel(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgba(hex_str, alpha=1.0):
    """'#rrggbb' (or short '#rgb') sRGB hex -> linear RGBA tuple for shader node default_value."""
    h = (hex_str or "#ffffff").lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    r = int(h[0:2], 16) / 255.0
    g = int(h[2:4], 16) / 255.0
    b = int(h[4:6], 16) / 255.0
    return (srgb_to_linear_channel(r), srgb_to_linear_channel(g), srgb_to_linear_channel(b), alpha)


def _selftest():
    assert kino_to_blender_pos([1, 2, 3]) == (1, -3, 2)
    assert kino_to_blender_scale([1, 2, 3]) == (1, 3, 2)
    assert kino_to_blender_euler([1, 2, 3]) == (1, 3, 2)
    r, g, b, a = hex_to_linear_rgba("#ffffff")
    assert abs(r - 1.0) < 1e-9 and abs(g - 1.0) < 1e-9 and abs(b - 1.0) < 1e-9 and a == 1.0
    r0, g0, b0, _ = hex_to_linear_rgba("#000000")
    assert r0 == 0.0 and g0 == 0.0 and b0 == 0.0
    rg, _, _, _ = hex_to_linear_rgba("#808080")
    assert 0.2 < rg < 0.24, rg  # sRGB mid-grey (0x80) -> linear ~0.216
    print("kino_render.py --selftest OK")


# ---------------------------------------------------------------------------
# Everything below needs bpy; imported lazily so --selftest works without Blender.
# ---------------------------------------------------------------------------

def set_input(node, names, value):
    """Set the first matching socket name found (handles cross-version Principled renames)."""
    for name in names:
        if name in node.inputs:
            node.inputs[name].default_value = value
            return True
    return False


def new_material(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True  # no-op on Blender >= 5.0 (materials always have nodes there)
    if mat.node_tree is None:
        raise RuntimeError(f"material '{name}' has no node_tree after use_nodes=True")
    mat.node_tree.nodes.clear()
    return mat


def set_material_transparent(mat, transparent):
    """Material.blend_method was renamed Material.surface_render_method in Blender 5.0."""
    try:
        mat.surface_render_method = "BLENDED" if transparent else "DITHERED"
    except AttributeError:
        mat.blend_method = "BLEND" if transparent else "OPAQUE"


def add_alpha_value_node(mat):
    """A named Value node every material exposes, so per-frame opacity is a single uniform write:
    set_material_opacity() below just looks up this node by name on any material we build."""
    n = mat.node_tree.nodes.new("ShaderNodeValue")
    n.name = n.label = "KinoAlpha"
    n.outputs[0].default_value = 1.0
    return n


def set_material_opacity(obj, value):
    data = getattr(obj, "data", None)
    materials = getattr(data, "materials", None) if data is not None else None
    if not materials:
        return
    for mat in materials:
        if mat is None or not mat.use_nodes or mat.node_tree is None:
            continue
        node = mat.node_tree.nodes.get("KinoAlpha")
        if node is not None:
            node.outputs[0].default_value = value


def build_pbr_material(spec, name):
    """MaterialSpec(kind="pbr") -> Principled BSDF. Blender 4.x/5.x socket names: Base Color,
    Metallic, Roughness, Coat Weight/Coat Roughness (renamed from Clearcoat in the 4.0 BSDF
    rewrite — try both), Alpha."""
    spec = spec or {}
    mat = new_material(name)
    nt = mat.node_tree
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = hex_to_linear_rgba(spec.get("color", "#ffffff"))
    bsdf.inputs["Metallic"].default_value = float(spec.get("metalness", 0.1))
    bsdf.inputs["Roughness"].default_value = float(spec.get("roughness", 0.6))
    if "clearcoat" in spec or "clearcoatRoughness" in spec:
        set_input(bsdf, ["Coat Weight", "Clearcoat"], float(spec.get("clearcoat", 0.0)))
        set_input(bsdf, ["Coat Roughness", "Clearcoat Roughness"], float(spec.get("clearcoatRoughness", 0.0)))
    opacity = float(spec.get("opacity", 1.0))
    transparent = bool(spec.get("transparent", False)) or opacity < 1.0
    alpha_node = add_alpha_value_node(mat)
    alpha_node.outputs[0].default_value = opacity
    nt.links.new(alpha_node.outputs[0], bsdf.inputs["Alpha"])
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    set_material_transparent(mat, transparent)
    return mat


def build_unlit_material(spec, name):
    """MaterialSpec(kind="basic"|"emissive") -> unlit color (three.js MeshBasicMaterial has no
    direct Blender equivalent). Built on Principled BSDF with Base Color pinned to black (~zero
    diffuse/specular response to scene lights) and the color driven through Emission Color/
    Strength instead — this reuses Principled's native Alpha socket for opacity (same wiring as
    build_pbr_material), which is a more direct/reliable transparency path than mixing a separate
    Emission node against a Transparent BSDF."""
    spec = spec or {}
    mat = new_material(name)
    nt = mat.node_tree
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 1.0
    set_input(bsdf, ["Emission Color"], hex_to_linear_rgba(spec.get("color", "#ffffff")))
    set_input(bsdf, ["Emission Strength"], 1.0)
    opacity = float(spec.get("opacity", 1.0))
    transparent = bool(spec.get("transparent", False)) or opacity < 1.0
    alpha_node = add_alpha_value_node(mat)
    alpha_node.outputs[0].default_value = opacity
    nt.links.new(alpha_node.outputs[0], bsdf.inputs["Alpha"])
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    set_material_transparent(mat, transparent)
    return mat


def build_material(spec, name):
    kind = (spec or {}).get("kind", "pbr")
    if kind == "pbr":
        return build_pbr_material(spec, name)
    return build_unlit_material(spec, name)  # "basic" and "emissive" both read as unlit


DARK_BODY_COLOR = "#15161a"  # devicePhone body — no MaterialSpec reaches Python for this type
                              # (recordApi's devicePhone handle carries no material); translator-
                              # owned constant, tune here (not per-preset) if the gate wants a change.


def build_dark_body_material(name):
    mat = new_material(name)
    nt = mat.node_tree
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = hex_to_linear_rgba(DARK_BODY_COLOR)
    bsdf.inputs["Metallic"].default_value = 0.4
    bsdf.inputs["Roughness"].default_value = 0.35
    set_input(bsdf, ["Coat Weight", "Clearcoat"], 0.6)
    set_input(bsdf, ["Coat Roughness", "Clearcoat Roughness"], 0.2)
    alpha_node = add_alpha_value_node(mat)
    nt.links.new(alpha_node.outputs[0], bsdf.inputs["Alpha"])
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    set_material_transparent(mat, False)
    return mat


def build_screen_material(image_path, name, frame_count=0):
    """Emission-mixed screenshot texture; a directory (frame_count > 0) mounts f%05d.png as an
    image SEQUENCE that advances with scene.frame_set. Missing/unreadable asset -> dark emission
    fallback, never raises (a broken beat asset shouldn't crash a whole build)."""
    mat = new_material(name)
    nt = mat.node_tree
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emission = nt.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.4
    loaded = False
    load_path = image_path
    if image_path and frame_count > 0 and os.path.isdir(image_path):
        load_path = os.path.join(image_path, "f00001.png")
    if load_path and os.path.isfile(load_path):
        try:
            img = bpy.data.images.load(load_path, check_existing=True)
            img.colorspace_settings.name = "sRGB"
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = img
            if frame_count > 0 and load_path != image_path:
                img.source = "SEQUENCE"
                tex.image_user.frame_duration = frame_count
                tex.image_user.frame_start = 1
                tex.image_user.frame_offset = 0
                tex.image_user.use_auto_refresh = True
            nt.links.new(tex.outputs["Color"], emission.inputs["Color"])
            loaded = True
        except Exception:
            loaded = False
    if not loaded:
        emission.inputs["Color"].default_value = (0.02, 0.02, 0.02, 1.0)
        emission.inputs["Strength"].default_value = 0.05
    nt.links.new(emission.outputs[0], out.inputs["Surface"])
    set_material_transparent(mat, False)
    return mat


def build_gradient_shadow_material(name, opacity):
    """EEVEE contactShadow: a radial-gradient alpha (opaque center -> transparent edge) times the
    per-frame KinoAlpha value, driving a flat black Principled's Alpha. Cycles uses a real
    shadow-catcher plane instead (build_contact_shadow)."""
    mat = new_material(name)
    nt = mat.node_tree
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    tex_coord = nt.nodes.new("ShaderNodeTexCoord")
    gradient = nt.nodes.new("ShaderNodeTexGradient")
    gradient.gradient_type = "SPHERICAL"
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (1.0, 1.0, 1.0, 1.0)
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = (0.0, 0.0, 0.0, 1.0)
    alpha_node = add_alpha_value_node(mat)
    alpha_node.outputs[0].default_value = opacity
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    nt.links.new(tex_coord.outputs["Object"], gradient.inputs["Vector"])
    nt.links.new(gradient.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], mul.inputs[0])  # RGBA->float auto-converts via luminance
    nt.links.new(alpha_node.outputs[0], mul.inputs[1])
    nt.links.new(mul.outputs[0], bsdf.inputs["Alpha"])
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    set_material_transparent(mat, True)
    return mat


# ---------------------------------------------------------------------------
# Objects
# ---------------------------------------------------------------------------

def apply_scale(obj):
    """Bake the object's current .scale into its mesh data (transform_apply), so per-frame
    frame.s can drive obj.scale from a clean (1,1,1) baseline without double-scaling geometry
    that was sized at creation time (box/plane/roundedBox/devicePhone dims)."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.context.view_layer.update()
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def apply_material_from_spec(obj, spec, id_):
    mat = build_material(spec.get("material"), id_ + "_mat")
    if hasattr(obj.data, "materials"):
        obj.data.materials.clear()
        obj.data.materials.append(mat)


def build_box(spec):
    size = spec["opts"].get("size", [1, 1, 1])
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.active_object
    obj.name = spec["id"]
    obj.dimensions = kino_to_blender_scale(size)
    bpy.context.view_layer.update()
    apply_scale(obj)
    return obj


def build_rounded_box(spec):
    o = spec["opts"]
    size = o.get("size", [1, 1, 1])
    radius = float(o.get("radius", 0.1))
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.active_object
    obj.name = spec["id"]
    obj.dimensions = kino_to_blender_scale(size)
    bpy.context.view_layer.update()
    apply_scale(obj)
    bevel = obj.modifiers.new("KinoBevel", "BEVEL")
    bevel.width = radius
    bevel.segments = 4
    bevel.limit_method = "NONE"
    return obj


def build_sphere(spec):
    r = float(spec["opts"].get("radius", 0.5))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=32, ring_count=16)
    obj = bpy.context.active_object
    obj.name = spec["id"]
    return obj


def build_plane(spec):
    # ponytail: no preset currently authors api.plane(); treated as a flat ground-style card lying
    # in Blender's XY (matching contactShadow's plane), sized (w,h). If a vertical "card facing the
    # camera" variant is ever needed, add an opts.facing flag and bake a 90°-about-X rotation here.
    w, h = spec["opts"].get("size", [1, 1])
    bpy.ops.mesh.primitive_plane_add(size=1)
    obj = bpy.context.active_object
    obj.name = spec["id"]
    obj.dimensions = (w, h, 0)
    bpy.context.view_layer.update()
    apply_scale(obj)
    return obj


def build_cylinder(spec):
    o = spec["opts"]
    r = float(o.get("radius", 0.5))
    h = float(o.get("height", 1))
    # Blender's native cylinder axis is local Z, which is exactly kino's up axis post-remap — no
    # extra rotation needed.
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, vertices=32)
    obj = bpy.context.active_object
    obj.name = spec["id"]
    return obj


def build_torus(spec):
    o = spec["opts"]
    r = float(o.get("radius", 0.5))
    t = float(o.get("tube", 0.2))
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=t, major_segments=32, minor_segments=16)
    obj = bpy.context.active_object
    obj.name = spec["id"]
    return obj


def build_device_phone(spec, public_dir):
    o = spec["opts"]
    w = float(o.get("width", 1))
    h = float(o.get("height", 2.16))
    depth = float(o.get("depth", 0.08))
    radius = float(o.get("radius", 0.09))

    empty = bpy.data.objects.new(spec["id"], None)
    empty.empty_display_type = "PLAIN_AXES"
    bpy.context.collection.objects.link(empty)

    # Body: rounded slab (bevel for case edges, one Subsurf level to round the bevel facets).
    bpy.ops.mesh.primitive_cube_add(size=1)
    body = bpy.context.active_object
    body.name = spec["id"] + "_body"
    body.dimensions = kino_to_blender_scale([w, h, depth])
    bpy.context.view_layer.update()
    apply_scale(body)
    bevel = body.modifiers.new("KinoBevel", "BEVEL")
    bevel.width = radius
    bevel.segments = 4
    bevel.limit_method = "NONE"
    subsurf = body.modifiers.new("KinoSubsurf", "SUBSURF")
    subsurf.levels = 1
    subsurf.render_levels = 1
    body.data.materials.append(build_dark_body_material(spec["id"] + "_body_mat"))
    body.parent = empty

    # Screen: inset plane on the phone's front face (kino +z), unlit emission of the screenshot.
    screen_w, screen_h = w * 0.94, h * 0.94
    bpy.ops.mesh.primitive_plane_add(size=1)
    screen = bpy.context.active_object
    screen.name = spec["id"] + "_screen"
    screen.dimensions = (screen_w, screen_h, 0)
    bpy.context.view_layer.update()
    apply_scale(screen)
    # Rotate the flat (blender-XY, normal +Z) plane so its normal faces blender -Y (= kino +z,
    # the phone's front) and its baked height axis lands on blender Z (kino's up), matching body.
    screen.rotation_euler = (math.radians(90), 0.0, 0.0)
    screen.location = (0.0, -(depth / 2.0 + 0.002), 0.0)
    screen_path = o.get("screen", "")
    full_path = None
    if screen_path:
        full_path = screen_path if os.path.isabs(screen_path) else os.path.join(public_dir, screen_path)
    screen.data.materials.append(
        build_screen_material(full_path, spec["id"] + "_screen_mat", int(o.get("screenFrames", 0)))
    )
    screen.parent = empty

    return empty


def build_layer_material(image_path, name, material_kind, emission_strength):
    """Rasterized SVG plane: texture color -> emission (unlit look, both engines), texture alpha ×
    per-frame KinoAlpha -> transparent mix. Missing asset -> fully transparent plane."""
    mat = new_material(name)
    nt = mat.node_tree
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emission = nt.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = emission_strength if material_kind == "emissive" else 1.0
    transparent = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    alpha_mul = nt.nodes.new("ShaderNodeMath")
    alpha_mul.operation = "MULTIPLY"
    alpha_node = add_alpha_value_node(mat)
    loaded = False
    if image_path and os.path.isfile(image_path):
        try:
            img = bpy.data.images.load(image_path, check_existing=True)
            img.colorspace_settings.name = "sRGB"
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = img
            nt.links.new(tex.outputs["Color"], emission.inputs["Color"])
            nt.links.new(tex.outputs["Alpha"], alpha_mul.inputs[0])
            loaded = True
        except Exception:
            loaded = False
    if not loaded:
        alpha_mul.inputs[0].default_value = 0.0
    nt.links.new(alpha_node.outputs[0], alpha_mul.inputs[1])
    nt.links.new(alpha_mul.outputs[0], mix.inputs["Fac"])
    nt.links.new(transparent.outputs[0], mix.inputs[1])
    nt.links.new(emission.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    set_material_transparent(mat, True)
    return mat


def build_layer(spec, public_dir):
    o = spec["opts"]
    w = float(o.get("width", 1))
    h = w * float(o.get("aspect", 1))
    bpy.ops.mesh.primitive_plane_add(size=1)
    obj = bpy.context.active_object
    obj.name = spec["id"]
    obj.dimensions = (w, h, 0)
    bpy.context.view_layer.update()
    apply_scale(obj)
    # apply_frame resets root rotation to kino_to_blender_euler([0, 0, 0]) == identity, so bake
    # the plane's facing into its mesh instead of storing it in obj.rotation_euler.
    obj.data.transform(Euler((math.radians(90), 0.0, 0.0)).to_matrix().to_4x4())
    path = o.get("path", "")
    full = path if os.path.isabs(path) else os.path.join(public_dir, path)
    obj.data.materials.append(
        build_layer_material(full, spec["id"] + "_mat", o.get("material", "unlit"), float(o.get("emission", 1)))
    )
    return obj


FONT_CACHE = {}


def build_text3d(spec, timeline, public_dir):
    o = spec["opts"]
    text = str(o.get("text", ""))
    size = float(o.get("size", 1))
    depth = float(o.get("depth", 0.3))

    curve = bpy.data.curves.new(spec["id"], type="FONT")
    curve.body = text
    curve.size = size
    curve.extrude = depth
    curve.bevel_depth = depth * 0.06

    font_path = timeline.get("fontPath")
    if font_path:
        full_font = font_path if os.path.isabs(font_path) else os.path.join(public_dir, font_path)
        if full_font not in FONT_CACHE:
            try:
                FONT_CACHE[full_font] = bpy.data.fonts.load(full_font, check_existing=True) if os.path.isfile(full_font) else None
            except Exception:
                FONT_CACHE[full_font] = None  # bad/missing font file: fall back to Blender's default
        loaded = FONT_CACHE[full_font]
        if loaded is not None:
            curve.font = loaded

    obj = bpy.data.objects.new(spec["id"], curve)
    bpy.context.collection.objects.link(obj)
    apply_material_from_spec(obj, spec, spec["id"])

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.context.view_layer.update()
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    return obj


def build_particles(spec):
    o = spec["opts"]
    positions = o.get("positions", [])
    size = float(o.get("size", 0.06))

    empty = bpy.data.objects.new(spec["id"], None)
    empty.empty_display_type = "PLAIN_AXES"
    bpy.context.collection.objects.link(empty)

    # Particles are meant to read as bright points (three.js + bloom). Drive them unlit/emissive
    # from the MaterialSpec color — PBR under softboxes alone washes to near-black at this scale.
    mat_spec = dict(spec.get("material") or {})
    mat_spec["kind"] = "emissive"
    mat = build_material(mat_spec, spec["id"] + "_mat")
    # Bump emission so small spheres punch through Filmic without needing huge light energy.
    try:
        for n in mat.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                set_input(n, ["Emission Strength"], 4.0)
                break
    except Exception:
        pass

    # Build ONE icosphere mesh datablock (via a throwaway object we immediately discard) and
    # instance it for every position — avoids hundreds of bpy.ops calls for large particle counts.
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=size)
    template = bpy.context.active_object
    mesh_data = template.data
    mesh_data.materials.append(mat)
    bpy.data.objects.remove(template, do_unlink=True)

    for i, pos in enumerate(positions):
        inst = bpy.data.objects.new(f"{spec['id']}_p{i}", mesh_data)
        inst.location = kino_to_blender_pos(pos)
        bpy.context.collection.objects.link(inst)
        inst.parent = empty

    return empty


def build_contact_shadow(spec, engine):
    o = spec["opts"]
    radius = float(o.get("radius", 1.4))
    if engine == "CYCLES":
        bpy.ops.mesh.primitive_plane_add(size=radius * 2)
        obj = bpy.context.active_object
        obj.name = spec["id"]
        obj.is_shadow_catcher = True
        obj.data.materials.append(build_pbr_material({"color": "#ffffff", "roughness": 1, "metalness": 0}, spec["id"] + "_mat"))
    else:
        bpy.ops.mesh.primitive_circle_add(radius=radius, fill_type="NGON", vertices=48)
        obj = bpy.context.active_object
        obj.name = spec["id"]
        opacity = float((spec.get("material") or {}).get("opacity", 0.35))
        obj.data.materials.append(build_gradient_shadow_material(spec["id"] + "_mat", opacity))
    return obj


def build_gltf(spec, public_dir):
    path = spec["opts"].get("path", "")
    full = path if os.path.isabs(path) else os.path.join(public_dir, path)

    empty = bpy.data.objects.new(spec["id"], None)
    empty.empty_display_type = "PLAIN_AXES"
    bpy.context.collection.objects.link(empty)

    if path and os.path.isfile(full):
        try:
            before = set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=full)
            for o in bpy.data.objects:
                if o not in before and o.parent is None and o is not empty:
                    o.parent = empty
        except Exception:
            pass  # missing/broken asset: keep the empty placeholder, don't crash the render
    return empty


def build_group(spec):
    empty = bpy.data.objects.new(spec["id"], None)
    empty.empty_display_type = "PLAIN_AXES"
    bpy.context.collection.objects.link(empty)
    return empty


# --- lights ------------------------------------------------------------------------------------

def aim_at(obj, target):
    """Point obj's local -Z at target (world space) — same convention Blender cameras, suns and
    area lights all share. Plain Vector math; no constraints (deterministic, no depsgraph coupling)."""
    direction = target - obj.location
    if direction.length < 1e-9:
        return
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def build_dir_light(spec):
    o = spec["opts"]
    pos = o.get("position", [3, 5, 2])
    intensity = float(o.get("intensity", 1))
    data = bpy.data.lights.new(spec["id"], type="SUN")
    data.energy = intensity * 2.0  # rough intensity->W/m^2 scale; tuned at the draft gate (Task 15)
    color = o.get("color")
    if color:
        data.color = hex_to_linear_rgba(color)[:3]
    obj = bpy.data.objects.new(spec["id"], data)
    bpy.context.collection.objects.link(obj)
    obj.location = kino_to_blender_pos(pos)
    aim_at(obj, Vector((0.0, 0.0, 0.0)))
    return obj


def build_hemi(spec):
    o = spec["opts"]
    intensity = float(o.get("intensity", 0.6))
    # Blender dropped the dedicated Hemi light type; approximate as one large soft area light
    # straight overhead. Only the "sky" color carries over (no true two-tone sky/ground gradient).
    data = bpy.data.lights.new(spec["id"], type="AREA")
    data.energy = intensity * 3.0
    data.size = 6.0
    sky = o.get("sky")
    if sky:
        data.color = hex_to_linear_rgba(sky)[:3]
    obj = bpy.data.objects.new(spec["id"], data)
    bpy.context.collection.objects.link(obj)
    obj.location = kino_to_blender_pos((0, 6, 0))
    aim_at(obj, Vector((0.0, 0.0, 0.0)))
    return obj


def apply_ambient(spec, scene):
    """No Blender object for api.ambient() — it bumps the world Background strength directly."""
    intensity = float(spec["opts"].get("intensity", 0.4))
    world = scene.world
    if world is None or not world.use_nodes or world.node_tree is None:
        return
    for node in world.node_tree.nodes:
        if node.type == "BACKGROUND":
            node.inputs["Strength"].default_value += intensity
            break


# --- world / studio rig -------------------------------------------------------------------------

WORLD_ZENITH_HEX = "#05070d"   # dark navy backdrop, top of frame
WORLD_HORIZON_HEX = "#141b2e"  # slightly lighter navy, "floor" of the backdrop gradient

# Fixed 3-point studio rig (kino/Y-up space): key upper-left-front, fill camera-right, rim behind
# the subject. Blender AREA energy is Watts — three.js-ish intensities of ~1–2 map to hundreds of W
# for a ~2m softbox, otherwise drafts render near-black. Retune at the draft gate (Task 15).
STUDIO_LIGHTS = (
    {"name": "KinoKeyLight", "pos": (-3.2, 4.0, 3.0), "energy": 450.0, "size": 2.2},
    {"name": "KinoFillLight", "pos": (3.6, 1.4, 2.2), "energy": 180.0, "size": 2.4},
    {"name": "KinoRimLight", "pos": (0.0, 2.2, -3.8), "energy": 260.0, "size": 1.6},
)


def ensure_world(scene, name="KinoWorld"):
    world = bpy.data.worlds.new(name)
    world.use_nodes = True
    if world.node_tree is None:
        raise RuntimeError("world has no node_tree after use_nodes=True")
    world.node_tree.nodes.clear()
    scene.world = world
    return world


def build_gradient_world(scene, strength):
    world = ensure_world(scene)
    nt = world.node_tree
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    tex_coord = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    map_range = nt.nodes.new("ShaderNodeMapRange")
    map_range.inputs["From Min"].default_value = -1.0
    map_range.inputs["From Max"].default_value = 1.0
    map_range.inputs["To Min"].default_value = 0.0
    map_range.inputs["To Max"].default_value = 1.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = hex_to_linear_rgba(WORLD_HORIZON_HEX)
    ramp.color_ramp.elements[1].color = hex_to_linear_rgba(WORLD_ZENITH_HEX)
    nt.links.new(tex_coord.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], map_range.inputs["Value"])
    nt.links.new(map_range.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = strength
    nt.links.new(bg.outputs[0], out.inputs["Surface"])


def build_black_world(scene):
    world = ensure_world(scene)
    nt = world.node_tree
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    bg.inputs["Strength"].default_value = 0.0
    nt.links.new(bg.outputs[0], out.inputs["Surface"])


def add_area_light(kino_pos, energy, size, name):
    data = bpy.data.lights.new(name, type="AREA")
    data.energy = energy
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = kino_to_blender_pos(kino_pos)
    aim_at(obj, Vector((0.0, 0.0, 0.0)))
    return obj


def build_studio_rig(energy_scale):
    for light in STUDIO_LIGHTS:
        add_area_light(light["pos"], light["energy"] * energy_scale, light["size"], light["name"])


def build_world_and_lights(scene, world_preset):
    if world_preset == "studio":
        build_gradient_world(scene, 1.0)
        build_studio_rig(1.0)
    elif world_preset == "night":
        build_gradient_world(scene, 0.35)
        build_studio_rig(0.35)
    else:
        build_black_world(scene)


# ---------------------------------------------------------------------------
# Object dispatch
# ---------------------------------------------------------------------------

SIMPLE_MESH_BUILDERS = {
    "box": build_box,
    "sphere": build_sphere,
    "plane": build_plane,
    "cylinder": build_cylinder,
    "torus": build_torus,
}

# Types whose per-frame rotation the JS recorder never authors (their aim is fixed once, at build
# time, from opts.position) — the generic frame loop must NOT overwrite rotation_euler for these,
# since frame.r is always [0,0,0] for them and would clobber the computed look-at.
STATIC_AIM_TYPES = {"dirLight", "hemi"}


def build_object(spec, timeline, public_dir, engine):
    t = spec["type"]
    if t in SIMPLE_MESH_BUILDERS:
        obj = SIMPLE_MESH_BUILDERS[t](spec)
        apply_material_from_spec(obj, spec, spec["id"])
        return obj
    if t == "roundedBox":
        obj = build_rounded_box(spec)
        apply_material_from_spec(obj, spec, spec["id"])
        return obj
    if t == "devicePhone":
        return build_device_phone(spec, public_dir)
    if t == "layer":
        return build_layer(spec, public_dir)
    if t == "text3d":
        return build_text3d(spec, timeline, public_dir)
    if t == "gltf":
        return build_gltf(spec, public_dir)
    if t == "particles":
        return build_particles(spec)
    if t == "group":
        return build_group(spec)
    if t == "contactShadow":
        return build_contact_shadow(spec, engine)
    if t == "dirLight":
        return build_dir_light(spec)
    if t == "hemi":
        return build_hemi(spec)
    if t == "ambient":
        apply_ambient(spec, bpy.context.scene)
        return None
    raise RuntimeError(f"unknown timeline object type: {t!r} (id={spec.get('id')!r})")


# ---------------------------------------------------------------------------
# Scene / engine / post setup
# ---------------------------------------------------------------------------

def setup_scene(scene, meta):
    scene.render.resolution_x = int(meta["width"])
    scene.render.resolution_y = int(meta["height"])
    scene.render.resolution_percentage = 100
    scene.render.fps = int(meta["fps"])
    scene.render.fps_base = 1.0
    scene.frame_start = 1
    scene.frame_end = max(1, int(meta["frameCount"]))
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 15  # fixed zlib level — reduces encoder drift across runs
    scene.render.threads = 1  # single-thread — Eevee/Cycles tile order stays stable across machines
    scene.render.use_persistent_data = True  # one process renders every frame of the beat
    scene.render.use_motion_blur = False
    try:
        scene.view_settings.view_transform = "Filmic"
    except TypeError:
        pass  # some builds/branches drop the legacy Filmic transform; Standard is an acceptable miss
    scene.display_settings.display_device = "sRGB"


def eevee_engine_id():
    # Renamed BLENDER_EEVEE_NEXT -> BLENDER_EEVEE in Blender 5.0.
    return "BLENDER_EEVEE" if bpy.app.version >= (5, 0, 0) else "BLENDER_EEVEE_NEXT"


def configure_cycles_device(scene):
    scene.cycles.device = "CPU"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        metal_devices = [d for d in prefs.devices if d.type == "METAL"]
        if metal_devices:
            for d in prefs.devices:
                d.use = d.type == "METAL"
            scene.cycles.device = "GPU"
    except Exception:
        scene.cycles.device = "CPU"  # no Metal backend (non-macOS / headless CI) -> CPU Cycles


def pick_engine(scene, quality):
    if quality == "draft":
        scene.render.engine = eevee_engine_id()
        scene.eevee.taa_render_samples = 64  # fixed draft sample count
        # Eevee Next needs raytracing for soft area-light response; without it softboxes read flat/black.
        try:
            scene.eevee.use_raytracing = True
        except Exception:
            pass
        return "EEVEE"

    scene.render.engine = "CYCLES"
    scene.cycles.samples = 512 if quality == "max" else 128
    scene.cycles.seed = 0
    scene.cycles.use_adaptive_sampling = False  # determinism: adaptive termination is not bit-stable
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    configure_cycles_device(scene)
    return "CYCLES"


def set_glare_param(node, socket_name, value, legacy_attr, legacy_transform=None):
    """Blender 5.0 moved Glare's threshold/size/mix from node attributes to input sockets. Try the
    new socket first, fall back to the deprecated attribute (still functional through 6.0)."""
    try:
        node.inputs[socket_name].default_value = value
        return
    except Exception:
        pass
    try:
        setattr(node, legacy_attr, legacy_transform(value) if legacy_transform else value)
    except Exception:
        pass  # neither surface matched this Blender build; bloom renders with node defaults


def set_glare_type(glare, name_5x, name_legacy):
    """Glare 'type' moved from the glare_type enum attribute (<5.0) to a 'Type' menu input
    socket (>=5.0), whose values are title-cased ('Bloom'/'Fog Glow') rather than upper-snake."""
    try:
        glare.inputs["Type"].default_value = name_5x
        return
    except Exception:
        pass
    try:
        glare.glare_type = name_legacy
    except Exception:
        pass


def get_compositor_tree(scene):
    """Scene.node_tree (<5.0) vs the Scene.compositing_node_group data-block (>=5.0)."""
    if hasattr(scene, "compositing_node_group"):
        tree = bpy.data.node_groups.new("KinoComposite", "CompositorNodeTree")
        scene.compositing_node_group = tree
        return tree, True  # True: needs a Group Output node + interface socket, not Composite
    scene.use_nodes = True
    tree = scene.node_tree
    tree.nodes.clear()
    return tree, False


def clear_compositor(scene):
    if hasattr(scene, "compositing_node_group"):
        scene.compositing_node_group = None
    else:
        scene.use_nodes = False


def setup_post(scene, post, engine):
    bloom = (post or {}).get("bloom")
    if not bloom:
        clear_compositor(scene)
        return

    tree, needs_group_output = get_compositor_tree(scene)
    rl = tree.nodes.new("CompositorNodeRLayers")
    glare = tree.nodes.new("CompositorNodeGlare")
    # EEVEE lost native bloom in the 4.2 EEVEE Next rewrite; both engines now bloom through this
    # compositor Glare node. EEVEE gets the cheap 'BLOOM' mode; Cycles finals pay for 'FOG_GLOW'
    # (spec-mandated, and finals already spend minutes path tracing).
    set_glare_type(glare, "Bloom", "BLOOM") if engine == "EEVEE" else set_glare_type(glare, "Fog Glow", "FOG_GLOW")
    set_glare_param(glare, "Threshold", float(bloom.get("threshold", 0.85)), "threshold")
    set_glare_param(
        glare, "Size", max(0.05, min(1.0, float(bloom.get("radius", 0.4)))), "size",
        legacy_transform=lambda v: max(1, min(9, round(1 + v * 8))),
    )
    set_glare_param(
        glare, "Strength", max(0.0, float(bloom.get("strength", 1.0))), "mix",
        legacy_transform=lambda v: max(-1.0, min(1.0, v * 2 - 1)),
    )
    tree.links.new(rl.outputs["Image"], glare.inputs["Image"])
    if needs_group_output:
        group_out = tree.nodes.new("NodeGroupOutput")
        tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        tree.links.new(glare.outputs["Image"], group_out.inputs[0])
    else:
        comp = tree.nodes.new("CompositorNodeComposite")
        tree.links.new(glare.outputs["Image"], comp.inputs["Image"])


# ---------------------------------------------------------------------------
# Camera + per-frame apply
# ---------------------------------------------------------------------------

def build_camera(scene):
    data = bpy.data.cameras.new("KinoCamera")
    data.sensor_fit = "VERTICAL"  # matches three.js PerspectiveCamera's vertical-fov convention
    obj = bpy.data.objects.new("KinoCamera", data)
    bpy.context.collection.objects.link(obj)
    scene.camera = obj
    return obj


def apply_camera(camera_obj, cam):
    camera_obj.location = kino_to_blender_pos(cam["p"])
    # three.js default: camera at +Z looks toward origin along -Z. When the recorder leaves
    # lookAt null (no cam.lookAt()/orbit() call), aim at the origin so the frame isn't empty.
    look = cam.get("lookAt")
    aim_at(camera_obj, Vector(kino_to_blender_pos(look if look is not None else [0, 0, 0])))
    zoom = max(float(cam.get("zoom", 1.0)), 0.01)
    camera_obj.data.angle = math.radians(float(cam["fov"]) / zoom)


def apply_frame(frame, objects_by_id, object_types_by_id, camera_obj):
    for obj_id, t in frame["transforms"].items():
        obj = objects_by_id.get(obj_id)
        if obj is None:
            continue
        obj.hide_render = not t.get("visible", True)
        if object_types_by_id.get(obj_id) not in STATIC_AIM_TYPES:
            obj.location = kino_to_blender_pos(t["p"])
            obj.rotation_euler = kino_to_blender_euler(t["r"])
            obj.scale = kino_to_blender_scale(t["s"])
        if "opacity" in t:
            set_material_opacity(obj, t["opacity"])
    apply_camera(camera_obj, frame["camera"])


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    argv = sys.argv
    if "--" not in argv:
        raise RuntimeError("expected -- before script args: timeline.json outDir publicDir")
    args = argv[argv.index("--") + 1:]
    if len(args) < 3:
        raise RuntimeError(f"expected 3 args after --  (timeline.json outDir publicDir), got {args!r}")
    timeline_path, out_dir, public_dir = args[0], args[1], args[2]

    with open(timeline_path, "r", encoding="utf-8") as f:
        timeline = json.load(f)

    os.makedirs(out_dir, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    setup_scene(scene, timeline["meta"])
    engine = pick_engine(scene, timeline["meta"]["quality"])
    build_world_and_lights(scene, timeline["world"])

    objects_by_id = {}
    object_types_by_id = {}
    for obj_spec in timeline["objects"]:
        object_types_by_id[obj_spec["id"]] = obj_spec["type"]
        obj = build_object(obj_spec, timeline, public_dir, engine)
        if obj is not None:
            objects_by_id[obj_spec["id"]] = obj

    # Re-parent group children AFTER every object exists (parent id may be recorded before or
    # after the child in objects[], and a group's own children can be groups themselves).
    for obj_spec in timeline["objects"]:
        parent_id = obj_spec.get("parent")
        child = objects_by_id.get(obj_spec["id"])
        parent = objects_by_id.get(parent_id) if parent_id else None
        if child is not None and parent is not None:
            child.parent = parent

    camera_obj = build_camera(scene)
    setup_post(scene, timeline.get("post"), engine)

    for i, frame in enumerate(timeline["frames"]):
        scene.frame_set(i + 1)
        apply_frame(frame, objects_by_id, object_types_by_id, camera_obj)
        scene.render.filepath = os.path.join(out_dir, f"f{i + 1:05d}.png")
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
        sys.exit(0)
    try:
        import json
        import bpy
        from mathutils import Euler, Vector
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
