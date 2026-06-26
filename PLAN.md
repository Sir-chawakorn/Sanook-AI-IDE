# PLAN — Native Auto-Skill-Synthesis (Sanook AI IDE)

> Goal externalized per workflow. Self-pacing, cross-session. Update progress here, not in chat context.

## Mission

Build a **native** subsystem in the Sanook AI IDE fork that detects when a user issues
semantically-similar prompts ~2–3 times and (with approval) synthesizes a reusable
`SKILL.md` — working across **all harnesses** (Claude Code, Codex/ChatGPT, local chat).
This is the Hermes-Agent auto-skill idea, ported native. No competing IDE ships this.

## Chosen architecture — **H1 + seam** (decided after 4-hypothesis workflow)

- **Capture** at the single funnel every harness flows through:
  `IChatService.onDidSubmitRequest` — [chatService.ts:1640](src/vs/workbench/contrib/chat/common/chatService/chatService.ts#L1640)
  (subscribe to ONLY this; `onDidSendRequest` mirrors it → double-count trap at
  [sessionsManagementService.ts:124](src/vs/sessions/services/sessions/browser/sessionsManagementService.ts#L124))
- **Resolve harness/workspace** via `getSessionForChatResource` →
  [sessionsManagement.ts:137](src/vs/sessions/services/sessions/common/sessionsManagement.ts#L137)
- **Cluster** in a pure, swappable `PromptClusterer` (PoC: exact-match; Phase 1: trigram/Jaccard ≥ 0.78, K≥3 across ≥2 sessions)
- **Write** `.agents/skills/<name>/SKILL.md` via the `IFileService` primitive used by
  [saveBuiltinPromptCopy:1812](src/vs/workbench/contrib/chat/browser/aiCustomization/aiCustomizationManagementEditor.ts#L1812)
- **Live registration for free** — `.agents/skills` is already a `recursive` search root at
  [sessionCustomizationDiscovery.ts:118](src/vs/platform/agentHost/node/copilot/sessionCustomizationDiscovery.ts#L118); the existing watcher re-registers.
- **Seam** `ISkillObserverSource` (from H3) so the separate extension-side Claude SDK pipeline can plug in later.

Rejected: H2 (agentHost middleware — chokepoint misses local chat + Claude SDK), H3 (3 adapters = needless dup), H4 (offline — too laggy + ChatSessionStore doesn't cover agent-host). H4's persistence kept as Phase 3.

## Phases

- [x] **Phase 0 — PoC**: exact-match, in-memory, notification → write SKILL.md. 3 files + 1 test + register edit. Scope = Agent Sessions Window. **E2E VERIFIED at runtime (2026-06-25):** dev-trigger fired `recordPrompt`×3 → real notification "Create reusable skill \"refactor-the-auth-module-to-use\"?" → clicked Create → `approveProposal` wrote `.agents/skills/refactor-the-auth-module-to-use/SKILL.md` with correct frontmatter+body. (Throwaway dev-trigger command bypassed only `onDidSubmitRequest`, which is verified by code. Real submit path needs a signed-in harness — Code OSS from-source has no working sign-in.) Committed in `9073812c51f`.
- [ ] **Phase 1**: fuzzy `PromptClusterer` (trigram/Jaccard) + turn-complete gate (`lastTurnEnd >= submittedAt`) + collision check + config flag `sessions.skillSynthesis.enabled` (default false). TDD on clusterer.
- [ ] **Phase 2**: approval UX (QuickInput edit name/desc/scope) + "Never"/cooldown + ≤1 proposal/session.
- [ ] **Phase 3**: persistence via `IStorageService` (WORKSPACE/MACHINE, not synced) + secret/path redaction.
- [ ] **Phase 4**: LLM-authored body (`CustomizationCreatorService.createWithAI`) + `commitFiles` + 2nd observer source for Claude SDK pipeline (exercises seam).

## Phase 0 file set

| File | Status |
|---|---|
| `src/vs/sessions/contrib/skillSynthesis/common/skillSynthesis.ts` | pending |
| `src/vs/sessions/contrib/skillSynthesis/browser/skillSynthesisService.ts` | pending |
| `src/vs/sessions/contrib/skillSynthesis/browser/skillProposalController.ts` | pending |
| edit `src/vs/sessions/contrib/chat/browser/chat.contribution.ts` (register) | pending |

## Open questions to settle in code before Phase 1

1. Does the discovery watcher fire for a brand-NEW depth-2 dir (`.agents/skills/<new>/SKILL.md`)? If not → add `rescan()` after write. (Verify empirically in Phase 0 demo.)
2. Is `.agents/skills` in each active harness's source-folder filter? Derive root from `getPromptFileDefaultLocations(PromptsType.skill)` rather than hardcoding if not.
3. Does `onDidSubmitRequest` fire for the extension-side Claude SDK path when `chat.agents.claude.preferAgentHost=false`?

## Runtime findings from E2E launch demo (2026-06-25)

- ✅ Transpile (`node build/next/index.ts transpile`, ~4s) + launch via `launch` skill works. NOTE: must set `TMPDIR=/tmp` or the AF_UNIX socket path exceeds macOS's 103-char limit and main process crashes (`listen EINVAL .../1.12-main.sock`).
- ✅ Agents window boots WITH the new code; **zero runtime errors** in main log + renderer console → `SkillProposalController` (AfterRestored) + `SkillSynthesisService` (Delayed) register & instantiate cleanly (DI wiring correct at runtime, not just type-level).
- ⚠️ **Q#2 leans NEGATIVE (needs fix):** writing `<ws>/.agents/skills/demo-live/SKILL.md` did NOT increment the Customizations "Skills" panel (stayed 11) even after the workspace was loaded into a session. That panel is powered by the **renderer `IPromptsService`/`PromptFilesLocator`** — a DIFFERENT discovery path from the **node `sessionCustomizationDiscovery`** that I verified includes `.agents/skills`. So the write target is good for *harness bundling*, but may NOT surface as a live slash-command in the renderer panel. Phase 1 MUST: (a) confirm which renderer source folders `IPromptsService` scans for skills, (b) ensure synthesized skills land where BOTH the panel/slash-commands AND harness bundler see them, (c) add an explicit `rescan()`/refresh if the live watcher doesn't fire for new nested dirs.
- ⛔ **Detection→notification→Create UI flow: NOT exercised** — launched profile has "No models available" (signed out). A real prompt submit needs a signed-in harness (Claude Code / ChatGPT). Carry to a signed-in run.

## Verification gate (every phase)

`npm run compile-check-ts-native` clean → `launch` skill → send same prompt 3× → notification → Create → confirm `.agents/skills/<slug>/SKILL.md` on disk → `/` menu shows skill live (no reload).
