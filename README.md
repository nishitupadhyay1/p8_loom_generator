# P8 Loom Generator

Static web app for designing the Dynaflow P8 loom packs: component library, panel layout, wire length estimate, live checks and the loom schedule.

Runs entirely in the browser (plain HTML, CSS and JavaScript modules, no build step, no dependencies). Hosted on GitHub Pages.

## Data stays out of this repository

This repository is public. **Never commit** the component library, project files, CSV imports or any Dynaflow data. `.gitignore` blocks every `.json`, `.csv`, `.xlsx`, `.dxf`, `.dwg` and `.pdf` except the two dummy files in `samples/`.

## Run locally

Any static file server works, for example:

```
python -m http.server 8000
```

then open <http://localhost:8000>. Opening `index.html` directly from disk does not work, because browsers block JavaScript modules on `file://`.
