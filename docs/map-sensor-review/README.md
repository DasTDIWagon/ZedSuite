# MAP calibration review: 25 EDC15 reference versions



This is an experimental hardware-sensor calibration tool for maintainer review. It is not a new ECU-family detector or a proposal to merge the earlier multimap/bank-copy work. This fork branch preserves the contributor's complete tested app, including earlier experimental changes. Per CONTRIBUTING.md, the hardware-conversion UI remains in the fork pending an integration decision. A separate upstream draft covers only checksum layout selection/counting and unknown-layout verification.



No ECU binaries, mappacks, executable builds, private paths or downloaded datasheets are committed. Corpus.json identifies the source archives and exact payload hashes. Originality labels are source claims, not a guarantee of factory provenance.



Reproduction (from the repository root, after installing dependencies):



```text

node tests/map-sensor.cjs

node tests/edc15-checksum-layouts.cjs

npm run test:bank-copy

node tests/map-sensor-corpus.cjs docs/map-sensor-review/Corpus.json <reference-directory> <results.json>

npx tsc --noEmit

cargo test --manifest-path src-tauri/Cargo.toml --lib

npm run build

```



The reference-directory must contain the files at the relative paths listed by Corpus.json. The source archives contain ZIP/RAR members with different names: identify the raw payload by SHA-256 before placing it at that path. The corpus test checks every hash before applying a test edit and never writes the input files. It checks full 16-bit ADC values, pressure values, diagnostic fields, bank isolation, byte changes and restoration. Optional results.json is its only file output.



Results: 180 real-file cases, 23 sensor-tool checks, 3 standalone checksum checks, 26 bank-copy/control checks, TypeScript, frontend/native build, and 66 Rust library tests pass. The complete maintainer-owned benchmark, final interactive native-app session, vehicle tests and broader firmware coverage remain outstanding. Edited test images are generated in memory; the 25 source candidates have not been independently proven untouched OEM.



## Changes



- Added sensor-curve record headers for GK KD34, HA4922 and the AB1071/LP1596 ANU files. Existing ADC/mV and pressure plausibility checks, per-bank uniqueness checks and stale-preview rejection remain enforced.

- Added the observed AB/LP diagnostic descriptor layouts and their distinct, fully contextual pressure-scalar patterns. These are structure searches, not fixed-offset writes or bare 980/18-FF searches.

- Fixed AB1071 checksum layout selection: its legacy single-bank structure uses standard tdi41 calibration checksums despite having a V4.1 marker. The original three populated checksum entries validate with that method, and converted outputs validate after correction. The structural rule stays stable when calibration bytes change.

- Checksum counts now exclude unused C3 padding entries. Previously reported 6/7 compact-layout results become 6/6 populated entries, without modifying the input files. Unknown layouts retain TYPE_ERROR instead of being incorrectly shown as OK.



## Validation



All 25 supplied collection references now expose both sensor conversion and VCDS diagnostic adjustment across all 55 expected bank records. This establishes support for these exact software versions and file layouts, not every EDC15 file.



- 180 real-file cases passed: 75 all-bank preset cases (stock, Bosch 0281002401 3-bar, Bosch 0281006059 4-bar), 55 individual-bank cases, and 50 sensor-only/diagnostic-only cases.

- Each case checks requested values, unrelated-byte preservation, selected-bank isolation, checksum correction and verification, and exact restoration of the original file before and after checksum correction. The stock preset is a byte-for-byte no-op.

- All original input hashes were checked and all source files remain unchanged. No tuned ECU binaries are included in this package.

- 23 MAP-tool regression checks and 26 earlier bank-copy/control checks passed. TypeScript, frontend build and Windows native build passed.

- The four newly supported layouts are tested with relocated synthetic patterns, edited values and damaged-context rejection. Unknown checksum layouts and legacy checksum selection are covered by regression checks.

- No final interactive native-app session or vehicle operation was tested. This is an offline-tested build, not proof of factory provenance or vehicle-specific installation compatibility.



## Per-file results



Changed-byte counts below are calibration bytes across all present banks, before checksum correction. All stock cases change zero bytes. Checksum ratios are populated entries after correction and are the same on the original inputs with the corrected layout selection.



| ECU | Software | Banks | Stock bytes | 3-bar bytes | 4-bar bytes | Checksums | Method |

|---|---|---:|---:|---:|---:|---|---|

