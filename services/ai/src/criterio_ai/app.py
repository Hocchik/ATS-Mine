from fastapi import FastAPI

app = FastAPI(title="Criterio IA")


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}
