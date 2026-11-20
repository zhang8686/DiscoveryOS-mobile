"""Repack a signed NSH Android APK so its native libraries are stored compressed.

NSH emits `android:extractNativeLibs="false"` with `lib/<abi>/*.so` stored
uncompressed and page-aligned (loaded straight from the APK). Flipping the
flag to true and deflating those entries cuts the download size by roughly
60% at the cost of the installer unpacking the libraries onto the device.

Only three things change in the archive:
  * the boolean attribute `android:extractNativeLibs` (4 bytes in binary XML)
  * `android:windowSoftInputMode`: set to adjustResize (0x10), so the system makes
    room for the keyboard and the reply box follows it up and down, as every other
    app on the phone does
  * the ZIP storage method of `lib/<abi>/*.so` entries

Every other entry keeps its original storage method (notably `resources.arsc`,
which Android requires to be stored uncompressed). Old signature files are
dropped; the output MUST be zipaligned and re-signed before distribution.

`--zopfli` spends several minutes re-compressing the native libraries with an
optimal DEFLATE parse (a few percent smaller than zlib -9). The result is a
standard ZIP DEFLATE stream, fully readable by Android — only the encoder is
different. Without the flag the fast zlib -9 path is used, as before.

Usage:
    python scripts/slim_apk.py <input.apk> <unsigned-output.apk> [--zopfli [N]]
    zipalign -f -p 4 <unsigned-output.apk> <aligned.apk>
    apksigner sign --ks <keystore> --ks-key-alias <alias> \
        --v2-signing-enabled true --v3-signing-enabled true \
        --out <final.apk> <aligned.apk>
"""
import argparse
import struct
import zlib
import zipfile
from pathlib import Path

SO_PREFIX = "lib/"
SO_SUFFIX = ".so"
MANIFEST = "AndroidManifest.xml"


def parse_string_pool(buf, off):
    ctype, hsize, csize = struct.unpack_from("<HHI", buf, off)
    assert ctype == 1, f"expected string pool, got {ctype:#x}"
    count, _styles, flags, str_start, _ = struct.unpack_from("<IIIII", buf, off + 8)
    offsets = struct.unpack_from("<" + "I" * count, buf, off + hsize)
    utf8 = bool(flags & 0x100)
    base = off + str_start
    out = []
    for o in offsets:
        p = base + o
        if utf8:
            def varint(q):
                v = buf[q]
                q += 1
                if v & 0x80:
                    v = ((v & 0x7F) << 8) | buf[q]
                    q += 1
                return v, q
            _, p = varint(p)
            n, p = varint(p)
            out.append(bytes(buf[p:p + n]).decode("utf-8", "replace"))
        else:
            n = struct.unpack_from("<H", buf, p)[0]
            p += 2
            if n & 0x8000:
                n = ((n & 0x7FFF) << 16) | struct.unpack_from("<H", buf, p)[0]
                p += 2
            out.append(bytes(buf[p:p + n * 2]).decode("utf-16-le", "replace"))
    return out, off + csize


def flip_extract_native_libs(axml):
    """Return (xml_bytes, changed). Idempotent: a manifest already set to true
    is returned unchanged."""
    buf = bytearray(axml)
    ctype, hsize, _total = struct.unpack_from("<HHI", buf, 0)
    assert ctype == 3, "not a binary AndroidManifest.xml"
    strings = []
    off = hsize
    while off + 8 <= len(buf):
        ct, hs, cs = struct.unpack_from("<HHI", buf, off)
        if cs < 8:
            break
        if ct == 1:
            strings, _ = parse_string_pool(buf, off)
        elif ct == 0x0102:  # RES_XML_START_ELEMENT_TYPE
            attr_start, attr_size, attr_count, _, _, _ = struct.unpack_from(
                "<HHHHHH", buf, off + hs + 8)
            attrs = off + hs + attr_start
            for i in range(attr_count):
                a = attrs + i * attr_size
                name = struct.unpack_from("<I", buf, a + 4)[0]
                label = strings[name] if name < len(strings) else "?"
                if label == "extractNativeLibs":
                    _size, _res0, dtype, data = struct.unpack_from("<HBBI", buf, a + 12)
                    assert dtype == 0x12, "extractNativeLibs is not a boolean"
                    if data != 0:
                        return bytes(axml), False  # already true
                    struct.pack_into("<I", buf, a + 16, 0xFFFFFFFF)
                    return bytes(buf), True
        off += cs
    raise SystemExit("error: extractNativeLibs attribute not found in manifest")


