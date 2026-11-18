from fastapi.testclient import TestClient

from criterio_ai.app import app
from criterio_ai.config import Config


def test_health_responde_ok():
    respuesta = TestClient(app).get("/health")
    assert respuesta.status_code == 200
    assert respuesta.json() == {"ok": True}


def test_el_token_no_aparece_en_repr():
    valor = "valor-de-prueba-no-visible"
    config = Config(worker_token=valor)
    assert valor not in repr(config)


def test_config_lee_variables_con_prefijo(monkeypatch):
    monkeypatch.setenv("CRITERIO_API_URL", "https://api.ejemplo.test")
    assert Config().api_url == "https://api.ejemplo.test"
