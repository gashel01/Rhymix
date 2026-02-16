# Beatbox Drum Calibration Wizard

## Run backend

```bash
pip install -r requirements.txt
python -m backend.factory
```

If your backend entrypoint is different in this repo, run your usual Flask command and ensure `backend.factory:create_app` is used.

## Run frontend

```bash
cd frontend
npm install
npm start
```

Open:

- Main app: `http://localhost:3001`
- Wizard: `http://localhost:3001/beatbox-calibration`

## API endpoints

- `POST /api/session/start`
- `POST /api/session/{sessionId}/take`
- `POST /api/session/{sessionId}/train`
- `GET /api/session/{sessionId}/review?label=kick&limit=10`
- `DELETE /api/session/{sessionId}/sample/{sampleId}`
- `GET /api/session/{sessionId}/status`
- `GET /api/sample/{sessionId}/{sampleId}/audio`

