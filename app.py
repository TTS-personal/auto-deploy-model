"""
Flask backend for the AutoReply chat frontend - deployment version.

Differences from the training-project copy (lessons/16_production/webapp/app.py):
  - Imports model.py from the SAME directory (no parent-directory sys.path
    hack needed - this is a standalone deploy folder, not nested inside
    the training project).
  - Requires an API key (X-API-Key header) on every /api/* request. This
    model was trained on real private conversations and has been observed
    to memorize training data at this scale - gating the API keeps random
    internet visitors from probing it. Set via the AUTOREPLY_API_KEY
    environment variable; if that variable isn't set at all (e.g. running
    locally without configuring one), the gate is skipped so local dev
    doesn't require extra setup.
  - Debug mode and the bind port are controlled by environment variables
    (FLASK_DEBUG, PORT) instead of being hardcoded - Render (and most
    hosts) inject PORT themselves and debug mode must default OFF in any
    internet-facing deployment.
  - In production, gunicorn imports this file's `app` object directly
    (see render.yaml) - the `app.run(...)` block only ever runs for local
    testing via `python app.py`.
"""

import os
from functools import wraps

import numpy as np
from flask import Flask, jsonify, render_template, request

from model import CHECKPOINT_PATH, DAYS, generate, load_checkpoint, time_features, tokenize

app = Flask(__name__)

PARAMS, VOCAB, TOK2ID = load_checkpoint(CHECKPOINT_PATH)

SUGGESTION_MAX_TOKENS = 10
AUTOCOMPLETE_MAX_TOKENS = 6
NUM_SUGGESTIONS = 3

API_KEY = os.environ.get("AUTOREPLY_API_KEY")


def require_api_key(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if API_KEY and request.headers.get("X-API-Key") != API_KEY:
            return jsonify({"error": "missing or invalid API key"}), 401
        return view(*args, **kwargs)
    return wrapped


def _parse_request_settings(payload):
    day = payload.get("day") or DAYS[0]
    time_str = payload.get("time") or "12:00"
    temperature = float(payload.get("temperature", 0.7))
    repetition_penalty = float(payload.get("repetition_penalty", 2.0))
    return time_features(day, time_str), temperature, repetition_penalty


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/suggest-replies", methods=["POST"])
@require_api_key
def suggest_replies():
    payload = request.get_json(force=True) or {}
    partner_message = (payload.get("partner_message") or "").strip()
    tf, temperature, repetition_penalty = _parse_request_settings(payload)

    tokens = [TOK2ID.get(t, TOK2ID["<UNK>"]) for t in tokenize(partner_message)]
    prompt_ids = tokens + [TOK2ID["<SEP>"]]

    suggestions = []
    for _ in range(NUM_SUGGESTIONS):
        rng = np.random.default_rng()
        text = generate(prompt_ids, tf, PARAMS, VOCAB, TOK2ID,
                         temperature=temperature, max_new_tokens=SUGGESTION_MAX_TOKENS,
                         repetition_penalty=repetition_penalty, rng=rng)
        suggestions.append(text)

    return jsonify({"suggestions": suggestions})


@app.route("/api/autocomplete", methods=["POST"])
@require_api_key
def autocomplete():
    payload = request.get_json(force=True) or {}
    partial_text = (payload.get("partial_text") or "").strip()
    tf, temperature, repetition_penalty = _parse_request_settings(payload)

    if not partial_text:
        return jsonify({"suggestion": ""})

    tokens = [TOK2ID.get(t, TOK2ID["<UNK>"]) for t in tokenize(partial_text)]
    prompt_ids = [TOK2ID["<SEP>"]] + tokens

    rng = np.random.default_rng()
    suggestion = generate(prompt_ids, tf, PARAMS, VOCAB, TOK2ID,
                          temperature=temperature, max_new_tokens=AUTOCOMPLETE_MAX_TOKENS,
                          repetition_penalty=repetition_penalty, rng=rng)
    return jsonify({"suggestion": suggestion})


if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG") == "1"
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=debug, host="0.0.0.0", port=port)
