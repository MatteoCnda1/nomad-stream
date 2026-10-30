// Réglages de l'égaliseur (page Compte) : interrupteur, préréglages, courbe et 6 curseurs.
import React, { useMemo } from "react";
import { BANDS, MAX_DB, PRESETS, bandLabel, responseDb, setEqualizer, useEqualizer } from "../equalizer";

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// Courbe de 20 Hz à 20 kHz, échelle logarithmique
const W = 600;
const H = 150;
const FREQS = Array.from({ length: 140 }, (_, i) => 20 * Math.pow(1000, i / 139));
const x = (f: number) => (Math.log10(f / 20) / 3) * W;
const y = (db: number) => H / 2 - (Math.max(-MAX_DB, Math.min(MAX_DB, db)) / MAX_DB) * (H / 2 - 8);

const formatDb = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${String(Math.abs(v)).replace(".", ",")} dB`;

export const EqualizerPanel: React.FC = () => {
  const eq = useEqualizer();
  const curve = useMemo(() => responseDb(eq.gains, FREQS), [eq.gains]);
  const path = curve.map((db, i) => `${i ? "L" : "M"}${x(FREQS[i]).toFixed(1)},${y(db).toFixed(1)}`).join("");

  const setGain = (band: number, value: number) => {
    const gains = eq.gains.map((g, i) => (i === band ? value : g));
    const match = PRESETS.find((p) => p.gains.every((g, i) => g === gains[i]));
    setEqualizer({ gains, preset: match?.id ?? "perso" });
  };
  const choosePreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (preset) setEqualizer({ preset: id, gains: preset.gains });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="eq-h" className="text-lg font-semibold">Égaliseur</h2>
          <p className="mt-0.5 text-[13px] text-muted">Pour la musique, sur cet appareil</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={eq.enabled}
          aria-label="Activer l'égaliseur"
          onClick={() => setEqualizer({ enabled: !eq.enabled })}
          className={`press relative w-[52px] h-8 rounded-full transition-colors ${eq.enabled ? "bg-accent" : "bg-surface3"}`}
        >
          <span
            className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow transition-transform ${eq.enabled ? "translate-x-5" : ""}`}
          />
        </button>
      </div>

      <div className={`mt-5 transition-opacity ${eq.enabled ? "" : "opacity-45"}`}>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="eq-preset" className="text-[15px] font-medium">
            Préréglage
          </label>
          <select
            id="eq-preset"
            value={eq.preset}
            disabled={!eq.enabled}
            onChange={(e) => choosePreset(e.target.value)}
            className="h-10 pl-3 pr-8 rounded-xl border border-line bg-panel text-[15px] outline-none focus:border-accent"
          >
            {eq.preset === "perso" && <option value="perso">Personnalisé</option>}
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!eq.enabled || eq.gains.every((g) => g === 0)}
            onClick={() => choosePreset("plat")}
            className="press h-10 px-4 rounded-full text-sm font-semibold text-muted hover:text-fg hover:bg-surface2 disabled:opacity-40"
          >
            Réinitialiser
          </button>
        </div>

        {/* Courbe de réponse */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Courbe de l'égaliseur : ${BANDS.map((hz, i) => `${bandLabel(hz)} ${formatDb(eq.gains[i])}`).join(", ")}`}
          className="mt-5 w-full h-[120px] sm:h-[150px] rounded-2xl bg-panel"
        >
          <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="currentColor" className="text-line2" strokeWidth="1" />
          {BANDS.map((hz) => (
            <line key={hz} x1={x(hz)} x2={x(hz)} y1="0" y2={H} stroke="currentColor" className="text-line" strokeWidth="1" />
          ))}
          <path d={`${path}L${W},${H / 2}L0,${H / 2}Z`} fill="var(--accent-soft)" />
          <path d={path} fill="none" stroke="rgb(var(--accent))" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          {BANDS.map((hz) => (
            <circle key={hz} cx={x(hz)} cy={y(curve[FREQS.findIndex((f) => f >= hz)] ?? 0)} r="5" fill="rgb(var(--accent))" />
          ))}
        </svg>

        {/* Curseurs */}
        <div className="mt-4 flex flex-col gap-y-1">
          {BANDS.map((hz, i) => (
            <div key={hz} className="flex items-center gap-3 py-1.5">
              <label htmlFor={`eq-${hz}`} className="w-[64px] flex-shrink-0 text-[13px] font-medium text-muted tabular-nums">
                {bandLabel(hz)}
              </label>
              <input
                id={`eq-${hz}`}
                type="range"
                min={-MAX_DB}
                max={MAX_DB}
                step={0.5}
                value={eq.gains[i]}
                disabled={!eq.enabled}
                onChange={(e) => setGain(i, Number(e.target.value))}
                aria-valuetext={formatDb(eq.gains[i])}
                className="flex-1 min-w-0 accent-accent"
              />
              <span className="w-[62px] flex-shrink-0 text-right text-[13px] tabular-nums">{formatDb(eq.gains[i])}</span>
            </div>
          ))}
        </div>

        {isIOS && (
          <p className="mt-3 text-[13px] text-muted">
            Sur iPhone et iPad, l'égaliseur fait passer la musique par le moteur audio du navigateur. Si elle
            s'arrête écran verrouillé ou dans la voiture, désactivez-le puis fermez et rouvrez l'appli.
          </p>
        )}
      </div>
    </div>
  );
};
