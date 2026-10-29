// Ménage du cache disque des vignettes. Chaque lecture rafraîchit la date de modification du
// fichier ; au-delà du plafond, les vignettes servies le moins récemment sont supprimées jusqu'à
// redescendre à 80 % du plafond (marge pour ne pas refaire le ménage à chaque nouvelle image).
import fs from "fs";
import path from "path";

const SWEEP_EVERY_WRITES = 500;

export function createImageCache({ dir, maxBytes, intervalMs = 3600 * 1000 }) {
  fs.mkdirSync(dir, { recursive: true });
  let writes = 0;
  let sweeping = null;

  async function sweep() {
    const files = [];
    for (const name of await fs.promises.readdir(dir)) {
      try {
        const st = await fs.promises.stat(path.join(dir, name));
        if (st.isFile()) files.push({ name, size: st.size, used: st.mtimeMs });
      } catch {
        // Fichier supprimé entre-temps
      }
    }
    let total = files.reduce((sum, f) => sum + f.size, 0);
    let removed = 0;
    if (total > maxBytes) {
      files.sort((a, b) => a.used - b.used);
      for (const f of files) {
        if (total <= maxBytes * 0.8) break;
        await fs.promises.rm(path.join(dir, f.name), { force: true });
        total -= f.size;
        removed++;
      }
    }
    return { total, removed };
  }

  // Un seul ménage à la fois ; les appels pendant un ménage en cours le partagent
  function enforceLimit() {
    sweeping ??= sweep().finally(() => (sweeping = null));
    return sweeping;
  }

  const run = () => enforceLimit().catch((err) => console.error("Ménage du cache d'images :", err.message));
  run();
  setInterval(run, intervalMs).unref();

  return {
    dir,
    enforceLimit,
    // Vignette servie depuis le disque : elle redevient « récente »
    touch(file) {
      const now = new Date();
      fs.utimes(file, now, now, () => {});
    },
    // Nouvelle vignette écrite : ménage anticipé si beaucoup d'images arrivent d'un coup
    noteWrite() {
      if (++writes % SWEEP_EVERY_WRITES === 0) run();
    },
  };
}
