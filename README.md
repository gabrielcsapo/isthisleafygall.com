# Is this leafy gall?

A simple, community-built dahlia photo guide at **https://isthisleafygall.com**.

Choose a photo, inspect it on your device, and compare it with published examples of leafy gall, normal-looking growth, and crown gall. Photos used for inspection never leave the browser. No image-analysis API or API key is used.

**This is experimental visual reference matching, not a validated disease detector.** A photo cannot confirm a bacterial infection, and normal-looking growth cannot rule one out.

## Help make the checker better

We need **normal growth and lookalikes**, not just dramatic disease photos.

- [Share your original photos](https://github.com/gabrielcsapo/isthisleafygall.com/issues/new?template=reference-photo.yml)
- [Report a problem](https://github.com/gabrielcsapo/isthisleafygall.com/issues/new?template=bug-report.yml)
- [Read the contribution and review process](CONTRIBUTING.md)

GitHub submissions are public and optional. They are never created from an inspection automatically. Photos are reviewed before inclusion; an uncertain community label does not become model ground truth.

## Reference set

The initial expanded set contains **30 published examples**: 12 leafy-gall appearances, 13 normal-growth appearances, and 5 crown-gall appearances. Sources include UC ANR, Wild Horse Gardens, Dahlia Doctor, Idlewild Blooms, and Summer Dreams Farm. See [the catalog](data/references.json) for source links, label status, image hashes, rights notices, and related-view groups.

These source-checked labels are not laboratory confirmations. The comparison model is general-purpose MobileCLIP-S0, not a model trained to diagnose gall. It compares 512-dimensional visual features, requires separation between categories, and ordinarily requires support from two reference groups. Near-exact reference-image matches are handled directly. The similarity values are not disease probabilities.

A leave-related-group-out check of this small convenience set produced 8 matching categories, 22 abstentions, and 0 wrong categories after adding the support check. This is a development check on source labels, **not a clinical accuracy estimate**. The set is small, related specimens may remain, and normal-looking infected plants are a known limitation. The thresholds remain conservative; the abstention rate is high.

The four display reference photos are pinned in `dist/assets/` so image-CDN encoding changes cannot break a deployment. Their original credits and copyright notices are retained; they are not covered by the code licence. The other downloaded reference photos and all user inspection photos are excluded from the repository. Source URLs, descriptions, provenance, and generated reference vectors are tracked; this is not a relicensed open photo dataset. Model binaries are generated locally and ignored. Community photo submissions have a separate explicit permission process.

## Run locally

Node 24 is recommended.

```sh
npm ci --ignore-scripts
npm run prepare-runtime
npm start
```

Open http://localhost:8080. The preparation step downloads the pinned model and self-hosted runtime and verifies the four pinned display reference thumbnails. It does not upload any visitor photos. Docker runs the same preparation during its build, so GitHub deployments are reproducible without checked-in binary blobs.

The first inspection loads approximately 75 MB. Inference runs in a Web Worker via ONNX Runtime WebAssembly. All model, font, and script files are served by the site itself. No browser photo or result is stored.

## Update reference vectors

```sh
npm run assets
npm run prepare-model
npm run refs:validate
npm test
npm run refs:evaluate
```

`assets` downloads source images and verifies their hashes. If a source changes, the download fails for manual review. `prepare-model` generates vectors locally from accepted catalog entries. Keep uncertain submissions outside the accepted catalog. Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing labels.

For a local WASM smoke check, start the site first, then run:

```sh
MODEL_ORIGIN=http://localhost:8080 node scripts/check-wasm.mjs
```

Model: `Xenova/mobileclip_s0` at revision `757d59c9c6870a76a4b0306f05f5061bca15c39f`. The fp32 vision encoder is used because the smaller q8 encoder produced degraded embeddings during development. The text encoder is used only during reference preparation and is not shipped to visitors.

## Hosting

Railway builds the Dockerfile, serves static files with a small Node server, and checks `/healthz`. The service listens on `0.0.0.0:$PORT`. Source and submitted photos do not become server endpoints. The project lives in Gabriel Csapo’s Railway workspace. The fallback address is https://isthisleafygall-production.up.railway.app.

## Licences

Original application code is [MIT licensed](LICENSE). DM Sans uses its included SIL Open Font License. Model and runtime licences are retained during preparation. Third-party reference photographs retain their owners’ rights; source labels and public availability do not grant a new photo licence. The GitHub photo-submission form asks contributors to license their own photos and descriptions under CC BY 4.0.
