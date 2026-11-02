# Help improve Is this leafy gall?

Send photos through the private review form on https://isthisleafygall.com. GitHub remains public for source code, bug reports and code contributions; do not post private review photos or email addresses in issues.

## Review requests

Anyone can submit a photo for a second look, whether the automatic checker finds a match or not. The form asks for an email so the site owner can reply. Photos and contact details are stored privately in Railway and delivered to the review inbox using Resend. Embedded image metadata is removed. There is no account or payment requirement.

The required permission covers ownership/sharing rights and contact about the review. The separate optional training checkbox is unchecked by default. Declining training permission does not prevent review. This grants permission to improve the checker; it does not publicly relicense the photo, and email addresses remain private. The consent wording version and timestamp are recorded with each submission.

## Review before use

- Reply to the visitor from the notification email; its Reply-To is the visitor’s address.
- Keep visual assessment, a suspected condition and laboratory confirmation distinct. A model result is not a ground-truth label.
- Use the owner-only review desk at /admin to record a human category, or the private command documented in README. Record uncertain cases as `unclear`.
- Only explicitly consented, human-labelled cases can be approved in the review desk or exported for training/evaluation. The export excludes email addresses and notes. Normal growth and lookalikes are as important as suspected disease.
- Keep multiple views of the same plant grouped. Exclude disputed or uncertain examples from accepted references, and prevent overlap between reference/training groups and evaluation groups.
- Check rights and evidence again before making any model update. Publishing raw private photos requires separate explicit permission; do not put uploads or exports in this repository.
- Use the private commands to honor permission withdrawals and deletion requests. Remove prior exports and inbox attachments as appropriate.

## Code and reference changes

Preserve on-device automatic inspection and explicit opt-in review uploads. Never include photos, filenames, email addresses, notes or image features in analytics. Original code is MIT licensed; third-party assets and private submissions retain their own rights.

For reference changes, update the source catalog and evidence, run `npm run refs:validate`, `npm test`, `npm run refs:evaluate`, and check both false matches and abstentions on independent examples. Do not lower thresholds simply to force a submitted photo into a desired category. A maintainer reviews changes before the model or vectors are deployed.