def set_adjust_resize(axml):
    """Return (xml_bytes, changed). Set android:windowSoftInputMode to adjustResize
    (0x10): the system shrinks the window to the space above the keyboard, so the
    reply box rides up with the IME and back down when it closes — the behaviour
    every other app on the phone has, and the one the user asked for. The app's own
    lift (App.tsx `keyboardBottom`) only applies when the window did not shrink.
    Idempotent."""
    buf = bytearray(axml)
    ctype, hsize, _total = struct.unpack_from("<HHI", buf, 0)
    assert ctype == 3, "not a binary AndroidManifest.xml"
    strings = []
    off = hsize
    while off + 8 <= len(buf):
        ct, hs, cs = struct.unpack_from("<HHI", buf, off)
        if cs < 8:
            break
        if ct == 1:
            strings, _ = parse_string_pool(buf, off)
        elif ct == 0x0102:  # RES_XML_START_ELEMENT_TYPE
            attr_start, attr_size, attr_count, _, _, _ = struct.unpack_from(
                "<HHHHHH", buf, off + hs + 8)
            attrs = off + hs + attr_start
            for i in range(attr_count):
                a = attrs + i * attr_size
                name = struct.unpack_from("<I", buf, a + 4)[0]
                label = strings[name] if name < len(strings) else "?"
                if label == "windowSoftInputMode":
                    _size, _res0, dtype, data = struct.unpack_from("<HBBI", buf, a + 12)
                    assert dtype in (0x10, 0x11), (
                        f"windowSoftInputMode is not an int (type {dtype:#x})")
                    if data == 0x10:
                        return bytes(axml), False  # already adjustResize
                    struct.pack_into("<I", buf, a + 16, 0x10)
                    return bytes(buf), True
        off += cs
    raise SystemExit("error: windowSoftInputMode attribute not found in manifest")


def zopfli_raw_deflate(data: bytes, iterations: int) -> bytes:
    """A raw DEFLATE stream from Zopfli, which searches far harder than zlib for
    an optimal parse. ZIP entries carry raw DEFLATE, while the Python binding
    returns a zlib stream, so strip its 2-byte header and 4-byte Adler-32."""
    try:
        import zopfli.zlib as zz
    except ImportError:
        raise SystemExit("error: --zopfli needs `python -m pip install zopfli`")
    return zz.compress(data, numiterations=iterations)[2:-4]


def write_precompressed(zout, src_info, data: bytes, raw: bytes) -> None:
    """Add an entry whose DEFLATE stream came from another compressor.

    zipfile has no hook for a custom compressor, so the local header is written
    directly and only the metadata is registered; close() then emits the central
    directory record. `start_dir` must be advanced, or a later writestr() seeks
    back and overwrites this entry.
    """
    name = src_info.filename.encode("utf-8")
    dt = src_info.date_time
    dos_date = (dt[0] - 1980) << 9 | dt[1] << 5 | dt[2]
    dos_time = dt[3] << 11 | dt[4] << 5 | dt[5] // 2
    flags = src_info.flag_bits & 0x800  # carry only the UTF-8 filename bit
    crc = zlib.crc32(data) & 0xFFFFFFFF

    zi = zipfile.ZipInfo(src_info.filename, date_time=dt)
    zi.external_attr = src_info.external_attr
    zi.internal_attr = src_info.internal_attr
    zi.create_system = src_info.create_system
    zi.comment = src_info.comment
    zi.flag_bits = flags
    zi.compress_type = zipfile.ZIP_DEFLATED
    zi.CRC = crc
    zi.compress_size = len(raw)
    zi.file_size = len(data)
    zi.header_offset = zout.fp.tell()

    zout.fp.write(struct.pack(
        "<IHHHHHIIIHH", 0x04034B50, 20, flags, 8, dos_time, dos_date,
        crc, len(raw), len(data), len(name), 0))
    zout.fp.write(name)
    zout.fp.write(raw)
    zout.filelist.append(zi)
    zout.NameToInfo[zi.filename] = zi
    zout.start_dir = zout.fp.tell()


