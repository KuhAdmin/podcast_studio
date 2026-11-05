import { useEffect, useState } from 'react';
import type { Project, RenderState } from '../../../shared/types.ts';
import { api, fileUrl } from '../api.ts';

const POLL_MS = 1000;

export function ExportStep({ project, flush }: { project: Project; flush: () => Promise<void> }) {
  const [status, setStatus] = useState<RenderState>({ state: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const running = status.state === 'bundling' || status.state === 'rendering';

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const s = await api.renderStatus(project.id);
        if (cancelled) return;
        setStatus(s);
        if (s.state === 'bundling' || s.state === 'rendering') timer = window.setTimeout(poll, POLL_MS);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [project.id, running]);

  const start = async () => {
    setError(null);
    try {
      await flush(); // render from the latest saved timeline + settings
      setStatus(await api.startRender(project.id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const progress = status.state === 'rendering' ? status.progress : 0;
  const srtUrl = `/api/projects/${project.id}/captions.srt`;
  const videoUrl = status.state === 'done' ? `${fileUrl(project.id, status.file)}?v=${encodeURIComponent(status.finishedAt)}` : null;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Render</h1>
          <p className="muted">Renders a 1920×1080, 30 fps H.264/AAC MP4, ready for YouTube.</p>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={start} disabled={running || !project.audio}>
          {running && <span className="spinner" aria-hidden />}
          {running ? 'Rendering…' : status.state === 'done' ? 'Render again' : 'Render MP4'}
        </button>
      </header>

      {!project.audio && <div className="notice notice-warning">Generate the audio first.</div>}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {status.state === 'error' && (
        <div className="notice notice-error" role="alert">
          Render failed: {status.message}
        </div>
      )}

      {running && (
        <section className="panel stack" aria-live="polite">
          <div className="row">
            <strong>{status.state === 'bundling' ? 'Preparing renderer…' : 'Rendering frames'}</strong>
            <span className="spacer" />
            <span className="mono">{Math.round(progress * 100)}%</span>
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <div style={{ width: `${progress * 100}%` }} />
          </div>
          <p className="muted small">The first render downloads a headless browser and bundles the video, which takes longer.</p>
        </section>
      )}

      {videoUrl && (
        <section className="panel stack" aria-labelledby="result-heading">
          <div className="row">
            <h2 id="result-heading">Your video</h2>
            <span className="spacer" />
            <a className="btn" href={srtUrl} download={`${project.id}.srt`}>
              Download subtitles (.srt)
            </a>
            <a className="btn" href={videoUrl} download={`${project.id}.mp4`}>
              Download MP4
            </a>
          </div>
          <video className="export-video" src={videoUrl} controls />
          <p className="muted small mono">projects/{project.id}/{status.state === 'done' && status.file}</p>
        </section>
      )}

      <section className="panel stack" aria-labelledby="next-heading">
        <h2 id="next-heading">After rendering</h2>
        <ol className="checklist">
          <li>Watch it through once — check that the audio stays in sync to the end.</li>
          <li>Optional: open the MP4 in OpenShot for an intro/outro or B-roll.</li>
          <li>Upload to YouTube (start as Unlisted to check processing).</li>
          <li>
            In YouTube Studio → Subtitles, upload the{' '}
            {project.audio ? (
              <a href={srtUrl} download={`${project.id}.srt`} style={{ color: 'var(--accent)' }}>
                subtitle file (.srt)
              </a>
            ) : (
              'subtitle file (.srt)'
            )}{' '}
            so viewers can turn captions on, translate them and find the video by its words.
          </li>
        </ol>
      </section>
    </div>
  );
}
