# Curation

Trust labels, applied by maintainers. Nothing is here yet, and that is deliberate.

A label is only worth having if it means the same thing every time it is applied, and the thresholds
have not been decided — see the open questions in the top-level README. Shipping an empty folder
with a name is cheaper to correct than shipping labels that turn out to mean "whatever the reviewer
felt that day".

Two things are already fixed about whatever lands here:

- **Labels are not submittable.** Anyone may add or correct a record in `registry/`; nobody may
  label their own. This folder is owned in CODEOWNERS and always will be.
- **A label is pinned to what was reviewed.** If a record changes after a reviewer approved it, the
  label falls. A label attached to a slug rather than to a version of a record is a label that keeps
  vouching for something nobody read.
