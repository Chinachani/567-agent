#!/usr/bin/env python3
"""Export the approved SVG masters. Requires system librsvg, cairo and gobject."""

import copy
import ctypes as C
import ctypes.util
import hashlib
import io
import json
from pathlib import Path
import struct
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "docs/brand"
SVG = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG)


class Rect(C.Structure):
    _fields_ = [(name, C.c_double) for name in ("x", "y", "width", "height")]


class Renderer:
    def __init__(self):
        libraries = [ctypes.util.find_library(name) for name in ("rsvg-2", "cairo", "gobject-2.0")]
        if not all(libraries):
            raise RuntimeError("Install librsvg, cairo and gobject before exporting brand assets.")
        self.r, self.c, self.g = [C.CDLL(path) for path in libraries]
        self.r.rsvg_handle_new_from_data.argtypes = [C.c_char_p, C.c_size_t, C.c_void_p]
        self.r.rsvg_handle_new_from_data.restype = C.c_void_p
        self.c.cairo_image_surface_create.argtypes = [C.c_int, C.c_int, C.c_int]
        self.c.cairo_image_surface_create.restype = C.c_void_p
        self.c.cairo_create.argtypes = [C.c_void_p]
        self.c.cairo_create.restype = C.c_void_p
        self.r.rsvg_handle_render_document.argtypes = [C.c_void_p, C.c_void_p, C.POINTER(Rect), C.c_void_p]
        self.r.rsvg_handle_render_document.restype = C.c_int
        self.write_type = C.CFUNCTYPE(C.c_int, C.c_void_p, C.POINTER(C.c_ubyte), C.c_uint)
        self.c.cairo_surface_write_to_png_stream.argtypes = [C.c_void_p, self.write_type, C.c_void_p]
        self.c.cairo_surface_write_to_png_stream.restype = C.c_int
        for name in ("cairo_destroy", "cairo_surface_destroy"):
            getattr(self.c, name).argtypes = [C.c_void_p]
        self.g.g_object_unref.argtypes = [C.c_void_p]

    def png(self, svg, size):
        handle = self.r.rsvg_handle_new_from_data(svg, len(svg), None)
        if not handle:
            raise ValueError("Invalid SVG master")
        surface = self.c.cairo_image_surface_create(0, size, size)
        context = self.c.cairo_create(surface)
        output = io.BytesIO()

        @self.write_type
        def write(_closure, data, length):
            output.write(C.string_at(data, length))
            return 0

        try:
            if not self.r.rsvg_handle_render_document(handle, context, C.byref(Rect(0, 0, size, size)), None):
                raise RuntimeError("SVG rendering failed")
            if self.c.cairo_surface_write_to_png_stream(surface, write, None) != 0:
                raise RuntimeError("PNG encoding failed")
            return output.getvalue()
        finally:
            self.c.cairo_destroy(context)
            self.c.cairo_surface_destroy(surface)
            self.g.g_object_unref(handle)


def element(name, **attrs):
    return ET.Element(f"{{{SVG}}}{name}", attrs)


def encode(root):
    for child in root.iter():
        if child.text is not None and not child.text.strip():
            child.text = None
        if child.tail is not None and not child.tail.strip():
            child.tail = None
    return ET.tostring(root, encoding="utf-8") + b"\n"


def glyph(root):
    result = root.find(".//*[@id='glyph']")
    if result is None:
        raise ValueError("SVG master must contain the outlined glyph")
    return result


def variant(mark, *, theme="dark", shape=None, scale=1, monochrome=False):
    root = element("svg", viewBox="0 0 1024 1024", width="1024", height="1024")
    if shape == "round":
        root.append(element("circle", cx="512", cy="512", r="512", fill="#121316"))
    elif shape == "square":
        color = "#121316" if theme == "dark" else "#FAFAFB"
        root.append(element("rect", x="16", y="16", width="992", height="992", rx="224", fill=color))
    layer = element("g", transform=f"translate(512 512) scale({scale}) translate(-512 -512)")
    for child in mark:
        layer.append(copy.deepcopy(child))
    glyph(layer).set("fill", "#F4F5F7" if theme == "dark" else "#121316")
    if monochrome:
        for child in layer.iter():
            if "fill" in child.attrib:
                child.set("fill", "#000000")
    root.append(layer)
    return encode(root)


