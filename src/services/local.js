// localStorage mit Schlüssel-Präfix der App; Fehler (privater Modus, voller Speicher) werden geschluckt.
export function createLocal(prefix) {
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const remove = k => { try { localStorage.removeItem(k); } catch (e) {} };
  const json = (k, d) => { try { const v = JSON.parse(get(k) || "null"); return v === null ? d : v; } catch (e) { return d; } };
  return { get, set, remove, json, key: k => prefix + ":" + k };
}
