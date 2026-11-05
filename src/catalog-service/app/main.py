from fastapi import FastAPI

app = FastAPI(
    title="ToneAtlas catalog service",
    description="Catálogo de canciones de ToneAtlas.",
    version="0.1.0",
)

# Canciones de prueba escritas a mano.
SONGS = [
    {"id": 1, "title": "Wish You Were Here", "artist": "Pink Floyd", "year": 1975},
    {"id": 2, "title": "Californication", "artist": "Red Hot Chili Peppers", "year": 1999},
    {"id": 3, "title": "Bohemian Rhapsody", "artist": "Queen", "year": 1975},
    {"id": 4, "title": "Hotel California", "artist": "Eagles", "year": 1976},
    {"id": 5, "title": "Smells Like Teen Spirit", "artist": "Nirvana", "year": 1991},
]


@app.get("/health")
def health():
    return {"status": "ok", "service": "catalog"}


@app.get("/songs")
def list_songs(q: str = ""):
    """Devuelve las canciones cuyo título o artista contengan q."""
    q = q.lower()
    return [s for s in SONGS if q in s["title"].lower() or q in s["artist"].lower()]