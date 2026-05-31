"""Genera interiores con Gemini 3 Pro Image (Nano Banana Pro) usando
una o varias imágenes de referencia + prompt.

Uso:
    python3 genera_interior_ref.py <ref1> [<ref2> ...] --prompt "<texto>" --nombre <nombre>

El orden de las referencias importa: la primera referencia del prompt es
contents[1], la segunda es contents[2], etc.

Guarda en assets/imagenes/interiores/:
    <nombre>.png   -> master sin tocar (bytes tal cual de la API)
    <nombre>.webp  -> convertido con Pillow, quality=90

NOTA: el campo image_size aún no está expuesto en google-genai 1.47.0 (último
publicado), así que se llama al endpoint REST directamente para poder pedir "4K".
"""

import argparse
import base64
import io
import json
import mimetypes
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

MODEL_ID = "gemini-3-pro-image-preview"
ASPECT_RATIO = "9:16"
IMAGE_SIZE = "4K"
ENDPOINT = (
    f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL_ID}:generateContent"
)
OUTPUT_DIR = Path(__file__).resolve().parent / "assets" / "imagenes" / "interiores"


def fail(msg: str, code: int = 1) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def load_reference(path: Path, project_root: Path):
    p = path if path.is_absolute() else project_root / path
    if not p.is_file():
        fail(f"No existe la referencia: {p}")
    try:
        raw = p.read_bytes()
    except OSError as exc:
        fail(f"No se ha podido leer {p}: {exc}")

    from PIL import Image
    try:
        with Image.open(io.BytesIO(raw)) as im:
            w, h = im.size
    except Exception as exc:
        fail(f"No se ha podido abrir como imagen: {p}: {type(exc).__name__}: {exc}")

    mime, _ = mimetypes.guess_type(str(p))
    if mime is None:
        mime = "image/webp"

    return {
        "path": p,
        "rel": p.relative_to(project_root) if project_root in p.parents else p,
        "bytes": raw,
        "mime": mime,
        "size": (w, h),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Genera un interior con Gemini 3 Pro Image (1+ referencias + prompt)."
    )
    parser.add_argument(
        "referencias",
        nargs="+",
        help="Rutas a las imágenes de referencia (en el orden que indica el prompt).",
    )
    parser.add_argument("--prompt", required=True, help="Prompt de texto.")
    parser.add_argument("--nombre", required=True, help="Nombre base del archivo (sin extensión).")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent
    load_dotenv(project_root / ".env")
    load_dotenv(project_root / ".env.local", override=False)

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        fail("Falta GEMINI_API_KEY. Añádela en .env (o .env.local) en la raíz del proyecto.")

    try:
        from PIL import Image
    except ImportError as exc:
        fail(f"Pillow no está instalado: {exc}. Ejecuta: pip install Pillow")

    refs = [load_reference(Path(r), project_root) for r in args.referencias]

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    png_path = OUTPUT_DIR / f"{args.nombre}.png"
    webp_path = OUTPUT_DIR / f"{args.nombre}.webp"

    print(f"Modelo:      {MODEL_ID}")
    print(f"Aspect:      {ASPECT_RATIO}    Size: {IMAGE_SIZE}")
    for i, r in enumerate(refs, start=1):
        print(f"Ref #{i}:      {r['rel']}  ({r['size'][0]}x{r['size'][1]}, {r['mime']})")
    print(f"Prompt:      {args.prompt[:120]}{'...' if len(args.prompt) > 120 else ''}")
    print("Generando con Gemini 3 Pro Image (REST)...")

    parts = [{"text": args.prompt}]
    for r in refs:
        parts.append(
            {
                "inlineData": {
                    "mimeType": r["mime"],
                    "data": base64.b64encode(r["bytes"]).decode("ascii"),
                }
            }
        )

    payload = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {
                "aspectRatio": ASPECT_RATIO,
                "imageSize": IMAGE_SIZE,
            },
        },
    }

    headers = {
        "x-goog-api-key": api_key,
        "Content-Type": "application/json",
    }

    try:
        with httpx.Client(timeout=300.0) as client:
            r = client.post(ENDPOINT, headers=headers, content=json.dumps(payload))
    except httpx.RequestError as exc:
        fail(f"Fallo de red al llamar a la API: {type(exc).__name__}: {exc}")

    if r.status_code != 200:
        try:
            err = r.json()
            msg = err.get("error", {}).get("message", r.text)
        except Exception:
            msg = r.text
        fail(f"La API ha devuelto HTTP {r.status_code}: {msg}")

    try:
        data = r.json()
    except json.JSONDecodeError as exc:
        fail(f"Respuesta no JSON: {exc}")

    image_bytes = None
    finish_reason = None
    for cand in data.get("candidates", []):
        finish_reason = cand.get("finishReason")
        for part in (cand.get("content") or {}).get("parts", []) or []:
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                image_bytes = base64.b64decode(inline["data"])
                break
        if image_bytes:
            break

    if not image_bytes:
        fail(
            f"La respuesta no contiene ninguna imagen (finishReason={finish_reason}). "
            "Revisa filtros de seguridad o el prompt."
        )

    try:
        png_path.write_bytes(image_bytes)
    except OSError as exc:
        fail(f"No se ha podido escribir {png_path}: {exc}")

    try:
        with Image.open(io.BytesIO(image_bytes)) as im:
            im.save(webp_path, "WEBP", quality=90)
            width, height = im.size
    except Exception as exc:
        fail(f"No se ha podido convertir a WEBP: {type(exc).__name__}: {exc}")

    print(f"OK  {png_path.relative_to(project_root)}  ({len(image_bytes) / 1024:.1f} KB)")
    print(f"OK  {webp_path.relative_to(project_root)}  ({webp_path.stat().st_size / 1024:.1f} KB)")
    print(f"Dimensiones: {width}x{height}")


if __name__ == "__main__":
    main()
