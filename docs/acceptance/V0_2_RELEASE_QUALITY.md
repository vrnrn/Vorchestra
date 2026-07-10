# v0.2 release-quality acceptance

This document defines the performance and accessibility evidence required by
V02-T09. Unit checks are supplemented by packaged-application measurements and a
packaged keyboard and VoiceOver walkthrough on supported Apple silicon hardware.

Artifact-integrity evidence and the unsigned installation documentation contract
are defined in [`V0_2_RELEASE.md`](./V0_2_RELEASE.md).

## Representative performance fixture

The canonical test factory is
`apps/desktop/test/fixtures/v0-2-representative-dag.ts`. It produces a valid,
portable schema-v2 workflow with this fixed shape:

- 51 generic process blocks across layers of 8, 16, 16, 8, 2, and 1 blocks
- 58 text-artifact connections
- fan-out from eight sources, a full-width parallel transform layer, then
  two-input and four-input fan-in before the final sink
- explicit deterministic positions for every block
- direct executable-and-argument invocations only; the fixture is never run by
  performance tests

`apps/desktop/test/performance-acceptance.test.ts` locks the topology and gates
three CPU-side editor contracts:

1. The serialized fixture parses, validates, and plans into the expected six
   layers.
2. Two hundred validation, planning, and explicit auto-arrange cycles finish in
   less than 2,000 ms after warm-up.
3. One thousand node-reconciliation updates finish in less than 2,000 ms and
   retain every stable node ID.

Run this evidence with:

```sh
npm test --workspace @vorchestra/desktop -- --run \
  test/performance-acceptance.test.ts
```

The generous batch budgets are intended to catch order-of-magnitude regressions
without turning ordinary differences between supported Macs into flaky failures.

## Packaged-editor performance check

Test the Apple silicon packaged release with the canonical fixture and record
the Mac model, macOS version, architecture, build identity, and measurements.
Acceptance requires:

- the editor shows all 51 canvas nodes and all 51 minimap nodes within two
  seconds after the workflow has been parsed;
- a five-second continuous drag never unmounts a canvas or minimap node;
- sampled animation-frame intervals during that drag have a median no greater
  than 20 ms and a 95th percentile no greater than 34 ms; and
- ten consecutive explicit auto-arrange actions each settle within 250 ms and do
  not run without the user's action.

These are packaged-browser measurements. The jsdom tests do not claim to measure
painting, compositing, Electron startup, or minimap frame rate.

### Recorded Apple silicon measurement

Recorded 2026-07-09 on a `MacBookPro18,3`, macOS 27.0 build 26A5368g, `arm64`,
against the unsigned packaged Vorchestra 0.2.0 application:

- 51 canvas and 51 minimap nodes rendered in 33 ms;
- ten explicit auto-arrange actions took at most 25.3 ms;
- every canvas and minimap node remained mounted throughout a 5.05-second
  pointer drag;
- median sampled frame interval was 10 ms; and
- 95th-percentile sampled frame interval was 10.9 ms.

The reproducible command is:

```sh
npm run desktop:performance:packaged
```

This clears the recovered draft, creates an exact 51-node workflow, measures the
packaged Chromium renderer through CDP, and never launches workflow tools. It
proves the Apple silicon performance threshold on the supported test host.

## Automated accessibility check

`apps/desktop/test/accessibility-acceptance.test.tsx` verifies that:

- the main canvas, workflow-input editor, and local-history regions have stable
  accessible names;
- the primary file, editing, arrangement, block-addition, and run-review
  controls expose names and keyboard focus;
- configuration and run-detail selection is represented with tab semantics;
- the authority review is an identified modal dialog with a heading, explicit
  executable-code warning, labelled trust checkbox, disabled-until-consented run
  action, and labelled close and cancel actions.

Run this evidence with:

```sh
npm test --workspace @vorchestra/desktop -- --run \
  test/accessibility-acceptance.test.tsx
```

## Keyboard and VoiceOver check

Before release, run this checklist against the packaged application using only
the keyboard, then repeat it with macOS VoiceOver enabled:

1. Reach New, Open, Save, Undo, Redo, Copy, Paste, Duplicate, Auto arrange, and
   Review & Run; confirm each action and disabled state is announced.
2. Add both a Process and AI Agent, select either from the canvas, and reach its
   entire configuration without pointer input.
3. Reorder arguments, ports, outputs, and environment entries with the keyboard
   and confirm the new order is announced or otherwise unambiguous.
4. Move between Configure and Run details with standard tab-list keyboard
   behavior, with focus and selection announced.
5. Open Review & Run, confirm focus enters and remains within the dialog, close
   it with Escape, reopen it, review inputs and preflight issues, grant trust,
   and start the run.
6. During a run, confirm state and failure changes are announced without moving
   focus; cancel the run and inspect stdout, stderr, paths, and copy/reveal
   actions.
7. Trigger a validation and preflight issue and confirm its severity, message,
   responsible block, and navigation action are understandable without relying
   on color.

Record the date, tester, macOS and VoiceOver versions, architecture, packaged
build identity, and any exception.

### Recorded packaged walkthrough

Passed 2026-07-09 against the official unsigned Vorchestra 0.2.0 Apple silicon
application on macOS 27.0 build 26A5368g, `arm64`, with VoiceOver 10 enabled.
The application used an isolated disposable user-data profile so the user's
recovered draft remained untouched.

The walkthrough verified the accessible toolbar and disabled states; Process and
AI Agent creation and configuration; keyboard ordering for arguments, ports,
outputs, and environment entries; tab-list selection; authority-dialog focus
containment, Escape, and focus restoration; preflight blocking and manual input
resolution; success, cancellation, and failure announcements; retained run
inspection; stdout and stderr controls; filesystem-reference Copy and Reveal
actions; and failure navigation to the responsible output field.

The 60-second direct `/bin/sleep` invocation was cancelled from the focused
Cancel control. Direct `/usr/bin/printf` produced inspectable stdout. A missing
filesystem-reference binding produced a typed failure; correcting the binding to
an existing directory produced a successful artifact with a labelled Reveal
action. VoiceOver was then verified off, the packaged application exited
normally, and the disposable profile was removed.

This clears the packaged keyboard and VoiceOver gate. Together with the
artifact, migration, packaged smoke/restart, and performance evidence, V02-T09
is accepted.
