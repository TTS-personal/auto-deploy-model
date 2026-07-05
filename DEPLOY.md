# Deploying AutoReply to Render

Repo: https://github.com/TTS-personal/auto-deploy-model (private)
Already pushed: the current `master` branch is exactly this app - no
training code, no raw chat data, just what's needed to run.

## 1. Create the Render service

Go to https://dashboard.render.com and sign in (or create an account).

**Option A - Blueprint (recommended, uses `render.yaml` automatically):**
1. Click **New +** → **Blueprint**.
2. Connect your GitHub account if you haven't already, and select the
   `auto-deploy-model` repo.
3. Render reads `render.yaml` from the repo root and pre-fills everything:
   service name `autoreply`, Python environment, build/start commands, and
   an auto-generated `AUTOREPLY_API_KEY` (because `render.yaml` has
   `generateValue: true` for it).
4. Click **Apply** / **Create**. Render will build and deploy.

**Option B - Manual Web Service (if you'd rather not use Blueprints):**
1. Click **New +** → **Web Service**, connect the same repo.
2. Environment: **Python 3**.
3. Build Command: `pip install -r requirements.txt`
4. Start Command: `gunicorn app:app --bind 0.0.0.0:$PORT`
5. Under **Environment**, manually add a variable `AUTOREPLY_API_KEY` and
   set it to any secret value you choose (this is the passphrase you'll
   enter on the site).

## 2. Get your API key

- **Blueprint path**: once the service exists, go to the service →
  **Environment** tab → find `AUTOREPLY_API_KEY` → click to reveal the
  auto-generated value. Copy it.
- **Manual path**: it's whatever value you typed in when adding the
  variable.

## 3. Use the live site

1. Wait for the deploy to finish (Render shows build/deploy logs live;
   first deploy usually takes a couple of minutes to install numpy/flask).
2. Open the URL Render gives you (looks like `https://autoreply.onrender.com`).
3. The access-key modal will appear on first load - paste in the
   `AUTOREPLY_API_KEY` value from step 2. It's remembered in your browser's
   `localStorage` after that (per-browser, not per-account).
4. Test the full flow: type a partner message, confirm 3 suggestion chips
   appear, click one, confirm it fills the compose box, type your own
   reply and confirm the ghost-text autocomplete shows up, send it.

## Notes / limitations worth knowing

- **Free tier spins down after ~15 minutes of inactivity.** The first
  request after idling will be slow (a "cold start" while Render restarts
  the service) - this is normal, not a bug.
- **The model was trained on real private conversations and can memorize
  training fragments.** That's the whole reason for the API-key gate -
  don't share the key beyond people you're fine having access to this.
- To rotate the key later: Render dashboard → service → Environment →
  edit `AUTOREPLY_API_KEY` → save (triggers a redeploy). Anyone with the
  old key stored in their browser will get a 401 and be re-prompted.
