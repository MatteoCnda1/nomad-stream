import React, { useEffect, useRef, useState } from "react";
import { Lock, Loader2 } from "lucide-react";
import { checkAuth, login } from "../api";

type Status = "checking" | "open" | "locked";

// Porte d'entrée par code d'accès. Transparente si l'auth est désactivée côté
// serveur (ACCESS_CODE non défini) : passe directement à "open".
export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<Status>("checking");
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    checkAuth().then(({ enabled, authed }) => {
      if (active) setStatus(!enabled || authed ? "open" : "locked");
    });
    // Un 401 en cours de session (cookie expiré) rouvre la porte
    const onRequired = () => setStatus((s) => (s === "open" ? "locked" : s));
    window.addEventListener("nomad-auth-required", onRequired);
    return () => {
      active = false;
      window.removeEventListener("nomad-auth-required", onRequired);
    };
  }, []);

  useEffect(() => {
    if (status === "locked") inputRef.current?.focus();
  }, [status]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || submitting) return;
    setSubmitting(true);
    setError(false);
    const ok = await login(code.trim());
    if (ok) {
      // Rechargement : les vues refont leurs appels avec le cookie désormais posé
      window.location.reload();
    } else {
      setError(true);
      setSubmitting(false);
      setCode("");
      inputRef.current?.focus();
    }
  };

  if (status === "open") return <>{children}</>;

  if (status === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <Loader2 className="w-7 h-7 text-muted animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-card rounded-3xl p-8 flex flex-col items-center gap-5"
      >
        <div className="w-14 h-14 rounded-2xl bg-accent-soft flex items-center justify-center">
          <Lock className="w-6 h-6 text-accent-text" strokeWidth={1.8} />
        </div>
        <div className="text-center">
          <h1 className="text-xl font-bold text-fg">Nomad Stream</h1>
          <p className="text-sm text-muted mt-1">Entrez le code d'accès pour continuer.</p>
        </div>
        <input
          ref={inputRef}
          type="password"
          inputMode="text"
          autoComplete="current-password"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError(false);
          }}
          placeholder="Code d'accès"
          className={`w-full px-4 py-3 rounded-2xl bg-surface2 text-fg text-center tracking-wide outline-none border ${
            error ? "border-accent" : "border-transparent focus:border-line2"
          }`}
        />
        {error && <p className="text-sm text-accent-text -mt-2">Code invalide, réessayez.</p>}
        <button
          type="submit"
          disabled={submitting || !code.trim()}
          className="w-full py-3 rounded-2xl bg-accent text-accent-text font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          Déverrouiller
        </button>
      </form>
    </div>
  );
};
