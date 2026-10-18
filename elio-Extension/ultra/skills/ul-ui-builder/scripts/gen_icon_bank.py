"""icons.json (from upload_icons.py) -> a Luau icon bank module.

    python gen_icon_bank.py --map <project>/ui/icons.json \
        --out <game>/src/shared/Config/UiIcons.luau [--source-note "ui/icons.json"]

WHY A BANK. ui_build.py strips Content-typed properties (Image) from the
.model.json by default, because the live Rojo plugin died on a Content value and
synced nothing (see strip_content_for_rojo). Every ImageLabel therefore carries
an IconName attribute, and a client controller applies the id from this bank at
runtime. Even with --keep-content the bank is still the one place a controller
turns a NAME into an id (a panel whose icon follows the selection), so it is
generated from the same icons.json the upload wrote - hand-kept ids drift the
first time an icon is rerolled.

Written as bytes with LF endings: Python text mode on Windows writes CRLF and an
LF-only repo's stylua gate then goes red on a file nobody edited.
verify_icon_wiring.py reads this file.
"""

import argparse
import json
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--map", required=True, help="icons.json written by upload_icons.py")
    ap.add_argument("--out", required=True, help="Luau module to write")
    ap.add_argument("--source-note", default=None, help="path shown in the header comment")
    args = ap.parse_args()

    ids = {k: v for k, v in json.loads(Path(args.map).read_text()).items()
           if not k.startswith("_")}
    if not ids:
        raise SystemExit(f"no ids in {args.map}; upload first")
    rows = "\n".join(f'\t{n} = "rbxassetid://{a}",' for n, a in sorted(ids.items()))
    note = args.source_note or args.map
    body = f"""--!strict
-- GENERATED FILE - DO NOT EDIT BY HAND.
-- Source: {note}, written by ul-ui-builder/scripts/upload_icons.py
-- Regenerate: python ~/.claude/skills/ul-ui-builder/scripts/gen_icon_bank.py

local UiIcons: {{ [string]: string }} = {{
{rows}
}}

return UiIcons
"""
    Path(args.out).write_bytes(body.encode("utf-8"))
    print(f"{len(ids)} icons -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
