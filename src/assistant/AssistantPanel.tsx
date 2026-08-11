import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ModelingAssistantController } from './useModelingAssistant';

/**
 * THESIS: Assistant work reads as an editor operation log, never a chatbot bolted onto the viewport.
 * OWN-WORLD: Flat graphite rows, orange selection, olive completion, 1px dividers, and compact system type.
 * STORY: Describe a scene change, watch its constrained stages, inspect the applied actions, and undo safely.
 * FIRST VIEWPORT: The 3D canvas remains dominant; Assistant occupies the existing right inspector only.
 * FORM: Approved Superdesign-inspired Blender workbench, adapted to AirCad's established shell and controls.
 */
interface AssistantPanelProps {
  controller: ModelingAssistantController;
  canUndo: boolean;
  onUndo: () => void;
}

export function AssistantPanel({ controller, canUndo, onUndo }: AssistantPanelProps) {
  const [instruction, setInstruction] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [controller.entries]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const value = instruction.trim();
    if (!value || controller.isBusy) return;
    setInstruction('');
    void controller.submitText(value);
  };

  return (
    <div className="assistant-panel-content">
      <div className="assistant-status-row" role="status" aria-live="polite">
        <strong className={`assistant-phase phase-${controller.phase}`}>
          {phaseLabel(controller.phase)}
        </strong>
        <span>{phaseDetail(controller.phase)}</span>
      </div>

      {controller.config === null ? (
        <div className="assistant-setup is-checking">
          <strong>Checking provider setup…</strong>
        </div>
      ) : !controller.config.ready && (
        <div className="assistant-setup">
          <strong>Provider setup needed</strong>
          <p>Add the OpenRouter and NVIDIA keys to <code>.env</code>, then restart AirCad.</p>
        </div>
      )}

      <div className="assistant-log" ref={logRef} aria-label="Assistant operation log">
        {controller.entries.length === 0 ? (
          <div className="assistant-empty">
            <strong>Describe a modeling change</strong>
            <p>Create, select, move, rotate, scale, delete, or combine existing solids.</p>
            <span>Voice control: View menu or Ctrl + Shift + Space</span>
          </div>
        ) : controller.entries.map((entry) => (
          <article key={entry.id} className={`assistant-entry entry-${entry.kind}`}>
            <div className="assistant-entry-heading">
              <span>{entryLabel(entry.kind)}</span>
              {entry.meta && <span>{entry.meta}</span>}
            </div>
            <p>{entry.text}</p>
          </article>
        ))}
      </div>

      {controller.entries.some((entry) => entry.kind === 'result') && (
        <div className="assistant-result-actions">
          <span>Last change is reversible</span>
          <button type="button" disabled={!canUndo || controller.isBusy} onClick={onUndo}>
            Undo
          </button>
        </div>
      )}

      {(controller.error || controller.voiceNotice) && (
        <div className={`assistant-notice ${controller.error ? 'is-error' : ''}`}>
          <span>{controller.error ?? controller.voiceNotice}</span>
          {controller.error && (
            <button type="button" onClick={controller.retry} disabled={controller.isBusy}>
              Retry
            </button>
          )}
        </div>
      )}

      <form className="assistant-composer" onSubmit={handleSubmit}>
        <label htmlFor="assistant-instruction">Modeling instruction</label>
        <textarea
          id="assistant-instruction"
          value={instruction}
          disabled={controller.isBusy || controller.config?.ready !== true}
          maxLength={1_200}
          rows={3}
          placeholder="Describe what to model…"
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="assistant-composer-actions">
          <span>Enter to send · Shift+Enter for a new line</span>
          {controller.isBusy ? (
            <button type="button" className="assistant-cancel" onClick={controller.cancel}>
              Cancel
            </button>
          ) : (
            <button
              type="submit"
              className="assistant-send"
              disabled={!instruction.trim() || controller.config?.ready !== true}
            >
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function phaseLabel(phase: ModelingAssistantController['phase']): string {
  switch (phase) {
    case 'recording': return 'Listening';
    case 'transcribing': return 'Transcribing';
    case 'acknowledging': return 'Preparing reply';
    case 'speaking': return 'Speaking';
    case 'planning': return 'Planning';
    case 'applying': return 'Applying';
    case 'complete': return 'Done';
    case 'error': return 'Needs attention';
    default: return 'Ready';
  }
}

function phaseDetail(phase: ModelingAssistantController['phase']): string {
  switch (phase) {
    case 'recording': return 'Ctrl+Shift+Space to send';
    case 'transcribing': return 'Converting voice to text';
    case 'acknowledging': return 'Making a short prompt-aware reply';
    case 'speaking': return 'Modeling starts when playback begins';
    case 'planning': return 'Building a constrained action plan';
    case 'applying': return 'Validating and updating the scene';
    case 'complete': return 'Scene updated';
    case 'error': return 'Nothing was partially applied';
    default: return 'Constrained scene actions';
  }
}

function entryLabel(kind: ModelingAssistantController['entries'][number]['kind']): string {
  switch (kind) {
    case 'user': return 'You';
    case 'acknowledgement': return 'Assistant';
    case 'result': return 'Done';
    case 'error': return 'Error';
  }
}
