// Shared between speech-recognition.ts (native) and speech-recognition.web.ts.

export type SpeechErrorCode =
  | 'unsupported'   // no engine on this platform/browser
  | 'no-speech'     // it listened, heard nothing
  | 'not-allowed'   // microphone permission denied
  | 'network'
  | 'aborted'       // we stopped it — never surfaced to the user
  | 'unknown';

export interface ListenHandlers {
  /** Words so far, while the person is still speaking. */
  onInterim?: (text: string) => void;
  /** The finished transcript. Called at most once, only when non-empty. */
  onFinal: (text: string) => void;
  onError: (code: SpeechErrorCode, message: string) => void;
  /** Always called last, whether it ended in a transcript, an error, or silence. */
  onEnd?: () => void;
}
