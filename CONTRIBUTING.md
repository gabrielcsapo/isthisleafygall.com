# Help improve Is this leafy gall?

We need useful examples of **normal growth as well as suspected disease**. A checker trained only on dramatic diseased plants will make unnecessary false alarms.

[Submit a reference photo](https://github.com/gabrielcsapo/isthisleafygall.com/issues/new?template=reference-photo.yml) or [report a bug](https://github.com/gabrielcsapo/isthisleafygall.com/issues/new?template=bug-report.yml).

## Photo submissions

Issues and attachments are public. Submit only photos you own, remove location metadata, and keep faces, addresses, plant-supplier disputes, and personal information out of the issue. The inspection page never submits a photo automatically.

Useful submissions include a sharp crown close-up, a view of the full clump, another angle, the growth stage, and follow-up over time. Keep multiple views of the same plant together. White shoots, multiple eyes, or growth after taking cuttings can be normal; include those examples too.

Tell us how the identification was established. A suspected diagnosis, an experienced grower's visual opinion, and a laboratory result are different evidence levels. Lab reports must be redacted before posting. Do not treat a model result as a label.

The submission form asks you to license your original photos and descriptions under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) so the project can use them with attribution. This permission applies to your submission, not to photos owned by other people.

## Review before inclusion

1. Check photo ownership, consent, attribution, and whether evidence supports the proposed label.
2. Group all views of one specimen. Check for duplicate or near-duplicate images and conflicting labels.
3. Keep uncertain and disputed cases out of the accepted reference set. Preserve them as unresolved issues.
4. Record `source_url`, credit, `label_status`, evidence, `group_id`, byte hash, and review date in `data/references.json`. Current published examples are source-checked visual references, not lab-confirmed diagnoses.
5. Run `npm run assets`, `npm run prepare-model`, `npm run refs:validate`, `npm test`, and `npm run refs:evaluate`.
6. Review changes against independent examples and compare both false matches and abstentions. Never test a photo against another view of the same specimen and call that independent validation.
7. Submit a pull request with the changed catalog, generated vectors, evaluation summary, and evidence. A maintainer reviews it before deployment.

The current comparison thresholds are retrieval heuristics, not medical or plant-disease probabilities. Never lower them just to make one submitted example return a desired answer. More references alone do not establish disease-detection accuracy.

## Code changes

Keep the app simple and photo-first. Preserve browser-local inference, accessible controls, visible errors, and privacy. Do not add a photo-upload endpoint or analytics containing image data. Original code is MIT-licensed; third-party models, fonts, and photos retain their own licences.
