import { useEffect, useState } from "react";

export default function PromptHistory({ messages, sessionId, onSelect }) {
  const [state, setState] = useState('open');
  const [previewId, setPreviewId] = useState(null);
  const prompts = messages.filter(message => message.role === 'user');
  const preview = prompts.find(message => message.id === previewId);
  useEffect(() => { setPreviewId(null); }, [sessionId, state]);
  if (!prompts.length) return null;
  if (state === 'closed') return <button type="button" className="prompt-history-launcher" onClick={() => setState('open')} aria-label="Open prompt history">↺</button>;
  return <aside className={`prompt-history ${state}`} aria-label="Prompt history" onMouseLeave={() => setPreviewId(null)} onKeyDown={event => { if (event.key === 'Escape') setPreviewId(null); }}>
    <div className="prompt-history-header">
      <button type="button" className="prompt-history-title" onClick={() => setState(state === 'open' ? 'minimized' : 'open')} aria-expanded={state === 'open'}>↺ Prompts <span>{prompts.length}</span></button>
      <button type="button" onClick={() => setState(state === 'open' ? 'minimized' : 'open')} aria-label={state === 'open' ? 'Minimize prompt history' : 'Expand prompt history'}>{state === 'open' ? '−' : '+'}</button>
      <button type="button" onClick={() => setState('closed')} aria-label="Close prompt history">×</button>
    </div>
    {state === 'open' && <ol className="prompt-history-list">
      {prompts.map((message, index) => <li key={message.id}>
        <button type="button" onClick={() => { setPreviewId(null); onSelect(message.id); }} onMouseEnter={() => setPreviewId(message.id)} onFocus={() => setPreviewId(message.id)} onBlur={() => setPreviewId(null)} aria-describedby={previewId === message.id ? 'prompt-history-preview' : undefined}>
          <span className="prompt-number">{index + 1}</span><span>{message.content || 'Attached image'}</span>
        </button>
      </li>)}
    </ol>}
    {state === 'open' && preview && <div id="prompt-history-preview" className="prompt-history-preview" role="tooltip" onMouseEnter={() => setPreviewId(preview.id)} onMouseLeave={() => setPreviewId(null)}><strong>Prompt {prompts.indexOf(preview) + 1}</strong><div>{preview.content || 'Attached image'}</div>{preview.attachments?.length > 0 && <small>{preview.attachments.length} attachment(s)</small>}</div>}
  </aside>;
}
