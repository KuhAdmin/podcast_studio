import { useEffect, useRef, useState } from 'react';
import { chunkLines, type ParsedScript } from '../../../shared/script.ts';
import type { Project } from '../../../shared/types.ts';
import { api } from '../api.ts';
import scriptPrompt from '../../../prompts/1-script.md?raw';
import tagsPrompt from '../../../prompts/2-audio-tags.md?raw';
import scenesPrompt from '../../../prompts/3-settings-and-images.md?raw';
import arjunSheet from '../../../characters/arjun.png?url';
import shilpaSheet from '../../../characters/shilpa.png?url';

interface Attachment {
  label: string;
  url: string;
  filename: string;
}

const PROMPTS: { title: string; text: string; attachments?: Attachment[] }[] = [
  { title: '1 · Write the script (with audio tags)', text: scriptPrompt },
  { title: '2 · Add audio tags to an untagged script (optional)', text: tagsPrompt },
  {
    title: '3 · Settings & image prompts',
    text: scenesPrompt,
    attachments: [
      { label: 'Shilpa character sheet', url: shilpaSheet, filename: 'shilpa-character-sheet.png' },
      { label: 'Arjun character sheet', url: arjunSheet, filename: 'arjun-character-sheet.png' },
    ],
  },
];

const PLACEHOLDER = `[SCENE: cozy-studio]
Arjun: [warmly] Hello, everyone! Welcome back to the show.
Shilpa: [laughs] Hello, Arjun! It's lovely to be here again.
[SCENE: city-rooftop]
Arjun: [whispers] Let me tell you a secret…`;

interface Props {
  project: Project;
  parsed: ParsedScript;
  update: (fn: (p: Project) => Project) => void;
  onNext: () => void;
}

export function ScriptStep({ project, parsed, update, onNext }: Props) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const errors = parsed.issues.filter((i) => i.severity === 'error');
  const chars = parsed.lines.reduce((n, l) => n + l.text.length, 0);
  const requests = chunkLines(parsed.lines).length;
  const sceneNames = [...new Set(parsed.scenes.map((s) => s.name))];

  const jumpToLine = (line: number) => {
    const el = editor.current;
    if (!el) return;
    const rows = el.value.split('\n');
    const start = rows.slice(0, line - 1).reduce((n, r) => n + r.length + 1, 0);
    el.focus();
    el.setSelectionRange(start, start + (rows[line - 1]?.length ?? 0));
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24;
    el.scrollTop = Math.max(0, (line - 4) * lineHeight);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Script</h1>
          <p className="muted">
            Paste the tagged script from ChatGPT. Format: <span className="mono">Speaker: text</span> per line, <span className="mono">[SCENE: name]</span> where the setting changes.
          </p>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={onNext} disabled={parsed.lines.length === 0 || errors.length > 0}>
          Next: voices & audio
        </button>
      </header>

      <div className="script-layout">
        <div className="stack">
          <label className="visually-hidden" htmlFor="script">
            Script
          </label>
          <div className="editor-frame">
            <textarea
              id="script"
              ref={editor}
              className="script-editor"
              spellCheck={false}
              value={project.script}
              placeholder={PLACEHOLDER}
              aria-describedby="credit-meter"
              onChange={(e) => update((p) => ({ ...p, script: e.target.value }))}
            />
            <CreditMeter chars={chars} />
          </div>
          <section className="stack" aria-label="ChatGPT prompt templates">
            <h3>ChatGPT prompts</h3>
            {PROMPTS.map((p) => (
              <PromptTemplate key={p.title} title={p.title} text={p.text} attachments={p.attachments} />
            ))}
          </section>
        </div>

        <aside className="stack">
          <div className="stat-grid">
            <Stat label="Lines" value={parsed.lines.length} />
            <Stat label="Speakers" value={parsed.speakers.length} />
            <Stat label="Scenes" value={sceneNames.length} />
            <Stat label="TTS requests" value={requests} hint={`${chars.toLocaleString()} chars`} />
          </div>

          {parsed.speakers.length > 0 && (
            <div className="stack" style={{ gap: 'var(--s2)' }}>
              <h3>Speakers</h3>
              <div className="row" style={{ gap: 'var(--s2)' }}>
                {parsed.speakers.map((s) => (
                  <span key={s} className="chip">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
          {sceneNames.length > 0 && (
            <div className="stack" style={{ gap: 'var(--s2)' }}>
              <h3>Scenes</h3>
              <div className="row" style={{ gap: 'var(--s2)' }}>
                {sceneNames.map((s) => (
                  <span key={s} className="chip mono">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="stack" style={{ gap: 'var(--s2)' }}>
            <h3>Checks</h3>
            {parsed.issues.length === 0 ? (
              <div className="notice notice-success">{parsed.lines.length ? 'Script looks good.' : 'Waiting for a script.'}</div>
            ) : (
              <ul className="issue-list">
                {parsed.issues.map((issue, i) => (
                  <li key={i}>
                    <button className={`notice issue notice-${issue.severity}`} onClick={() => jumpToLine(issue.sourceLine)}>
                      <span>
                        <strong>Line {issue.sourceLine}:</strong> {issue.message}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

type Quota = { remaining: number; resetsAt: string | null } | null;

/** Characters this script will bill and the ElevenLabs balance left afterwards. */
function CreditMeter({ chars }: { chars: number }) {
  const [quota, setQuota] = useState<Quota | undefined>(undefined); // undefined = loading, null = unavailable

  useEffect(() => {
    const load = () => api.quota().then(setQuota).catch(() => setQuota(null));
    load();
    // The balance changes when audio is generated elsewhere; refresh when the tab regains focus.
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, []);

  const after = quota ? quota.remaining - chars : null;
  const short = after !== null && after < 0;

  return (
    <div
      id="credit-meter"
      className="editor-footer"
      data-short={short}
      title="Billed: the spoken text of every line, including [audio tags]. Speaker names and [SCENE] lines are not sent to ElevenLabs."
    >
      <span>
        <strong>{chars.toLocaleString()}</strong> characters will be used
      </span>
      <span className="spacer" />
      {quota === undefined ? (
        <span>Checking ElevenLabs balance…</span>
      ) : quota === null ? (
        <span>ElevenLabs balance unavailable</span>
      ) : short ? (
        <span className="balance" role="status">
          ⚠ Not enough credits: <strong>{quota.remaining.toLocaleString()}</strong> left, short by <strong>{(-after!).toLocaleString()}</strong>
        </span>
      ) : (
        <span className="balance">
          Balance <strong>{quota.remaining.toLocaleString()}</strong> → <strong>{after!.toLocaleString()}</strong> left after generating
        </span>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span className="muted small">
        {label}
        {hint && ` · ${hint}`}
      </span>
    </div>
  );
}

function PromptTemplate({ title, text, attachments }: { title: string; text: string; attachments?: Attachment[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <details className="prompt">
      <summary>
        {title}
        <span className="spacer" />
        <button
          className="btn btn-sm"
          onClick={async (e) => {
            e.preventDefault();
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </summary>
      {attachments && (
        <div className="prompt-attachments">
          <span className="muted small">Attach both to ChatGPT with this prompt:</span>
          {attachments.map((a) => (
            <a key={a.url} className="attachment" href={a.url} download={a.filename}>
              <img src={a.url} alt="" />
              <span>⬇ {a.label}</span>
            </a>
          ))}
        </div>
      )}
      <pre>{text}</pre>
    </details>
  );
}
