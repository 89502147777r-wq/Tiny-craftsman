"""
Tiny Craftsman → Blender importer (stages 1–3: excavation, formwork, rebar, machines).

Rebuilds a project exported from the game (menu → «Экспорт для Blender») as an
animated Blender scene, ready for a photoreal Cycles render:

  * workbench, plywood tray (real sizes, metres)
  * soil terrain: one shape key per journal action, switched on at the moment
    the action was committed in the game → the pit grows exactly as played
  * camera with the recorded path, orientation, field of view and focus
    distance (depth of field enabled)
  * shovel proxy following the recorded tool motion (and the rake, BUILD 11+)
  * formwork boards + stakes, rebar bars / cages / mesh sheets, each shown
    from the moment its journal action was committed (hidden after deletion)
  * excavator / tractor / truck mixer / concrete pump proxies following the recorded track

Usage (Blender 4.x):
  blender --python tools/blender/tiny_craftsman_import.py -- project.json [--assets /path/to/repo/assets] [--fps 30]
or open the script in Blender's Text Editor, set PROJECT_PATH below and Run.

Coordinates: the game uses three.js (Y up); Blender uses Z up.
(x, y, z)_three → (x, -z, y)_blender.
"""
import base64
import json
import math
import os
import struct
import sys

PROJECT_PATH = ""   # used when run from the Text Editor
ASSETS_PATH = ""    # repo "assets" folder for photo textures (optional)
FPS = 30

TYPED = {"Float32Array": "f", "Uint32Array": "I", "Int16Array": "h", "Uint8Array": "B"}


def _decode(obj):
    if isinstance(obj, dict) and "__typed" in obj:
        raw = base64.b64decode(obj["data"])
        code = TYPED[obj["__typed"]]
        n = len(raw) // struct.calcsize(code)
        return list(struct.unpack("<%d%s" % (n, code), raw))
    return obj


def load_project(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f, object_hook=_decode)


def reconstruct_states(project):
    """Return [(time_seconds, nat, loose)] from the initial ground through every action."""
    t = project["terrain"]
    nat = list(t["nat"])
    loose = list(t["loose"])
    done = project["journal"]["done"]
    # walk back from the final state to the untouched ground
    for rec in reversed(done):
        d = rec.get("diff")
        if not d:
            continue
        for k, i in enumerate(d["idx"]):
            nat[i] = d["bn"][k]
            loose[i] = d["bl"][k]
    states = [(0.0, nat[:], loose[:])]
    for rec in done:
        d = rec.get("diff")
        if not d:
            continue
        for k, i in enumerate(d["idx"]):
            nat[i] = d["an"][k]
            loose[i] = d["al"][k]
        states.append((float(rec.get("t1") or rec.get("t0") or 0.0), nat[:], loose[:]))
    return states


def to_bl(x, y, z):
    return (x, -z, y)


def track_rows(project):
    tr = project.get("track") or {}
    fields = tr.get("fields") or []
    data = tr.get("data") or []
    F = len(fields)
    if not F:
        return []
    return [dict(zip(fields, data[i:i + F])) for i in range(0, len(data) - F + 1, F)]


