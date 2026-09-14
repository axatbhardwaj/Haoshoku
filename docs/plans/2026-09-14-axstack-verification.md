# Axstack migration verification matrix

Derived from [approved spec r2](https://github.com/axatbhardwaj/Haoshoku/issues/63). This matrix describes required checks; none is a claimed pass. T1's author owns behavior tests for its candidate, T2/T3 own their affected tests, T4 verifies integration, and T5/T6 own per-host execution evidence.

| ID | Observable setup | Required outcome | Primary owner |
| --- | --- | --- | --- |
| I01 | Instruction file absent | One valid block at resolved path; correct permissions | T1 |
| I02 | Personal instruction file without block | Append once; existing bytes preserved | T1 |
| I03 | Owned unchanged block; repeat identical install | No byte/config/manifest drift | T1 |
| I04 | Owned block changed by feature upgrade | Only owned block changes; pointers remain correct | T1 |
| I05 | User-edited or unowned matching-looking block | Preserve and report conflict; no force adoption | T1 |
| I06 | Duplicate, nested or unterminated markers | Refuse before any partial mutation | T1 |
| I07 | Symlinked instruction file or unsafe destination | Refuse; link target untouched | T1 |
| I08 | Existing pre-feature manifest | Compatible ownership remains valid; old hash semantics preserved | T1 |
| I09 | Install followed by uninstall | Outside bytes/mode preserved; only owned block/separation removed | T1 |
| I10 | Concurrent instruction edit before commit | Detect conflict; preserve external edit | T1 |
| I11 | Failure during combined skill/profile/instruction write | Rollback this attempt; explicit incomplete recovery if restoration fails | T1 |
| H01 | Fresh disposable Arch/Debian home with mocked installers | Only agreed tools/dependencies and Axstack setup requested | T2 |
| H02 | Wrong digest, failed download or Axstack setup failure | Non-success; no destructive legacy retirement | T2 |
| H03 | Newer/user-managed installation or conflicting manifest | Preserve; report actionable condition, no silent downgrade | T2 |
| H04 | Profile binding already in shared skills manifest | No second ownership binding from harness targets | T2 |
| H05 | Repeated successful setup/update | Idempotent; no old policy restored | T2/T4 |
| H06 | Old flags and default OS branches | Actionable retirement result; no removed helper calls | T3 |
| H07 | Package content inspection | No old skills/policy/automation payload shipped | T3/T4 |
| H08 | Mixed desktop/editor files | Only approved AI entries changed; general settings retained | T3 |
| H09 | Profiles written but runtime reload deferred | Deferred activation reported distinctly from usable runtime | T2/T4 |
| M01 | Known retired role with matching shipped bytes | Eligible only after replacement and consumer checks | T4/T5/T6 |
| M02 | Matching name/marker but unknown ownership | Preserve and record incomplete retirement | T4/T5/T6 |
| M03 | Mapped schedule has changed purpose/dependencies | Preserve/hold; mapping alone does not cause deletion | T4/T6 |
| M04 | Schedule pause/delete response uncertain | Read actual state; no blind recreate or retry | T4/T6 |
| M05 | Active service supports current work/transport | Hold affected retirement; retain Paseo connectivity | T4/T5/T6 |
| M06 | Restore meets concurrent host change | Do not overwrite newer state; record recovery hold | T4/T5/T6 |
| M07 | Final IO/VPS state | Independent CLI, discovery, profile, connectivity and disposition evidence | T5/T6 |

Normal behavior changes require a real observed failure before production code changes, followed by green evidence. A missing import/module is not behavioral red. Keep baseline/holdout expectations stable. Docs and this matrix are planning artifacts, not test execution.

At each final candidate revision, run the repository's full tests and applicable lint/format checks, inspect package contents, measure the complete PR against its actual base, and obtain independent review using author provenance. Record environment-dependent or unavailable checks explicitly. A feature-release URL is pinned only after its existence, bytes and digest are verified; test fixtures must not depend on a future or moving latest release.
