"""Genera interiores hiperrealistas con Imagen 4 Ultra (Gemini API).

Uso:
    python3 genera_interior.py "<prompt>" <nombre-salida>

Guarda en assets/imagenes/interiores/:
    <nombre>.png   -> master sin tocar (bytes tal cual de la API)
    <nombre>.webp  -> convertido con Pillow, quality=90
"""

import argparse
import io
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

MODEL_ID = "imagen-4.0-ultra-generate-001"
ASPECT_RATIO = "16:9"
IMAGE_SIZE = "2K"
PERSON_GENERATION = "allow_adult"
OUTPUT_DIR = Path(__file__).resolve().parent / "assets" / "imagenes" / "interiores"


def fail(msg: str, code: int = 1) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera un interior con Imagen 4 Ultra.")
    parser.add_argument("prompt", help="Prompt de texto para la imagen.")
    parser.add_argument("nombre", help="Nombre base del archivo (sin extensión).")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent
    load_dotenv(project_root / ".env")
    load_dotenv(project_root / ".env.local", override=False)

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        fail(
            "Falta GEMINI_API_KEY. Añádela en .env (o .env.local) en la raíz del proyecto."
        )

    try:
        from google import genai
        from google.genai import types
    except ImportError as exc:
        fail(f"google-genai no está instalado: {exc}. Ejecuta: pip install google-genai")

    try:
        from PIL import Image
    except ImportError as exc:
        fail(f"Pillow no está instalado: {exc}. Ejecuta: pip install Pillow")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    png_path = OUTPUT_DIR / f"{args.nombre}.png"
    webp_path = OUTPUT_DIR / f"{args.nombre}.webp"

    print(f"Modelo:      {MODEL_ID}")
    print(f"Aspect:      {ASPECT_RATIO}    Size: {IMAGE_SIZE}")
    print(f"Prompt:      {args.prompt[:120]}{'...' if len(args.prompt) > 120 else ''}")
    print("Generando con Imagen 4 Ultra...")

    try:
        client = genai.Client(api_key=api_key)
        result = client.models.generate_images(
            model=MODEL_ID,
            prompt=args.prompt,
            config=types.GenerateImagesConfig(
                number_of_images=1,
                aspect_ratio=ASPECT_RATIO,
                image_size=IMAGE_SIZE,
                output_mime_type="image/png",
                person_generation=PERSON_GENERATION,
            ),
        )
    except Exception as exc:
        fail(f"La llamada a la API ha fallado: {type(exc).__name__}: {exc}")

    if not getattr(result, "generated_images", None):
        block_reason = getattr(result, "positive_prompt_safety_attributes", None)
        fail(
            "La API no ha devuelto ninguna imagen. "
            f"Posible filtro de contenido o cuota agotada. Detalle: {block_reason}"
        )

    try:
        image_bytes = result.generated_images[0].image.image_bytes
    except (AttributeError, IndexError) as exc:
        fail(f"No se han podido extraer los bytes de la respuesta: {exc}")

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
