#!/usr/bin/env python3
# =============================================================================
# audit-input-font-sizes.py — Audit of the "no zoom" policy (issues
# #92/#275, ADR-042 and ADR-099): no input/textarea/select may have a
# computed font-size < 16px (1rem) and both stylesheets must include the
# global touch-action: manipulation rule on interactive elements.
#
# Usage:
#   scripts/audit-input-font-sizes.py
#
# Exit code: 0 if everything is fine; 1 if there are violations (useful
# as a CI or pre-commit guard). No arguments; paths relative to the repo directory.
# =============================================================================
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHEETS = [ROOT / "css" / "styles.css", ROOT / "ocio" / "ocio.css"]
BASE_FONT_PX = 16  # html doesn't redefine font-size: browser default (16px)

# Global rules for inputs (safety net, ADR-042) and touch-action (ADR-099)
GLOBAL_INPUT_RULE = re.compile(
    r"input\s*,\s*textarea\s*,\s*select\s*\{\s*font-size:\s*16px\s*;"
)
TOUCH_ACTION_RULE = re.compile(
    r"button\s*,\s*a\s*,\s*input\s*,\s*select\s*,\s*textarea\s*\{\s*"
    r"touch-action:\s*manipulation\s*;"
)
# Form element selectors (word boundary so it doesn't catch e.g.
# .ing-nombre-valor outside an input... the .ing-nombre selector is
# an input, so the class name alone isn't enough: the tag is searched).
FIELD_SEL = re.compile(r"\b(input|select|textarea)\b")
FONT_SIZE = re.compile(r"font-size:\s*([^;]+);")
# Value in rem or px
SIZE = re.compile(r"^\s*([\d.]+)\s*(rem|px)\s*$")


def font_px(value: str):
    m = SIZE.match(value)
    if not m:
        return None
    n, unit = float(m.group(1)), m.group(2)
    return n * BASE_FONT_PX if unit == "rem" else n


def split_rules(css: str):
    """Splits the CSS into selector { body } blocks. Media queries are
    kept as blocks with an @media selector (they contain no field font-size)."""
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
        yield m.group(1).strip(), m.group(2)


def audit_sheet(path: Path) -> list:
    css = path.read_text(encoding="utf-8")
    violations = []
    if not GLOBAL_INPUT_RULE.search(css):
        violations.append("falta la regla global `input, textarea, select { font-size: 16px; }`")
    if not TOUCH_ACTION_RULE.search(css):
        violations.append("falta la regla global `button, a, input, select, textarea { touch-action: manipulation; }`")
    for selector, body in split_rules(css):
        if not FIELD_SEL.search(selector):
            continue
        fs = FONT_SIZE.search(body)
        if not fs:
            continue
        px = font_px(fs.group(1))
        if px is None:
            continue
        if px < 16:
            violations.append(
                f"font-size {fs.group(1).strip()} ({px:.1f}px) < 16px en: {selector}"
            )
    return violations


def main() -> int:
    ok = True
    for sheet in SHEETS:
        if not sheet.exists():
            print(f"ERROR: no existe {sheet}"); ok = False; continue
        violations = audit_sheet(sheet)
        if violations:
            ok = False
            print(f"VIOLACIONES en {sheet.relative_to(ROOT)}:")
            for v in violations:
                print(f"  - {v}")
        else:
            print(f"OK: {sheet.relative_to(ROOT)} — sin violaciones")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
