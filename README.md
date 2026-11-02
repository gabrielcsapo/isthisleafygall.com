# Is this leafy gall?

A simple, community-built dahlia photo guide at **https://isthisleafygall.com**.

Choose a photo, inspect it on your device, and compare it with published examples of leafy gall, normal-looking growth, and crown gall. Automatic inspection stays in the browser. Uploading a photo for human review is a separate, explicit choice. No image-analysis API is used.

**This is experimental visual reference matching, not a validated disease detector.** A photo cannot confirm a bacterial infection, and normal-looking growth cannot rule one out.

## Help make the checker better

We need **normal growth and lookalikes**, not just dramatic disease photos.

- [Send a photo privately for review](https://isthisleafygall.com)
- [Report a problem](https://github.com/gabrielcsapo/isthisleafygall.com/issues/new?template=bug-report.yml)
- [Read the contribution and review process](CONTRIBUTING.md)

The website accepts optional private review requests with a reply email. Photos are stored privately in Railway and delivered to the review inbox through Resend. The owner can reply directly to the notification. Training permission is a separate unchecked choice. A model result is never accepted as a training label automatically. Do not attach private photos or email addresses to public GitHub issues.

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

The first inspection loads approximately 75 MB. Inference runs in a Web Worker via ONNX Runtime WebAssembly. All model, font, and script files are served by the site itself. A photo is uploaded only after the visitor explicitly submits the private review form. Analytics receives only coarse usage events and result categories/reasons, never submission contents or email addresses.

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

Railway builds the Dockerfile, serves static files with a small Node server, and checks `/healthz`. The service listens on `0.0.0.0:$PORT`. Submitted photos and metadata live in a private bucket, with no public read endpoint. The project lives in Gabriel Csapo’s Railway workspace. The fallback address is https://isthisleafygall-production.up.railway.app.

## Licences

Original application code is [MIT licensed](LICENSE). DM Sans uses its included SIL Open Font License. Model and runtime licences are retained during preparation. Third-party reference photographs retain their owners’ rights; source labels and public availability do not grant a new photo licence. Private review submissions are not MIT-licensed or publicly relicensed. Use is governed by the visitor’s recorded permission.

## Usage analytics

PostHog is optional. Set `POSTHOG_PROJECT_TOKEN` (a public `phc_` project token) and `POSTHOG_API_HOST` (the project’s official ingestion host) in Railway. Missing or invalid configuration disables analytics without affecting photo inspection. Never use a private personal API key. For local configuration, use an ignored `.env.local` and `node --env-file=.env.local server.mjs`.

The self-hosted slim SDK runs in cookieless mode with person profiles, session replay, autocapture, surveys, heatmaps and exception capture disabled. Enable cookieless tracking in the PostHog project before activation. Do Not Track and Global Privacy Control skip analytics entirely.

Tracked events: page view, photo selected (no file metadata), inspection started/completed/failed/cancelled, reference opened, guide shared, review form opened/submitted/failed and support links opened. Only fixed categories/reasons/stages are accepted. URLs lose queries and fragments; referrers retain only the domain. Photos, filenames, image features and diagnostic error text are excluded. Blockers or analytics outages never prevent inspection.

## Private photo review

Set these server-only Railway variables (see `.env.example`):

- `REVIEW_S3_ENDPOINT`, `REVIEW_S3_BUCKET`, `REVIEW_S3_REGION`, `REVIEW_S3_ACCESS_KEY_ID`, `REVIEW_S3_SECRET_ACCESS_KEY` — reference the private `review-photos` bucket variables. Use its `BUCKET` value, not the display name.
- `RESEND_API_KEY` — a send-only key; never expose it in browser configuration.
- `REVIEW_FROM_EMAIL` — an authorized sender. The account-owner-only Resend onboarding sender works for notifications to the verified owner; use a verified domain for other recipients.
- `REVIEW_NOTIFY_TO` — the owner’s review inbox. Visitor emails are used only as Reply-To, never as arbitrary notification recipients.
- `SUPPORT_URL` — the public Ko-fi page. An unset URL hides the donation link; the Support dialog still offers photo contributions and the open-source project.

Without complete storage/mail configuration, review submission is disabled and the checker still works. `GET /submission-config.json` exposes only availability and the public support link. `POST /api/reviews` accepts one explicit multipart submission, validates email and review permission, decodes/re-encodes images, strips embedded metadata, enforces request/pixel/concurrency limits, and rate-limits by an in-memory salted address hash. Only the resized JPEG is stored; original filenames and image metadata are discarded. Training permission defaults to false.

`photos/` contains private JPEGs. `pending/` contains durable records awaiting inbox notification. Successful notifications move records to `submissions/`. Failures retry with backoff, including after restarts; stable request IDs and provider idempotency keys prevent ordinary retries from generating duplicate notifications. The app has no public submission-list or image-read route. Notifications contain the image attachment and the visitor’s Reply-To address, so review and reply happen in the owner’s mailbox.

The browser normalizes the image before upload; the server validates and normalizes again. Public submissions are inherently abuse-prone: application limits help but are not a replacement for infrastructure-level traffic controls. A deploy resets in-memory limits. No external inference service or model-training job receives a photo automatically.

### Human labels and training exports

With the bucket variables in your environment (or through the Railway service console):

```sh
node scripts/review-submissions.mjs list
node scripts/review-submissions.mjs label <submission-id> normal
node scripts/review-submissions.mjs export .cache/reviewed-training-new
node scripts/review-submissions.mjs revoke-training <submission-id>
node scripts/review-submissions.mjs delete <submission-id> --confirm
```

Labels can be `leafy`, `normal`, `crown`, `other` or `unclear`. They are human visual assessments, not lab confirmation. Export requires an empty directory and includes only explicit current training permission plus a human label; `unreviewed` and `unclear` cases are excluded. Email addresses and notes never enter the manifest. Keep exports private and review related-view grouping, evidence and held-out evaluation before updating any reference vectors or model. Withdrawal excludes future exports; remove withdrawn photos from prior exports too. No photo enters the live model simply by being submitted or labelled.

To handle a deletion request, remove the private bucket objects and prior exports, and delete the corresponding inbox email/attachment. Tips do not affect whether a review is provided.
