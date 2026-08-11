import type { ModelingAssistantController } from './useModelingAssistant';

interface VoiceControlProps {
  visible: boolean;
  controller: ModelingAssistantController;
  onClose: () => void;
}

export function VoiceControl({ visible, controller, onClose }: VoiceControlProps) {
  if (!visible) return null;

  const active = controller.phase !== 'idle' && controller.phase !== 'complete' && controller.phase !== 'error';
  return (
    <section
      className={`voice-control is-visible ${controller.isRecording ? 'is-recording' : ''}`}
      aria-label="Voice assistant control"
    >
      <div className="voice-control-heading">
        <div>
          <strong>Voice control</strong>
          <span>{voiceDetail(controller.phase)}</span>
        </div>
        <button
          type="button"
          className="voice-close"
          aria-label="Hide voice control"
          disabled={active}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="voice-meter" aria-hidden="true">
        {Array.from({ length: 18 }, (_, index) => <span key={index} />)}
      </div>

      <div className="voice-control-actions">
        {active && !controller.isRecording ? (
          <button type="button" className="voice-stop" onClick={controller.cancel}>
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className={controller.isRecording ? 'voice-stop' : 'voice-start'}
            disabled={controller.config?.ready !== true}
            onClick={controller.toggleRecording}
          >
            <span className="voice-record-mark" aria-hidden="true" />
            {controller.isRecording ? 'Stop & send' : 'Start listening'}
          </button>
        )}
        <kbd>Ctrl Shift Space</kbd>
      </div>

      {(controller.voiceNotice || (visible && controller.error)) && (
        <p className={controller.error ? 'voice-error' : ''}>
          {controller.error ?? controller.voiceNotice}
        </p>
      )}
    </section>
  );
}

function voiceDetail(phase: ModelingAssistantController['phase']): string {
  switch (phase) {
    case 'recording': return 'Listening — speak naturally';
    case 'transcribing': return 'Transcribing your request';
    case 'acknowledging': return 'Preparing a short reply';
    case 'speaking': return 'Replying before modeling starts';
    case 'planning': return 'Planning the scene change';
    case 'applying': return 'Applying validated actions';
    case 'complete': return 'Ready for another request';
    case 'error': return 'Request was not applied';
    default: return 'Press the shortcut or start listening';
  }
}