| 038906012FD | 4102 | 3 | 0 | 30 | 42 | 11/11 | tdi41_2002 |

| 038906012GN | 4308 | 2 | 0 | 20 | 28 | 8/8 | tdi41_2002 |

| 038906012GQ | 4307 | 2 | 0 | 20 | 28 | 8/8 | tdi41_2002 |

| 038906012F | 3313 | 3 | 0 | 30 | 42 | 11/11 | tdi41_2002 |

| 038906012F | 3331 | 3 | 0 | 30 | 42 | 11/11 | tdi41_2002 |

| 038906012FH | 3537 | 2 | 0 | 20 | 28 | 8/8 | tdi41_2002 |

| 038906012FN | 3358 | 2 | 0 | 20 | 28 | 8/8 | tdi41_2002 |

| 038906012H | 3315 | 3 | 0 | 30 | 42 | 11/11 | tdi41_2002 |

| 038906012H | 3332 | 3 | 0 | 30 | 42 | 11/11 | tdi41_2002 |

| 038906012AF | 2825 | 2 | 0 | 20 | 28 | 6/6 | tdi41v2 |

| 038906012AJ | 2829 | 2 | 0 | 20 | 28 | 6/6 | tdi41v2 |

| 038906012B | 2802 | 2 | 0 | 20 | 28 | 6/6 | tdi41v2 |

| 038906012C | 2803 | 2 | 0 | 20 | 28 | 6/6 | tdi41v2 |

| 038906012CP | 2839 | 3 | 0 | 30 | 42 | 7/7 | tdi41v2 |

| 038906012Q | 2818 | 2 | 0 | 20 | 28 | 6/6 | tdi41v2 |

| 038906012BD | 2507 | 3 | 0 | 30 | 42 | 7/7 | tdi41v2 |

| 038906012M | 2528 | 2 | 0 | 20 | 28 | 6/6 | tdi41v2 |

| 038906012GK | KD34 | 2 | 0 | 20 | 28 | 8/8 | tdi41_2002 |

| 038906019AB | 1071 | 1 | 0 | 10 | 14 | 3/3 | tdi41 |

| 038906019LP | 1596 | 1 | 0 | 10 | 14 | 5/5 | tdi41_2002 |

| 038906012AJ | 2707 | 2 | 0 | 20 | 28 | 6/6 | tdi41v2 |

| 038906012S | 2512 | 2 | 0 | 20 | 28 | 6/6 | tdi41v2 |

| 038906012BS | 2804 | 2 | 0 | 20 | 28 | 6/6 | tdi41v2 |

| 038906012CA | 2806 | 2 | 0 | 20 | 28 | 6/6 | tdi41v2 |

| 038906012HA | 4922 | 2 | 0 | 20 | 28 | 8/8 | tdi41_2002 |



## Newly supported offsets



| ECU / software | Sensor input | Sensor pressure | VCDS format/multiplier bytes | VCDS scalar |

|---|---|---|---|

| 038906012GK / KD34 | 0x0549EC | 0x0549F0 | 0x053642, 0x053646, 0x05366E | 0x0539FC |

| 038906012GK / KD34 | 0x0749EC | 0x0749F0 | 0x073642, 0x073646, 0x07366E | 0x0739FC |

| 038906019AB / 1071 | 0x07850A | 0x07850E | 0x076C2A, 0x076C2E, 0x076C56 | 0x076FF0 |

| 038906019LP / 1596 | 0x06F478 | 0x06F47C | 0x0731B4, 0x0731B8, 0x0731E0 | 0x07356E |

| 038906012HA / 4922 | 0x054A82 | 0x054A86 | 0x053722, 0x053726, 0x05374E | 0x053AA0 |

| 038906012HA / 4922 | 0x074A82 | 0x074A86 | 0x073722, 0x073726, 0x07374E | 0x073AA0 |



## Source and reproduction



The source archive contains corresponding source, GPL licence and regression tests. The incremental patch applies to the source in `ZedSuite-MAP-sensor-v2-BD-source.zip` from this chat. The JSON results include original SHA-256 identities, exact detected offsets, preset byte counts and checksum results. Earlier audit reports describe the older detector and are superseded by these v3 results.



```text

npm run test:map-sensor

npm run test:bank-copy

npx tsc --noEmit

npm run build

npm run app:build

```