# ----------------------------------------------------------------------------------------
def build(project, assets="", fps=FPS):
    import bpy
    from mathutils import Quaternion

    scene = bpy.context.scene
    scene.render.fps = fps
    scene.unit_settings.system = "METRIC"
    scene.render.engine = "CYCLES"

    coll = bpy.data.collections.new("TinyCraftsman")
    scene.collection.children.link(coll)

    def link(ob):
        coll.objects.link(ob)
        return ob

    def image_mat(name, folder, scale=1.0, color=(0.5, 0.4, 0.3)):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (*color, 1)
        bsdf.inputs["Roughness"].default_value = 0.9
        diff = os.path.join(assets, "textures", folder, "diff.jpg") if assets else ""
        if diff and os.path.exists(diff):
            nt = m.node_tree
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = bpy.data.images.load(diff)
            coord = nt.nodes.new("ShaderNodeTexCoord")
            mapn = nt.nodes.new("ShaderNodeMapping")
            mapn.inputs["Scale"].default_value = (1 / scale, 1 / scale, 1 / scale)
            nt.links.new(coord.outputs["Object"], mapn.inputs["Vector"])
            nt.links.new(mapn.outputs["Vector"], tex.inputs["Vector"])
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            tex.projection = "BOX"
            tex.projection_blend = 0.2
        return m

    # ---- table & tray -------------------------------------------------------------
    tray = project["tray"]
    bpy.ops.mesh.primitive_cube_add(size=1)
    table = bpy.context.active_object
    table.name = "Workbench"
    table.scale = (1.7, 0.85, 0.045)
    table.location = to_bl(0.05, -0.0225, -0.12)
    table.data.materials.append(image_mat("Workbench", "wood_table_worn", 0.55, (0.45, 0.3, 0.2)))
    for c in table.users_collection:
        c.objects.unlink(table)
    link(table)

    ply = image_mat("Plywood", "plywood", 0.5, (0.75, 0.6, 0.42))
    W, H, floor = tray["wall"], tray["height"], tray["floor"]
    ix_, iz_ = tray.get("innerX", tray.get("inner")), tray.get("innerZ", tray.get("inner"))
    ox, oz = ix_ + 2 * W, iz_ + 2 * W
    parts = [((ox, floor, oz), (0, floor / 2, 0))]
    for sg in (-1, 1):
        parts.append(((ox, H - floor, W), (0, floor + (H - floor) / 2, sg * (iz_ / 2 + W / 2))))
        parts.append(((W, H - floor, iz_), (sg * (ix_ / 2 + W / 2), floor + (H - floor) / 2, 0)))
    for k, (size, pos) in enumerate(parts):
        bpy.ops.mesh.primitive_cube_add(size=1)
        ob = bpy.context.active_object
        ob.name = "Tray.%d" % k
        ob.scale = (size[0], size[2], size[1])
        ob.location = to_bl(*pos)
        ob.data.materials.append(ply)
        for c in ob.users_collection:
            c.objects.unlink(ob)
        link(ob)

    # ---- terrain with one shape key per action ----------------------------------------
    t = project["terrain"]
    if "rx" in t:
        rx, rz, cell = t["rx"], t["rz"], t["cell"]
    else:  # stage-1 square tray
        rx = rz = t["res"]
        cell = t["size"] / t["res"]
    n, nz = rx + 1, rz + 1
    hx, hz = rx * cell / 2, rz * cell / 2
    states = reconstruct_states(project)
    _, nat0, loose0 = states[0]
    verts = []
    for iz in range(nz):
        for ix in range(n):
            i = iz * n + ix
            verts.append(to_bl(ix * cell - hx, nat0[i] + loose0[i], iz * cell - hz))
    faces = []
    for iz in range(rz):
        for ix in range(rx):
            a = iz * n + ix
            faces.append((a, a + n, a + n + 1, a + 1))
    me = bpy.data.meshes.new("Soil")
    me.from_pydata(verts, [], faces)
    me.update()
    soil = link(bpy.data.objects.new("Soil", me))
    for p in me.polygons:
        p.use_smooth = True
    soil.data.materials.append(image_mat("Soil", "brown_mud_dry", 0.2, (0.35, 0.25, 0.17)))
    soil.shape_key_add(name="Basis")
    keys = []
    for k, (time_s, nat, loose) in enumerate(states[1:], 1):
        sk = soil.shape_key_add(name="action_%03d" % k, from_mix=False)
        for i in range(n * nz):
            sk.data[i].co.z = nat[i] + loose[i]
        keys.append((time_s, sk))
    for k, (time_s, sk) in enumerate(keys):
        f_on = 1 + time_s * fps
        f_off = 1 + keys[k + 1][0] * fps if k + 1 < len(keys) else None
        sk.value = 0.0
        sk.keyframe_insert("value", frame=1)
        sk.value = 1.0
        sk.keyframe_insert("value", frame=max(1, f_on))
        if f_off is not None:
            sk.value = 0.0
            sk.keyframe_insert("value", frame=max(1, f_off))
    if soil.data.shape_keys and soil.data.shape_keys.animation_data:
        for fc in soil.data.shape_keys.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "CONSTANT"

    # ---- camera + shovel from the recorded track ----------------------------------------
    rows = track_rows(project)
    cam_data = bpy.data.cameras.new("PhoneMacro")
    cam_data.dof.use_dof = True
    cam_data.dof.aperture_fstop = 2.8
    cam_data.sensor_fit = "VERTICAL"
    cam = link(bpy.data.objects.new("PhoneMacro", cam_data))
    cam.rotation_mode = "QUATERNION"
    scene.camera = cam
    bpy.ops.mesh.primitive_cylinder_add(radius=0.0014, depth=0.11)
    shovel = bpy.context.active_object
    shovel.name = "ShovelProxy"
    for c in shovel.users_collection:
        c.objects.unlink(shovel)
    link(shovel)
    shovel.rotation_mode = "QUATERNION"
    rake = None
    if rows and "rk_px" in rows[0]:
        # rake proxy: the head (origin = tine tips), X across it, Y = tines
        bpy.ops.mesh.primitive_cube_add(size=1)
        rake = bpy.context.active_object
        rake.name = "RakeProxy"
        rake.scale = (0.095, 0.02, 0.004)  # three.js local axes: conv @ q maps them to Blender
        for c in rake.users_collection:
            c.objects.unlink(rake)
        link(rake)
        rake.rotation_mode = "QUATERNION"
    conv = Quaternion((1, 0, 0), math.radians(90))
    last = 1
    for r in rows:
        f = 1 + r["t"] * fps
        last = max(last, f)
        cam.location = to_bl(r["cam_px"], r["cam_py"], r["cam_pz"])
        cam.rotation_quaternion = conv @ Quaternion((r["cam_qw"], r["cam_qx"], r["cam_qy"], r["cam_qz"]))
        cam_data.angle = math.radians(r["cam_vfov"])
        cam_data.dof.focus_distance = max(0.01, r["cam_focus"])
        cam.keyframe_insert("location", frame=f)
        cam.keyframe_insert("rotation_quaternion", frame=f)
        cam_data.keyframe_insert("lens", frame=f)
        cam_data.dof.keyframe_insert("focus_distance", frame=f)
        shovel.location = to_bl(r["tool_px"], r["tool_py"], r["tool_pz"])
        shovel.rotation_quaternion = conv @ Quaternion((r["tool_qw"], r["tool_qx"], r["tool_qy"], r["tool_qz"]))
        shovel.keyframe_insert("location", frame=f)
        shovel.keyframe_insert("rotation_quaternion", frame=f)
        if rake is not None:
            rake.location = to_bl(r["rk_px"], r["rk_py"], r["rk_pz"])
            rake.rotation_quaternion = conv @ Quaternion((r["rk_qw"], r["rk_qx"], r["rk_qy"], r["rk_qz"]))
            rake.keyframe_insert("location", frame=f)
            rake.keyframe_insert("rotation_quaternion", frame=f)
    build_objects(project, coll, fps, image_mat)
    build_machines(rows, coll, fps)
    scene.frame_start = 1
    scene.frame_end = int(max(last, 1 + (states[-1][0] if states else 0) * fps)) + fps
    return coll