def ico(images):
    offset = 6 + 16 * len(images)
    entries, payload = [], []
    for size, png in images:
        entries.append(struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(png), offset))
        payload.append(png)
        offset += len(png)
    return struct.pack("<HHH", 0, 1, len(images)) + b"".join(entries + payload)


def icns(images):
    types = {16: b"icp4", 32: b"icp5", 64: b"icp6", 128: b"ic07", 256: b"ic08", 512: b"ic09", 1024: b"ic10"}
    chunks = [types[size] + struct.pack(">I", len(png) + 8) + png for size, png in images]
    body = b"".join(chunks)
    return b"icns" + struct.pack(">I", len(body) + 8) + body


def main():
    sources = {name: (SOURCES / name).read_bytes() for name in ("icon-dark.svg", "icon-light.svg", "mark.svg")}
    mark = ET.fromstring(sources["mark.svg"])
    # Prevent separate light/dark artwork from silently diverging in shape.
    for name, data in sources.items():
        if glyph(ET.fromstring(data)).get("d") != glyph(mark).get("d"):
            raise ValueError(f"Glyph geometry differs in {name}")
    renderer = Renderer()
    outputs = {}

    def save(path, data):
        destination = ROOT / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        outputs[path] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}

    dark = sources["icon-dark.svg"]
    small = {theme: variant(mark, theme=theme, shape="square", scale=1.16) for theme in ("light", "dark")}
    desktop = "apps/desktop/build"
    images = {}
    for size in (16, 32, 48, 64, 128, 256, 512, 1024):
        images[size] = renderer.png(small["dark"] if size <= 32 else dark, size)
        if size <= 512:
            save(f"{desktop}/icons/{size}x{size}.png", images[size])
    for filename in ("icon.png", "icon-dock.png"):
        save(f"{desktop}/{filename}", images[1024])
    save(f"{desktop}/icon.ico", ico([(size, images[size]) for size in (16, 32, 48, 64, 128, 256)]))
    save(f"{desktop}/icon.icns", icns([(size, images[size]) for size in (16, 32, 64, 128, 256, 512, 1024)]))
    for theme in small:
        save(f"{desktop}/tray-{theme}.png", renderer.png(small[theme], 32))
        save(f"apps/desktop/src/renderer/public/brand/icon-{theme}.svg", small[theme])
    template = variant(mark, scale=1.16, monochrome=True)
    save(f"{desktop}/trayTemplate.png", renderer.png(template, 22))
    save(f"{desktop}/trayTemplate@2x.png", renderer.png(template, 44))
    save("apps/desktop/src/renderer/public/icon.png", images[512])

    save("apps/mobile/shared/src/commonMain/composeResources/drawable/brand_icon.png", images[256])

    mobile = "apps/mobile/androidApp/src/main/res"
    # Keep the bracket corners inside Android's central 66dp safe circle.
    foreground = variant(mark, scale=0.70)
    round_icon = variant(mark, shape="round")
    for density, size, foreground_size in (("mdpi", 48, 108), ("hdpi", 72, 162), ("xhdpi", 96, 216), ("xxhdpi", 144, 324), ("xxxhdpi", 192, 432)):
        prefix = f"{mobile}/mipmap-{density}"
        save(f"{prefix}/ic_launcher.png", renderer.png(dark, size))
        save(f"{prefix}/ic_launcher_round.png", renderer.png(round_icon, size))
        save(f"{prefix}/ic_launcher_foreground.png", renderer.png(foreground, foreground_size))
    save(f"{mobile}/drawable/ic_launcher_background.xml", b'''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#121316" android:pathData="M0,0h108v108h-108z" />
</vector>
''')
    save("apps/docs-site/public/images/agent567-app-icon.png", images[512])
    save("apps/docs-site/public/favicon.svg", small["dark"])
    manifest = {"sources": {name: hashlib.sha256(data).hexdigest() for name, data in sources.items()}, "outputs": outputs}
    (SOURCES / "generated-assets.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Exported {len(outputs)} brand assets from {len(sources)} SVG masters.")


if __name__ == "__main__":
    main()
