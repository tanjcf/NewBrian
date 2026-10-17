"""Bind visual observations to actual template files; the model supplies no hashes."""
import argparse
from pathlib import Path
from template_visual_gate import read_json, hashes, review_issues
import json

def main():
    p=argparse.ArgumentParser();p.add_argument('project_dir');a=p.parse_args()
    root=Path(a.project_dir).resolve();base=root/'_internal/00_project';f=base/'fidelity_template'
    review=read_json(base/'template_canvas_self_review.json',{})
    registry=read_json(f/'template_registry.json',{})
    review['evidence']={'source_png_sha256':hashes(list((base/'template_visuals').glob('*.png'))),
      'canvas_png_sha256':hashes(list((f/'canvas_previews').rglob('*.png'))),
      'canvas_svg_sha256':hashes([f/x['canvas_file'] for x in registry.get('layouts',{}).values()])}
    (base/'template_canvas_self_review.json').write_text(json.dumps(review,ensure_ascii=False,indent=2))
    issues=review_issues(root)
    print(json.dumps({'issues':issues,'status':'fail' if issues else 'pass'},ensure_ascii=False))
    raise SystemExit(bool(issues))
if __name__=='__main__':main()
