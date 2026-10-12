# GN / GQ / GK / FD developer update

This consolidated patch contains the EDC15VM detection fixes and the experimental **Multi-Map Beta** Tools option, plus **ECU Compatibility** reference. It targets upstream ZedSuite 1.2.6 commit `77d75fb9e28df04379fd6d1912197947f1cce0c0`. The four existing files changed by the patch match that commit's Git blob hashes exactly; four files are new. Firmware support is limited to inspected GN4308, FD4102, GQ4307 and GK KD34 profiles. No additional ECU conversion is included.

## Apply

Use a clean checkout at the stated commit. Apply this full patch once; do not stack it with the older custom patches. If a developer's branch already contains these changes, review and port the relevant hunks instead.

```powershell
git apply --check ZedSuite_1.2.6_GN_GQ_GK_FD_Full_Update.patch
git apply ZedSuite_1.2.6_GN_GQ_GK_FD_Full_Update.patch
git diff --check
git diff
npm install
npx tsc --noEmit
npm run app:dev
```

The patch includes detector revision 52 to trigger refresh through the existing detection-version flow. It does not change the product version from 1.2.6. A maintainer should choose a new detection revision if their branch has already advanced beyond 52.

## Package contents

- `Developer_Dump_Log.txt`: current findings, changes, verification results and limits.
- `Map_Dump.json`: hashes and selected map metadata from seven inspected GN/GQ/GK/FD files; no ROM contents or local user paths.
- `Multimap_Validation.json`: 24 baseline conversion cases, 36 explicit-source cases, 8 saved/working cases, and 79 rejection checks against the actual module and checksum source.
- `Source_Manifest.json`: upstream baseline blob hashes and updated source hashes.
- `source/`: snapshots of the eight changed files for code review.
- `verify-multimap.cjs` and `fixtures.example.json`: reproducible offline validation. Install the source checkout's dependencies, supply your own corresponding ECU fixtures, then run `node verify-multimap.cjs <source-root> <fixtures.json>`.
- `evidence/`: older detailed diagnostic reports. Their historical counts/build results are separate from today's fresh checks.

## Behavior and review limits

The Tools option requires an editable version, independent explicit choices for vehicle configuration and source code block, and a beta acknowledgement. The user chooses the actual tuned CB1, CB2 or CB3 source; a factory SG/AG marker does not identify tuning status. Empty/unsupported source banks are refused. No stock tables are downloaded or substituted. Manual/automatic vehicle choice does not convert transmission-specific settings. Marker mismatches are disclosed. Automatic requires the experimental brake + SET selector. No verified 4×4 profile is available; FD's middle ID-4 bank is marked AG and is not assumed to be 4×4.

All-bank mode copies the chosen source to CB1/CB2/CB3, preserves the first/final selector IDs and sets the middle ID to 3. It overwrites the other banks' configuration and tuning. Only manual with CB1 source permits partial mode, copying CB1 into CB2 and retaining CB3. Source table sizes and axes are preserved, whether SG 9×9 or AG 9×8 Start IQ. No table is resized in place.

**Include unsaved edits** defaults to checked and uses the working snapshot. Unchecked reconstructs the selected version's saved tune, not Ori/stock. Failed saved-data reads abort. Excluded unsaved edits are discarded on applying the replacement, with a warning in the dialog. The result is staged as a complete byte delta against the raw imported/original version base; old cell/axis overlays are cleared so they cannot reapply a stale target tune over the clone.

**ECU Compatibility** lists the eleven exact main-program groups from the prior 146-unique-payload comparison, including full ECU identities, inspected software versions, bank spacing, and converter scope. The grouping region excludes lower identification/checksum areas and differs from the converter's stricter fingerprint. Other groups are informational; no additional conversion profiles are enabled. Matching program bytes does not establish interchangeability or flash safety.

The selector is inherited from the supplied GN donor. There is no explicit engine-off guard in that routine; engine-off behavior elsewhere has not been established. This refresh corrects the UI to describe a press-and-release action, require engine-stopped use, disclose the missing guard, and avoid claiming verified bank-number correspondence from the tach indication. These are wording changes, not a newly implemented gate.

Brake + cruise SET and GK runtime behavior remain unverified. GK has a separate fingerprint, identities, bank IDs and checksum compensation; this is not proof that every GK ECU works. Correct checksum results and the user's report of a working GN file do not establish vehicle compatibility for other files. Independent ECU/bench validation is still required before a maintainer treats the feature as validated.

The update includes no ECU binaries or new installer. The prior installer predates the latest warning text and should not be presented as built from this exact patch. Today's checks include a complete Rust test run (64 library tests plus two local fixture tests), TypeScript checks and binary conversion checks; the frontend production export passed, but no fresh Windows installer or vehicle test was performed.
