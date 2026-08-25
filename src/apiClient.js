// Cliente para el backend real de Verdtical (lecturas de sensores en vivo).
// Si alguna variable falta o la llamada falla, se devuelve null y el panel
// sigue funcionando con la simulación local para esa línea.

const BASE_URL = import.meta.env.VITE_API_BASE_URL;
const API_KEY = import.meta.env.VITE_API_KEY;
const PROYECTO_ID = import.meta.env.VITE_API_PROYECTO_ID;

// Normaliza nombres de línea para emparejar aunque haya pequeñas diferencias
// de formato entre el panel y el backend (espacios, mayúsculas, guiones):
// "Zona1", "Zona 1", "zona-1" se convierten todos en "zona1".
function normalizar(texto) {
  return String(texto || '').toLowerCase().replace(/[\s\-_]/g, '');
}

export async function obtenerUltimasLecturas() {
  if (!BASE_URL || !API_KEY || !PROYECTO_ID) return null;
  try {
    const res = await fetch(`${BASE_URL}/lecturas/ultimas?proyecto_id=${PROYECTO_ID}`, {
      headers: { 'x-api-key': API_KEY },
    });
    if (!res.ok) return null;
    const filas = await res.json();

    // Indexado por nombre normalizado de línea, para emparejar con sectors,
    // y también por posición (orden en que vienen del backend, que es el
    // orden en que se sincronizaron las Zonas reales) — por si los nombres
    // del panel no coinciden con los del backend (ej. "Línea 1" vs "Zona1").
    const porNombre = {};
    const porPosicion = [];
    for (const fila of filas) {
      const lectura = {
        humidity: fila.humedad !== null ? Number(fila.humedad) : null,
        temperature: fila.temperatura !== null ? Number(fila.temperatura) : null,
        ec: fila.ce !== null ? Number(fila.ce) : null,
        // Caudal instantáneo real (l/h) del contador de agua Loxone.
        flowMeasured: fila.caudal !== null ? Number(fila.caudal) : null,
        // Litros de hoy, ya calculados por el propio Loxone (no hay que
        // integrarlo nosotros a partir del caudal).
        litrosHoy: fila.litros_hoy !== null ? Number(fila.litros_hoy) : null,
        presion: fila.presion !== null ? Number(fila.presion) : null,
        medidoEn: fila.medido_en,
      };
      porNombre[normalizar(fila.nombre)] = lectura;
      porPosicion.push(lectura);
    }
    return { porNombre, porPosicion };
  } catch {
    return null;
  }
}

// Busca la lectura real de un sector del panel: primero por nombre (tolerando
// pequeñas diferencias de formato), y si no hay coincidencia, por posición
// (la línea nº N del panel con la línea nº N real del backend) — para paneles
// donde las líneas tienen nombres propios distintos a los del backend.
export function buscarLectura(lecturasReales, nombreSector, posicion) {
  if (!lecturasReales) return null;
  const porNombre = lecturasReales.porNombre?.[normalizar(nombreSector)];
  if (porNombre) return porNombre;
  if (typeof posicion === 'number') return lecturasReales.porPosicion?.[posicion] || null;
  return null;
}

// --- Configuración del proyecto (líneas, técnico/cliente, plano, ajustes) ---
// Mismo patrón defensivo que obtenerUltimasLecturas: si falta configuración o
// falla la llamada, se devuelve null y quien llama sigue usando localStorage.

// GET /proyectos/:id — ajustes generales (presión, ETo, fertilizante, etc.).
export async function obtenerConfiguracionProyecto() {
  if (!BASE_URL || !API_KEY || !PROYECTO_ID) return null;
  try {
    const res = await fetch(`${BASE_URL}/proyectos/${PROYECTO_ID}`, {
      headers: { 'x-api-key': API_KEY },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// GET /lineas?proyecto_id=... — umbrales de alarma y posición en el plano de cada línea.
export async function obtenerLineasProyecto() {
  if (!BASE_URL || !API_KEY || !PROYECTO_ID) return null;
  try {
    const res = await fetch(`${BASE_URL}/lineas?proyecto_id=${PROYECTO_ID}`, {
      headers: { 'x-api-key': API_KEY },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// GET /contactos?proyecto_id=... — técnico y cliente, indexados por rol.
export async function obtenerContactosProyecto() {
  if (!BASE_URL || !API_KEY || !PROYECTO_ID) return null;
  try {
    const res = await fetch(`${BASE_URL}/contactos?proyecto_id=${PROYECTO_ID}`, {
      headers: { 'x-api-key': API_KEY },
    });
    if (!res.ok) return null;
    const filas = await res.json();
    return {
      tecnico: filas.find((f) => f.rol === 'tecnico') || null,
      cliente: filas.find((f) => f.rol === 'cliente') || null,
    };
  } catch {
    return null;
  }
}

// GET /planos?proyecto_id=... — imagen del plano (404 = todavía sin plano, se
// trata igual que cualquier otro fallo: null).
export async function obtenerPlanoProyecto() {
  if (!BASE_URL || !API_KEY || !PROYECTO_ID) return null;
  try {
    const res = await fetch(`${BASE_URL}/planos?proyecto_id=${PROYECTO_ID}`, {
      headers: { 'x-api-key': API_KEY },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Combina las cuatro llamadas anteriores en paralelo. Cada una ya se degrada
// a null por su cuenta, así que Promise.all nunca rechaza aquí.
export async function obtenerBootstrapProyecto() {
  if (!BASE_URL || !API_KEY || !PROYECTO_ID) return null;
  const [proyecto, lineas, contactos, plano] = await Promise.all([
    obtenerConfiguracionProyecto(),
    obtenerLineasProyecto(),
    obtenerContactosProyecto(),
    obtenerPlanoProyecto(),
  ]);
  return { proyecto, lineas, contactos, plano };
}

// Busca la línea del backend que corresponde a un sector del panel: mismo
// emparejamiento por nombre normalizado, o si no por posición, que buscarLectura.
export function buscarLineaBackend(lineasBackend, nombreSector, posicion) {
  if (!Array.isArray(lineasBackend)) return null;
  const porNombre = lineasBackend.find((l) => normalizar(l.nombre) === normalizar(nombreSector));
  if (porNombre) return porNombre;
  if (typeof posicion === 'number') return lineasBackend[posicion] || null;
  return null;
}