def object_versions(project):
    """{id: [(time, record or None), …]} from the journal's object operations."""
    vers = {}
    for rec in project["journal"]["done"]:
        for op in rec.get("objs") or []:
            vers.setdefault(op["id"], []).append((float(rec.get("t1") or 0.0), op.get("after")))
    # objects that exist without a journal entry (e.g. the default outline) are there from the start
    for r in (project.get("objects") or {}).get("items", []):
        vers.setdefault(r["id"], [(0.0, r)])
    return vers


def build_objects(project, coll, fps, image_mat):
    import bpy
    from mathutils import Vector

    wood = image_mat("Board", "raw_plank_wall", 0.3, (0.6, 0.45, 0.3))
    steel = bpy.data.materials.new("Rebar")
    steel.use_nodes = True
    b = steel.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (0.18, 0.13, 0.1, 1)
    b.inputs["Metallic"].default_value = 0.6
    b.inputs["Roughness"].default_value = 0.6

    def rod(name, a, b_, d, mat, parent):
        A, B = Vector(to_bl(*a)), Vector(to_bl(*b_))
        L = (B - A).length
        if L < 1e-6:
            return
        bpy.ops.mesh.primitive_cylinder_add(radius=d / 2, depth=L, vertices=8, location=(A + B) / 2)
        ob = bpy.context.active_object
        ob.name = name
        ob.rotation_mode = "QUATERNION"
        ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference((B - A).normalized())
        ob.data.materials.append(mat)
        for c in ob.users_collection:
            c.objects.unlink(ob)
        coll.objects.link(ob)
        ob.parent = parent

    def board_box(name, center, size, yaw, mat, parent):
        bpy.ops.mesh.primitive_cube_add(size=1, location=to_bl(*center))
        ob = bpy.context.active_object
        ob.name = name
        ob.scale = (size[0], size[2], size[1])
        ob.rotation_euler = (0, 0, yaw)
        ob.data.materials.append(mat)
        for c in ob.users_collection:
            c.objects.unlink(ob)
        coll.objects.link(ob)
        ob.parent = parent

    board_t, board_h = 0.025 / 12, 0.15 / 12
    for oid, versions in object_versions(project).items():
        for k, (t_on, rec) in enumerate(versions):
            if not rec or rec.get("type") not in ("form", "bar", "cage", "mesh"):
                continue
            root = bpy.data.objects.new("%s_%d_v%d" % (rec["type"], oid, k), None)
            coll.objects.link(root)
            if rec["type"] == "form":
                (ax, az), (bx, bz), (nx, nz) = rec["a"], rec["b"], rec["n"]
                L = math.hypot(bx - ax, bz - az)
                yaw = math.atan2(bz - az, bx - ax)  # Blender: -z_three = y
                count = max(1, math.ceil((rec["y1"] - rec["y0"]) / board_h - 0.05))
                for j in range(count):
                    y = rec["y1"] - board_h / 2 - j * board_h
                    c = ((ax + bx) / 2 + nx * board_t / 2, y, (az + bz) / 2 + nz * board_t / 2)
                    board_box("board", c, (L + board_t, board_h, board_t), -yaw, wood, root)
            elif rec["type"] == "bar":
                rod("bar", rec["a"], rec["b"], rec["d"], steel, root)
            elif rec["type"] == "cage":
                for bb in rec["bars"]:
                    rod("bar", bb[0:3], bb[3:6], bb[6], steel, root)
            elif rec["type"] == "mesh":
                z = rec["z0"]
                while z <= rec["z1"] + 1e-6:
                    rod("wire", (rec["x0"], rec["y"], z), (rec["x1"], rec["y"], z), rec["d"], steel, root)
                    z += rec["cell"]
                x = rec["x0"]
                while x <= rec["x1"] + 1e-6:
                    rod("wire", (x, rec["y"] + rec["d"], rec["z0"]), (x, rec["y"] + rec["d"], rec["z1"]), rec["d"], steel, root)
                    x += rec["cell"]
            # visible from this version's time until the next version of the same object
            t_off = versions[k + 1][0] if k + 1 < len(versions) else None
            for ob in [root] + list(root.children):
                ob.hide_render = ob.hide_viewport = True
                ob.keyframe_insert("hide_render", frame=1)
                ob.keyframe_insert("hide_viewport", frame=1)
                ob.hide_render = ob.hide_viewport = False
                ob.keyframe_insert("hide_render", frame=max(1, 1 + t_on * fps))
                ob.keyframe_insert("hide_viewport", frame=max(1, 1 + t_on * fps))
                if t_off is not None:
                    ob.hide_render = ob.hide_viewport = True
                    ob.keyframe_insert("hide_render", frame=1 + t_off * fps)
                    ob.keyframe_insert("hide_viewport", frame=1 + t_off * fps)


