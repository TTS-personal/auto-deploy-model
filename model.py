"""
Inference-only core for the deployed AutoReply backend.

This is a trimmed copy of lessons/16_production/model.py from the training
project: only what's needed to LOAD a trained checkpoint and GENERATE text
survives here (forward pass, sampling, repetition penalty). Training code
(backward pass, the training loop, dataset loading/vocab-building from the
raw CSV) is deliberately left out - this deployment never needs it and
never has access to the raw chat data it was trained from.
"""

from collections import Counter
from pathlib import Path

import numpy as np

CHECKPOINT_PATH = Path(__file__).resolve().parent / "checkpoint.npz"

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
DAY2IDX = {day: i for i, day in enumerate(DAYS)}
TIME_DIM = 9  # 7-way day one-hot + sin(time-of-day) + cos(time-of-day)


def tokenize(text):
    import re
    return re.findall(r"[a-zA-Z']+", text.lower())


def time_features(day, time_str):
    day_onehot = np.zeros(7)
    day_onehot[DAY2IDX[day]] = 1.0
    hh, mm = time_str.split(":")
    angle = 2 * np.pi * (int(hh) * 60 + int(mm)) / (24 * 60)
    return np.concatenate([day_onehot, [np.sin(angle), np.cos(angle)]])


def relu(z):
    return np.maximum(0.0, z)


def sigmoid(z):
    return 1.0 / (1.0 + np.exp(-z))


def softmax_rows(x):
    shifted = x - np.max(x, axis=-1, keepdims=True)
    exp_values = np.exp(shifted)
    return exp_values / np.sum(exp_values, axis=-1, keepdims=True)


def causal_mask(seq_len):
    future = np.triu(np.ones((seq_len, seq_len)), k=1)
    return np.where(future == 1, -np.inf, 0.0)


def forward(ids, params, time_feat):
    input_ids = np.asarray(ids)

    E, Wt, bt, Wg, bg = params["E"], params["Wt"], params["bt"], params["Wg"], params["bg"]
    Wq, Wk, Wv = params["Wq"], params["Wk"], params["Wv"]
    W1, b1, W2, b2 = params["W1"], params["b1"], params["W2"], params["b2"]

    T = len(input_ids)

    Zt = Wt @ time_feat + bt
    Ht = np.tanh(Zt)
    Zg = Wg @ Ht + bg
    G = sigmoid(Zg)
    time_contrib = G * Ht

    X = E[input_ids] + time_contrib

    Q, K, Val = X @ Wq, X @ Wk, X @ Wv
    scores = (Q @ K.T) / np.sqrt(Wq.shape[0]) + causal_mask(T)
    A = softmax_rows(scores)
    attn_out = A @ Val

    Z1 = attn_out @ W1 + b1
    H1 = relu(Z1)
    logits = H1 @ W2 + b2
    P = softmax_rows(logits)

    return P, {"logits": logits}


def sample_next_token(logits_row, temperature, rng):
    """Ties back to the softmax lesson: softmax only cares about the GAPS
    between scores. Dividing by temperature before softmax shrinks those
    gaps (temperature > 1, more varied) or stretches them (temperature < 1,
    closer to always picking the top choice)."""
    scaled = logits_row / max(temperature, 1e-8)
    probs = softmax_rows(scaled[None, :])[0]
    return int(rng.choice(len(probs), p=probs))


def apply_repetition_penalty(logits, generated_ids, penalty=2.0):
    """Subtract a penalty from a token's score per prior occurrence in this
    response - the same "lower this score, softmax shrinks its share"
    lever as temperature, just applied selectively per-token."""
    if not generated_ids:
        return logits
    penalized = logits.copy()
    counts = Counter(generated_ids)
    for token_id, count in counts.items():
        penalized[token_id] -= penalty * count
    return penalized


def generate(prompt_ids, time_feat, params, vocab, tok2id,
             temperature=0.7, max_new_tokens=20, repetition_penalty=2.0, rng=None):
    """Decode until <EOS> (or max_new_tokens as a safety backstop)."""
    if rng is None:
        rng = np.random.default_rng()
    eos_id = tok2id["<EOS>"]
    ids = list(prompt_ids)
    generated = []

    for _ in range(max_new_tokens):
        _P, cache = forward(ids, params, time_feat)
        logits_row = cache["logits"][-1]
        logits_row = apply_repetition_penalty(logits_row, generated, repetition_penalty)
        next_id = sample_next_token(logits_row, temperature, rng)
        if next_id == eos_id:
            break
        ids.append(next_id)
        generated.append(next_id)

    return " ".join(vocab[i] for i in generated) if generated else "(empty response)"


def load_checkpoint(path):
    data = np.load(path, allow_pickle=True)
    vocab = list(data["vocab"])
    params = {key: data[key] for key in data.files if key != "vocab"}
    tok2id = {w: i for i, w in enumerate(vocab)}
    return params, vocab, tok2id
