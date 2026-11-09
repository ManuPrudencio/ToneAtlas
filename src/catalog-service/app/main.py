import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sqlalchemy import Integer, String, create_engine, or_, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./catalog.db")
engine = create_engine(DATABASE_URL, pool_pre_ping=True)


class Base(DeclarativeBase):
    pass


class Song(Base):
    __tablename__ = "songs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(300))
    artist: Mapped[str] = mapped_column(String(300))
    album: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)


class SongOut(BaseModel):
    id: int
    title: str
    artist: str
    album: Optional[str] = None
    year: Optional[int] = None

    model_config = {"from_attributes": True}


SAMPLE_SONGS = [
    ("Wish You Were Here", "Pink Floyd", "Wish You Were Here", 1975),
    ("Comfortably Numb", "Pink Floyd", "The Wall", 1979),
    ("Californication", "Red Hot Chili Peppers", "Californication", 1999),
    ("Under the Bridge", "Red Hot Chili Peppers", "Blood Sugar Sex Magik", 1991),
    ("Back in Black", "AC/DC", "Back in Black", 1980),
    ("Smoke on the Water", "Deep Purple", "Machine Head", 1972),
]


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    yield


app = FastAPI(
    title="ToneAtlas catalog service",
    description="Catálogo de canciones de ToneAtlas.",
    version="0.2.0",
    lifespan=lifespan,
)


@app.get("/health")
def health():
    return {"status": "ok", "service": "catalog"}


@app.get("/songs", response_model=list[SongOut])
def list_songs(q: str = ""):
    stmt = select(Song).order_by(Song.artist, Song.title)
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Song.title.ilike(like), Song.artist.ilike(like)))
    with Session(engine) as session:
        return session.scalars(stmt).all()


@app.get("/songs/{song_id}", response_model=SongOut)
def get_song(song_id: int):
    with Session(engine) as session:
        song = session.get(Song, song_id)
        if song is None:
            raise HTTPException(status_code=404, detail="Song not found")
        return song


@app.post("/songs/seed")
def seed_songs():
    created = 0
    with Session(engine) as session:
        for title, artist, album, year in SAMPLE_SONGS:
            exists = session.scalar(select(Song).where(Song.title == title, Song.artist == artist))
            if exists is None:
                session.add(Song(title=title, artist=artist, album=album, year=year))
                created += 1
        session.commit()
    return {"created": created}