"""Cross-check the DOM contract between index.html and the JS modules.

Catches the class of bug where a module reads an element the HTML never declares
(silent null) or the HTML wires a data-action nobody handles (dead button)

    python tools/check-contract.py     # exit 0 = clean
"""

import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
js = {
    os.path.basename(p): open(p, encoding="utf-8").read()
    for p in sorted(glob.glob(os.path.join(ROOT, "js", "*.js")))
}
all_js = "\n".join(js.values())

html_ids = set(re.findall(r'\bid="([^"]+)"', html))
html_actions = set(re.findall(r'data-action="([^"]+)"', html))

# --- ids the JS reads -------------------------------------------------------
wanted = {}


def note(name, ident):
    wanted.setdefault(ident, set()).add(name)


for name, src in js.items():
    for m in re.finditer(r'(?:\$\(|getElementById\()\s*"([^"]+)"', src):
        note(name, m.group(1))
    for m in re.finditer(r'querySelector(?:All)?\(\s*"#([A-Za-z][\w-]*)"', src):
        note(name, m.group(1))
    # ids passed as plain string arguments to the helpers that take one
    for m in re.finditer(r'(?:openModal|closeModal|wireUpload)\(\s*"([^"]+)"', src):
        note(name, m.group(1))

# the view list in app.js is an array of element ids
views = re.search(r'VIEWS\s*=\s*\[(.*?)\]', all_js, re.S)
if views:
    for v in re.findall(r'"([^"]+)"', views.group(1)):
        note("app.js", v)

# --- actions the JS handles ------------------------------------------------
handled = set(re.findall(r'case\s+"([a-z][\w-]*)"\s*:', all_js))
handled |= set(re.findall(r'\bact\s*===\s*"([^"]+)"', all_js))
# app.js dispatches through an ACTIONS map — pull its quoted keys from the block
block = re.search(r"const ACTIONS = \{(.*?)\n  \};", js.get("app.js", ""), re.S)
if block:
    handled |= set(re.findall(r'"([a-z][a-z0-9-]*)"\s*:', block.group(1)))

missing_ids = {k: v for k, v in wanted.items() if k not in html_ids}
dead_actions = html_actions - handled
orphan_handlers = handled - html_actions
unread_ids = html_ids - set(wanted)


def show(title, rows, fatal=False):
    print(f"\n{'FAIL' if fatal and rows else 'ok  '} {title}  ({len(rows)})")
    for r in sorted(rows):
        print("      -", r)


print(f"index.html : {len(html_ids)} ids, {len(html_actions)} data-action values")
print(f"js modules : {len(js)} files, {len(wanted)} ids read, {len(handled)} actions handled")

show("ids read by JS but absent from index.html",
     [f"#{k}  <- {', '.join(sorted(v))}" for k, v in missing_ids.items()], fatal=True)
show("data-action in HTML with no handler (dead button)", dead_actions, fatal=True)
show("handlers with no button in HTML (unreachable, not fatal)", orphan_handlers)
show("ids never read by JS (styling/labelling only, fine)", unread_ids)

breaks = len(missing_ids) + len(dead_actions)
print(f"\n{'FAIL' if breaks else 'PASS'}: {breaks} contract break(s)")
sys.exit(1 if breaks else 0)
