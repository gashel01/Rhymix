import logging
from logging.config import dictConfig


def configure_logging():
    # Keep logging configuration identical to the previous app.py setup
    dictConfig(
        {
            "version": 1,
            "formatters": {
                "default": {
                    "format": "[%(asctime)s] %(levelname)s in %(module)s: %(message)s",
                },
            },
            "handlers": {
                "wsgi": {
                    "class": "logging.StreamHandler",
                    "stream": "ext://flask.logging.wsgi_errors_stream",
                    "formatter": "default",
                },
                "file": {
                    "class": "logging.FileHandler",
                    "filename": "flask_app.log",
                    "formatter": "default",
                },
            },
            "root": {
                "level": "DEBUG",
                "handlers": ["wsgi", "file"],
            },
        }
    )

    return logging.getLogger(__name__)
