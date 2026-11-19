import { useMemo, useRef, useState } from 'react';
import { parseRotaFile, toRotaFile, type RotaFile, type Setup } from '../model/io';
import { slotCount } from '../model/match';
import { hardBreaks, validate } from '../model/validate';
import { rotationGraphBlob } from '../share/png';
import { whatsappText } from '../share/whatsapp';
import { reference } from './store';
import { ByTime, RotationGraph, Shifts } from './RotaViews';

interface Props {
  setup: Setup;
  replace: (s: Setup) => void;
  goOptions: () => void;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function ShareScreen({ setup, replace, goOptions }: Props) {
  const [title, setTitle] = useState('Match rota');
  const [flash, setFlash] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { settings } = setup;
  const rota = setup.rota && setup.rota.length === slotCount(settings.match) ? setup.rota : null;
  const text = useMemo(() => (rota ? whatsappText(rota, settings, title) : ''), [rota, settings, title]);
  const hard = useMemo(() => (rota ? hardBreaks(validate(rota, settings, setup.constraints)) : []), [rota, settings, setup.constraints]);

  const say = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 2500);
  };

  const savePng = async () => {
    if (!rota) return;
    const blob = await rotationGraphBlob(rota, settings, title);
    const file = new File([blob], 'rota.png', { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title });
        return;
      } catch {
        /* cancelled: fall back to download */
      }
    }
    download(blob, 'rota.png');
  };

  const exportJson = () => {
    const json = JSON.stringify(toRotaFile(setup, title), null, 2);
    download(new Blob([json], { type: 'application/json' }), 'rota-setup.json');
  };

  const importJson = async (file: File) => {
    try {
      const parsed = parseRotaFile(JSON.parse(await file.text()) as RotaFile);
      if (!parsed.settings.squad.length) throw new Error('no squad');
      if (!confirm(`Load “${file.name}”? This replaces your squad, match settings and rules${parsed.rota ? ' and the current rota' : ''}.`)) return;
      replace({ ...parsed, constraints: parsed.constraints.length ? parsed.constraints : setup.constraints });
      say('Setup loaded.');
    } catch {
      alert('That file could not be read. It should be a rota JSON file exported from this app (or rota.json).');
    }
  };

  return (
    <section className="screen">
      <header className="screen-head no-print">
        <h1>Share</h1>
        <p className="muted">Send the rota to the coaches' group, save it as an image, or print it for the touchline.</p>
      </header>

      {!rota ? (
        <div className="card empty no-print">
          <p>No rota chosen yet.</p>
          <button type="button" className="btn primary" onClick={goOptions}>
            See options
          </button>
        </div>
      ) : (
        <>
          {hard.length > 0 && <p className="notice hard no-print">This rota breaks {hard.length} rule{hard.length === 1 ? '' : 's'}. Check the Edit tab before sharing.</p>}
          <div className="card no-print">
            <label className="field">
              <span>Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <h2>WhatsApp</h2>
            <pre className="wa-preview">{text}</pre>
            <div className="row-btns">
              <button type="button" className="btn primary" onClick={async () => say((await copyText(text)) ? 'Copied. Paste it into WhatsApp.' : 'Could not copy.')}>
                Copy text
              </button>
              <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
                Open WhatsApp
              </a>
            </div>
          </div>
          <div className="card no-print">
            <h2>Image and print</h2>
            <div className="row-btns">
              <button type="button" className="btn" onClick={savePng}>
                Save image (PNG)
              </button>
              <button type="button" className="btn" onClick={() => window.print()}>
                Print
              </button>
            </div>
          </div>

          <div className="print-sheet">
            <h1>{title}</h1>
            <RotationGraph rota={rota} settings={settings} />
            <div className="print-cols">
              <div>
                <h2>By time</h2>
                <ByTime rota={rota} settings={settings} />
              </div>
              <div>
                <h2>Minutes</h2>
                <Shifts rota={rota} settings={settings} />
              </div>
            </div>
          </div>
        </>
      )}

      <div className="card no-print">
        <h2>Pass the setup to another coach</h2>
        <p className="muted small">Squad, match settings, rules and the current rota, as a JSON file (same shape as rota.json).</p>
        <div className="row-btns">
          <button type="button" className="btn" onClick={exportJson}>
            Export setup
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            Import setup
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              if (!confirm("Load the coaches' reference rota (rota.json)? This replaces your current setup.")) return;
              const parsed = parseRotaFile(reference);
              replace({ ...parsed, constraints: setup.constraints });
              say('Reference rota loaded.');
            }}
          >
            Load reference rota
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importJson(f);
            e.target.value = '';
          }}
        />
      </div>
      {flash && (
        <div className="toast" role="status">
          {flash}
        </div>
      )}
    </section>
  );
}
