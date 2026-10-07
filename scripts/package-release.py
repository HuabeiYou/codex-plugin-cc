#!/usr/bin/env python3
"""Create a deterministic standalone marketplace ZIP and SHA-256 sidecar."""
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
release = root / "release"
version = json.loads((release / "bundle-manifest.json").read_text())["version"]
output = root / "output"
output.mkdir(exist_ok=True)
archive = output / f"codex-companion-{version}.zip"
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
    for file in sorted(release.rglob("*")):
        if not file.is_file() or ".claude-plugin/types/" in file.relative_to(release).as_posix():
            continue
        entry = zipfile.ZipInfo(file.relative_to(release).as_posix(), (1980, 1, 1, 0, 0, 0))
        entry.create_system = 3
        entry.external_attr = 0o100644 << 16
        entry.compress_type = zipfile.ZIP_DEFLATED
        bundle.writestr(entry, file.read_bytes())
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
checksum = archive.with_suffix(".zip.sha256")
checksum.write_text(f"{digest}  {archive.name}\n")
print(json.dumps({"archive": str(archive), "sha256": digest, "checksum": str(checksum)}))
