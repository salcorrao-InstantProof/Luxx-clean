# LUXX video worker

Runs on the droplet (`luxx-worker`, 137.184.216.66). Reads the same Netlify Blobs the app uses. Do not put the Netlify token in this repo.

## On the machine

```
cd /root
git clone https://github.com/salcorrao-InstantProof/Luxx-clean.git luxx-worker
cd luxx-worker/luxx-worker
```

Copy the libraries the renderer imports. Paths must stay `netlify/lib/`:

```
mkdir -p netlify/lib
cp ../netlify/lib/storage.mjs netlify/lib/   # after the credential patch is in the app tree
cp ../video\ CLEANDISK.js netlify/lib/video.mjs
cp ../netlify/lib/model.mjs netlify/lib/
cp ../netlify/lib/privacy.mjs netlify/lib/
cp ../netlify/lib/ids.mjs netlify/lib/
cp ../netlify/lib/domain.mjs netlify/lib/    # model.mjs imports seedState from domain
```

If `privacy.mjs` or `domain.mjs` are missing from this package, copy them from the live app tree. `video.mjs` will not start without `privacy.mjs`.

```
nano start.sh          # paste token only. never commit it
npm install
bash start.sh
```

Expect: `connected to storage` then `worker ready`.

Keep it up:

```
cp luxx-worker.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now luxx-worker
journalctl -u luxx-worker -f
```

## Honest limits

- 1 GB RAM on that droplet is tight for an 800 MB assemble plus ffmpeg. Watch `dmesg` for OOM.
- Claim logic was unit-tested. First live Blobs run is the real test.
- Do not redeploy the Netlify app just to turn this on.
