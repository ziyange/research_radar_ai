from functools import lru_cache
from typing import Annotated, Literal
from urllib.parse import urlparse

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    api_host: str = "127.0.0.1"
    api_port: int = 8010
    demo_seed_enabled: bool = False
    dev_user_id: str | None = None
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"]
    )

    database_url: str = "sqlite+memory://dev"
    retrieval_provider: Literal["live", "mock"] = "live"
    retrieval_timeout_seconds: float = 12.0
    retrieval_max_results_per_source: int = 8
    openalex_email: str | None = None
    redis_url: str = "redis://localhost:6379/0"
    s3_endpoint_url: str = "http://localhost:9000"
    s3_access_key_id: str = "research_radar"
    s3_secret_access_key: str = "research_radar_password"
    s3_bucket: str = "research-radar-dev"

    ai_provider: Literal["mock", "openai"] = "mock"
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"
    openai_api_key: str | None = None
    ai_request_timeout_seconds: float = 90.0
    agent_source_timeout_seconds: float = 20.0
    x_mol_api_base_url: str | None = None
    x_mol_api_key: str | None = None
    cnki_api_base_url: str | None = None
    cnki_api_key: str | None = None

    email_provider: Literal["mock", "smtp", "api"] = "mock"
    email_from: str = "Research Radar AI <no-reply@research-radar.local>"
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_use_tls: bool = True
    email_mock_force_failure: bool = False

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def ai_configured(self) -> bool:
        if self.ai_provider == "mock":
            return True
        return bool(self.openai_api_key and self.openai_base_url and self.openai_model)

    @property
    def openai_base_url_host(self) -> str | None:
        parsed = urlparse(self.openai_base_url)
        return parsed.netloc or None


@lru_cache
def get_settings() -> Settings:
    return Settings()
