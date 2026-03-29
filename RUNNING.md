# Running the app

Two servers, two terminals.

## Terminal 1 — backend
```
cd captainsLog
.venv/bin/uvicorn server:app --reload --port 8000
```

## Terminal 2 — frontend
```
cd captainsLog/frontend
npm run dev
```

Open: http://localhost:5173

API docs: http://localhost:8000/docs

---

## Setup

```
# 1. Copy config and fill in your name
cp config.py.example config.py

# 2. Add your OpenAI key
cp .env.example .env
# edit .env: OPENAI_API_KEY=sk-...

# 3. Install Python deps
python -m venv .venv
.venv/bin/pip install -r requirements.txt

# 4. Install frontend deps
cd frontend && npm install
```

---

## Dev panel

Hit the API directly from the docs UI or curl:

| Action | Endpoint |
|---|---|
| DB stats | `GET /api/admin/stats` |
| Wipe DB | `POST /api/admin/reset` |
| Load fixture notes | `POST /api/admin/load-fixtures` |
| Generate embeddings | `POST /api/admin/embed` |
