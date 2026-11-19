import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Setup } from '../model/io';
import type { Rota } from '../model/types';
import { solve, warmUp } from '../solver/client';
import { EditScreen } from './EditScreen';
import { MatchScreen } from './MatchScreen';
import { OptionsScreen, type RunState } from './OptionsScreen';
import { RulesScreen } from './RulesScreen';
import { ShareScreen } from './ShareScreen';
import { SquadScreen } from './SquadScreen';
import { usePersistentSetup } from './store';

type Tab = 'squad' | 'match' | 'rules' | 'options' | 'edit' | 'share';

const ICONS: Record<Tab, ReactNode> = {
  squad: <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 20a5 5 0 0 0-4-4.9" />,
  match: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-14v5l3 2" />,
  rules: <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />,
  options: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4" />,
  share: <path d="M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm12 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />,
};
const LABELS: Record<Tab, string> = { squad: 'Squad', match: 'Match', rules: 'Rules', options: 'Options', edit: 'Edit', share: 'Share' };

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

export function App() {
  const [setup, setSetup] = usePersistentSetup();
  const [tab, setTab] = useState<Tab>('options');
  const [run, setRun] = useState<RunState>({ running: false, result: null, inputKey: null, ms: 0, seed: 0 });

  useEffect(() => {
    const t = setTimeout(warmUp, 500);
    return () => clearTimeout(t);
  }, []);

  const update = useCallback((fn: (s: Setup) => Setup) => setSetup((s) => fn(s)), [setSetup]);
  const inputKey = useMemo(() => JSON.stringify([setup.settings, setup.constraints]), [setup.settings, setup.constraints]);

  const generate = async (seed: number) => {
    setRun((r) => ({ ...r, running: true }));
    const key = inputKey;
    const { result, ms } = await solve(setup.settings, setup.constraints, { count: 5, seed });
    setRun({ running: false, result, inputKey: key, ms, seed });
  };

  const chooseRota = (rota: Rota) => {
    update((s) => ({ ...s, rota, locks: [] }));
    setTab('edit');
    window.scrollTo({ top: 0 });
  };

  const go = (t: Tab) => {
    setTab(t);
    setDrawer(false);
    window.scrollTo({ top: 0 });
  };

  // Rules down the side: always beside the rota on wide screens; a slide-in drawer on phones.
  const wide = useMediaQuery('(min-width: 960px)');
  const [drawer, setDrawer] = useState(false);
  const sideRules = tab !== 'rules';
  const enabledRules = setup.constraints.filter((c) => c.enabled).length;
  const openRules = wide ? undefined : { label: `Rules (${enabledRules})`, open: () => setDrawer(true) };

  return (
    <div className={`app ${wide && sideRules ? 'with-side' : ''}`}>
      {sideRules && (wide || drawer) && (
        <>
          {!wide && <div className="drawer-backdrop no-print" onClick={() => setDrawer(false)} />}
          <aside className={`side-rules no-print ${wide ? '' : 'drawer'}`} aria-label="Rules">
            {!wide && (
              <button type="button" className="icon-btn drawer-close" aria-label="Close rules" onClick={() => setDrawer(false)}>
                ✕
              </button>
            )}
            <RulesScreen setup={setup} update={update} compact />
          </aside>
        </>
      )}
      <main className="main">
        {tab === 'squad' && <SquadScreen setup={setup} update={update} />}
        {tab === 'match' && <MatchScreen setup={setup} update={update} />}
        {tab === 'rules' && <RulesScreen setup={setup} update={update} />}
        {tab === 'options' && (
          <OptionsScreen openRules={openRules} setup={setup} run={run} stale={run.inputKey !== inputKey} onGenerate={generate} onUse={chooseRota} goRules={() => go('rules')} />
        )}
        {tab === 'edit' && <EditScreen openRules={openRules} setup={setup} update={update} goOptions={() => go('options')} />}
        {tab === 'share' && <ShareScreen setup={setup} replace={(s) => setSetup(s)} goOptions={() => go('options')} />}
      </main>
      <nav className="tabbar no-print" aria-label="Screens">
        {(Object.keys(LABELS) as Tab[]).map((t) => (
          <button key={t} type="button" className={tab === t ? 'active' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => go(t)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {ICONS[t]}
            </svg>
            <span>{LABELS[t]}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