def build_machines(rows, coll, fps):
    """Simple proxies (boxes) for the machines, keyed from the recorded track."""
    import bpy
    from mathutils import Euler

    def proxy(name, size, color):
        bpy.ops.mesh.primitive_cube_add(size=1)
        ob = bpy.context.active_object
        ob.name = name
        ob.scale = size
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        m.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (*color, 1)
        ob.data.materials.append(m)
        for c in ob.users_collection:
            c.objects.unlink(ob)
        coll.objects.link(ob)
        return ob

    # real sizes (length, width, height) at 1:12; replace the boxes with the CC-BY
    # models from assets/models (see CREDITS.md) for the final render
    specs = [("ex", "Excavator", (5.6 / 12, 2.0 / 12, 2.5 / 12), (0.94, 0.7, 0.05)),
             ("tr", "Tractor", (3.3 / 12, 1.9 / 12, 2.5 / 12), (0.7, 0.15, 0.1)),
             ("mx", "TruckMixer", (7.1 / 12, 2.5 / 12, 3.6 / 12), (0.92, 0.92, 0.9)),
             ("pu", "ConcretePump", (3.9 / 12, 1.9 / 12, 1.55 / 12), (0.95, 0.8, 0.1))]
    for key, name, size, color in specs:
        if not rows or key + "_on" not in rows[0]:
            continue
        ob = None
        for r in rows:
            if not r.get(key + "_on"):
                continue
            if ob is None:
                ob = proxy(name, size, color)
            f = 1 + r["t"] * fps
            ob.location = to_bl(r[key + "_x"], r[key + "_y"] + size[2] / 2, r[key + "_z"])
            ob.rotation_euler = Euler((r[key + "_roll"], r[key + "_pitch"], r[key + "_yaw"]), "XYZ")
            ob.keyframe_insert("location", frame=f)
            ob.keyframe_insert("rotation_euler", frame=f)


def _args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    path, assets, fps = PROJECT_PATH, ASSETS_PATH, FPS
    i = 0
    while i < len(argv):
        if argv[i] == "--assets":
            assets = argv[i + 1]; i += 2
        elif argv[i] == "--fps":
            fps = int(argv[i + 1]); i += 2
        else:
            path = argv[i]; i += 1
    return path, assets, fps


if __name__ == "__main__":
    path, assets, fps = _args()
    if not path:
        raise SystemExit("Укажите путь к .json проекту: blender --python tiny_craftsman_import.py -- project.json")
    proj = load_project(path)
    try:
        import bpy  # noqa: F401
    except ImportError:
        st = reconstruct_states(proj)
        print("bpy not available — dry run: %d terrain states, %d track samples" % (len(st), len(track_rows(proj))))
    else:
        build(proj, assets, fps)
