from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CRITERIO_", env_file=".env", extra="ignore")

    api_url: str = "http://localhost:3000"
    worker_token: str = Field(default="", repr=False)