def repack(src, dst, zopfli_iterations=None):
    zin = zipfile.ZipFile(src)
    manifest, c1 = flip_extract_native_libs(zin.read(MANIFEST))
    manifest, c2 = set_adjust_resize(manifest)
    changed = c1 or c2
    so_names = [i.filename for i in zin.infolist()
                if i.filename.startswith(SO_PREFIX) and i.filename.endswith(SO_SUFFIX)]
    if not so_names:
        raise SystemExit("error: no native libraries found in APK")

    zout = zipfile.ZipFile(dst, "w", allowZip64=True)
    kept = 0
    so_bytes = 0
    for it in zin.infolist():
        if it.filename.startswith("META-INF/"):
            continue  # old signature is invalid after repacking
        data = zin.read(it.filename)
        if it.filename == MANIFEST:
            data = manifest
        if it.filename in so_names:
            if zopfli_iterations:
                raw = zopfli_raw_deflate(data, zopfli_iterations)
                write_precompressed(zout, it, data, raw)
                so_bytes += len(raw)
            else:
                zi = zipfile.ZipInfo(it.filename, date_time=it.date_time)
                zi.external_attr = it.external_attr
                zi.internal_attr = it.internal_attr
                zi.create_system = it.create_system
                zi.comment = it.comment
                zi.compress_type = zipfile.ZIP_DEFLATED
                zout.writestr(zi, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
                so_bytes += zi.compress_size
        else:
            zi = zipfile.ZipInfo(it.filename, date_time=it.date_time)
            zi.external_attr = it.external_attr
            zi.internal_attr = it.internal_attr
            zi.create_system = it.create_system
            zi.comment = it.comment
            zi.compress_type = it.compress_type
            zout.writestr(zi, data, compress_type=it.compress_type)
        kept += 1
    zout.start_dir = zout.fp.tell()
    zout.close()
    zin.close()
    return kept, len(so_names), so_bytes, changed


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", type=Path, help="the signed NSH APK")
    ap.add_argument("dst", type=Path, help="the unsigned output APK")
    ap.add_argument("--zopfli", nargs="?", const=5, type=int, default=None,
                    metavar="ITERATIONS",
                    help="re-compress the .so with Zopfli (default 5 iterations; slower, ~4%% smaller)")
    args = ap.parse_args()
    if not args.src.is_file():
        raise SystemExit(f"error: {args.src} does not exist")
    if args.zopfli is not None and args.zopfli < 1:
        raise SystemExit("error: --zopfli iterations must be >= 1")
    args.dst.parent.mkdir(parents=True, exist_ok=True)
    kept, nso, so_bytes, changed = repack(args.src, args.dst, args.zopfli)
    print(f"manifest patched (extractNativeLibs=true, windowSoftInputMode=adjustResize): {'changed' if changed else 'already patched'}")
    print(f"native libraries deflated: {nso} | entries kept: {kept} (old signature dropped)")
    print(f"encoder: {'zopfli ' + str(args.zopfli) + ' iterations' if args.zopfli else 'zlib -9'}")
    print(f"compressed .so total: {so_bytes:,} B")
    print(f"input : {args.src.stat().st_size:,} B")
    print(f"output: {args.dst.stat().st_size:,} B (unsigned — align and sign before distributing)")


if __name__ == "__main__":
    main()
