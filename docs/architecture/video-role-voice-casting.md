# Role Voice Casting

The video workspace stores `voiceCasting` in the existing pipeline JSON. Analysis uses the authorized desktop model gateway. It returns roles, catalog voice IDs, reasons and shot-bound dialogue; the service rejects invented voices, duplicate IDs and changed or missing dialogue.

Candidate speech is imported as a new project audio file. Generating a candidate does not update the timeline. The user confirms role voices, selects line versions, previews a scene and explicitly applies that scene to its audio track. Earlier candidate files remain available. Scene assembly preserves gain and channel order, resampling to 48 kHz PCM for concatenation.

Windows synthesis routes explicit Kokoro voices to Kokoro and MiniMax profiles to the gateway. A remote failure returns an error instead of substituting a local speaker. MiniMax profiles currently share one known speaker identity; they are not presented as three distinct speakers.

## Verification

- `node scripts/test-video-voice-casting.mjs`: analysis validation, PCM encoding, and provider identity tests.
- Materialized desktop `node scripts/test-electron-voice-casting.mjs`: real Electron/preload/IPC/model fixture integration; this is not a visible UI acceptance test.
- Set `NEWBRAIN_VOICE_LIVE=1`, `NEWBRAIN_E2E_MODEL_CONFIG_PATH` and `NEWBRAIN_E2E_COPY_LIVE_AUTH=1` for an isolated live analysis and synthesis probe. Credentials are not logged.

## Outstanding Acceptance

Visible user operation, full restart restoration and MSI-installed behavior require acceptance. Direction text currently records a director suggestion, not synthesized emotion control. There is no implemented voice cloning or reference-WAV matching. The offline catalog lists supported assets; generation reports an error when an asset is missing. Other platform native voice services have not been brought to Windows parity.
