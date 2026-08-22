import React, { useState, useEffect, useRef } from "react";
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from "recharts";

const DIAS = [
  { key: "L", label: "Lun" },
  { key: "M", label: "Mar" },
  { key: "X", label: "Mié" },
  { key: "J", label: "Jue" },
  { key: "V", label: "Vie" },
  { key: "S", label: "Sáb" },
  { key: "D", label: "Dom" },
];
const DIA_JS_TO_KEY = ["D", "L", "M", "X", "J", "V", "S"];
const TODOS_LOS_DIAS = DIAS.map((d) => d.key);
const MAX_HORARIOS_POR_LINEA = 20;

const ESTACIONES = [
  { key: "primavera", label: "Primavera", factor: 0.75 },
  { key: "verano", label: "Verano", factor: 1 },
  { key: "otono", label: "Otoño", factor: 0.55 },
  { key: "invierno", label: "Invierno", factor: 0.3 },
];

const STORAGE_KEY = "verdtical-panel-riego-v6";

function getSeasonForDate(date) {
  const m = date.getMonth() + 1; // 1-12
  const d = date.getDate();
  if ((m === 3 && d >= 21) || m === 4 || m === 5 || (m === 6 && d <= 20)) return "primavera";
  if ((m === 6 && d >= 21) || m === 7 || m === 8 || (m === 9 && d <= 22)) return "verano";
  if ((m === 9 && d >= 23) || m === 10 || m === 11 || (m === 12 && d <= 20)) return "otono";
  return "invierno";
}

function nuevoHorario(overrides = {}) {
  return {
    id: `evt-${Date.now()}-${Math.round(Math.random() * 100000)}`,
    days: [...TODOS_LOS_DIAS],
    time: "06:00",
    duration: 15,
    ...overrides,
  };
}

function escalarHorarios(eventos, factor) {
  return eventos.map((ev) => ({
    ...ev,
    id: `evt-${Date.now()}-${Math.round(Math.random() * 100000)}`,
    duration: Math.max(1, Math.round(ev.duration * factor)),
  }));
}

function generarProgramacionEstacional(eventosBase) {
  const schedules = {};
  ESTACIONES.forEach((est) => {
    schedules[est.key] = escalarHorarios(eventosBase, est.factor);
  });
  return schedules;
}

// Calcula automáticamente cuántos minutos de riego (repartidos en tandas
// cortas, tipo riego pulsado) necesita una línea al día, a partir de su
// superficie real, su exposición (que determina cuánta agua necesita por
// evapotranspiración) y el caudal real que da esa línea según sus emisores.
// La referencia es "verano" (factor 1); el resto de estaciones ya se ajustan
// solas a partir de ahí.
function calcularProgramacionAutomatica({ areaM2, eto, nominalFlow, duracionSesion, horaInicio, ocupacion }) {
  const necesidadDiariaLitros = Number(areaM2 || 0) * Number(eto || 0);
  if (necesidadDiariaLitros <= 0 || !nominalFlow || nominalFlow <= 0) return null;

  const tiempoTotalMin = (necesidadDiariaLitros / nominalFlow) * 60;
  // La duración de cada tanda la marca el "Riego 1" que ya tenga la línea
  // (o 15 min si todavía no hay ninguno configurado) — a partir de ahí se
  // calcula cuántas repeticiones de ESE mismo tamaño hacen falta para
  // completar el agua necesaria.
  const duracionPorSesion = Math.max(1, duracionSesion || 15);
  const numSesiones = Math.max(1, Math.ceil(tiempoTotalMin / duracionPorSesion));

  // La primera tanda respeta exactamente la hora que ya tenía puesta; el
  // resto se reparten a intervalos regulares a lo largo de las 24 horas
  // completas del día (dando la vuelta a medianoche si hace falta) — y si el
  // hueco propuesto choca con otra línea, lo va desplazando de 15 en 15 min
  // hasta encontrar uno libre (probando hasta 2h más tarde antes de
  // rendirse).
  const MINUTOS_DIA = 24 * 60;
  const inicioMin = (horaInicio ?? 7) * 60;
  const intervaloMin = Math.floor(MINUTOS_DIA / numSesiones);
  const diasTodos = [...TODOS_LOS_DIAS];
  let conflictosSinResolver = 0;
  // Ocupación propia de esta misma línea, para que sus propias tandas
  // tampoco se pisen entre sí (además de con las demás líneas).
  let ocupacionPropia = [];

  const horarios = [];
  for (let i = 0; i < numSesiones; i++) {
    const horaDeseada = (inicioMin + i * intervaloMin) % MINUTOS_DIA;
    const ocupacionTotal = [...(ocupacion || []), ...ocupacionPropia];
    let horaMin = horaDeseada;
    let conflicto = buscarConflicto(diasTodos, horaMin, duracionPorSesion, ocupacionTotal);
    // Busca en las 24 horas completas (pasos de 15 min), no solo un par de
    // horas después — si hay hueco en cualquier punto del día, lo encuentra.
    let intentos = 0;
    while (conflicto && intentos < MINUTOS_DIA / 15) {
      horaMin = (horaMin + 15) % MINUTOS_DIA;
      conflicto = buscarConflicto(diasTodos, horaMin, duracionPorSesion, ocupacionTotal);
      intentos++;
    }
    if (conflicto) conflictosSinResolver++;
    ocupacionPropia = [...ocupacionPropia, { days: diasTodos, inicio: horaMin, fin: horaMin + duracionPorSesion, lineName: "(misma línea)" }];
    const h = Math.floor(horaMin / 60);
    const m = horaMin % 60;
    horarios.push(
      nuevoHorario({
        time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
        duration: duracionPorSesion,
      })
    );
  }

  return {
    horarios,
    necesidadDiariaLitros: Math.round(necesidadDiariaLitros * 10) / 10,
    tiempoTotalMin: Math.round(tiempoTotalMin),
    conflictosSinResolver,
  };
}

// Convierte "HH:MM" a minutos desde medianoche, para poder comparar rangos.
function horaAMinutos(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Todas las franjas ocupadas por las DEMÁS líneas (no la propia), para una
// estación concreta: [{ days, inicio, fin, lineName }, ...] en minutos.
function obtenerOcupacion(todosLosSectores, propioId, season) {
  if (!todosLosSectores) return [];
  const ocupacion = [];
  todosLosSectores.forEach((s) => {
    if (s.id === propioId) return;
    const eventosOtraLinea = (s.schedules && s.schedules[season]) || [];
    eventosOtraLinea.forEach((ev) => {
      const inicio = horaAMinutos(ev.time);
      ocupacion.push({ days: ev.days, inicio, fin: inicio + Number(ev.duration || 0), lineName: s.name });
    });
  });
  return ocupacion;
}

// ¿Este horario (días + inicio + duración) se cruza con alguna franja ya
// ocupada por otra línea? Solo cuenta si comparten al menos un día.
function buscarConflicto(dias, inicioMin, duracionMin, ocupacion) {
  const finMin = inicioMin + duracionMin;
  return ocupacion.find((o) => {
    const diasComunes = dias.some((d) => o.days.includes(d));
    if (!diasComunes) return false;
    return inicioMin < o.fin && finMin > o.inicio;
  });
}

// El balance hídrico (escorrentía/déficit) solo tiene sentido comparado con
// un día YA CERRADO — si se compara con "hoy" mientras el día todavía está en
// marcha, el riego que aún no ha llegado a ejecutarse parece "déficit" de
// forma falsa. Por eso usamos el consumo de AYER (el último día completo del
// histórico), no el de hoy.
function consumoDeAyer(sector, now) {
  const ayer = new Date(now);
  ayer.setDate(ayer.getDate() - 1);
  const ayerStr = ayer.toDateString();
  const registro = (sector.dailyConsumption || []).find((d) => d.date === ayerStr);
  return registro ? Number(registro.liters || 0) : null;
}

// Construye el listado completo de todos los eventos de riego de todas las
// líneas, para una temporada, ordenados por hora — marcando cuáles se cruzan
// entre sí (mismo día de la semana y horas solapadas).
function construirListadoHorarios(sectors, season) {
  const eventosConLinea = [];
  sectors.forEach((s) => {
    const eventos = (s.schedules && s.schedules[season]) || [];
    eventos.forEach((ev) => {
      const inicio = horaAMinutos(ev.time);
      eventosConLinea.push({
        lineId: s.id,
        lineName: s.name,
        days: ev.days,
        time: ev.time,
        duration: Number(ev.duration || 0),
        inicio,
        fin: inicio + Number(ev.duration || 0),
      });
    });
  });
  eventosConLinea.sort((a, b) => a.inicio - b.inicio);

  // Para cada evento, buscamos si se cruza con OTRO evento de OTRA línea.
  const conConflicto = eventosConLinea.map((ev) => {
    const conflicto = eventosConLinea.find(
      (otro) =>
        otro.lineId !== ev.lineId &&
        otro.days.some((d) => ev.days.includes(d)) &&
        ev.inicio < otro.fin &&
        ev.fin > otro.inicio
    );
    return { ...ev, conflictoCon: conflicto ? conflicto.lineName : null };
  });

  return conConflicto;
}

// A partir del listado de eventos (ya construido), calcula los huecos
// libres del día completo (24h) en los que NINGUNA línea tiene programado
// riego — fusionando primero todos los intervalos ocupados, sin distinguir
// día de la semana (aproximación: si un evento existe en cualquier día, esa
// franja horaria se considera "ocupada" a efectos de huecos libres).
function calcularHuecosLibres(eventos) {
  if (eventos.length === 0) return [{ inicio: 0, fin: 24 * 60 }];
  const ordenados = [...eventos].sort((a, b) => a.inicio - b.inicio);
  const fusionados = [];
  ordenados.forEach((ev) => {
    const ultimo = fusionados[fusionados.length - 1];
    if (ultimo && ev.inicio <= ultimo.fin) {
      ultimo.fin = Math.max(ultimo.fin, ev.fin);
    } else {
      fusionados.push({ inicio: ev.inicio, fin: ev.fin });
    }
  });
  const huecos = [];
  let cursor = 0;
  fusionados.forEach((f) => {
    if (f.inicio > cursor) huecos.push({ inicio: cursor, fin: f.inicio });
    cursor = Math.max(cursor, f.fin);
  });
  if (cursor < 24 * 60) huecos.push({ inicio: cursor, fin: 24 * 60 });
  return huecos;
}

function formatoHora(min) {
  const m = ((min % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// Calcula la programación de las 4 estaciones a la vez, PERO en vez de
// mantener el mismo número de tandas y encoger su duración (lo que las deja
// muy pegadas entre sí y aumenta el riesgo de que se pisen), mantiene el
// tamaño de cada tanda constante y reduce cuántas tandas hacen falta —
// menos necesidad de agua en invierno = menos repeticiones, no tandas más
// cortas. Cada estación comprueba conflictos por separado, con su propia
// ocupación (la ocupación de otras líneas puede ser distinta en cada
// estación si esas líneas también se han recalculado así).
function calcularProgramacionAutomaticaTodasEstaciones({ areaM2, etoBase, nominalFlow, duracionSesion, ocupacionPorEstacion }) {
  const schedules = {};
  const resumenPorEstacion = {};
  ESTACIONES.forEach((est) => {
    const etoEstacional = etoBase * est.factor;
    const resultado = calcularProgramacionAutomatica({
      areaM2,
      eto: etoEstacional,
      nominalFlow,
      duracionSesion,
      horaInicio: 7,
      ocupacion: (ocupacionPorEstacion && ocupacionPorEstacion[est.key]) || [],
    });
    schedules[est.key] = resultado ? resultado.horarios : [nuevoHorario({ time: "07:00", duration: duracionSesion || 15 })];
    resumenPorEstacion[est.key] = resultado
      ? { numSesiones: resultado.horarios.length, conflictosSinResolver: resultado.conflictosSinResolver }
      : { numSesiones: 1, conflictosSinResolver: 0 };
  });
  return { schedules, resumenPorEstacion };
}

function sanearLineasAlCargar(sectors) {
  if (!sectors) return sectors;
  return sectors.map((s) => {
    const th = s.thresholds || {};
    const humedadObjetivo = th.humidityMin !== undefined && th.humidityMax !== undefined ? (th.humidityMin + th.humidityMax) / 2 : 45;
    const ecObjetivo = th.ecMin !== undefined && th.ecMax !== undefined ? (th.ecMin + th.ecMax) / 2 : 1.8;
    const sensors = s.sensors || {};
    return {
      ...s,
      sensors: {
        ...sensors,
        humidity: clamp(sensors.humidity ?? humedadObjetivo, humedadObjetivo - 10, humedadObjetivo + 10),
        ec: clamp(sensors.ec ?? ecObjetivo, ecObjetivo - 0.3, ecObjetivo + 0.3),
      },
      // Se reinician las banderas de aviso informativas (no las de fuga grave,
      // que reflejan un estado real ya visible en la interfaz) para partir de
      // una lectura limpia y evitar avisos heredados de sesiones anteriores.
      minorLeakFlag: false,
      clogFlag: false,
      humidityFlag: false,
      ecFlag: false,
      temperatureFlag: false,
    };
  });
}

function demoHumedadSemana(humedadBase) {
  // Media diaria de humedad de ejemplo para los últimos 14 días (%), para el
  // historial de 1 año — complementa a demoHumedadHoraria, que cubre el
  // detalle real de los últimos 7 días.
  const dias = 14;
  const hoy = new Date();
  const lecturas = [];
  for (let diasAtras = dias; diasAtras >= 1; diasAtras--) {
    const d = new Date(hoy);
    d.setDate(d.getDate() - diasAtras);
    const avgHumidity = Math.round((humedadBase + (Math.random() - 0.5) * 4) * 10) / 10;
    lecturas.push({
      date: d.toDateString(),
      label: d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
      avgHumidity,
    });
  }
  return lecturas;
}

function demoSensorHoraria(valorBase, amplitud, campo, decimales, min, max) {
  // Genera 168 lecturas reales de ejemplo (7 días x 24 horas) para cualquier
  // sensor, oscilando de forma natural alrededor de un valor base.
  const hoy = new Date();
  const lecturas = [];
  const factor = Math.pow(10, decimales);
  for (let diasAtras = 7; diasAtras >= 1; diasAtras--) {
    const d = new Date(hoy);
    d.setDate(d.getDate() - diasAtras);
    for (let h = 0; h < 24; h++) {
      const ciclo = Math.sin((h / 24) * Math.PI * 2) * amplitud;
      const ruido = (Math.random() - 0.5) * amplitud * 0.6;
      let valor = Math.round((valorBase + ciclo + ruido) * factor) / factor;
      if (min !== undefined) valor = Math.max(min, valor);
      if (max !== undefined) valor = Math.min(max, valor);
      lecturas.push({
        ts: new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).toISOString(),
        label: d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) + " " + String(h).padStart(2, "0") + "h",
        [campo]: valor,
      });
    }
  }
  return lecturas;
}

function demoSensorSemana(valorBase, amplitud, campo, decimales) {
  // Media diaria de ejemplo para los últimos 14 días, para el historial de 1 año.
  const dias = 14;
  const hoy = new Date();
  const factor = Math.pow(10, decimales);
  const lecturas = [];
  for (let diasAtras = dias; diasAtras >= 1; diasAtras--) {
    const d = new Date(hoy);
    d.setDate(d.getDate() - diasAtras);
    const valor = Math.round((valorBase + (Math.random() - 0.5) * amplitud) * factor) / factor;
    lecturas.push({
      date: d.toDateString(),
      label: d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
      [campo]: valor,
    });
  }
  return lecturas;
}

function demoHumedadHoraria(humedadBase) {
  // 168 lecturas reales de ejemplo (7 días x 24 horas), sin promediar,
  // oscilando de forma natural alrededor de la humedad objetivo de la línea.
  const hoy = new Date();
  const lecturas = [];
  for (let diasAtras = 7; diasAtras >= 1; diasAtras--) {
    const d = new Date(hoy);
    d.setDate(d.getDate() - diasAtras);
    for (let h = 0; h < 24; h++) {
      const ciclo = Math.sin((h / 24) * Math.PI * 2) * 3;
      const ruido = Math.round((Math.random() - 0.5) * 4 * 10) / 10;
      const humidity = Math.max(20, Math.min(70, Math.round((humedadBase + ciclo + ruido) * 10) / 10));
      lecturas.push({
        ts: new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).toISOString(),
        label: d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) + " " + String(h).padStart(2, "0") + "h",
        humidity,
      });
    }
  }
  return lecturas;
}

function demoLineWeek(baseHour, litrosPorDia) {
  // Genera 14 días de ejemplo (los últimos 14 días naturales, terminando ayer),
  // tanto el total diario como su reparto por hora, concentrado en la franja
  // de riego habitual de esa línea (baseHour), para simular un riego corto.
  const hoy = new Date();
  const dailyConsumption = [];
  const hourlyHistory = [];
  litrosPorDia.forEach((litros, idx) => {
    const diasAtras = litrosPorDia.length - idx;
    const d = new Date(hoy);
    d.setDate(d.getDate() - diasAtras);
    const dateKey = d.toDateString();
    dailyConsumption.push({
      date: dateKey,
      label: d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
      liters: litros,
    });
    const hours = Array(24).fill(0);
    hours[baseHour] = Math.round(litros * 0.7 * 10) / 10;
    hours[(baseHour + 1) % 24] = Math.round(litros * 0.3 * 10) / 10;
    hourlyHistory.push({
      date: dateKey,
      label: d.toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "short" }),
      hours,
    });
  });
  return { dailyConsumption, hourlyHistory };
}

function defaultSectors() {
  const numeros = [1, 2, 3, 4, 5, 6];
  // Posiciones calculadas a partir del plano real subido por Antonio
  // (Screenshot_20260820-184239.png): LÍNEA01-04 en la zona grande (49,43 m),
  // LÍNEA05-06 en la zona pequeña (19,38 m). El sensor se coloca a ~50 cm del
  // suelo, en la parte baja de los paneles, según indicó Antonio.
  const posicionesPlano = {
    // Zona grande (49,43 x 5,00 m), 2 filas x 2 mitades: cada línea cubre
    // (49,43/2) x (5,00/2) = 61,79 m². Zona pequeña (19,38 x 5,00 m), 2 filas
    // a todo el ancho: cada línea cubre 19,38 x (5,00/2) = 48,45 m².
    1: { tuberia: { x1: 4.2, y1: 18, x2: 50.0, y2: 22 }, sensor: { x: 15, y: 40 }, area: 61.79 },
    2: { tuberia: { x1: 50.4, y1: 18, x2: 96.7, y2: 22 }, sensor: { x: 85, y: 40 }, area: 61.79 },
    3: { tuberia: { x1: 4.2, y1: 27, x2: 50.0, y2: 31 }, sensor: { x: 35, y: 42 }, area: 61.79 },
    4: { tuberia: { x1: 50.4, y1: 27, x2: 96.7, y2: 31 }, sensor: { x: 65, y: 42 }, area: 61.79 },
    5: { tuberia: { x1: 32.5, y1: 56, x2: 69.5, y2: 60 }, sensor: { x: 40, y: 76 }, area: 48.45 },
    6: { tuberia: { x1: 32.5, y1: 66, x2: 69.5, y2: 70 }, sensor: { x: 60, y: 76 }, area: 48.45 },
  };
  return numeros.map((n, i) => {
    const baseHour = (i * 3) % 24;
    const litrosSemana = [18, 25, 14, 30, 22, 10, 27, 19, 23, 16, 28, 21, 12, 26].map(
      (l) => Math.round(l * (0.85 + (i % 4) * 0.1))
    );
    const semanaDemo = demoLineWeek(baseHour, litrosSemana);
    const pos = posicionesPlano[n];
    return {
      id: `sector-${n}`,
      name: `Línea ${n}`,
      emitters: 24,
      emitterFlow: 60,
      mode: "horario",
      schedules: generarProgramacionEstacional([
        nuevoHorario({ time: `${String(baseHour).padStart(2, "0")}:00`, duration: 15 }),
      ]),
      thresholds: { humidityMin: 30, humidityMax: 65, ecMin: 1.2, ecMax: 2.4, temperatureMin: 2, temperatureMax: 40, flowMinPercent: 85, flowMaxPercent: 115 },
      sensors: {
        humidity: 45 + Math.round(Math.random() * 10 - 5),
        temperature: 21,
        ec: 1.8,
        flowMeasured: 0,
        litersToday: 0,
        lastResetDay: null,
      },
      posicionPlano: pos.sensor,
      areaM2: pos.area,
      duracionTandaAuto: 15,
      exposicion: "sol",
      hourlyConsumption: Array(24).fill(0),
      history: [],
      dailyConsumption: semanaDemo.dailyConsumption,
      hourlyHistory: semanaDemo.hourlyHistory,
      humidityHourlyHistory: demoHumedadHoraria(40 + (i % 4) * 3),
      humidityDailyHistory: demoHumedadSemana(40 + (i % 4) * 3),
      temperatureHourlyHistory: demoSensorHoraria(20 + (i % 3), 4, "temperature", 1),
      temperatureDailyHistory: demoSensorSemana(20 + (i % 3), 3, "avgTemperature", 1),
      ecHourlyHistory: demoSensorHoraria(1.8, 0.3, "ec", 2, 1.0, 3.0),
      ecDailyHistory: demoSensorSemana(1.8, 0.2, "avgEc", 2),
      flowHourlyHistory: demoSensorHoraria(0, 0, "flow", 0, 0, 0),
      flowDailyHistory: demoSensorSemana(0, 0, "avgFlow", 1),
      blockedByLeak: false,
      blockedByFault: false,
      minorLeakFlag: false,
      clogFlag: false,
      humidityFlag: false,
      ecFlag: false,
      temperatureFlag: false,
      manualOverride: null,
      riegoLog: [],
    };
  });
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function demoDailyConsumption() {
  const litrosSemana = [100, 180, 300, 250, 50, 75, 35, 120, 210, 280, 90, 60, 150, 200];
  const hoy = new Date();
  return litrosSemana.map((liters, idx) => {
    const diasAtras = litrosSemana.length - idx;
    const d = new Date(hoy);
    d.setDate(d.getDate() - diasAtras);
    return {
      date: d.toDateString(),
      label: d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
      liters,
    };
  });
}

function demoFertilizerHistory() {
  // Consumo de fertilizante de ejemplo repartido entre los últimos 14 días.
  const mlSemana = [4200, 3800, 2900, 3500, 4100, 3300, 3200, 3900, 3600, 2700, 3400, 4000, 3100, 3300];
  const hoy = new Date();
  return mlSemana.map((consumoML, idx) => {
    const diasAtras = mlSemana.length - idx;
    const d = new Date(hoy);
    d.setDate(d.getDate() - diasAtras);
    return {
      date: d.toDateString(),
      label: d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
      consumoML,
    };
  });
}

function demoPressureHistory() {
  // Media diaria de presión de ejemplo para los últimos 14 días (bar).
  const presionSemana = [2.4, 2.6, 2.3, 2.7, 2.5, 2.2, 2.6, 2.5, 2.3, 2.6, 2.4, 2.7, 2.2, 2.5];
  const hoy = new Date();
  return presionSemana.map((avgPressure, idx) => {
    const diasAtras = presionSemana.length - idx;
    const d = new Date(hoy);
    d.setDate(d.getDate() - diasAtras);
    return {
      date: d.toDateString(),
      label: d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
      avgPressure,
    };
  });
}

function demoPressureHourly() {
  // 168 lecturas reales de ejemplo (7 días x 24 horas), sin promediar,
  // con una ligera bajada simulada durante las horas de riego habituales.
  const hoy = new Date();
  const lecturas = [];
  for (let diasAtras = 7; diasAtras >= 1; diasAtras--) {
    const d = new Date(hoy);
    d.setDate(d.getDate() - diasAtras);
    for (let h = 0; h < 24; h++) {
      const bajadaRiego = h % 3 === 0 ? 0.15 : 0; // pequeñas caídas cuando suele regar alguna línea
      const ruido = Math.round((Math.random() - 0.5) * 0.2 * 100) / 100;
      const pressure = Math.round((2.6 - bajadaRiego + ruido) * 100) / 100;
      lecturas.push({
        ts: new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).toISOString(),
        label: d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) + " " + String(h).padStart(2, "0") + "h",
        pressure,
      });
    }
  }
  return lecturas;
}

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function eventosDeTemporada(sector, now) {
  const season = getSeasonForDate(now);
  return (sector.schedules && sector.schedules[season]) || [];
}

function isWithinSchedule(sector, now) {
  const events = eventosDeTemporada(sector, now);
  const todayKey = DIA_JS_TO_KEY[now.getDay()];
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return events.some((ev) => {
    if (!ev.days || !ev.days.includes(todayKey)) return false;
    const start = timeToMinutes(ev.time);
    const end = start + Number(ev.duration || 0);
    return nowMin >= start && nowMin < end;
  });
}

function isManualOverrideActive(sector, now) {
  const mo = sector.manualOverride;
  if (!mo || !mo.active) return false;
  return new Date(mo.endsAt).getTime() > now.getTime();
}

function isSectorActiveNow(sector, now) {
  if (sector.blockedByLeak || sector.blockedByFault) return false;
  if (isManualOverrideActive(sector, now)) return true;
  if (sector.mode === "apagado") return false;
  const scheduled = isWithinSchedule(sector, now);
  if (sector.mode === "sensor") {
    if (!scheduled) return false;
    const th = sector.thresholds || { humidityMin: 30 };
    const humidity = sector.sensors ? sector.sensors.humidity : undefined;
    if (humidity === undefined) return true;
    return humidity < th.humidityMin;
  }
  return scheduled;
}

function nextEventForSector(sector, now) {
  if (sector.mode === "apagado") return null;
  const events = eventosDeTemporada(sector, now);
  let earliest = null;
  events.forEach((ev) => {
    if (!ev.days || ev.days.length === 0) return;
    const startMin = timeToMinutes(ev.time);
    for (let offset = 0; offset < 8; offset++) {
      const d = new Date(now);
      d.setDate(d.getDate() + offset);
      const key = DIA_JS_TO_KEY[d.getDay()];
      if (!key || !ev.days.includes(key)) continue;
      const candidate = new Date(d);
      candidate.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
      if (candidate.getTime() > now.getTime()) {
        if (!earliest || candidate.getTime() < earliest.getTime()) earliest = candidate;
        break;
      }
    }
  });
  return earliest;
}

function formatEventDate(date, now) {
  if (!date) return "sin programar";
  const sameDay = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  if (sameDay) return `hoy · ${hh}:${mm}`;
  if (isTomorrow) return `mañana · ${hh}:${mm}`;
  const diaLabel = DIAS[(date.getDay() + 6) % 7].label;
  return `${diaLabel} · ${hh}:${mm}`;
}

const CATALOGO_PROCESOS_MANTENIMIENTO = [
  { key: "fertilizante", label: "Rellenar fertilizante" },
  { key: "limpieza_canal", label: "Limpieza de canal" },
  { key: "cambio_plantas", label: "Cambio de plantas" },
  { key: "limpieza_plantas", label: "Limpieza de plantas" },
  { key: "fitosanitario", label: "Tratamiento fitosanitario" },
  { key: "revision_general", label: "Revisión general del sistema" },
];

const CATEGORIAS_ALARMA = [
  { key: "fugas", label: "Fugas (leve y grave)" },
  { key: "fallo_electrico", label: "Fallo eléctrico de electroválvula" },
  { key: "embozo", label: "Posible embozo" },
  { key: "presion", label: "Presión de red" },
  { key: "humedad", label: "Humedad fuera de rango" },
  { key: "ec", label: "CE fuera de rango" },
  { key: "temperatura", label: "Temperatura fuera de rango" },
  { key: "multiples_lineas", label: "Varias líneas a la vez" },
  { key: "fertilizante", label: "Nivel de fertilizante" },
];

// IMPORTANTE PARA LA FUTURA INTEGRACIÓN CON mapa-situacion-proyectos.html:
// esta función es el punto de traducción entre los dos sistemas. El "tipo"
// exacto de una alarma aquí (p.ej. "humedad_fuera_rango") se corresponde con
// el "tipoAlarma" que usa el mapa multi-proyecto (p.ej. "humedad") a través
// de esta categoría, NO por coincidencia directa de campo. Cuando exista un
// backend real, el evento que se envíe al mapa debe llevar
// categoriaDeAlarma(alarm.type) en su campo tipoAlarma, no alarm.type tal cual.
function categoriaDeAlarma(type) {
  if (type === "fuga_grave" || type === "fuga_leve" || type === "fuga_rearmada") return "fugas";
  if (type === "fallo_electrico" || type === "fallo_electrico_resuelto") return "fallo_electrico";
  if (type === "embozo") return "embozo";
  if (type === "presion_baja" || type === "presion_alta") return "presion";
  if (type === "humedad_fuera_rango") return "humedad";
  if (type === "ec_fuera_rango") return "ec";
  if (type === "temperatura_fuera_rango") return "temperatura";
  if (type === "multiples_lineas") return "multiples_lineas";
  if (type === "fertilizante_bajo" || type === "fertilizante_agotado" || type === "fertilizante_rellenado") return "fertilizante";
  return null;
}

function debeNotificar(alarm, tecnico) {
  const categoria = categoriaDeAlarma(alarm.type);
  if (!categoria) return true;
  const prefs = tecnico?.alarmas;
  if (!prefs || prefs[categoria] === undefined) return true;
  return prefs[categoria] !== false;
}

function textoAlarma(alarm) {
  if (alarm.type === "fallo_conexion") {
    return {
      titulo: "🔌 Sin datos del sistema — todo detenido",
      descripcion: "No se está recibiendo ningún dato (ni sensores, ni caudal, ni presión) — comunicación totalmente perdida, o la batería de respaldo del PLC se ha agotado.",
      accion: "El sistema se ha apagado solo, como medida de seguridad. Se reactivará automáticamente en cuanto vuelvan a llegar datos.",
    };
  }
  if (alarm.type === "fallo_conexion_resuelto") {
    return {
      titulo: "🔌 Datos recuperados — sistema reactivado",
      descripcion: "Ha vuelto a recibirse información del sistema.",
      accion: "El sistema se ha reactivado automáticamente.",
    };
  }
  if (alarm.type === "corte_corriente_plc") {
    return {
      titulo: "⚡ Corte de corriente en el PLC — sistema apagado",
      descripcion: "El controlador de campo (Loxone) se ha quedado sin corriente eléctrica. No se puede activar ninguna electroválvula sin corriente.",
      accion:
        "El sistema se ha apagado como medida de seguridad. Gracias a la batería de respaldo, los sensores (humedad, presión, caudal) siguen llegando con normalidad mientras dure la batería. Reactiva el sistema manualmente desde el botón de arriba en cuanto vuelva la corriente.",
    };
  }
  if (alarm.type === "rotura_antes_electrovalvulas") {
    return {
      titulo: "⛔ Rotura antes de las electroválvulas — maestra cerrada",
      descripcion: alarm.detalle || "El caudalímetro general detecta agua que ninguna línea explica.",
      accion:
        "Requiere intervención de un técnico: localizar la rotura en la tubería general (antes del colector) y repararla. La electroválvula maestra ha sido cerrada automáticamente y no se reabrirá hasta que se rearme manualmente desde el panel.",
    };
  }
  if (alarm.type === "fuga_grave") {
    return {
      titulo: "Fuga grave (rotura)",
      descripcion: `Caudal medido de ${alarm.flowMeasured} L/h frente a ${alarm.nominalFlow} L/h esperados según los emisores instalados (≥150% del nominal).`,
      accion:
        "Revisar con urgencia la electroválvula, el ramal y los emisores de la línea indicada por probable rotura de tubería o conexión suelta. La línea ha sido aislada automáticamente por el panel y no regará hasta que se rearme manualmente tras la reparación.",
    };
  }
  if (alarm.type === "fuga_leve") {
    return {
      titulo: "Fuga leve (goteo)",
      descripcion: `Caudal medido de ${alarm.flowMeasured} L/h frente a ${alarm.nominalFlow} L/h esperados (entre 115% y 150% del nominal).`,
      accion:
        "Revisar conexiones y emisores de la línea en la próxima visita de mantenimiento. No es urgente: la línea sigue funcionando con normalidad, pero conviene comprobarla antes de que empeore.",
    };
  }
  if (alarm.type === "fallo_electrico") {
    return {
      titulo: "Fallo eléctrico de electroválvula",
      descripcion: "La línea estaba programada para regar pero el caudalímetro no ha registrado caudal alguno durante varios ciclos seguidos.",
      accion:
        "Comprobar la alimentación eléctrica de la electroválvula, el solenoide, el cableado y la conexión al programador. La línea ha sido aislada automáticamente y no volverá a intentarlo hasta que se rearme manualmente.",
    };
  }
  if (alarm.type === "fallo_electrico_resuelto") {
    return {
      titulo: "Electroválvula rearmada tras fallo eléctrico",
      descripcion: "La línea ha sido rearmada manualmente tras una incidencia de falta de respuesta de la electroválvula.",
      accion: "Confirmar que la línea vuelve a regar con normalidad en el próximo ciclo programado.",
    };
  }
  if (alarm.type === "presion_baja" || alarm.type === "presion_alta") {
    const cual = alarm.type === "presion_baja" ? "por debajo de 1,0 bar" : "por encima de 4,0 bar";
    return {
      titulo: alarm.type === "presion_baja" ? "Presión de red sostenidamente baja" : "Presión de red sostenidamente alta",
      descripcion: `La presión de la red (${alarm.value} bar) lleva varios minutos ${cual} de forma continuada.`,
      accion:
        alarm.type === "presion_baja"
          ? "Comprobar el suministro de agua, posibles fugas en el ramal principal, filtro obstruido, o número de líneas regando simultáneamente."
          : "Comprobar el regulador de presión de cabezal; una presión excesiva y sostenida puede dañar emisores y juntas.",
    };
  }
  if (alarm.type === "embozo") {
    return {
      titulo: "Posible embozo",
      descripcion: `Caudal medido de ${alarm.flowMeasured} L/h frente a ${alarm.nominalFlow} L/h esperados (por debajo del 85% del nominal), con la presión de red en rango de trabajo.`,
      accion: "Revisar y limpiar los emisores (goteros/microaspersores) de la línea y comprobar el filtro de cabezal en la próxima visita.",
    };
  }
  if (alarm.type === "humedad_fuera_rango") {
    return {
      titulo: "Humedad de sustrato fuera de rango",
      descripcion: `Humedad medida de ${alarm.valor}% fuera del rango configurado (${alarm.min}%–${alarm.max}%) para esta línea.`,
      accion: "Comprobar el sensor de humedad y el estado del sustrato; ajustar la programación o el umbral si el rango configurado ya no es adecuado.",
    };
  }
  if (alarm.type === "ec_fuera_rango") {
    return {
      titulo: "Conductividad (CE) fuera de rango",
      descripcion: `CE medida de ${alarm.valor} mS/cm fuera del rango configurado (${alarm.min}–${alarm.max} mS/cm) para esta línea.`,
      accion: "Revisar la fertirrigación y la calidad del agua de riego de esta línea; comprobar el sensor de CE.",
    };
  }
  if (alarm.type === "temperatura_fuera_rango") {
    return {
      titulo: "Temperatura fuera de rango",
      descripcion: `Temperatura medida de ${alarm.valor}°C fuera del rango configurado (${alarm.min}°C–${alarm.max}°C) para esta línea.`,
      accion: "Comprobar riesgo de helada o estrés térmico según el caso; revisar el sensor de temperatura.",
    };
  }
  if (alarm.type === "multiples_lineas") {
    return {
      titulo: "Varias líneas con incidencias",
      descripcion: `${alarm.cantidad} líneas presentan alguna incidencia simultáneamente: ${alarm.lineas}.`,
      accion:
        "Cuando varias líneas fallan a la vez, sospechar primero de una causa común: presión de cabezal, filtro obstruido, corte de suministro o fallo del propio programador, antes de revisar cada línea por separado.",
    };
  }
  if (alarm.type === "fertilizante_bajo") {
    return {
      titulo: "Nivel de fertilizante bajo",
      descripcion: `El depósito de fertilizante está al ${alarm.value}%, por debajo del 15% de reserva recomendado.`,
      accion: "Preparar el rellenado del depósito de fertirrigación en los próximos días para no interrumpir la dosificación.",
    };
  }
  if (alarm.type === "fertilizante_agotado") {
    return {
      titulo: "Depósito de fertilizante prácticamente agotado",
      descripcion: `El depósito de fertilizante está al ${alarm.value}%, por debajo del 5%. El riego sigue funcionando con agua, pero sin dosificación efectiva.`,
      accion: "Rellenar el depósito de fertilizante lo antes posible para no perder el aporte nutricional programado.",
    };
  }
  if (alarm.type === "fertilizante_rellenado") {
    return {
      titulo: "Depósito de fertilizante rellenado",
      descripcion: "El depósito se ha marcado como rellenado al 100% desde el panel.",
      accion: "Ninguna acción requerida; aviso informativo de cierre de incidencia.",
    };
  }
  return {
    titulo: "Electroválvula rearmada",
    descripcion: "La línea ha sido rearmada manualmente y ha vuelto a funcionar con normalidad.",
    accion: "Ninguna acción requerida; aviso informativo de cierre de incidencia.",
  };
}

function construirAviso(alarm, tecnico) {
  const { titulo, descripcion, accion } = textoAlarma(alarm);
  const fecha = new Date(alarm.ts).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
  const saludo = tecnico?.nombre ? `Hola ${tecnico.nombre},` : "Hola,";
  const subject = `Verdtical Control · ${titulo} — ${alarm.lineName}`;
  const body = [
    saludo,
    "",
    `Se ha registrado una incidencia en el sistema de riego Verdtical:`,
    "",
    `Línea: ${alarm.lineName}`,
    `Tipo: ${titulo}`,
    `Fecha y hora: ${fecha}`,
    `Detalle: ${descripcion}`,
    "",
    `Acción recomendada: ${accion}`,
    "",
    "Este aviso se ha generado desde el panel de control de riego Verdtical.",
  ].join("\n");
  return { subject, body };
}

function buildMailtoUrl(alarm, tecnico) {
  const { subject, body } = construirAviso(alarm, tecnico);
  const destino = tecnico?.emailAvisos || tecnico?.email || "";
  return `mailto:${encodeURIComponent(destino)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function buildWhatsappUrl(alarm, tecnico) {
  const { subject, body } = construirAviso(alarm, tecnico);
  const telefono = (tecnico?.telefono || "").replace(/[^0-9]/g, "");
  const texto = `${subject}\n\n${body}`;
  return `https://wa.me/${telefono}?text=${encodeURIComponent(texto)}`;
}

function simulateSector(sector, active, hour) {
  const s = sector.sensors || { humidity: 45, temperature: 21, ec: 1.8, flowMeasured: 0 };
  const nominalFlow = Number(sector.emitters || 0) * Number(sector.emitterFlow || 0);

  // Retorno a la media: además de la variación por riego, cada sensor tira
  // suavemente hacia un valor central realista, para que no derive sin freno
  // durante sesiones largas y dispare avisos falsos.
  const HUMEDAD_OBJETIVO = 45;
  const EC_OBJETIVO = 1.8;
  const RETORNO_HUMEDAD = 0.12;
  const RETORNO_EC = 0.08;

  const humidityDelta = active ? 0.6 + Math.random() * 0.8 : -(0.15 + Math.random() * 0.25);
  const humidityConRiego = s.humidity + humidityDelta;
  const humidity = clamp(
    Math.round((humidityConRiego + (HUMEDAD_OBJETIVO - humidityConRiego) * RETORNO_HUMEDAD) * 10) / 10,
    5,
    95
  );

  const ecDelta = active ? (Math.random() - 0.3) * 0.06 : (Math.random() - 0.5) * 0.02;
  const ecConRiego = s.ec + ecDelta;
  const ec = clamp(Math.round((ecConRiego + (EC_OBJETIVO - ecConRiego) * RETORNO_EC) * 100) / 100, 0.3, 4.5);

  const baseTemp = 18 + 6 * Math.sin(((hour - 7) / 24) * 2 * Math.PI);
  const temperature = Math.round((baseTemp + (Math.random() - 0.5)) * 10) / 10;

  const flowMeasured = active ? Math.round(nominalFlow * (0.9 + Math.random() * 0.18)) : 0;

  return { humidity, ec, temperature, flowMeasured };
}

function ValveHandle({ open, size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 46 46" aria-hidden="true">
      <circle cx="23" cy="23" r="21" fill="none" stroke="var(--vc-border)" strokeWidth="2" />
      <line x1="6" y1="23" x2="40" y2="23" stroke="var(--vc-pipe)" strokeWidth="4" strokeLinecap="round" />
      <g style={{ transition: "transform 0.35s cubic-bezier(.4,0,.2,1)", transformOrigin: "23px 23px", transform: open ? "rotate(0deg)" : "rotate(90deg)" }}>
        <rect x="10" y="19" width="26" height="8" rx="4" fill="var(--vc-brass)" />
        <circle cx="23" cy="23" r="4.5" fill="var(--vc-brass-dark)" />
      </g>
    </svg>
  );
}

function StatusDot({ active, mode }) {
  const color = active ? "var(--vc-open)" : "var(--vc-red)";
  return (
    <svg width="24" height="34" viewBox="0 0 14 20" style={{ flexShrink: 0, overflow: "visible" }}>
      {/* cuerpo del magnetotérmico */}
      <rect x="1" y="1" width="12" height="18" rx="2" fill="#0a1413" stroke="var(--vc-border)" strokeWidth="1" />
      {/* marca "ON" arriba y "OFF" abajo, como en un interruptor real */}
      <line x1="4" y1="4.5" x2="10" y2="4.5" stroke="var(--vc-text-muted)" strokeWidth="0.8" />
      <line x1="4" y1="15.5" x2="10" y2="15.5" stroke="var(--vc-text-muted)" strokeWidth="0.8" />
      {/* palanca: sube (encendido) o baja (apagado) */}
      <rect
        x="3.5"
        y={active ? "2.5" : "11.5"}
        width="7"
        height="6"
        rx="1.5"
        fill={color}
        stroke="#12201f"
        strokeWidth="0.8"
        style={{ transition: "y 0.25s ease" }}
      />
    </svg>
  );
}

function Co2LeafIcon() {
  return (
    <svg width="24" height="34" viewBox="0 0 14 20" style={{ flexShrink: 0, overflow: "visible" }}>
      {/* hoja: captación de CO2 */}
      <path d="M7 2 C 12 4.5, 12.5 12, 7 18 C 1.5 12, 2 4.5, 7 2 Z" fill="#6fcf87" stroke="#1a3324" strokeWidth="1" />
      <path d="M7 4 C 7 8, 7 12, 7 16" stroke="#1a3324" strokeWidth="0.8" fill="none" />
      <path d="M7 8 L 9.5 6.5 M7 8 L 4.5 6.5 M7 12 L 9.5 10.5 M7 12 L 4.5 10.5" stroke="#1a3324" strokeWidth="0.6" fill="none" />
    </svg>
  );
}

function MiniAguaIcon({ active, danger }) {
  const color = danger ? "#e2504f" : "#4fb6c4";
  const girando = danger || active;
  return (
    <svg width="60" height="36" viewBox="0 0 26 16" style={{ flexShrink: 0, overflow: "visible" }}>
      <rect x="1" y="5" width="24" height="6" rx="3" fill="#0a1413" stroke={danger ? "#e2504f" : "#378add"} strokeWidth="1" />
      {(active || danger) && (
        <line
          x1="2.5"
          y1="8"
          x2="23.5"
          y2="8"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="3 2.5"
          className="vc-llave-flujo"
        />
      )}
      <circle cx="13" cy="8" r="4.2" fill="#0a1413" stroke={color} strokeWidth="1.2" />
      <g className={girando ? "vc-aspas-giro" : ""} style={{ transformOrigin: "13px 8px" }}>
        <line x1="13" y1="4.5" x2="13" y2="11.5" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
        <line x1="10" y1="5.5" x2="16" y2="10.5" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
        <line x1="10" y1="10.5" x2="16" y2="5.5" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function SensorStat({ label, value, unit, warn, wide, onClick, active, iconoAgua, lineaActiva }) {
  const clases = `vc-sensor${warn ? " vc-sensor-warn" : ""}${wide ? " vc-sensor-wide" : ""}${onClick ? " vc-sensor-clickable" : ""}${
    active ? " vc-sensor-active" : ""
  }`;
  return (
    <div className={clases} onClick={onClick} role={onClick ? "button" : undefined}>
      {iconoAgua ? <MiniAguaIcon active={lineaActiva} /> : <span className="vc-sensor-label">{label}</span>}
      <span className="vc-sensor-value">
        {value}
        <span className="vc-sensor-unit">{unit}</span>
      </span>
    </div>
  );
}

function HorarioRow({ evento, index, onChange, onRemove, canRemove, conflicto }) {
  const toggleDay = (dayKey) => {
    const days = evento.days.includes(dayKey)
      ? evento.days.filter((d) => d !== dayKey)
      : [...evento.days, dayKey];
    onChange({ ...evento, days });
  };

  return (
    <div className={conflicto ? "vc-event-block vc-event-block-conflicto" : "vc-event-block"}>
      <div className="vc-event-header">
        <span className="vc-event-title">Riego {index + 1}</span>
        {canRemove && (
          <button className="vc-event-remove" onClick={onRemove} aria-label={`Eliminar riego ${index + 1}`}>
            ×
          </button>
        )}
      </div>
      {conflicto && (
        <p className="vc-conflicto-hint">
          ⚠ se cruza con {conflicto.lineName} ({String(Math.floor(conflicto.inicio / 60)).padStart(2, "0")}:
          {String(conflicto.inicio % 60).padStart(2, "0")}–{String(Math.floor(conflicto.fin / 60)).padStart(2, "0")}:
          {String(conflicto.fin % 60).padStart(2, "0")}): el caudalímetro no distinguirá el agua de cada línea si riegan a la vez.
        </p>
      )}
      <div className="vc-day-row">
        {DIAS.map((d) => (
          <button
            key={d.key}
            className={evento.days.includes(d.key) ? "vc-day vc-day-on" : "vc-day"}
            onClick={() => toggleDay(d.key)}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className="vc-field-row">
        <label>
          Hora inicio
          <input type="time" value={evento.time} onChange={(e) => onChange({ ...evento, time: e.target.value })} />
        </label>
        <label>
          Duración (min)
          <input
            type="number"
            min="1"
            max="180"
            value={evento.duration}
            onChange={(e) => onChange({ ...evento, duration: Number(e.target.value) })}
          />
        </label>
      </div>
    </div>
  );
}

function SectorCard({ sector, now, mainSupply, maestraCerrada, tecnico, cliente, presionEnRangoTrabajo, balanceHidrico, umbralBalanceHidrico, todosLosSectores, etoSol, etoSemisombra, etoSombra, alarmHistory, onUpdate, onRemove, onRearm, onRearmFault }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [showCharts, setShowCharts] = useState(false);
  const [combinedView, setCombinedView] = useState("hora");
  const [combinedAnnualOffset, setCombinedAnnualOffset] = useState(0);
  const [editingSeason, setEditingSeason] = useState(() => getSeasonForDate(now));
  const [avisoConflictoHorario, setAvisoConflictoHorario] = useState(null);
  const [manualMinutes, setManualMinutes] = useState(5);
  const [showRiegoLog, setShowRiegoLog] = useState(false);
  const [showLineAnnualConsumo, setShowLineAnnualConsumo] = useState(false);
  const [showHumidityAnnual, setShowHumidityAnnual] = useState(false);
  const [showHumidityYearFull, setShowHumidityYearFull] = useState(false);
  const [humidityAnnualOffset, setHumidityAnnualOffset] = useState(0);
  const [showTemperatureAnnual, setShowTemperatureAnnual] = useState(false);
  const [showTemperatureYearFull, setShowTemperatureYearFull] = useState(false);
  const [temperatureAnnualOffset, setTemperatureAnnualOffset] = useState(0);
  const [showEcAnnual, setShowEcAnnual] = useState(false);
  const [showEcYearFull, setShowEcYearFull] = useState(false);
  const [ecAnnualOffset, setEcAnnualOffset] = useState(0);
  const [showFlowAnnual, setShowFlowAnnual] = useState(false);
  const [showFlowYearFull, setShowFlowYearFull] = useState(false);
  const [flowAnnualOffset, setFlowAnnualOffset] = useState(0);
  const [selectedHourlyDay, setSelectedHourlyDay] = useState(null);
  const [lineAnnualOffset, setLineAnnualOffset] = useState(0);
  const active = mainSupply && !maestraCerrada && isSectorActiveNow(sector, now);
  const manualActive = isManualOverrideActive(sector, now);
  const manualRemainingMs = manualActive ? new Date(sector.manualOverride.endsAt).getTime() - now.getTime() : 0;
  const nextEvent = nextEventForSector(sector, now);
  const nominalFlow = Number(sector.emitters || 0) * Number(sector.emitterFlow || 0);
  const sensors = sector.sensors || { humidity: 0, temperature: 0, ec: 0, flowMeasured: 0, litersToday: 0 };
  const th = sector.thresholds || { humidityMin: 30, humidityMax: 65, ecMin: 1.2, ecMax: 2.4 };
  const schedules = sector.schedules || {};
  const activeSeason = getSeasonForDate(now);
  const activeEventos = schedules[activeSeason] || [];
  const eventos = schedules[editingSeason] || [];
  const lineHistory = sector.history || [];

  const combinarHistoricos = (limite) => {
    const dailyLiters = sector.dailyConsumption || [];
    const dailyHum = sector.humidityDailyHistory || [];
    const dailyTemp = sector.temperatureDailyHistory || [];
    const dailyEc = sector.ecDailyHistory || [];
    const base = limite ? dailyLiters.slice(-limite) : dailyLiters;
    const fechasBase = base.map((d) => d.date);
    const filas = fechasBase.map((fecha) => {
      const l = dailyLiters.find((d) => d.date === fecha);
      const h = dailyHum.find((d) => d.date === fecha);
      const t = dailyTemp.find((d) => d.date === fecha);
      const e = dailyEc.find((d) => d.date === fecha);
      return {
        date: fecha,
        label: l ? l.label : fecha,
        liters: l ? l.liters : 0,
        humidity: h ? h.avgHumidity : null,
        temperature: t ? t.avgTemperature : null,
        ec: e ? e.avgEc : null,
      };
    });
    filas.push({
      label: "Hoy",
      liters: sensors.litersToday || 0,
      humidity: sensors.humidity,
      temperature: sensors.temperature,
      ec: sensors.ec,
    });
    return filas;
  };
  const combinedDailyData = combinarHistoricos(7);
  const combinedAnnualData = combinarHistoricos(null);
  const lineDailyChart = [...(sector.dailyConsumption || []), { label: "Hoy", liters: sensors.litersToday || 0, isToday: true }];
  const humidityChartHoraria = [
    ...(sector.humidityHourlyHistory || []),
    { label: "Ahora", humidity: sensors.humidity, isToday: true },
  ];
  const humidityChartAnual = [
    ...(sector.humidityDailyHistory || []),
    { label: "Hoy", avgHumidity: sensors.humidity, isToday: true },
  ];
  const temperatureChartHoraria = [
    ...(sector.temperatureHourlyHistory || []),
    { label: "Ahora", temperature: sensors.temperature, isToday: true },
  ];
  const temperatureChartAnual = [
    ...(sector.temperatureDailyHistory || []),
    { label: "Hoy", avgTemperature: sensors.temperature, isToday: true },
  ];
  const ecChartHoraria = [...(sector.ecHourlyHistory || []), { label: "Ahora", ec: sensors.ec, isToday: true }];
  const ecChartAnual = [...(sector.ecDailyHistory || []), { label: "Hoy", avgEc: sensors.ec, isToday: true }];
  const flowChartHoraria = [
    ...(sector.flowHourlyHistory || []),
    { label: "Ahora", flow: sensors.flowMeasured, isToday: true },
  ];
  const flowChartAnual = [
    ...(sector.flowDailyHistory || []),
    { label: "Hoy", avgFlow: sensors.flowMeasured, isToday: true },
  ];
  const hourlyChart = Array.isArray(sector.hourlyConsumption) ? sector.hourlyConsumption : Array(24).fill(0);
  const horasDelDia = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}h`);
  const hourlyHistory = sector.hourlyHistory || [];
  const esHoySeleccionado = selectedHourlyDay === "hoy";
  const diaHistoricoSeleccionado = hourlyHistory.find((d) => d.date === selectedHourlyDay);
  const diaEnDailyConsumption = (sector.dailyConsumption || []).find((d) => d.date === selectedHourlyDay);
  const diaSeleccionadoLabel = esHoySeleccionado
    ? "Hoy"
    : diaHistoricoSeleccionado?.label || diaEnDailyConsumption?.label || selectedHourlyDay;
  const hayDatosHorarios = esHoySeleccionado || !!diaHistoricoSeleccionado;
  const horasSeleccionadas = esHoySeleccionado ? hourlyChart : diaHistoricoSeleccionado?.hours || Array(24).fill(0);

  const humidityWarn = sensors.humidity < th.humidityMin || sensors.humidity > th.humidityMax;
  const ecWarn = sensors.ec < th.ecMin || sensors.ec > th.ecMax;
  const temperatureWarn = sensors.temperature < (th.temperatureMin ?? -99) || sensors.temperature > (th.temperatureMax ?? 99);
  const presionImpideDiagnostico = active && nominalFlow > 0 && !presionEnRangoTrabajo;
  const flowMinPct = (th.flowMinPercent ?? 85) / 100;
  const flowMaxPct = (th.flowMaxPercent ?? 115) / 100;
  const clogWarn = !presionImpideDiagnostico && active && nominalFlow > 0 && sensors.flowMeasured < nominalFlow * flowMinPct;
  const leakLeveWarn =
    !presionImpideDiagnostico &&
    active &&
    nominalFlow > 0 &&
    sensors.flowMeasured >= nominalFlow * flowMaxPct &&
    sensors.flowMeasured < nominalFlow * 1.5;
  const leakGraveWarn = !presionImpideDiagnostico && active && nominalFlow > 0 && sensors.flowMeasured >= nominalFlow * 1.5;
  const flowOk = !presionImpideDiagnostico && active && nominalFlow > 0 && !clogWarn && !leakLeveWarn && !leakGraveWarn;
  const flowWarn = clogWarn || leakLeveWarn || leakGraveWarn;

  const updateEvento = (idx, updated) => {
    const nuevos = eventos.map((ev, i) => (i === idx ? updated : ev));
    onUpdate({ ...sector, schedules: { ...schedules, [editingSeason]: nuevos } });
  };

  const removeEvento = (idx) => {
    onUpdate({ ...sector, schedules: { ...schedules, [editingSeason]: eventos.filter((_, i) => i !== idx) } });
  };

  const addEvento = () => {
    if (eventos.length >= MAX_HORARIOS_POR_LINEA) return;
    const last = eventos[eventos.length - 1];
    let horaNueva = "06:00";
    if (last) {
      const [h, m] = last.time.split(":").map(Number);
      const siguienteHora = (h + 1) % 24;
      horaNueva = `${String(siguienteHora).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
    const nuevos = [...eventos, nuevoHorario(last ? { time: horaNueva, days: [...last.days] } : {})];
    onUpdate({ ...sector, schedules: { ...schedules, [editingSeason]: nuevos } });
  };

  const iniciarRiegoManual = () => {
    const minutos = Math.max(1, Math.min(180, Number(manualMinutes) || 1));
    const endsAt = new Date(now.getTime() + minutos * 60000).toISOString();
    onUpdate({ ...sector, manualOverride: { active: true, endsAt, minutes: minutos } });
  };

  const detenerRiegoManual = () => {
    onUpdate({ ...sector, manualOverride: null });
  };

  return (
    <div
      className={sector.blockedByLeak ? "vc-card vc-card-leak" : "vc-card"}
      style={{
        zIndex:
          editingSchedule ||
          showCharts ||
          showRiegoLog ||
          showLineAnnualConsumo ||
          showHumidityAnnual ||
          showTemperatureAnnual ||
          showEcAnnual ||
          showFlowAnnual
            ? 5
            : 1,
        gridColumn:
          showCharts ||
          showRiegoLog ||
          showLineAnnualConsumo ||
          showHumidityAnnual ||
          showTemperatureAnnual ||
          showEcAnnual ||
          showFlowAnnual
            ? "span 2"
            : undefined,
      }}
    >
      <div className="vc-card-top">
        <div className="vc-card-title">
          <input
            className="vc-name-input"
            value={sector.name}
            onChange={(e) => onUpdate({ ...sector, name: e.target.value })}
            aria-label="Nombre de la línea"
          />
        </div>
        <button className="vc-icon-btn" onClick={() => setConfirmDelete(true)} aria-label="Eliminar línea" title="Eliminar línea">
          ×
        </button>
      </div>

      {confirmDelete && (
        <div className="vc-confirm-delete">
          <span>¿Eliminar {sector.name}? Se perderá su historial de riegos y consumo.</span>
          <div className="vc-confirm-delete-actions">
            <button className="vc-confirm-cancel" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </button>
            <button className="vc-confirm-yes" onClick={onRemove}>
              Sí, eliminar
            </button>
          </div>
        </div>
      )}

      <div className="vc-card-body">
        <ValveHandle open={active} />
        <div className="vc-readout">
          <span className="vc-readout-label">{active ? "abierta" : "cerrada"}</span>
          <span className="vc-readout-value">{nominalFlow} L/h nom.</span>
        </div>
      </div>

      <div className="vc-sensor-grid">
        <SensorStat
          label="Humedad"
          value={sensors.humidity}
          unit="%"
          warn={humidityWarn}
          onClick={() => setShowHumidityAnnual((v) => !v)}
          active={showHumidityAnnual}
        />
        <SensorStat
          label="Temp."
          value={sensors.temperature}
          unit="°C"
          warn={temperatureWarn}
          onClick={() => setShowTemperatureAnnual((v) => !v)}
          active={showTemperatureAnnual}
        />
        <SensorStat
          label="CE"
          value={sensors.ec}
          unit="mS/cm"
          warn={ecWarn}
          onClick={() => setShowEcAnnual((v) => !v)}
          active={showEcAnnual}
        />
        <SensorStat
          label="Caudalím."
          value={sensors.flowMeasured}
          unit="L/h"
          warn={flowWarn}
          onClick={() => setShowFlowAnnual((v) => !v)}
          active={showFlowAnnual}
        />
        <SensorStat
          value={sensors.litersToday || 0}
          unit="L"
          warn={false}
          wide
          iconoAgua
          lineaActiva={active}
          onClick={() => setShowLineAnnualConsumo((v) => !v)}
          active={showLineAnnualConsumo}
        />
      </div>
      {showHumidityAnnual && (
        <div className="vc-annual-chart-wrap">
          <div className="vc-hourly-detail-title">
            <span>Humedad — lecturas reales por hora ({humidityChartHoraria.length} lecturas, últimos 7 días)</span>
            <button className="vc-cal-dia-cerrar-btn" onClick={() => setShowHumidityAnnual(false)}>
              ✕
            </button>
          </div>
          <TrendChart
            data={humidityChartHoraria}
            color="var(--vc-flow)"
            unit="%"
            dataKey="humidity"
            height={200}
            umbralMin={th.humidityMin}
            umbralMax={th.humidityMax}
          />
          <button className="vc-toggle-btn vc-annual-toggle" onClick={() => setShowHumidityYearFull((v) => !v)}>
            {showHumidityYearFull
              ? "ocultar historial de 1 año"
              : `ver historial de 1 año (${humidityChartAnual.length} días, media diaria)`}
          </button>
          {showHumidityYearFull && (
            <div className="vc-annual-chart-wrap">
              <TrendChart
                data={ventanaDatos(humidityChartAnual, humidityAnnualOffset, VENTANA_DIAS_HISTORICO)}
                color="var(--vc-violet)"
                unit="%"
                dataKey="avgHumidity"
                height={200}
                umbralMin={th.humidityMin}
                umbralMax={th.humidityMax}
              />
              <ChartNavBar
                offset={humidityAnnualOffset}
                setOffset={setHumidityAnnualOffset}
                total={humidityChartAnual.length}
                windowSize={VENTANA_DIAS_HISTORICO}
              />
            </div>
          )}
        </div>
      )}
      {showTemperatureAnnual && (
        <div className="vc-annual-chart-wrap">
          <div className="vc-hourly-detail-title">
            <span>Temperatura — lecturas reales por hora ({temperatureChartHoraria.length} lecturas, últimos 7 días)</span>
            <button className="vc-cal-dia-cerrar-btn" onClick={() => setShowTemperatureAnnual(false)}>
              ✕
            </button>
          </div>
          <TrendChart
            data={temperatureChartHoraria}
            color="var(--vc-heat)"
            unit="°C"
            dataKey="temperature"
            height={200}
            umbralMin={th.temperatureMin}
            umbralMax={th.temperatureMax}
          />
          <button className="vc-toggle-btn vc-annual-toggle" onClick={() => setShowTemperatureYearFull((v) => !v)}>
            {showTemperatureYearFull
              ? "ocultar historial de 1 año"
              : `ver historial de 1 año (${temperatureChartAnual.length} días, media diaria)`}
          </button>
          {showTemperatureYearFull && (
            <div className="vc-annual-chart-wrap">
              <TrendChart
                data={ventanaDatos(temperatureChartAnual, temperatureAnnualOffset, VENTANA_DIAS_HISTORICO)}
                color="var(--vc-violet)"
                unit="°C"
                dataKey="avgTemperature"
                height={200}
                umbralMin={th.temperatureMin}
                umbralMax={th.temperatureMax}
              />
              <ChartNavBar
                offset={temperatureAnnualOffset}
                setOffset={setTemperatureAnnualOffset}
                total={temperatureChartAnual.length}
                windowSize={VENTANA_DIAS_HISTORICO}
              />
            </div>
          )}
        </div>
      )}
      {showEcAnnual && (
        <div className="vc-annual-chart-wrap">
          <div className="vc-hourly-detail-title">
            <span>CE — lecturas reales por hora ({ecChartHoraria.length} lecturas, últimos 7 días)</span>
            <button className="vc-cal-dia-cerrar-btn" onClick={() => setShowEcAnnual(false)}>
              ✕
            </button>
          </div>
          <TrendChart
            data={ecChartHoraria}
            color="var(--vc-violet)"
            unit="mS/cm"
            dataKey="ec"
            height={200}
            umbralMin={th.ecMin}
            umbralMax={th.ecMax}
          />
          <button className="vc-toggle-btn vc-annual-toggle" onClick={() => setShowEcYearFull((v) => !v)}>
            {showEcYearFull ? "ocultar historial de 1 año" : `ver historial de 1 año (${ecChartAnual.length} días, media diaria)`}
          </button>
          {showEcYearFull && (
            <div className="vc-annual-chart-wrap">
              <TrendChart
                data={ventanaDatos(ecChartAnual, ecAnnualOffset, VENTANA_DIAS_HISTORICO)}
                color="var(--vc-brass)"
                unit="mS/cm"
                dataKey="avgEc"
                height={200}
                umbralMin={th.ecMin}
                umbralMax={th.ecMax}
              />
              <ChartNavBar offset={ecAnnualOffset} setOffset={setEcAnnualOffset} total={ecChartAnual.length} windowSize={VENTANA_DIAS_HISTORICO} />
            </div>
          )}
        </div>
      )}
      {showFlowAnnual && (
        <div className="vc-annual-chart-wrap">
          <div className="vc-hourly-detail-title">
            <span>Caudalímetro — lecturas reales por hora ({flowChartHoraria.length} lecturas, últimos 7 días)</span>
            <button className="vc-cal-dia-cerrar-btn" onClick={() => setShowFlowAnnual(false)}>
              ✕
            </button>
          </div>
          <TrendChart
            data={flowChartHoraria}
            color="var(--vc-flow)"
            unit="L/h"
            dataKey="flow"
            height={200}
            umbralMin={nominalFlow > 0 ? Math.round(nominalFlow * ((th.flowMinPercent ?? 85) / 100)) : undefined}
            umbralMax={nominalFlow > 0 ? Math.round(nominalFlow * ((th.flowMaxPercent ?? 115) / 100)) : undefined}
          />
          <button className="vc-toggle-btn vc-annual-toggle" onClick={() => setShowFlowYearFull((v) => !v)}>
            {showFlowYearFull ? "ocultar historial de 1 año" : `ver historial de 1 año (${flowChartAnual.length} días, media diaria)`}
          </button>
          {showFlowYearFull && (
            <div className="vc-annual-chart-wrap">
              <TrendChart
                data={ventanaDatos(flowChartAnual, flowAnnualOffset, VENTANA_DIAS_HISTORICO)}
                color="var(--vc-brass)"
                unit="L/h"
                dataKey="avgFlow"
                height={200}
                umbralMin={nominalFlow > 0 ? Math.round(nominalFlow * ((th.flowMinPercent ?? 85) / 100)) : undefined}
                umbralMax={nominalFlow > 0 ? Math.round(nominalFlow * ((th.flowMaxPercent ?? 115) / 100)) : undefined}
              />
              <ChartNavBar
                offset={flowAnnualOffset}
                setOffset={setFlowAnnualOffset}
                total={flowChartAnual.length}
                windowSize={VENTANA_DIAS_HISTORICO}
              />
            </div>
          )}
          {presionImpideDiagnostico && (
            <p className="vc-thresholds-note">
              ⚠ Presión de red fuera de rango ahora mismo: los umbrales de caudal no se están evaluando para esta línea hasta que la
              presión vuelva a 1,8–3,5 bar.
            </p>
          )}
          <div className="vc-outage-log">
            <div className="vc-outage-log-title">Alarmas de caudal registradas — {(sector.flowAlarmLog || []).length}</div>
            {(sector.flowAlarmLog || []).length === 0 ? (
              <div className="vc-chart-empty">sin alarmas de sobre-caudal ni embozo registradas</div>
            ) : (
              (sector.flowAlarmLog || []).slice(0, 30).map((a, i) => {
                const etiqueta =
                  a.tipo === "embozo" ? "Embozo (caudal bajo)" : a.tipo === "fuga_leve" ? "Sobre-caudal leve" : "Sobre-caudal grave";
                const claseColor = a.tipo === "fuga_grave" ? "vc-flow-alarm-item-grave" : "vc-flow-alarm-item-leve";
                return (
                  <div className={"vc-outage-log-item " + claseColor} key={i}>
                    <span>
                      {etiqueta} · {new Date(a.ts).toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "short" })} ·{" "}
                      {new Date(a.ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span>
                      {a.flowMeasured} L/h ({a.porcentaje}% del nominal)
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
      {showLineAnnualConsumo && (
        <div className="vc-annual-chart-wrap">
          <div className="vc-hourly-detail-title">
            <span>
              Consumo diario — historial de 1 año ({(sector.dailyConsumption || []).length} días) — pulsa un día para ver sus horas
            </span>
            <button className="vc-cal-dia-cerrar-btn" onClick={() => setShowLineAnnualConsumo(false)}>
              ✕
            </button>
          </div>
          <DailyBarChart
            data={ventanaDatos(lineDailyChart, lineAnnualOffset, VENTANA_DIAS_HISTORICO)}
            color="var(--vc-brass)"
            unit="L"
            height={220}
            onBarClick={(entry) => setSelectedHourlyDay(entry.date || "hoy")}
          />
          <ChartNavBar
            offset={lineAnnualOffset}
            setOffset={setLineAnnualOffset}
            total={lineDailyChart.length}
            windowSize={VENTANA_DIAS_HISTORICO}
          />
          {selectedHourlyDay && (
            <div className="vc-hourly-detail">
              <div className="vc-hourly-detail-title">
                <span>Consumo por hora — {diaSeleccionadoLabel}</span>
                <button className="vc-cal-dia-cerrar-btn" onClick={() => setSelectedHourlyDay(null)}>
                  ✕
                </button>
              </div>
              {hayDatosHorarios ? (
                <DailyBarChart
                  data={horasDelDia.map((h, i) => ({
                    label: h,
                    liters: horasSeleccionadas[i],
                    isToday: esHoySeleccionado && i === new Date().getHours(),
                  }))}
                  color="var(--vc-flow)"
                  unit="L"
                  height={160}
                  todayColor="var(--vc-brass)"
                />
              ) : (
                <div className="vc-chart-empty">
                  No hay detalle por hora guardado para este día (solo se conservan los últimos 14 días).
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {presionImpideDiagnostico && (
        <div className="vc-alert-line vc-alert-pressure-first">
          ⚠ presión de red fuera de 1,8–3,5 bar: comprobar la presión antes de diagnosticar embozo o fuga en esta línea (el caudal medido
          no es fiable con esta presión)
        </div>
      )}
      {balanceHidrico &&
        balanceHidrico.hayDatos &&
        Math.abs(balanceHidrico.diferenciaPct) >= (umbralBalanceHidrico ?? 30) &&
        balanceHidrico.necesidadTeorica > 0 && (
          <div className={"vc-alert-line " + (balanceHidrico.diferenciaLinea >= 0 ? "vc-alert-escorrentia" : "vc-alert-deficit")}>
            ⚠ {balanceHidrico.diferenciaLinea >= 0 ? "posible escorrentía" : "posible déficit de riego"} AYER: se regaron{" "}
            {balanceHidrico.consumoRealLinea} L frente a {balanceHidrico.necesidadTeorica} L necesarios (
            {balanceHidrico.diferenciaLinea >= 0 ? "+" : ""}
            {balanceHidrico.diferenciaPct}%)
          </div>
        )}
      {(humidityWarn || ecWarn || temperatureWarn || flowWarn) && (
        <div className="vc-alert-line">
          ⚠ {humidityWarn ? "humedad fuera de rango · " : ""}
          {temperatureWarn ? "temperatura fuera de rango · " : ""}
          {ecWarn ? "CE fuera de rango · " : ""}
          {clogWarn ? "posible embozo: caudal por debajo de lo requerido por los emisores" : ""}
          {leakLeveWarn ? "posible goteo (fuga leve): caudal algo por encima de lo esperado" : ""}
          {leakGraveWarn ? "fuga grave: caudal muy por encima de lo esperado" : ""}
        </div>
      )}
      {flowOk && !humidityWarn && !ecWarn && !temperatureWarn && <div className="vc-alert-line vc-alert-ok">✓ caudal correcto</div>}

      {sector.blockedByLeak && (
        <div className="vc-blocked-banner">
          <span>
            ⚠ Fuga grave detectada ({sensors.flowMeasured} L/h frente a {nominalFlow} L/h esperados) — electroválvula aislada
            automáticamente.
          </span>
          <div className="vc-leak-actions">
            {tecnico.alarmas?.fugas !== false && (
              <>
                <a
                  className="vc-alarm-notify-link"
                  href={buildMailtoUrl(
                    { lineId: sector.id, lineName: sector.name, ts: now.toISOString(), flowMeasured: sensors.flowMeasured, nominalFlow, type: "fuga_grave" },
                    tecnico
                  )}
                >
                  ✉ avisar técnico
                </a>
                {tecnico.telefono && (
                  <a
                    className="vc-alarm-notify-link"
                    href={buildWhatsappUrl(
                      { lineId: sector.id, lineName: sector.name, ts: now.toISOString(), flowMeasured: sensors.flowMeasured, nominalFlow, type: "fuga_grave" },
                      tecnico
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    💬 WhatsApp
                  </a>
                )}
              </>
            )}
            {cliente?.alarmas?.fugas === true && cliente.email && (
              <a
                className="vc-alarm-notify-link vc-alarm-notify-link-cliente"
                href={buildMailtoUrl(
                  { lineId: sector.id, lineName: sector.name, ts: now.toISOString(), flowMeasured: sensors.flowMeasured, nominalFlow, type: "fuga_grave" },
                  cliente
                )}
              >
                ✉ avisar cliente
              </a>
            )}
            <button className="vc-leak-rearm vc-leak-rearm-sm" onClick={() => onRearm(sector.id, sector.name)}>
              Rearmar
            </button>
          </div>
        </div>
      )}

      {sector.blockedByFault && (
        <div className="vc-blocked-banner vc-blocked-banner-fault">
          <span>⚠ posible fallo eléctrico: no responde</span>
          <div className="vc-leak-actions">
            {tecnico.alarmas?.fallo_electrico !== false && (
              <a
                className="vc-alarm-notify-link"
                href={buildMailtoUrl(
                  { lineId: sector.id, lineName: sector.name, ts: now.toISOString(), type: "fallo_electrico" },
                  tecnico
                )}
              >
                ✉ avisar técnico
              </a>
            )}
            {cliente?.alarmas?.fallo_electrico === true && cliente.email && (
              <a
                className="vc-alarm-notify-link vc-alarm-notify-link-cliente"
                href={buildMailtoUrl(
                  { lineId: sector.id, lineName: sector.name, ts: now.toISOString(), type: "fallo_electrico" },
                  cliente
                )}
              >
                ✉ avisar cliente
              </a>
            )}
            <button className="vc-leak-rearm vc-leak-rearm-sm" onClick={() => onRearmFault(sector.id, sector.name)}>
              Rearmar
            </button>
          </div>
        </div>
      )}

      <div className="vc-toggle-row">
        <button className="vc-toggle-btn" onClick={() => setShowCharts((v) => !v)}>
          {showCharts ? "ocultar gráficas en grupo" : "ver gráficas en grupo"}
        </button>
        <button className="vc-toggle-btn" onClick={() => setShowRiegoLog((v) => !v)}>
          {showRiegoLog ? "ocultar historial" : `ver historial de riegos (${(sector.riegoLog || []).length})`}
        </button>
      </div>

      {showCharts && (
        <div className="vc-combined-chart-wrap">
          <div className="vc-mini-chart-title">
            <span>
              Gráficas en grupo (humedad, temperatura, CE y agua) —{" "}
              {combinedView === "hora"
                ? "últimos ~30 min"
                : combinedView === "dia"
                ? "última semana (media diaria)"
                : `historial de 1 año (${combinedAnnualData.length} días, media diaria)`}
            </span>
          </div>
          <div className="vc-day-tabs">
            <button
              className={combinedView === "hora" ? "vc-day-tab vc-day-tab-on" : "vc-day-tab"}
              onClick={() => setCombinedView("hora")}
            >
              por hora
            </button>
            <button
              className={combinedView === "dia" ? "vc-day-tab vc-day-tab-on" : "vc-day-tab"}
              onClick={() => setCombinedView("dia")}
            >
              por día (7 días)
            </button>
            <button
              className={combinedView === "año" ? "vc-day-tab vc-day-tab-on" : "vc-day-tab"}
              onClick={() => setCombinedView("año")}
            >
              por año
            </button>
          </div>
          {combinedView === "hora" ? (
            lineHistory.length > 1 ? (
              <CombinedLineChart data={lineHistory} height={240} />
            ) : (
              <div className="vc-chart-empty vc-chart-empty-sm">registrando…</div>
            )
          ) : combinedView === "dia" ? (
            combinedDailyData.length > 1 ? (
              <CombinedLineChart data={combinedDailyData} height={240} />
            ) : (
              <div className="vc-chart-empty vc-chart-empty-sm">todavía no hay una semana de datos guardados</div>
            )
          ) : combinedAnnualData.length > 1 ? (
            <>
              <CombinedLineChart data={ventanaDatos(combinedAnnualData, combinedAnnualOffset, VENTANA_DIAS_HISTORICO)} height={240} />
              <ChartNavBar
                offset={combinedAnnualOffset}
                setOffset={setCombinedAnnualOffset}
                total={combinedAnnualData.length}
                windowSize={VENTANA_DIAS_HISTORICO}
              />
            </>
          ) : (
            <div className="vc-chart-empty vc-chart-empty-sm">todavía no hay suficiente histórico guardado</div>
          )}
        </div>
      )}

      {showRiegoLog && (
        <div className="vc-riego-log">
          {(sector.riegoLog || []).length === 0 ? (
            <div className="vc-history-empty">todavía no hay riegos registrados en esta línea</div>
          ) : (
            (sector.riegoLog || []).map((r) => (
              <div className="vc-riego-log-item" key={r.id}>
                <span className={`vc-riego-tag vc-riego-tag-${r.tipo}`}>{r.tipo}</span>
                <span className="vc-riego-log-time">
                  {new Date(r.startTs).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  {" – "}
                  {new Date(r.endTs).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="vc-riego-log-stats">
                  {r.durationMin} min · {r.liters} L
                </span>
              </div>
            ))
          )}
          <div className="vc-history-title vc-history-title-sub">
            Historial de fugas en esta línea ({(alarmHistory || []).filter((a) => a.lineId === sector.id && (a.type === "fuga_grave" || a.type === "fuga_rearmada")).length})
          </div>
          {(alarmHistory || []).filter((a) => a.lineId === sector.id && (a.type === "fuga_grave" || a.type === "fuga_rearmada")).length === 0 ? (
            <div className="vc-history-empty">sin fugas registradas todavía en esta línea</div>
          ) : (
            (alarmHistory || [])
              .filter((a) => a.lineId === sector.id && (a.type === "fuga_grave" || a.type === "fuga_rearmada"))
              .map((a) => (
                <div className="vc-riego-log-item" key={a.id}>
                  <span className={a.type === "fuga_rearmada" ? "vc-riego-tag vc-riego-tag-fuga-ok" : "vc-riego-tag vc-riego-tag-fuga"}>
                    {a.type === "fuga_rearmada" ? "✓ rearmada" : "⚠ fuga"}
                  </span>
                  <span className="vc-riego-log-time">
                    {new Date(a.ts).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {a.flowMeasured !== undefined && (
                    <span className="vc-riego-log-stats">
                      {a.flowMeasured} L/h (esperado {a.nominalFlow} L/h)
                    </span>
                  )}
                </div>
              ))
          )}
        </div>
      )}

      <div className="vc-mode-toggle">
        <button
          className={sector.mode === "horario" ? "vc-mode-btn vc-mode-btn-on" : "vc-mode-btn"}
          onClick={() => onUpdate({ ...sector, mode: "horario" })}
        >
          Horario
        </button>
        <button
          className={sector.mode === "sensor" ? "vc-mode-btn vc-mode-btn-on" : "vc-mode-btn"}
          onClick={() => onUpdate({ ...sector, mode: "sensor" })}
        >
          Riego con sensor
        </button>
        <button
          className={sector.mode === "apagado" ? "vc-mode-btn vc-mode-btn-on" : "vc-mode-btn"}
          onClick={() => onUpdate({ ...sector, mode: "apagado" })}
        >
          Apagado
        </button>
      </div>

      <div className="vc-manual-block">
        {manualActive ? (
          <>
            <span className="vc-manual-countdown">
              riego manual en curso · quedan {Math.max(0, Math.ceil(manualRemainingMs / 60000))} min
            </span>
            <button className="vc-manual-stop" onClick={detenerRiegoManual}>
              Detener
            </button>
          </>
        ) : (
          <>
            <input
              type="number"
              min="1"
              max="180"
              className="vc-manual-input"
              value={manualMinutes}
              onChange={(e) => setManualMinutes(e.target.value)}
              aria-label="Minutos de riego manual"
            />
            <span className="vc-manual-unit">min</span>
            <button className="vc-manual-start" onClick={iniciarRiegoManual} disabled={sector.blockedByLeak}>
              Riego manual
            </button>
          </>
        )}
      </div>

      {sector.mode === "sensor" && (
        <div className="vc-sensor-hint">
          humedad {sensors.humidity}% · mínimo {th.humidityMin}% →{" "}
          {sensors.humidity < th.humidityMin ? "regará en el próximo horario" : "dentro de rango, no riega"}
        </div>
      )}

      {sector.mode === "apagado" && !manualActive ? (
        <div className="vc-next-event">línea apagada — no regará por horario hasta que cambies el modo</div>
      ) : sector.mode === "apagado" ? null : (
        <div className="vc-next-event">
          próximo riego: <strong>{formatEventDate(nextEvent, now)}</strong>
          <span className="vc-event-count">
            {" "}
            · {activeEventos.length} horario{activeEventos.length !== 1 ? "s" : ""} · {ESTACIONES.find((e) => e.key === activeSeason)?.label}
          </span>
        </div>
      )}

      <div className="vc-exposicion-fila">
        <span className="vc-exposicion-label">exposición:</span>
        <select
          value={sector.exposicion || "sol"}
          onChange={(e) => onUpdate({ ...sector, exposicion: e.target.value })}
          className="vc-plano-input-sm"
        >
          <option value="sol">☀ sol</option>
          <option value="semisombra">⛅ semisombra</option>
          <option value="sombra">☁ sombra</option>
        </select>
      </div>

      <button className="vc-link-btn" onClick={() => setEditingSchedule((v) => !v)}>
        {editingSchedule ? "ocultar horarios y umbrales" : "editar horarios y umbrales"}
      </button>

      {editingSchedule && (
        <div className="vc-schedule-editor">
          {sector.areaM2 > 0 && (
            <div className="vc-auto-programa">
              <label className="vc-auto-duracion-label">
                Duración de cada tanda (min)
                <input
                  type="number"
                  min="1"
                  value={sector.duracionTandaAuto ?? 15}
                  onChange={(e) => onUpdate({ ...sector, duracionTandaAuto: Math.max(1, Number(e.target.value) || 1) })}
                  className="vc-plano-input-sm"
                  onClick={(e) => e.stopPropagation()}
                />
              </label>
              <button
                className="vc-cliente-copiar-btn"
                onClick={() => {
                  const etoLinea = { sol: etoSol ?? 7, semisombra: etoSemisombra ?? 4.75, sombra: etoSombra ?? 2.5 }[sector.exposicion] ?? (etoSol ?? 7);
                  const ocupacionPorEstacion = {};
                  ESTACIONES.forEach((est) => {
                    ocupacionPorEstacion[est.key] = obtenerOcupacion(todosLosSectores, sector.id, est.key);
                  });
                  const { schedules: nuevosSchedules, resumenPorEstacion } = calcularProgramacionAutomaticaTodasEstaciones({
                    areaM2: sector.areaM2,
                    etoBase: etoLinea,
                    nominalFlow,
                    duracionSesion: sector.duracionTandaAuto ?? 15,
                    ocupacionPorEstacion,
                  });
                  onUpdate({ ...sector, schedules: nuevosSchedules });
                  const conflictosTotales = Object.values(resumenPorEstacion).reduce((sum, r) => sum + r.conflictosSinResolver, 0);
                  if (conflictosTotales > 0) {
                    setAvisoConflictoHorario(
                      `⚠ ${conflictosTotales} tanda(s), repartidas entre las 4 estaciones, no encontraron hueco libre del todo — revísalas a mano.`
                    );
                  } else {
                    setAvisoConflictoHorario(null);
                  }
                }}
              >
                🔄 calcular programación automática (las 4 estaciones)
              </button>
              <p className="vc-tecnico-hint" style={{ margin: "4px 0 0" }}>
                Con {sector.areaM2} m² y exposición "{sector.exposicion || "sol"}", calcula, PARA CADA ESTACIÓN por separado,
                cuántas tandas de {sector.duracionTandaAuto ?? 15} min hacen falta para completar el agua que toca ese trimestre —
                el tamaño de tanda se mantiene siempre igual, lo que cambia es cuántas veces se repite (menos en invierno, más en
                verano), evitando coincidir con las demás líneas en cada estación por separado. Cambia el número de ahí arriba y
                vuelve a pulsar para recalcular con otro tamaño de tanda.
              </p>
              {avisoConflictoHorario && <p className="vc-tecnico-hint" style={{ color: "var(--vc-red)", margin: "4px 0 0" }}>{avisoConflictoHorario}</p>}
            </div>
          )}
          <div className="vc-season-tabs">
            {ESTACIONES.map((est) => (
              <button
                key={est.key}
                className={editingSeason === est.key ? "vc-season-tab vc-season-tab-on" : "vc-season-tab"}
                onClick={() => setEditingSeason(est.key)}
              >
                {est.label}
                {activeSeason === est.key && <span className="vc-season-dot" title="Estación en curso" />}
              </button>
            ))}
          </div>
          {(() => {
            const ocupacionEstacion = obtenerOcupacion(todosLosSectores, sector.id, editingSeason);
            return eventos.map((ev, idx) => {
              const conflicto = buscarConflicto(ev.days, horaAMinutos(ev.time), Number(ev.duration || 0), ocupacionEstacion);
              return (
                <HorarioRow
                  key={ev.id}
                  evento={ev}
                  index={idx}
                  onChange={(updated) => updateEvento(idx, updated)}
                  onRemove={() => removeEvento(idx)}
                  canRemove={eventos.length > 1}
                  conflicto={conflicto}
                />
              );
            });
          })()}
          <button className="vc-add-event-btn" onClick={addEvento} disabled={eventos.length >= MAX_HORARIOS_POR_LINEA}>
            + añadir horario ({eventos.length}/{MAX_HORARIOS_POR_LINEA})
          </button>

          <div className="vc-threshold-title">Umbrales de sensores</div>
          <div className="vc-field-row">
            <label>
              Emisores
              <input
                type="number"
                min="1"
                value={sector.emitters}
                onChange={(e) => onUpdate({ ...sector, emitters: Number(e.target.value) })}
              />
            </label>
            <label>
              Caudal/emisor (L/h)
              <input
                type="number"
                min="1"
                value={sector.emitterFlow}
                onChange={(e) => onUpdate({ ...sector, emitterFlow: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="vc-field-row">
            <label>
              Humedad mín (%)
              <input
                type="number"
                value={th.humidityMin}
                onChange={(e) => onUpdate({ ...sector, thresholds: { ...th, humidityMin: Number(e.target.value) } })}
              />
            </label>
            <label>
              Humedad máx (%)
              <input
                type="number"
                value={th.humidityMax}
                onChange={(e) => onUpdate({ ...sector, thresholds: { ...th, humidityMax: Number(e.target.value) } })}
              />
            </label>
          </div>
          <div className="vc-field-row">
            <label>
              CE mín (mS/cm)
              <input
                type="number"
                step="0.1"
                value={th.ecMin}
                onChange={(e) => onUpdate({ ...sector, thresholds: { ...th, ecMin: Number(e.target.value) } })}
              />
            </label>
            <label>
              CE máx (mS/cm)
              <input
                type="number"
                step="0.1"
                value={th.ecMax}
                onChange={(e) => onUpdate({ ...sector, thresholds: { ...th, ecMax: Number(e.target.value) } })}
              />
            </label>
          </div>
          <div className="vc-field-row">
            <label>
              Temp. mín (°C)
              <input
                type="number"
                value={th.temperatureMin ?? ""}
                onChange={(e) => onUpdate({ ...sector, thresholds: { ...th, temperatureMin: Number(e.target.value) } })}
              />
            </label>
            <label>
              Temp. máx (°C)
              <input
                type="number"
                value={th.temperatureMax ?? ""}
                onChange={(e) => onUpdate({ ...sector, thresholds: { ...th, temperatureMax: Number(e.target.value) } })}
              />
            </label>
          </div>
          <div className="vc-field-row">
            <label>
              Embozo si caudal &lt; (% nominal)
              <input
                type="number"
                min="1"
                max="99"
                value={th.flowMinPercent ?? 85}
                onChange={(e) => onUpdate({ ...sector, thresholds: { ...th, flowMinPercent: Number(e.target.value) } })}
              />
            </label>
            <label>
              Fuga leve si caudal &gt; (% nominal)
              <input
                type="number"
                min="101"
                value={th.flowMaxPercent ?? 115}
                onChange={(e) => onUpdate({ ...sector, thresholds: { ...th, flowMaxPercent: Number(e.target.value) } })}
              />
            </label>
          </div>
          <p className="vc-thresholds-note">
            ⚠ La presión de red (1,8–3,5 bar) se comprueba siempre antes de aplicar estos umbrales: con la presión fuera de rango, el
            panel no diagnostica embozo ni fuga en esta línea, para evitar falsos avisos por falta de agua en origen.
          </p>
        </div>
      )}
    </div>
  );
}

function CollectorFlow({ lines }) {
  const count = Math.max(lines.length, 1);
  const width = Math.max(320, count * 90);
  const anyActive = lines.some((l) => l.active);
  const activeNames = lines.filter((l) => l.active).map((l) => l.name);
  return (
    <div>
      <svg viewBox={`0 0 ${width} 56`} width="100%" height="56" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="16" x2={width} y2="16" stroke="var(--vc-pipe)" strokeWidth="6" strokeLinecap="round" />
        {anyActive && (
          <line x1="0" y1="16" x2={width} y2="16" stroke="var(--vc-flow)" strokeWidth="3" strokeDasharray="10 10" strokeLinecap="round">
            <animate attributeName="stroke-dashoffset" from="0" to="-40" dur="0.8s" repeatCount="indefinite" />
          </line>
        )}
        {lines.map((l, i) => {
          const x = ((i + 0.5) / count) * width;
          const color = l.active ? "var(--vc-open)" : "var(--vc-pipe)";
          return (
            <g key={i}>
              <line x1={x} y1="16" x2={x} y2="34" stroke={color} strokeWidth={l.active ? 3 : 2} strokeLinecap="round" />
              <circle cx={x} cy="34" r={l.active ? 3.5 : 2.5} fill={color} />
              {l.active && (
                <text x={x} y="48" textAnchor="middle" fontSize="9" fontFamily="var(--vc-font-mono)" fill="var(--vc-open)">
                  {l.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="vc-collector-status">
        {activeNames.length > 0 ? `regando ahora: ${activeNames.join(", ")}` : "sin riego activo"}
      </div>
    </div>
  );
}

function PressureGauge({ bar }) {
  const min = 0;
  const max = 5;
  const pct = clamp((bar - min) / (max - min), 0, 1);
  const angle = -90 + pct * 180;
  return (
    <svg width="64" height="40" viewBox="0 0 64 40" aria-hidden="true">
      <path d="M 6 36 A 26 26 0 0 1 58 36" fill="none" stroke="var(--vc-border)" strokeWidth="5" strokeLinecap="round" />
      <path
        d="M 6 36 A 26 26 0 0 1 58 36"
        fill="none"
        stroke={bar < 1.0 || bar > 4.0 ? "var(--vc-red)" : "var(--vc-flow)"}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${pct * 81.7} 200`}
      />
      <line
        x1="32"
        y1="36"
        x2={32 + 20 * Math.cos((angle * Math.PI) / 180)}
        y2={36 + 20 * Math.sin((angle * Math.PI) / 180)}
        stroke="var(--vc-brass)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="32" cy="36" r="2.5" fill="var(--vc-brass)" />
    </svg>
  );
}

function FertilizerGauge({ level, consumiendo }) {
  const color = level < 5 ? "var(--vc-red)" : level < 15 ? "var(--vc-amber)" : "var(--vc-violet)";
  const alturaLlena = (level / 100) * 26;
  const yLiquido = 34 - alturaLlena;
  return (
    <svg width="32" height="42" viewBox="0 0 30 40" aria-hidden="true" style={{ flexShrink: 0 }}>
      <defs>
        <clipPath id="vc-fert-clip">
          <rect x="6" y={yLiquido} width="18" height={alturaLlena} />
        </clipPath>
      </defs>
      <rect x="6" y="4" width="18" height="4" rx="1" fill="var(--vc-border)" />
      <rect x="4" y="8" width="22" height="28" rx="3" fill="none" stroke="var(--vc-border)" strokeWidth="2" />
      <rect x="6" y={yLiquido} width="18" height={alturaLlena} rx="1" fill={color} />
      {consumiendo && alturaLlena > 1.5 && (
        <g clipPath="url(#vc-fert-clip)">
          <g className="vc-fert-baja">
            <line x1="2" y1="-10" x2="32" y2="-2" stroke="rgba(255,255,255,0.4)" strokeWidth="2.2" />
            <line x1="2" y1="0" x2="32" y2="8" stroke="rgba(255,255,255,0.4)" strokeWidth="2.2" />
            <line x1="2" y1="10" x2="32" y2="18" stroke="rgba(255,255,255,0.4)" strokeWidth="2.2" />
            <line x1="2" y1="20" x2="32" y2="28" stroke="rgba(255,255,255,0.4)" strokeWidth="2.2" />
            <line x1="2" y1="30" x2="32" y2="38" stroke="rgba(255,255,255,0.4)" strokeWidth="2.2" />
            <line x1="2" y1="40" x2="32" y2="48" stroke="rgba(255,255,255,0.4)" strokeWidth="2.2" />
          </g>
        </g>
      )}
    </svg>
  );
}

function CombinedTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div
      style={{
        background: "var(--vc-panel-2)",
        border: "1px solid var(--vc-border)",
        borderRadius: 6,
        padding: "6px 10px",
        fontSize: 11,
        fontFamily: "var(--vc-font-mono)",
        color: "var(--vc-text)",
      }}
    >
      <div style={{ color: "var(--vc-text-muted)", marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.value} {p.unit}
        </div>
      ))}
    </div>
  );
}

function CombinedLineChart({ data, height = 220 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
        <CartesianGrid stroke="var(--vc-border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: "var(--vc-text-muted)", fontSize: 10 }}
          interval="preserveStartEnd"
          minTickGap={40}
          axisLine={{ stroke: "var(--vc-border)" }}
          tickLine={false}
        />
        <YAxis
          yAxisId="humidity"
          domain={["auto", "auto"]}
          orientation="left"
          width={30}
          tick={{ fill: "var(--vc-flow)", fontSize: 9 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          yAxisId="ec"
          domain={["auto", "auto"]}
          orientation="left"
          width={30}
          tick={{ fill: "var(--vc-violet)", fontSize: 9 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          yAxisId="temperature"
          domain={["auto", "auto"]}
          orientation="right"
          width={30}
          tick={{ fill: "var(--vc-heat)", fontSize: 9 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          yAxisId="liters"
          domain={["auto", "auto"]}
          orientation="right"
          width={30}
          tick={{ fill: "var(--vc-brass)", fontSize: 9 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<CombinedTooltip />} />
        <Legend wrapperStyle={{ fontSize: 10, color: "var(--vc-text-muted)" }} />
        <Line
          yAxisId="humidity"
          type="monotone"
          dataKey="humidity"
          name="Humedad"
          unit="%"
          stroke="var(--vc-flow)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="temperature"
          type="monotone"
          dataKey="temperature"
          name="Temperatura"
          unit="°C"
          stroke="var(--vc-heat)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="ec"
          type="monotone"
          dataKey="ec"
          name="CE"
          unit="mS/cm"
          stroke="var(--vc-violet)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="liters"
          type="monotone"
          dataKey="liters"
          name="Agua acumulada hoy"
          unit="L"
          stroke="var(--vc-brass)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ChartTooltip({ active, payload, label, unit }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div
      style={{
        background: "var(--vc-panel-2)",
        border: "1px solid var(--vc-border)",
        borderRadius: 6,
        padding: "6px 10px",
        fontSize: 11,
        fontFamily: "var(--vc-font-mono)",
        color: "var(--vc-text)",
      }}
    >
      <div style={{ color: "var(--vc-text-muted)", marginBottom: 2 }}>{label}</div>
      <div>
        {payload[0].value} {unit}
      </div>
    </div>
  );
}

function TrendChart({ data, color, unit, dataKey = "value", height = 130, umbralMin, umbralMax }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid stroke="var(--vc-border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: "var(--vc-text-muted)", fontSize: 10 }}
          interval="preserveStartEnd"
          minTickGap={40}
          axisLine={{ stroke: "var(--vc-border)" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "var(--vc-text)", fontSize: 11, fontWeight: 500 }}
          width={40}
          axisLine={false}
          tickLine={false}
          domain={[
            (dataMin) => (umbralMin !== undefined ? Math.min(dataMin, umbralMin) - 2 : dataMin),
            (dataMax) => (umbralMax !== undefined ? Math.max(dataMax, umbralMax) + 2 : dataMax),
          ]}
        />
        <Tooltip content={<ChartTooltip unit={unit} />} />
        {umbralMin !== undefined && (
          <ReferenceLine
            y={umbralMin}
            stroke="var(--vc-red)"
            strokeDasharray="4 4"
            strokeWidth={1.5}
            label={{ value: `mín ${umbralMin}`, position: "insideBottomLeft", fill: "var(--vc-red)", fontSize: 9 }}
          />
        )}
        {umbralMax !== undefined && (
          <ReferenceLine
            y={umbralMax}
            stroke="var(--vc-red)"
            strokeDasharray="4 4"
            strokeWidth={1.5}
            label={{ value: `máx ${umbralMax}`, position: "insideTopLeft", fill: "var(--vc-red)", fontSize: 9 }}
          />
        )}
        <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

const VENTANA_DIAS_HISTORICO = 30;

function ventanaDatos(data, offset, windowSize) {
  const total = data.length;
  const fin = Math.max(0, total - offset);
  const inicio = Math.max(0, fin - windowSize);
  return data.slice(inicio, fin);
}

function ChartNavBar({ offset, setOffset, total, windowSize }) {
  const puedeVerAnteriores = offset + windowSize < total;
  const puedeVerRecientes = offset > 0;
  const finVentana = Math.max(0, total - offset);
  const inicioVentana = Math.max(0, finVentana - windowSize);
  return (
    <div className="vc-chart-nav">
      <button
        className="vc-chart-nav-btn"
        disabled={!puedeVerAnteriores}
        onClick={() => setOffset((o) => Math.min(o + windowSize, Math.max(0, total - windowSize)))}
      >
        ← días anteriores
      </button>
      <span className="vc-chart-nav-label">
        {inicioVentana + 1}–{finVentana} de {total} días
      </span>
      <button className="vc-chart-nav-btn" disabled={!puedeVerRecientes} onClick={() => setOffset((o) => Math.max(0, o - windowSize))}>
        días siguientes →
      </button>
      {puedeVerRecientes && (
        <button className="vc-chart-nav-btn vc-chart-nav-hoy" onClick={() => setOffset(0)}>
          ir a hoy
        </button>
      )}
    </div>
  );
}

function DailyBarChart({ data, color, unit, height = 130, dataKey = "liters", todayColor = "var(--vc-flow)", onBarClick }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }} barCategoryGap="20%" barGap={0}>
        <CartesianGrid stroke="var(--vc-border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: "var(--vc-text-muted)", fontSize: 10 }}
          interval="preserveStartEnd"
          minTickGap={40}
          axisLine={{ stroke: "var(--vc-border)" }}
          tickLine={false}
        />
        <YAxis tick={{ fill: "var(--vc-text)", fontSize: 11, fontWeight: 500 }} width={40} axisLine={false} tickLine={false} />
        <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ fill: "var(--vc-panel-2)" }} />
        <Bar
          dataKey={dataKey}
          radius={[2, 2, 0, 0]}
          maxBarSize={16}
          onClick={onBarClick}
          style={onBarClick ? { cursor: "pointer" } : undefined}
        >
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.isToday ? todayColor : color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const PLANO_DEMO_IMAGEN = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBAUEBAYFBQUGBgYHCQ4JCQgICRINDQoOFRIWFhUSFBQXGiEcFxgfGRQUHScdHyIjJSUlFhwpLCgkKyEkJST/2wBDAQYGBgkICREJCREkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCT/wAARCAKGBXgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD6h+xx/wB0flR9jj/uj8qsUUAV/scf90flR9jj/uj8qsUUAV/scf8AdH5UfY4/7o/KrFFAFf7HH/dH5UfY4/7o/KrFFAFf7HH/AHR+VH2OP+6PyqxRQBX+xx/3R+VH2OP+6PyqxRQBX+xx/wB0flR9jj/uj8qsUUAV/scf90flR9jj/uj8qsUUAV/scf8AdH5UfY4/7o/KrFFAFf7HH/dH5UfY4/7o/KrFFAFf7HH/AHR+VH2OP+6PyqxRQBX+xx/3R+VH2OP+6PyqxRQBX+xx/wB0flR9jj/uj8qsUUAV/scf90flR9jj/uj8qsUUAV/scf8AdH5UfY4/7o/KrFFAFf7HH/dH5UfY4/7o/KrFFAFf7HH/AHR+VH2OP+6PyqxRQBX+xx/3R+VH2OP+6PyqxRQBX+xx/wB0flR9jj/uj8qsUUAV/scf90flR9jj/uj8qsUUAV/scf8AdH5UfY4/7o/KrFFAFf7HH/dH5UfY4/7o/KrFFAFf7HH/AHR+VH2OP+6PyqxRQBX+xx/3R+VH2OP+6PyqxRQBX+xx/wB0flR9jj/uj8qsUUAV/scf90flR9jj/uj8qsUUAV/scf8AdH5UfY4/7o/KrFFAFf7HH/dH5UfY4/7o/KrFFAFf7HH/AHR+VH2OP+6PyqxRQBX+xx/3R+VH2OP+6PyqxRQBX+xx/wB0flR9jj/uj8qsUUAV/scf90flR9jj/uj8qsUUAV/scf8AdH5UfY4/7o/KrFFAFf7HH/dH5UfY4/7o/KrFFAFf7HH/AHR+VH2OP+6PyqxRQBX+xx/3R+VH2OP+6PyqxRQBX+xx/wB0flR9jj/uj8qsUUAV/scf90flR9jj/uj8qsUUAV/scf8AdH5UfY4/7o/KrFFAFf7HH/dH5UfY4/7o/KrFFAFf7HH/AHR+VH2OP+6PyqxRQBX+xx/3R+VH2OP+6PyqxRQBX+xx/wB0flR9jj/uj8qsUUAV/scf90flR9jj/uj8qsUUAV/scf8AdH5UfY4/7o/KrFFAFf7HH/dH5UfY4/7o/KrFFAFf7HH/AHR+VH2OP+6PyqxRQBX+xx/3R+VH2OP+6PyqxRQBX+xx/wB0flR9jj/uj8qsUUAV/scf90flR9jj/uj8qsUUAV/scf8AdH5UfY4/7o/KrFFAFf7HH/dH5UfY4/7o/KrFFAFf7HH/AHR+VH2OP+6PyqxRQBX+xx/3R+VH2OP+6PyqxRQBX+xx/wB0flR9jj/uj8qsUUAV/scf90flR9jj/uj8qsUUAV/scf8AdH5UfY4/7o/KrFFAFf7HH/dH5UfY4/7o/KrFFAFf7HH/AHR+VH2OP+6PyqxRQBX+xx/3R+VH2OP+6PyqxRQBX+xx/wB0flR9jj/uj8qsUUAV/scf90flR9jj/uj8qsUUAV/scf8AdH5UfY4/7o/KrFFAFf7HH/dH5UfY4/7o/KrFFAFf7HH/AHR+VH2OP+6PyqxRQBX+xx/3R+VH2OP+6PyqxRQBX+xx/wB0flR9jj/uj8qsUUAV/scf90flR9jj/uj8qsUUAV/scf8AdH5UfY4/7o/KrFFAFf7HH/dH5UfY4/7o/KrFFAFf7HH/AHR+VH2OP+6PyqxRQBX+xx/3R+VH2OP+6PyqxRQBX+xx/wB0flR9jj/uj8qsUUAV/scf90flR9jj/uj8qsUUAV/scf8AdH5UfY4/7o/KrFFAFf7HH/dH5UfY4/7o/KrFFAFf7HH/AHR+VH2OP+6PyqxRQBX+xx/3R+VH2OP+6PyqxRQBX+xx/wB0flR9jj/uj8qsUUAV/scf90flR9jj/uj8qsUUAV/scf8AdH5UfY4/7o/KrFFAFf7HH/dH5UfY4/7o/KrFFAFf7HH/AHR+VAtEByFA/CrFFADUTbTqKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigArlfG/j218IvYWioLnUL6eOKOHP3EZwpkbHQDOB6nj1rqWztO3GccZrxXxd4e8WaTp8l/qT6Hd3V/q1o73KvLv4lHlRgEYWNfQc9Tya5sVUlCPuo9vIsFQxOISxDVrrS9rt/ot31ei63XY6j4w8R3Wp63H4fsNNktNDwlx9sdxJcybN5WPbwuBxls5NdZoerwa9o1lqtsCIbyBJ1DdVDDOD7jpXnHxD0ZtNad9J1a/tdc8RIsD6ZYlWju5Qu0yfMCUUA/Mwxx7muw0y50vwLpnh3w3d3eJ5kWzt/kJ82RVGeg45Pf1qKU5KclN6fq3pb5WOjHYShLC054ePvPZJO9ox99vuua9mtLX7WT/HfjSz8D6FLqNwvnTkFbe2U/NM4GfwUDknsBTdWvfFU1jaXehR6Lsa286YXzSctgEKu3oOvzH8q4n4g+HvE8dp4o126fRrqB7KWCDc8vmWttjlUXG3e3Uk9Tx0rd1LUvD0vhG00Pxlq1pp81zZJK6w3Dw5QcAoxwSeB8vOfQiodWTc1LTRW6d+vmawwFGFGjOkvaScnzWXNpZPSOnw3+b8rHTeEfEA8U+G9P1oQNb/a4hIYic7TkgjPcZHB9K165b4YXV5eeBtLkvk2SBGSMmMRl4lYiNio6ZQKa6muynLmgn3R4eYUo0sVVpxVkpNLW+z79QoooqzjCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAoo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ACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAK5tviX4KSc27eLNCWYNsMZvY9wbOMYz68V0leez2lr/wvG1XyIefDUzY2Dr9qj5oW9g6HoWaM14vZeK9Rk1Cy1B/FNz/AG9P4kOmz+HdyGOO289kK+VjcNsIEvmZ59cHFVvDL+ItZ/4Q5rnxnru3xD/aCXaxyRgBISxjEZ2ZQjABYZJGfwFqrg97HuNFfO974/1i78NaakviLUkv7fSZrmSRL23sY2KzyxpM7spaV/3QBjRcZ6/eAqzf+PtbW50jVrrxFM8LadpdxLa6fdxQzQvKqly1rImLlZC38D5XBAGRQtf6/rsD0Pf6htb21vVka1uIp1jkaFzG4YK6nDKcdCDwR2rjPiRqtxaX/hzT5NXm0TSdQu5Y73UYZFiZCsTNHF5jAhN7Dr1O3A615Vp/iLU7SxsNP0zXhJpl/rGtSy6kdRjsDeSJONg8/wAtlBIZ3wAN23jgEFJ62Bn0dRXnVh4o8Rx/BS58QJNbarrUFhcywTW+ZEnKFwj/AHV3HaAThQGIOOCK8+/4TDxPbaFrhtPFcMy/2Zb3CSx6omoTQzPcxoJQViRUVlZvkOenAxmn1sHS59BzTxW6eZNKkaZC7nYAZJwBz6k4p+a8J8fxXVpHr2hX/iPVbjT9Pv8AQb5Li5uFWSDzbplkzIFGEGwMM8KRnoMVcvNd1Cz0XX9XufE+tlpvEMmj2kUEsKpFGJRtVXkA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9C2nLGZjcqdybPXjrT5JWTtuT7WF2rq63L9FYmmeNND1i8SzsrqWSdwSqtbSoDgZPLKB+tbdEouLtJWHCpGavB3CiiipLCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA5/x3/wAi4/8A182v/pRHXQVz/jv/AJFx/wDr5tf/AEojroKzXxv0X6nXP/dYf4pflAKKKK0OQKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKztD1+w8Q6RbatZSN9luQTGZBsJwxHQ+4NaJr50u/D2qS+H9H0y78LzO0eizrHLc6ZPfHz2mk/dJErqkMmAjea/YjB4NJsaR9F03zEKeZvXZ/ezx+deb39hrt/8D9NtPs2ozaj/AGfYi9tgxS6lRTH9ojySDvZA465JOO9c9eaPpktzZz2HgrWIPCEWpCS/svssirct9nZUlFp97y0fbuAX5mw2DtzVNWbRKd1c9paRFGWdQMZyT29aGdFxuYDJwMnqa8R0HwRNqniDQItT0C7/AOEcW71ea0sryJtltbMsIiSRD90FhKyo3QEcDGBg6h4V1RfDmjfadH1W5urSwvLWC0vdMlvbdwLqTy4gUcS20uwJtl6bcc/LSfQaPerPVtIvNa1G0tpYW1GxWKO6AXDIGBZFJ78EnA9a0hLGVLB1IHU54FeEap4Rub/xDqkd34XuoZNUv9BuJzHCzo8K7BcIZh97awO7JyRyaueMNNvdGt/HOgab4c1V01T7E2mLYWbNB5SRxo4DL8qbSjZU4OMYBzTsK57W0iISGdQQNxyeg9fpVHRde07xBpNtq2m3Kz2V0u6KXlQ4zjvXl9hoUP8AwlF4ms+EtV1DX5temlj1LYwhWybIQmf7vlLEQhhzycjbzmuc8K+G4NP0nw5D4m8H6pd6PaaVPaNYpp0knk6h5vzu0SjJLpgLLgjg8jNJbf1/XkM+gS6BgpYAntmhXRyQrAlTg4PQ14l4c8IaxDJLqOuaDeajqen+FYFs0lkO8XAkuSI1lzgTBDEpcHIz15qX4UaRfad47guI9IfT9Pl0No5f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AJBdp/1xT+VEYNfaf4f5FVMVCdrUoqzvpza+Wsnp+PmcRNqPjg65Gx8P6IJfkwv9pPj7kuOfL9N3bsPWun1+51yHSUfTNOs7q6cYmjmuTGkY2nJDBSTzx0FE/wDyMkX/AGz/APQJ61bv/j1m/wBxv5UKDStzP8P8hTxUJSTVKKt097X1978rHG+Gr/xizRpLoejpatKglkXUHZlXauSF8vk45xkVa8a3Wvw3ECaVpdhdwGJy0lxdmIhvQAKc8YOa2fD3/Hm/+8v/AKLSmeIPux/7kn8hQoO1uZ/h/kDxUHNS9lHTp71v/Sr/AInNXt94wl1KwXUNE0iCAuod4r93ZU86LJAMYyenFd5WLr//AB82n0/9rQ1j6be6j/wmk93La3C6fevJZRyGQlcxDKnZj5ckTfN3yvtQly6N3CclXvKMFGy6X1+9s7KivONT8W65bQMYbi6a68998IsMJCy5/c78HdkYPAyeu4CrOieI9Uk8SafYASCzkMiyqYcKOJGDBsE9VAySB1GCeaFVV7A8FNRcro76ivMRq/iK31lYIDJdmCe6MaXEbZkJklyowmDtUR4+YDDd8jF4azrVxE8kGpT3lqkSg79P8vzy+8N2B+XA6Y6c57ntEN4KSe6PQKK80v8AxXrlpp8/lz3SXa5UW62HyQYUmP8AeEHO8AHGGJzgba9E0+d7mwtp5F2vJEjsMYwSATxVRkpbGVXDyppN9SeiiiqMAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAoorHHi/Rf7WudKN5subZGkk3xssYCgM4DkbSVDKSAcgMM0AbFFZ1r4i0y8i0yWC5EiapH5towU/vU2b89OPl55qCXxdo8J1MPdEf2Woa6PlsQgOfbnoenpQBsVi+LfET+HNNimt7M3t3dXEdpawbwgklc4UFj0HBJPtW1XM/EOTSF8OMmr291cpLNHHbxWmRO1wT+78sgjDZ5B9qzrN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AK4L/hSnRdLIwdNs/wDvwv8AhQBS0zV4FtmHlXZ/fS9LZ/8Ano3tVLV9VgbULU+XdD7nW3cf8to/atoaJpY6abZ/9+F/wpDomlk5Om2R/wC2C/4UAJ/bEH/PG8/8Bn/wrG8ParAhl/d3R+Relu5/if2rb/sXTP8AoHWf/flf8KQaJpY6abZD6QL/AIUAZ+s6tA0EX7q7H7wdbdx/C3tVmy1eAWcA8q7/ANWv/Ls/oPapzomlnrptkf8Atgv+FL/Yulj/AJh1n/34X/CgDH/tWD+293l3X3v+fd/+ef0q5qmrwNpt2PKuxmF+tu4/hPtVv+xNLzn+zbLPr5C/4Up0XSyMHTbP/vwv+FAGbourQLby/urs/vn6W7nv9Kg1rVYGu7U+XdDCnrbuP+WsXtWwNE0sdNNsh/2wX/Cg6JpZ66bZH/tgv+FACf2xB/zxvP8AwGf/AArK0rVYFvLg+XdHg9Ld/wDnrJ7Vr/2Lpn/QOs/+/K/4Ug0TSx002yH/AGwX/CgCnqerwG2X91dj99F1tn/vr7UulavAumWo8q7OIl6Wz+n0q4dE0s9dNs/+/C/4UDRdLAwNNs/+/C/4UAYs2qwf8JFG3lXX/LPj7O+fuTe1ad1q8BtpR5V39xv+XZ/T6VN/Yml5z/Ztln18hf8ACl/sXTP+gdZ/9+F/woAytB1aBbRx5V0fmXpbuf4E9qZr2qwMsf7q6Hyydbdx2HtWuNE0sdNNsh/2wX/Cg6JpZ66bZH/tgv8AhQBkazqUM15ZoI7gE8fNAyj/AF0Pciukqouj6ajrImn2iupyrCFQQfUHFW6ACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAp/wBsWH/Pwv5H/Cj+2LD/AJ+F/I/4VS+yR+lH2SP0qrAXf7YsP+fhfyP+FH9sWH/Pwv5H/CqX2SP0o+yR+lFgLv8AbFh/z8L+R/wo/tiw/wCfhfyP+FUvskfpR9kj9KLAXf7YsP8An4X8j/hR/bFh/wA/C/kf8KpfZI/Sj7JH6UWAu/2xYf8APwv5H/Cj+2LD/n4X8j/hVL7JH6UfZI/SiwF3+2LD/n4X8j/hR/bFh/z8L+R/wql9kj9KPskfpRYC7/bFh/z8L+R/wo/tiw/5+F/I/wCFUvskfpR9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k/Wi4ENFTfY5P7yfrR9jk/vJ+tFwIaKm+xyf3k/Wj7HJ/eT9aLgQ0VN9jk/vJ+tH2OT+8n60XAhoqb7HJ/eT9aPscn95P1ouBDRU32OT+8n60fY5P7yfrRcCGipvscn95P1o+xyf3k/Wi4ENFTfY5P7yfrR9jk/vJ+tFwIaKm+xyf3k/Wj7HJ/eT9aLgQ0VN9jk/vJ+tH2OT+8n60XAhoqb7HJ/eT9aPscn95P1ouBDRU32OT+8n60fY5P7yfrRcCGipvscn95P1o+xyf3k/Wi4ENFTfY5P7yfrR9jk/vJ+tFwIaKm+xyf3k/Wj7HJ/eT9aLgQ0VN9jk/vJ+tH2OT+8n60XAhoqb7HJ/eT9aPscn95P1ouBDRU32OT+8n60fY5P7yfrRcCGipvscn95P1o+xyf3k/Wi4ENFTfY5P7yfrR9jk/vJ+tFwIaKm+xyf3k/Wj7HJ/eT9aLgQ0VN9jk/vJ+tH2OT+8n60XAhoqb7HJ/eT9aPscn95P1ouBDRU32OT+8n60fY5P7yfrRcCGipvscn95P1o+xyf3k/Wi4ENFTfY5P7yfrR9jk/vJ+tFwIaKm+xyf3k/Wj7HJ/eT9aLgQ0VN9jk/vJ+tH2OT+8n60XAhoqb7HJ/eT9aPscn95P1ouBDRU32OT+8n60fY5P7yfrRcCGipvscn95P1o+xyf3k/Wi4ENFTfY5P7yfrR9jk/vJ+tFwIaKm+xyf3k/Wj7HJ/eT9aLgQ0VN9jk/vJ+tH2OT+8n60XAhoqb7HJ/eT9aPscn95P1ouBDRU32OT+8n60fY5P7yfrRcCGipvscn95P1o+xyf3k/Wi4ENFTfY5P7yfrR9jk/vJ+tFwIaKm+xyf3k/Wj7HJ/eT9aLgQ0VN9jk/vJ+tH2OT+8n60XAhoqb7HJ/eT9aPscn95P1ouBDRU32OT+8n60fY5P7yfrRcCGipvscn95P1o+xyf3k/Wi4ENFTfY5P7yfrR9jk/vJ+tFwIaKm+xyf3k/Wj7HJ/eT9aLgQ0VN9jk/vJ+tH2OT+8n60XAhoqb7HJ/eT9aPscn95P1ouBDRU32OT+8n60fY5P7yfrRcCGipvscn95P1o+xyf3k/Wi4ENFTfY5P7yfrRRcC5RRRUgFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAf/9k=";

export default function VerdticalControlPanel() {
  const [sectors, setSectors] = useState(null);
  const [mainSupply, setMainSupply] = useState(true);
  const [pressureBar, setPressureBar] = useState(2.6);
  const [now, setNow] = useState(new Date());
  const [loaded, setLoaded] = useState(false);
  const [proyecto, setProyecto] = useState({ id: "", nombre: "" });
  const [showProyectoConfig, setShowProyectoConfig] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  // Interruptor SOLO de pruebas: simula que se agota la batería de respaldo
  // del PLC (sin datos en absoluto), sin depender de la conexión real a
  // internet del dispositivo — así se puede probar sin desconectar el wifi.
  const [simulacionBateriaAgotada, setSimulacionBateriaAgotada] = useState(false);
  const [showAlarmHistory, setShowAlarmHistory] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [showTecnicoConfig, setShowTecnicoConfig] = useState(false);
  const [showClienteConfig, setShowClienteConfig] = useState(false);
  const [copiadoCliente, setCopiadoCliente] = useState(false);
  const [showFertilizerHistory, setShowFertilizerHistory] = useState(false);
  const [showRedHistory, setShowRedHistory] = useState(false);
  const [showPlano, setShowPlano] = useState(false);
  const [planoImagen, setPlanoImagen] = useState(PLANO_DEMO_IMAGEN);
  const [lineaColocando, setLineaColocando] = useState(null);
  const [lineaResaltada, setLineaResaltada] = useState(null);
  // Superficie calculada del plano real: zona grande 49,43 x 5,00 m + zona
  // pequeña 19,38 x 5,00 m = 344,05 m². Editable por si cambia la instalación.
  const [etoSol, setEtoSol] = useState(7);
  const [etoSemisombra, setEtoSemisombra] = useState(4.75);
  const [etoSombra, setEtoSombra] = useState(2.5);
  const [umbralBalanceHidrico, setUmbralBalanceHidrico] = useState(30);
  const [wueGramosPorLitro, setWueGramosPorLitro] = useState(2.5);
  const [showAnnualWaterHistory, setShowAnnualWaterHistory] = useState(false);
  const [waterAnnualOffset, setWaterAnnualOffset] = useState(0);
  const [selectedGlobalConsumoDay, setSelectedGlobalConsumoDay] = useState(null);
  const [showAnnualPressureHistory, setShowAnnualPressureHistory] = useState(false);
  const [pressureAnnualOffset, setPressureAnnualOffset] = useState(0);
  const [tecnico, setTecnico] = useState({
    nombre: "",
    telefono: "",
    email: "",
    emailAvisos: "",
    alarmas: { fugas: true, fallo_electrico: true, embozo: true, presion: true, humedad: true, ec: true, temperatura: true, multiples_lineas: true, fertilizante: true },
  });
  const [cliente, setCliente] = useState({
    nombre: "",
    telefono: "",
    email: "",
    emailAvisos: "",
    alarmas: { fugas: false, fallo_electrico: false, embozo: false, presion: false, humedad: false, ec: false, temperatura: false, multiples_lineas: false, fertilizante: false },
  });
  const [procesosRealizados, setProcesosRealizados] = useState({});
  const [notaObservacion, setNotaObservacion] = useState("");
  const [pressureAlert, setPressureAlert] = useState(null);
  const [multiLineAlert, setMultiLineAlert] = useState(null);
  const [fertilizerLevel, setFertilizerLevel] = useState(68);
  const [fertilizerAlert, setFertilizerAlert] = useState(null);
  const [fertilizerConsumedToday, setFertilizerConsumedToday] = useState(0);
  const [fertilizerDailyHistory, setFertilizerDailyHistory] = useState([]);
  const [pressureDailyHistory, setPressureDailyHistory] = useState([]);
  const [pressureHourlyHistory, setPressureHourlyHistory] = useState([]);
  const pressureLastHourRef = useRef(null);
  const [pressureOutageLog, setPressureOutageLog] = useState([]);
  const pressureOutageActiveRef = useRef(false);
  const pressureSumTodayRef = useRef(0);
  const pressureCountTodayRef = useRef(0);
  const alarmDropdownRef = useRef(null);
  const activityDropdownRef = useRef(null);
  const tecnicoDropdownRef = useRef(null);
  const clienteDropdownRef = useRef(null);
  const fertilizerDropdownRef = useRef(null);
  const redDropdownRef = useRef(null);
  const [history, setHistory] = useState([]);
  const [flowHistory, setFlowHistory] = useState([]);
  const [pressureHistory, setPressureHistory] = useState([]);
  const [dailyConsumption, setDailyConsumption] = useState([]);
  // Caudalímetro GENERAL, instalado antes de todas las electroválvulas de
  // línea (a la entrada de la instalación). Sirve para detectar una pérdida
  // de agua que ninguna línea puede ver por su cuenta: rotura en la tubería
  // general, antes del colector.
  const [caudalGeneralMedido, setCaudalGeneralMedido] = useState(0);
  // Protección de la ELECTROVÁLVULA MAESTRA: si el caudal general no
  // coincide con lo que suman las líneas activas, hay agua escapándose antes
  // de llegar a ninguna línea — se cierra la maestra y se avisa.
  const [maestraCerrada, setMaestraCerrada] = useState(null);
  const [confirmRearmeMaestra, setConfirmRearmeMaestra] = useState(false);
  const [leakAlerts, setLeakAlerts] = useState([]);
  const [alarmHistory, setAlarmHistory] = useState([]);
  const prevActiveRef = useRef({});
  const zeroFlowTicksRef = useRef({});
  const humedadLastHourRef = useRef({});
  const humedadSumTodayRef = useRef({});
  const humedadCountTodayRef = useRef({});
  const tempLastHourRef = useRef({});
  const tempSumTodayRef = useRef({});
  const tempCountTodayRef = useRef({});
  const ecLastHourRef = useRef({});
  const ecSumTodayRef = useRef({});
  const ecCountTodayRef = useRef({});
  const caudalLastHourRef = useRef({});
  const caudalSumTodayRef = useRef({});
  const caudalCountTodayRef = useRef({});
  const pressureOutTicksRef = useRef(0);
  const fertilizerAlertedRef = useRef({ bajo: false, agotado: false });
  const sessionStartRef = useRef({});
  const lastDayRef = useRef(null);
  const MAX_PUNTOS_GRAFICA = 120;
  const MAX_DIAS_HISTORICO = 365;
  const MAX_DIAS_HORARIO = 14;
  const MAX_LECTURAS_PRESION_HORARIA = 7 * 24;
  const MAX_LECTURAS_HUMEDAD_HORARIA = 7 * 24;
  const MAX_LECTURAS_SENSOR_HORARIA = 7 * 24;
  const MAX_RIEGO_LOG = 150;
  const MAX_ALARM_LOG = 300;

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const result = await window.storage.get(STORAGE_KEY);
        if (mounted && result && result.value) {
          const parsed = JSON.parse(result.value);
          setSectors(sanearLineasAlCargar(parsed.sectors) || defaultSectors());
          setMainSupply(parsed.mainSupply !== undefined ? parsed.mainSupply : true);
          setPressureBar(parsed.pressureBar !== undefined ? parsed.pressureBar : 2.6);
          setHistory(parsed.history || []);
          setFlowHistory(parsed.flowHistory || []);
          setPressureHistory(parsed.pressureHistory || []);
          setDailyConsumption(parsed.dailyConsumption && parsed.dailyConsumption.length > 0 ? parsed.dailyConsumption : demoDailyConsumption());
          setCaudalGeneralMedido(parsed.caudalGeneralMedido ?? 0);
          setMaestraCerrada(parsed.maestraCerrada ?? null);
          setLeakAlerts(parsed.leakAlerts || []);
          setAlarmHistory(parsed.alarmHistory || []);
          setTecnico({
            nombre: "",
            telefono: "",
            email: "",
            emailAvisos: "",
            alarmas: { fugas: true, fallo_electrico: true, embozo: true, presion: true, humedad: true, ec: true, temperatura: true, multiples_lineas: true, fertilizante: true },
            ...(parsed.tecnico || {}),
            alarmas: {
              fugas: true,
              fallo_electrico: true,
              embozo: true,
              presion: true,
              humedad: true,
              ec: true,
              temperatura: true,
              multiples_lineas: true,
              fertilizante: true,
              ...(parsed.tecnico && parsed.tecnico.alarmas ? parsed.tecnico.alarmas : {}),
            },
          });
          setCliente({
            nombre: "",
            telefono: "",
            email: "",
            emailAvisos: "",
            alarmas: { fugas: false, fallo_electrico: false, embozo: false, presion: false, humedad: false, ec: false, temperatura: false, multiples_lineas: false, fertilizante: false },
            ...(parsed.cliente || {}),
            alarmas: {
              fugas: false,
              fallo_electrico: false,
              embozo: false,
              presion: false,
              humedad: false,
              ec: false,
              temperatura: false,
              multiples_lineas: false,
              fertilizante: false,
              ...(parsed.cliente && parsed.cliente.alarmas ? parsed.cliente.alarmas : {}),
            },
          });
          setProcesosRealizados(parsed.procesosRealizados || {});
          setPlanoImagen(parsed.planoImagen || PLANO_DEMO_IMAGEN);
          setEtoSol(parsed.etoSol ?? 7);
          setEtoSemisombra(parsed.etoSemisombra ?? 4.75);
          setEtoSombra(parsed.etoSombra ?? 2.5);
          setUmbralBalanceHidrico(parsed.umbralBalanceHidrico ?? 30);
          setWueGramosPorLitro(parsed.wueGramosPorLitro ?? 2.5);
          setNotaObservacion(parsed.notaObservacion || "");
          setProyecto(parsed.proyecto || { id: "", nombre: "" });
          setPressureAlert(parsed.pressureAlert || null);
          setMultiLineAlert(null);
          setFertilizerLevel(parsed.fertilizerLevel !== undefined ? parsed.fertilizerLevel : 68);
          setFertilizerAlert(parsed.fertilizerAlert || null);
          setFertilizerConsumedToday(parsed.fertilizerConsumedToday || 0);
          setFertilizerDailyHistory(
            parsed.fertilizerDailyHistory && parsed.fertilizerDailyHistory.length > 0
              ? parsed.fertilizerDailyHistory
              : demoFertilizerHistory()
          );
          fertilizerAlertedRef.current = parsed.fertilizerAlerted || { bajo: false, agotado: false };
          setPressureDailyHistory(
            parsed.pressureDailyHistory && parsed.pressureDailyHistory.length > 0
              ? parsed.pressureDailyHistory
              : demoPressureHistory()
          );
          pressureSumTodayRef.current = parsed.pressureSumToday || 0;
          pressureCountTodayRef.current = parsed.pressureCountToday || 0;
          setPressureOutageLog(parsed.pressureOutageLog || []);
          setPressureHourlyHistory(parsed.pressureHourlyHistory || demoPressureHourly());
        } else if (mounted) {
          setSectors(defaultSectors());
          setDailyConsumption(demoDailyConsumption());
          setFertilizerDailyHistory(demoFertilizerHistory());
          setPressureDailyHistory(demoPressureHistory());
          setPressureHourlyHistory(demoPressureHourly());
        }
      } catch (err) {
        if (mounted) setSectors(defaultSectors());
      } finally {
        if (mounted) setLoaded(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // "datosActivos" combina la conexión real del navegador con el
  // interruptor de pruebas de batería agotada — es lo que de verdad decide
  // si hay datos o no, en vez de usar isOnline directamente en todos lados.
  const datosActivos = isOnline && !simulacionBateriaAgotada;

  // La falta de datos es un problema del PANEL viendo el sistema, no del
  // sistema en sí: el PLC sigue regando aunque el panel se quede a ciegas
  // por un fallo de internet o batería. Por eso NO se toca "sistema
  // activado/apagado" aquí — solo se avisa y se congela lo que se MUESTRA
  // (ver el otro efecto), hasta que vuelvan los datos.
  const sinDatosAvisadoRef = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    if (!datosActivos && !sinDatosAvisadoRef.current) {
      sinDatosAvisadoRef.current = true;
      setAlarmHistory((prev) =>
        [
          { id: `alarm-conexion-${Date.now()}`, ts: new Date().toISOString(), lineId: null, lineName: "Sistema general", type: "fallo_conexion" },
          ...prev,
        ].slice(0, MAX_ALARM_LOG)
      );
    } else if (datosActivos && sinDatosAvisadoRef.current) {
      sinDatosAvisadoRef.current = false;
      setAlarmHistory((prev) =>
        [
          { id: `alarm-conexion-ok-${Date.now()}`, ts: new Date().toISOString(), lineId: null, lineName: "Sistema general", type: "fallo_conexion_resuelto" },
          ...prev,
        ].slice(0, MAX_ALARM_LOG)
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datosActivos, loaded]);

  useEffect(() => {
    if (!showAlarmHistory && !showActivityLog && !showTecnicoConfig && !showClienteConfig && !showFertilizerHistory && !showRedHistory) return;
    const handleClickOutside = (e) => {
      if (showAlarmHistory && alarmDropdownRef.current && !alarmDropdownRef.current.contains(e.target)) {
        setShowAlarmHistory(false);
      }
      if (showActivityLog && activityDropdownRef.current && !activityDropdownRef.current.contains(e.target)) {
        setShowActivityLog(false);
      }
      if (showTecnicoConfig && tecnicoDropdownRef.current && !tecnicoDropdownRef.current.contains(e.target)) {
        setShowTecnicoConfig(false);
      }
      if (showClienteConfig && clienteDropdownRef.current && !clienteDropdownRef.current.contains(e.target)) {
        setShowClienteConfig(false);
      }
      if (showFertilizerHistory && fertilizerDropdownRef.current && !fertilizerDropdownRef.current.contains(e.target)) {
        setShowFertilizerHistory(false);
      }
      if (showRedHistory && redDropdownRef.current && !redDropdownRef.current.contains(e.target)) {
        setShowRedHistory(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showAlarmHistory, showActivityLog, showTecnicoConfig, showClienteConfig, showFertilizerHistory, showRedHistory]);

  useEffect(() => {
    if (!loaded || !sectors) return;
    const save = async () => {
      try {
        await window.storage.set(
          STORAGE_KEY,
          JSON.stringify({
            sectors,
            mainSupply,
            pressureBar,
            history: history.slice(0, 20),
            flowHistory: flowHistory.slice(-MAX_PUNTOS_GRAFICA),
            pressureHistory: pressureHistory.slice(-MAX_PUNTOS_GRAFICA),
            dailyConsumption: dailyConsumption.slice(-MAX_DIAS_HISTORICO),
            caudalGeneralMedido,
            maestraCerrada,
            leakAlerts,
            alarmHistory: alarmHistory.slice(-MAX_ALARM_LOG),
            tecnico,
            cliente,
            procesosRealizados,
            notaObservacion,
            proyecto,
            planoImagen,
            etoSol,
            etoSemisombra,
            etoSombra,
            umbralBalanceHidrico,
            wueGramosPorLitro,
            pressureAlert,
            multiLineAlert,
            fertilizerLevel,
            fertilizerAlert,
            fertilizerAlerted: fertilizerAlertedRef.current,
            fertilizerConsumedToday,
            fertilizerDailyHistory: fertilizerDailyHistory.slice(-MAX_DIAS_HISTORICO),
            pressureDailyHistory: pressureDailyHistory.slice(-MAX_DIAS_HISTORICO),
            pressureSumToday: pressureSumTodayRef.current,
            pressureCountToday: pressureCountTodayRef.current,
            pressureOutageLog: pressureOutageLog.slice(-200),
            pressureHourlyHistory: pressureHourlyHistory.slice(-MAX_LECTURAS_PRESION_HORARIA),
          })
        );
      } catch (err) {
        // fallo silencioso de guardado; el estado local sigue siendo válido
      }
    };
    save();
  }, [
    sectors,
    mainSupply,
    pressureBar,
    history,
    flowHistory,
    pressureHistory,
    dailyConsumption,
    caudalGeneralMedido,
    maestraCerrada,
    leakAlerts,
    alarmHistory,
    tecnico,
    cliente,
    procesosRealizados,
    notaObservacion,
    proyecto,
    planoImagen,
    etoSol,
    etoSemisombra,
    etoSombra,
    umbralBalanceHidrico,
    wueGramosPorLitro,
    pressureAlert,
    multiLineAlert,
    fertilizerLevel,
    fertilizerAlert,
    fertilizerConsumedToday,
    fertilizerDailyHistory,
    pressureDailyHistory,
    pressureOutageLog,
    pressureHourlyHistory,
    loaded,
  ]);

  useEffect(() => {
    if (!sectors) return;
    // Los sensores (humedad, presión, caudal) siguen llegando aunque el
    // sistema esté "apagado" — con batería de respaldo en el PLC, se sigue
    // recibiendo información aunque no se pueda activar ninguna
    // electroválvula sin corriente. Lo único que congela TODO de verdad es
    // la falta de datos en sí (batería agotada o comunicación perdida).
    if (!datosActivos) return;
    const nextActive = {};
    const newEvents = [];
    const leaksDetectados = [];
    const fugasLeves = [];
    const fallosElectricos = [];
    const embozosNuevos = [];
    const humedadNuevos = [];
    const ecNuevos = [];
    const temperaturaNuevos = [];
    let anyActiveCount = 0;

    // La presión de red condiciona si se puede fiar el diagnóstico de caudal por
    // línea: por debajo de 1,8 bar (o por encima de 3,5 bar) los emisores
    // autocompensantes no entregan su caudal nominal aunque no tengan ninguna
    // avería, así que el embozo/fuga/fallo eléctrico solo se evalúa si la presión
    // del ciclo anterior estaba dentro del rango de trabajo.
    const presionEnRangoTrabajo = pressureBar >= 1.8 && pressureBar <= 3.5;

    const label = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    const todayStr = now.toDateString();
    let dayChanged = false;
    let fechaAnterior = null;

    if (lastDayRef.current === null) {
      lastDayRef.current = todayStr;
    } else if (lastDayRef.current !== todayStr) {
      dayChanged = true;
      fechaAnterior = lastDayRef.current;
      const totalDiaAnterior = sectors.reduce((sum, s) => sum + Number(s.sensors?.litersToday || 0), 0);
      setDailyConsumption((prev) =>
        [
          ...prev,
          {
            date: fechaAnterior,
            label: new Date(fechaAnterior).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
            liters: Math.round(totalDiaAnterior),
          },
        ].slice(-MAX_DIAS_HISTORICO)
      );
      lastDayRef.current = todayStr;
    }

    const updated = sectors.map((s) => {
      let manualOverride = s.manualOverride;
      if (manualOverride && manualOverride.active && new Date(manualOverride.endsAt).getTime() <= now.getTime()) {
        newEvents.push({ ts: now.toISOString(), text: `${s.name}: riego manual finalizado (tiempo agotado)` });
        manualOverride = null;
      }
      const sConManual = manualOverride === s.manualOverride ? s : { ...s, manualOverride };

      const active = mainSupply && !maestraCerrada && isSectorActiveNow(sConManual, now);
      nextActive[s.id] = active;
      if (active) anyActiveCount += 1;
      const wasActive = prevActiveRef.current[s.id];
      if (wasActive !== undefined) {
        if (active && !wasActive) {
          newEvents.push({ ts: now.toISOString(), text: `${s.name}: válvula abierta` });
          const tipo = isManualOverrideActive(sConManual, now) ? "manual" : s.mode === "sensor" ? "sensor" : "horario";
          sessionStartRef.current[s.id] = {
            startTs: now.toISOString(),
            litersAtStart: Number(s.sensors?.litersToday || 0),
            tipo,
          };
        } else if (!active && wasActive) {
          newEvents.push({ ts: now.toISOString(), text: `${s.name}: válvula cerrada` });
        }
      }
      let sim = simulateSector(s, active, now.getHours() + now.getMinutes() / 60);

      const nominalFlow = Number(s.emitters || 0) * Number(s.emitterFlow || 0);

      // Simulación de fallo eléctrico/mecánico ocasional: la válvula no responde
      // (caudal 0 estando programada). Esto solo debe verse en la demo o en una
      // instalación real conectada; aquí se simula con una probabilidad muy baja.
      if (active && Math.random() < 0.003) {
        sim = { ...sim, flowMeasured: 0 };
      }

      let blockedByLeak = s.blockedByLeak || false;
      let minorLeakFlag = s.minorLeakFlag || false;
      let clogFlag = s.clogFlag || false;
      let flowAlarmLog = s.flowAlarmLog || [];
      if (active && nominalFlow > 0 && presionEnRangoTrabajo) {
        const flowMinPct = (s.thresholds?.flowMinPercent ?? 85) / 100;
        const flowMaxPct = (s.thresholds?.flowMaxPercent ?? 115) / 100;
        const esGrave = sim.flowMeasured >= nominalFlow * 1.5;
        const esLeve = !esGrave && sim.flowMeasured >= nominalFlow * flowMaxPct;
        const esEmbozo = sim.flowMeasured < nominalFlow * flowMinPct;
        const porcentajeActual = Math.round((sim.flowMeasured / nominalFlow) * 100);
        if (!blockedByLeak && esGrave) {
          blockedByLeak = true;
          leaksDetectados.push({ id: s.id, name: s.name, flowMeasured: sim.flowMeasured, nominalFlow });
          flowAlarmLog = [
            { ts: now.toISOString(), tipo: "fuga_grave", flowMeasured: sim.flowMeasured, nominalFlow, porcentaje: porcentajeActual },
            ...flowAlarmLog,
          ].slice(0, 100);
        }
        if (esLeve && !minorLeakFlag) {
          minorLeakFlag = true;
          fugasLeves.push({ id: s.id, name: s.name, flowMeasured: sim.flowMeasured, nominalFlow });
          flowAlarmLog = [
            { ts: now.toISOString(), tipo: "fuga_leve", flowMeasured: sim.flowMeasured, nominalFlow, porcentaje: porcentajeActual },
            ...flowAlarmLog,
          ].slice(0, 100);
        } else if (!esLeve && !esGrave) {
          minorLeakFlag = false;
        }
        if (esEmbozo && !clogFlag) {
          clogFlag = true;
          embozosNuevos.push({ id: s.id, name: s.name, flowMeasured: sim.flowMeasured, nominalFlow });
          flowAlarmLog = [
            { ts: now.toISOString(), tipo: "embozo", flowMeasured: sim.flowMeasured, nominalFlow, porcentaje: porcentajeActual },
            ...flowAlarmLog,
          ].slice(0, 100);
        } else if (!esEmbozo) {
          clogFlag = false;
        }
      }

      let blockedByFault = s.blockedByFault || false;
      if (active && nominalFlow > 0 && presionEnRangoTrabajo && sim.flowMeasured === 0 && !blockedByFault) {
        zeroFlowTicksRef.current[s.id] = (zeroFlowTicksRef.current[s.id] || 0) + 1;
        if (zeroFlowTicksRef.current[s.id] >= 2) {
          blockedByFault = true;
          fallosElectricos.push({ id: s.id, name: s.name });
        }
      } else if (!active || !presionEnRangoTrabajo) {
        zeroFlowTicksRef.current[s.id] = 0;
      }

      const prevSensors = s.sensors || {};
      const sameDay = prevSensors.lastResetDay === todayStr;
      const prevLiters = sameDay ? Number(prevSensors.litersToday || 0) : 0;
      const deltaLiters = sim.flowMeasured * (15 / 3600); // caudal L/h -> litros en 15 s
      const litersToday = Math.round((prevLiters + deltaLiters) * 10) / 10;

      const horaActual = now.getHours();
      const prevHourly = sameDay && Array.isArray(s.hourlyConsumption) ? s.hourlyConsumption : Array(24).fill(0);
      const hourlyConsumption = prevHourly.map((v, h) => (h === horaActual ? Math.round((v + deltaLiters) * 10) / 10 : v));

      const newSensors = { ...sim, litersToday, lastResetDay: todayStr };
      const historyPoint = { label, humidity: sim.humidity, temperature: sim.temperature, ec: sim.ec, liters: litersToday };
      const newHistory = [...(s.history || []), historyPoint].slice(-MAX_PUNTOS_GRAFICA);

      const th = s.thresholds || {};
      let humidityFlag = s.humidityFlag || false;
      const humedadFuera = newSensors.humidity < th.humidityMin || newSensors.humidity > th.humidityMax;
      if (humedadFuera && !humidityFlag) {
        humidityFlag = true;
        humedadNuevos.push({ id: s.id, name: s.name, valor: newSensors.humidity, min: th.humidityMin, max: th.humidityMax });
      } else if (!humedadFuera) {
        humidityFlag = false;
      }

      let ecFlag = s.ecFlag || false;
      const ecFuera = newSensors.ec < th.ecMin || newSensors.ec > th.ecMax;
      if (ecFuera && !ecFlag) {
        ecFlag = true;
        ecNuevos.push({ id: s.id, name: s.name, valor: newSensors.ec, min: th.ecMin, max: th.ecMax });
      } else if (!ecFuera) {
        ecFlag = false;
      }

      let temperatureFlag = s.temperatureFlag || false;
      const tMin = th.temperatureMin ?? -99;
      const tMax = th.temperatureMax ?? 99;
      const temperaturaFuera = newSensors.temperature < tMin || newSensors.temperature > tMax;
      if (temperaturaFuera && !temperatureFlag) {
        temperatureFlag = true;
        temperaturaNuevos.push({ id: s.id, name: s.name, valor: newSensors.temperature, min: tMin, max: tMax });
      } else if (!temperaturaFuera) {
        temperatureFlag = false;
      }

      let riegoLog = s.riegoLog || [];
      if (wasActive && !active) {
        const sesion = sessionStartRef.current[s.id];
        if (sesion) {
          const duracionMin = Math.max(1, Math.round((now.getTime() - new Date(sesion.startTs).getTime()) / 60000));
          const litrosUsados = Math.max(0, Math.round((litersToday - sesion.litersAtStart) * 10) / 10);
          riegoLog = [
            {
              id: `riego-${now.getTime()}-${Math.round(Math.random() * 1000)}`,
              startTs: sesion.startTs,
              endTs: now.toISOString(),
              durationMin: duracionMin,
              liters: litrosUsados,
              tipo: sesion.tipo,
            },
            ...riegoLog,
          ].slice(0, MAX_RIEGO_LOG);
          delete sessionStartRef.current[s.id];
        }
      }

      let dailyHist = s.dailyConsumption || [];
      let hourlyHist = s.hourlyHistory || [];
      let humidityHourlyHist = s.humidityHourlyHistory || [];
      let humidityDailyHist = s.humidityDailyHistory || [];

      // Lectura REAL de humedad (no promediada): se guarda una vez por hora,
      // igual que hacemos con la presión de red.
      let temperatureHourlyHist = s.temperatureHourlyHistory || [];
      let temperatureDailyHist = s.temperatureDailyHistory || [];
      let ecHourlyHist = s.ecHourlyHistory || [];
      let ecDailyHist = s.ecDailyHistory || [];
      let caudalHourlyHist = s.flowHourlyHistory || [];
      let caudalDailyHist = s.flowDailyHistory || [];

      const horaClaveHumedad = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
      if (humedadLastHourRef.current[s.id] !== horaClaveHumedad) {
        humedadLastHourRef.current[s.id] = horaClaveHumedad;
        humidityHourlyHist = [
          ...humidityHourlyHist,
          {
            ts: now.toISOString(),
            label: now.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) + " " + String(now.getHours()).padStart(2, "0") + "h",
            humidity: sim.humidity,
          },
        ].slice(-MAX_LECTURAS_HUMEDAD_HORARIA);
      }
      if (tempLastHourRef.current[s.id] !== horaClaveHumedad) {
        tempLastHourRef.current[s.id] = horaClaveHumedad;
        temperatureHourlyHist = [
          ...temperatureHourlyHist,
          {
            ts: now.toISOString(),
            label: now.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) + " " + String(now.getHours()).padStart(2, "0") + "h",
            temperature: sim.temperature,
          },
        ].slice(-MAX_LECTURAS_SENSOR_HORARIA);
      }
      if (ecLastHourRef.current[s.id] !== horaClaveHumedad) {
        ecLastHourRef.current[s.id] = horaClaveHumedad;
        ecHourlyHist = [
          ...ecHourlyHist,
          {
            ts: now.toISOString(),
            label: now.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) + " " + String(now.getHours()).padStart(2, "0") + "h",
            ec: sim.ec,
          },
        ].slice(-MAX_LECTURAS_SENSOR_HORARIA);
      }
      if (caudalLastHourRef.current[s.id] !== horaClaveHumedad) {
        caudalLastHourRef.current[s.id] = horaClaveHumedad;
        caudalHourlyHist = [
          ...caudalHourlyHist,
          {
            ts: now.toISOString(),
            label: now.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) + " " + String(now.getHours()).padStart(2, "0") + "h",
            flow: sim.flowMeasured,
          },
        ].slice(-MAX_LECTURAS_SENSOR_HORARIA);
      }

      // Media diaria de humedad (para el historial de 1 año, a más largo plazo).
      humedadSumTodayRef.current[s.id] = (humedadSumTodayRef.current[s.id] || 0) + sim.humidity;
      humedadCountTodayRef.current[s.id] = (humedadCountTodayRef.current[s.id] || 0) + 1;
      tempSumTodayRef.current[s.id] = (tempSumTodayRef.current[s.id] || 0) + sim.temperature;
      tempCountTodayRef.current[s.id] = (tempCountTodayRef.current[s.id] || 0) + 1;
      ecSumTodayRef.current[s.id] = (ecSumTodayRef.current[s.id] || 0) + sim.ec;
      ecCountTodayRef.current[s.id] = (ecCountTodayRef.current[s.id] || 0) + 1;
      caudalSumTodayRef.current[s.id] = (caudalSumTodayRef.current[s.id] || 0) + sim.flowMeasured;
      caudalCountTodayRef.current[s.id] = (caudalCountTodayRef.current[s.id] || 0) + 1;

      if (dayChanged) {
        dailyHist = [
          ...dailyHist,
          {
            date: fechaAnterior,
            label: new Date(fechaAnterior).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
            liters: Math.round(Number(prevSensors.litersToday || 0)),
          },
        ].slice(-MAX_DIAS_HISTORICO);
        hourlyHist = [
          ...hourlyHist,
          {
            date: fechaAnterior,
            label: new Date(fechaAnterior).toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "short" }),
            hours: Array.isArray(s.hourlyConsumption) ? s.hourlyConsumption : Array(24).fill(0),
          },
        ].slice(-MAX_DIAS_HORARIO);
        const sumaHumedadAnterior = humedadSumTodayRef.current[s.id] - sim.humidity;
        const cuentaHumedadAnterior = humedadCountTodayRef.current[s.id] - 1;
        const mediaHumedadAnterior =
          cuentaHumedadAnterior > 0 ? Math.round((sumaHumedadAnterior / cuentaHumedadAnterior) * 10) / 10 : sim.humidity;
        humidityDailyHist = [
          ...humidityDailyHist,
          {
            date: fechaAnterior,
            label: new Date(fechaAnterior).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
            avgHumidity: mediaHumedadAnterior,
          },
        ].slice(-MAX_DIAS_HISTORICO);
        humedadSumTodayRef.current[s.id] = sim.humidity;
        humedadCountTodayRef.current[s.id] = 1;

        const sumaTempAnterior = tempSumTodayRef.current[s.id] - sim.temperature;
        const cuentaTempAnterior = tempCountTodayRef.current[s.id] - 1;
        const mediaTempAnterior =
          cuentaTempAnterior > 0 ? Math.round((sumaTempAnterior / cuentaTempAnterior) * 10) / 10 : sim.temperature;
        temperatureDailyHist = [
          ...temperatureDailyHist,
          {
            date: fechaAnterior,
            label: new Date(fechaAnterior).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
            avgTemperature: mediaTempAnterior,
          },
        ].slice(-MAX_DIAS_HISTORICO);
        tempSumTodayRef.current[s.id] = sim.temperature;
        tempCountTodayRef.current[s.id] = 1;

        const sumaEcAnterior = ecSumTodayRef.current[s.id] - sim.ec;
        const cuentaEcAnterior = ecCountTodayRef.current[s.id] - 1;
        const mediaEcAnterior = cuentaEcAnterior > 0 ? Math.round((sumaEcAnterior / cuentaEcAnterior) * 100) / 100 : sim.ec;
        ecDailyHist = [
          ...ecDailyHist,
          {
            date: fechaAnterior,
            label: new Date(fechaAnterior).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
            avgEc: mediaEcAnterior,
          },
        ].slice(-MAX_DIAS_HISTORICO);
        ecSumTodayRef.current[s.id] = sim.ec;
        ecCountTodayRef.current[s.id] = 1;

        const sumaCaudalAnterior = caudalSumTodayRef.current[s.id] - sim.flowMeasured;
        const cuentaCaudalAnterior = caudalCountTodayRef.current[s.id] - 1;
        const mediaCaudalAnterior =
          cuentaCaudalAnterior > 0 ? Math.round((sumaCaudalAnterior / cuentaCaudalAnterior) * 10) / 10 : sim.flowMeasured;
        caudalDailyHist = [
          ...caudalDailyHist,
          {
            date: fechaAnterior,
            label: new Date(fechaAnterior).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
            avgFlow: mediaCaudalAnterior,
          },
        ].slice(-MAX_DIAS_HISTORICO);
        caudalSumTodayRef.current[s.id] = sim.flowMeasured;
        caudalCountTodayRef.current[s.id] = 1;
      }

      return {
        ...s,
        sensors: newSensors,
        hourlyConsumption,
        history: newHistory,
        dailyConsumption: dailyHist,
        hourlyHistory: hourlyHist,
        humidityHourlyHistory: humidityHourlyHist,
        humidityDailyHistory: humidityDailyHist,
        temperatureHourlyHistory: temperatureHourlyHist,
        temperatureDailyHistory: temperatureDailyHist,
        ecHourlyHistory: ecHourlyHist,
        ecDailyHistory: ecDailyHist,
        flowHourlyHistory: caudalHourlyHist,
        flowDailyHistory: caudalDailyHist,
        flowAlarmLog,
        blockedByLeak,
        blockedByFault,
        minorLeakFlag,
        clogFlag,
        humidityFlag,
        ecFlag,
        temperatureFlag,
        manualOverride,
        riegoLog,
      };
    });

    prevActiveRef.current = nextActive;
    setSectors(updated);
    const nuevaPresion = clamp(
      Math.round((2.6 - anyActiveCount * 0.06 + (Math.random() - 0.5) * 0.08) * 100) / 100,
      0.5,
      4.5
    );
    setPressureBar(nuevaPresion);

    // Caudal medido en el caudalímetro GENERAL, antes de todas las
    // electroválvulas de línea. En condiciones normales debe coincidir con
    // lo que suman las líneas activas. Si el general marca más caudal del
    // que ninguna línea explica, es agua escapándose antes de llegar a
    // ninguna electroválvula — indicio de rotura de tubería general.
    const sumaFlowLineas = updated.reduce((sum, s) => sum + Number(s.sensors?.flowMeasured || 0), 0);
    // Simulación de fuga antes de las electroválvulas (solo demo; con el
    // caudalímetro real esto vendría directamente de su lectura, sin
    // necesidad de simularlo).
    let fugaAntesElectrovalvulas = 0;
    if (mainSupply && Math.random() < 0.0006) {
      fugaAntesElectrovalvulas = 150 + Math.random() * 350;
    }
    const caudalGeneralAhora = Math.round((sumaFlowLineas + fugaAntesElectrovalvulas) * 10) / 10;
    setCaudalGeneralMedido(caudalGeneralAhora);

    const caudalNoExplicado = Math.round((caudalGeneralAhora - sumaFlowLineas) * 10) / 10;
    if (!maestraCerrada && caudalNoExplicado > 5) {
      const motivoTexto = `El caudalímetro general marca ${caudalNoExplicado} L/h que ninguna línea explica — indicio de rotura de tubería antes de las electroválvulas.`;
      setMaestraCerrada({ motivo: motivoTexto, ts: now.toISOString() });
      setAlarmHistory((prev) =>
        [
          {
            id: `alarm-maestra-${now.getTime()}`,
            ts: now.toISOString(),
            lineId: null,
            lineName: "Sistema general",
            type: "rotura_antes_electrovalvulas",
            detalle: motivoTexto,
          },
          ...prev,
        ].slice(0, MAX_ALARM_LOG)
      );
    }

    // Histórico horario REAL (no promediado): se guarda la lectura tal cual en
    // cuanto cambia la hora del reloj, una sola vez por hora, durante 14 días.
    const horaClave = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
    if (pressureLastHourRef.current !== horaClave) {
      pressureLastHourRef.current = horaClave;
      setPressureHourlyHistory((prev) =>
        [
          ...prev,
          {
            ts: now.toISOString(),
            label: now.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) + " " + String(now.getHours()).padStart(2, "0") + "h",
            pressure: nuevaPresion,
          },
        ].slice(-MAX_LECTURAS_PRESION_HORARIA)
      );
    }

    pressureSumTodayRef.current += nuevaPresion;
    pressureCountTodayRef.current += 1;
    if (dayChanged) {
      const mediaAnterior =
        pressureCountTodayRef.current > 1
          ? Math.round(((pressureSumTodayRef.current - nuevaPresion) / (pressureCountTodayRef.current - 1)) * 100) / 100
          : nuevaPresion;
      setPressureDailyHistory((prev) =>
        [
          ...prev,
          {
            date: fechaAnterior,
            label: new Date(fechaAnterior).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
            avgPressure: mediaAnterior,
          },
        ].slice(-MAX_DIAS_HISTORICO)
      );
      pressureSumTodayRef.current = nuevaPresion;
      pressureCountTodayRef.current = 1;
    }

    // Registro de "horas sin presión": se anota el momento exacto (fecha + hora)
    // en que la presión cae por debajo de 1,0 bar, una sola vez por caída (no
    // se repite mientras se mantenga baja), para poder consultar después en
    // qué día y a qué hora ocurrió cada corte.
    if (nuevaPresion < 1.0) {
      if (!pressureOutageActiveRef.current) {
        pressureOutageActiveRef.current = true;
        setPressureOutageLog((prev) => [{ ts: now.toISOString(), value: nuevaPresion }, ...prev].slice(0, 200));
      }
    } else {
      pressureOutageActiveRef.current = false;
    }

    let eventosCombinados = newEvents;
    if (leaksDetectados.length > 0) {
      setLeakAlerts((prev) => [
        ...prev,
        ...leaksDetectados.map((f) => ({
          lineId: f.id,
          lineName: f.name,
          ts: now.toISOString(),
          flowMeasured: f.flowMeasured,
          nominalFlow: f.nominalFlow,
        })),
      ]);
      setAlarmHistory((prev) =>
        [
          ...leaksDetectados.map((f) => ({
            id: `alarm-${now.getTime()}-${f.id}`,
            ts: now.toISOString(),
            lineId: f.id,
            lineName: f.name,
            type: "fuga_grave",
            flowMeasured: f.flowMeasured,
            nominalFlow: f.nominalFlow,
          })),
          ...prev,
        ].slice(0, MAX_ALARM_LOG)
      );
      eventosCombinados = [
        ...newEvents,
        ...leaksDetectados.map((f) => ({
          ts: now.toISOString(),
          text: `ALERTA: fuga grave detectada en ${f.name} (${f.flowMeasured} L/h, esperado ${f.nominalFlow} L/h) — electroválvula de la línea aislada automáticamente. El resto de líneas sigue regando con normalidad.`,
        })),
      ];
    }

    if (fugasLeves.length > 0) {
      setAlarmHistory((prev) =>
        [
          ...fugasLeves.map((f) => ({
            id: `alarm-${now.getTime()}-leve-${f.id}`,
            ts: now.toISOString(),
            lineId: f.id,
            lineName: f.name,
            type: "fuga_leve",
            flowMeasured: f.flowMeasured,
            nominalFlow: f.nominalFlow,
          })),
          ...prev,
        ].slice(0, MAX_ALARM_LOG)
      );
      eventosCombinados = [
        ...eventosCombinados,
        ...fugasLeves.map((f) => ({
          ts: now.toISOString(),
          text: `Aviso: posible goteo en ${f.name} (${f.flowMeasured} L/h, esperado ${f.nominalFlow} L/h) — sin aislar, revisar en próxima visita.`,
        })),
      ];
    }

    if (fallosElectricos.length > 0) {
      setAlarmHistory((prev) =>
        [
          ...fallosElectricos.map((f) => ({
            id: `alarm-${now.getTime()}-fault-${f.id}`,
            ts: now.toISOString(),
            lineId: f.id,
            lineName: f.name,
            type: "fallo_electrico",
          })),
          ...prev,
        ].slice(0, MAX_ALARM_LOG)
      );
      eventosCombinados = [
        ...eventosCombinados,
        ...fallosElectricos.map((f) => ({
          ts: now.toISOString(),
          text: `ALERTA: ${f.name} no responde (caudal 0 estando programada) — posible fallo eléctrico de la electroválvula, línea aislada.`,
        })),
      ];
    }

    if (embozosNuevos.length > 0) {
      setAlarmHistory((prev) =>
        [
          ...embozosNuevos.map((f) => ({
            id: `alarm-${now.getTime()}-embozo-${f.id}`,
            ts: now.toISOString(),
            lineId: f.id,
            lineName: f.name,
            type: "embozo",
            flowMeasured: f.flowMeasured,
            nominalFlow: f.nominalFlow,
          })),
          ...prev,
        ].slice(0, MAX_ALARM_LOG)
      );
    }

    if (humedadNuevos.length > 0) {
      setAlarmHistory((prev) =>
        [
          ...humedadNuevos.map((f) => ({
            id: `alarm-${now.getTime()}-hum-${f.id}`,
            ts: now.toISOString(),
            lineId: f.id,
            lineName: f.name,
            type: "humedad_fuera_rango",
            valor: f.valor,
            min: f.min,
            max: f.max,
          })),
          ...prev,
        ].slice(0, MAX_ALARM_LOG)
      );
    }

    if (ecNuevos.length > 0) {
      setAlarmHistory((prev) =>
        [
          ...ecNuevos.map((f) => ({
            id: `alarm-${now.getTime()}-ec-${f.id}`,
            ts: now.toISOString(),
            lineId: f.id,
            lineName: f.name,
            type: "ec_fuera_rango",
            valor: f.valor,
            min: f.min,
            max: f.max,
          })),
          ...prev,
        ].slice(0, MAX_ALARM_LOG)
      );
    }

    if (temperaturaNuevos.length > 0) {
      setAlarmHistory((prev) =>
        [
          ...temperaturaNuevos.map((f) => ({
            id: `alarm-${now.getTime()}-temp-${f.id}`,
            ts: now.toISOString(),
            lineId: f.id,
            lineName: f.name,
            type: "temperatura_fuera_rango",
            valor: f.valor,
            min: f.min,
            max: f.max,
          })),
          ...prev,
        ].slice(0, MAX_ALARM_LOG)
      );
    }

    // Alerta de "varias líneas con incidencias a la vez": si 3 o más líneas
    // presentan simultáneamente algún problema activo, sospechar de una causa
    // común (presión, filtro, suministro) antes que de averías independientes.
    const lineasConProblema = updated.filter(
      (s) => s.blockedByLeak || s.blockedByFault || s.minorLeakFlag || s.clogFlag || s.humidityFlag || s.ecFlag || s.temperatureFlag
    );
    if (lineasConProblema.length >= 3 && !multiLineAlert) {
      const nuevaAlertaMulti = {
        id: `alarm-${now.getTime()}-multi`,
        ts: now.toISOString(),
        lineName: `Varias líneas (${lineasConProblema.length})`,
        type: "multiples_lineas",
        cantidad: lineasConProblema.length,
        lineas: lineasConProblema.map((s) => s.name).join(", "),
      };
      setMultiLineAlert(nuevaAlertaMulti);
      setAlarmHistory((prev) => [nuevaAlertaMulti, ...prev].slice(0, MAX_ALARM_LOG));
      setHistory((h) =>
        [
          {
            ts: now.toISOString(),
            text: `ALERTA: ${lineasConProblema.length} líneas con incidencias a la vez (${nuevaAlertaMulti.lineas}) — revisar causa común antes que línea por línea.`,
          },
          ...h,
        ].slice(0, 20)
      );
    } else if (lineasConProblema.length < 3 && multiLineAlert) {
      setMultiLineAlert(null);
    }

    if (eventosCombinados.length > 0) {
      setHistory((h) => [...eventosCombinados.reverse(), ...h].slice(0, 20));
    }

    const presionFueraRango = nuevaPresion < 1.0 || nuevaPresion > 4.0;
    if (presionFueraRango) {
      pressureOutTicksRef.current += 1;
    } else {
      pressureOutTicksRef.current = 0;
    }
    if (pressureOutTicksRef.current >= 8 && !pressureAlert) {
      const tipo = nuevaPresion < 1.0 ? "presion_baja" : "presion_alta";
      const nuevaAlerta = { id: `alarm-${now.getTime()}-presion`, ts: now.toISOString(), lineName: "Red / suministro general", type: tipo, value: nuevaPresion };
      setPressureAlert(nuevaAlerta);
      setAlarmHistory((prev) => [nuevaAlerta, ...prev].slice(0, MAX_ALARM_LOG));
      setHistory((h) =>
        [
          {
            ts: now.toISOString(),
            text: `ALERTA: presión de red sostenidamente ${nuevaPresion < 1.0 ? "baja" : "alta"} (${nuevaPresion} bar durante ≥2 min).`,
          },
          ...h,
        ].slice(0, 20)
      );
    } else if (!presionFueraRango && pressureAlert) {
      pressureOutTicksRef.current = 0;
    }

    const totalFlow = sumaFlowLineas;
    setFlowHistory((h) => [...h, { label, value: totalFlow }].slice(-MAX_PUNTOS_GRAFICA));
    setPressureHistory((h) => [...h, { label, value: nuevaPresion }].slice(-MAX_PUNTOS_GRAFICA));

    // Consumo del depósito de fertilizante: proporcional al agua dosificada
    // (dosis típica ≈ 1 mL de fertilizante por litro de agua), sobre un
    // depósito de referencia de 20 L (20.000 mL).
    const TANQUE_ML = 20000;
    const DOSIS_ML_POR_LITRO = 1;
    const litrosEsteTick = totalFlow * (15 / 3600);
    const consumoML = litrosEsteTick * DOSIS_ML_POR_LITRO;
    const nuevoNivel = clamp(Math.round((fertilizerLevel - (consumoML / TANQUE_ML) * 100) * 10) / 10, 0, 100);
    setFertilizerLevel(nuevoNivel);

    if (dayChanged) {
      setFertilizerDailyHistory((prev) =>
        [
          ...prev,
          {
            date: fechaAnterior,
            label: new Date(fechaAnterior).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
            consumoML: Math.round(fertilizerConsumedToday),
          },
        ].slice(-MAX_DIAS_HISTORICO)
      );
      setFertilizerConsumedToday(Math.round(consumoML * 10) / 10);
    } else {
      setFertilizerConsumedToday((prev) => Math.round((prev + consumoML) * 10) / 10);
    }

    if (nuevoNivel < 5 && !fertilizerAlertedRef.current.agotado) {
      fertilizerAlertedRef.current = { bajo: true, agotado: true };
      const nuevaAlertaFert = {
        id: `alarm-${now.getTime()}-fert-agotado`,
        ts: now.toISOString(),
        lineName: "Depósito de fertilizante",
        type: "fertilizante_agotado",
        value: nuevoNivel,
      };
      setFertilizerAlert(nuevaAlertaFert);
      setAlarmHistory((prev) => [nuevaAlertaFert, ...prev].slice(0, MAX_ALARM_LOG));
      setHistory((h) =>
        [{ ts: now.toISOString(), text: `ALERTA: depósito de fertilizante prácticamente agotado (${nuevoNivel}%).` }, ...h].slice(0, 20)
      );
    } else if (nuevoNivel < 15 && !fertilizerAlertedRef.current.bajo) {
      fertilizerAlertedRef.current = { ...fertilizerAlertedRef.current, bajo: true };
      const nuevaAlertaFert = {
        id: `alarm-${now.getTime()}-fert-bajo`,
        ts: now.toISOString(),
        lineName: "Depósito de fertilizante",
        type: "fertilizante_bajo",
        value: nuevoNivel,
      };
      setFertilizerAlert((prev) => prev || nuevaAlertaFert);
      setAlarmHistory((prev) => [nuevaAlertaFert, ...prev].slice(0, MAX_ALARM_LOG));
      setHistory((h) => [{ ts: now.toISOString(), text: `Aviso: nivel de fertilizante bajo (${nuevoNivel}%).` }, ...h].slice(0, 20));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  const [confirmReset, setConfirmReset] = useState(false);
  const reiniciarPanel = async () => {
    try {
      await window.storage.delete(STORAGE_KEY);
    } catch (err) {
      // si la clave no existe, delete puede lanzar; lo ignoramos
    }
    setSectors(defaultSectors());
    setDailyConsumption(demoDailyConsumption());
    setFertilizerDailyHistory(demoFertilizerHistory());
    setPressureDailyHistory(demoPressureHistory());
    setPressureHourlyHistory(demoPressureHourly());
    setFertilizerConsumedToday(0);
    setFertilizerLevel(68);
    setMainSupply(true);
    setMaestraCerrada(null);
    setHistory([]);
    setAlarmHistory([]);
    setLeakAlerts([]);
    setPressureAlert(null);
    setMultiLineAlert(null);
    setFertilizerAlert(null);
    setConfirmReset(false);
  };

  const barraAscii = (valor, maximo, ancho = 18) => {
    if (!maximo || maximo <= 0) return "░".repeat(ancho);
    const llenas = Math.max(0, Math.min(ancho, Math.round((valor / maximo) * ancho)));
    return "█".repeat(llenas) + "░".repeat(ancho - llenas);
  };

  const enviarInformeMantenimientoCliente = () => {
    if (!cliente.email) return;
    const ahora = new Date();
    const fecha = ahora.toLocaleDateString("es-ES", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
    const mesActual = ahora.getMonth();
    const anioActual = ahora.getFullYear();
    const nombreMes = ahora.toLocaleDateString("es-ES", { month: "long" });
    const lineasActivas = sectors.filter((s) => isSectorActiveNow(s, now)).length;
    const alarmasAbiertas = alarmHistory
      .filter((a) => a.type !== "fuga_rearmada" && a.type !== "fallo_electrico_resuelto")
      .slice(0, 10);
    const lineasBloqueadas = sectors.filter((s) => s.blockedByLeak || s.blockedByFault);

    // Consumo de este mes, por línea (suma de los días del histórico diario que
    // caen en el mes en curso, más lo que lleve hoy).
    const consumoPorLinea = sectors.map((s) => {
      const diasDelMes = (s.dailyConsumption || []).filter((d) => {
        const fd = new Date(d.date);
        return fd.getMonth() === mesActual && fd.getFullYear() === anioActual;
      });
      const totalDias = diasDelMes.reduce((sum, d) => sum + Number(d.liters || 0), 0);
      const total = Math.round((totalDias + Number(s.sensors?.litersToday || 0)) * 10) / 10;
      return { nombre: s.name, litros: total };
    });
    const totalConsumoMes = Math.round(consumoPorLinea.reduce((sum, l) => sum + l.litros, 0) * 10) / 10;

    // Fertilizante: consumo del mes y última fecha de relleno.
    const fertilizanteMes = (fertilizerDailyHistory || []).filter((d) => {
      const fd = new Date(d.date);
      return fd.getMonth() === mesActual && fd.getFullYear() === anioActual;
    });
    const totalFertilizanteMes = Math.round(
      (fertilizanteMes.reduce((sum, d) => sum + Number(d.consumoML || 0), 0) + Number(fertilizerConsumedToday || 0)) * 10
    ) / 10;
    const ultimoRelleno = alarmHistory.find((a) => a.type === "fertilizante_rellenado");

    // Checklist de procesos realizados en esta visita.
    const procesosHechos = CATALOGO_PROCESOS_MANTENIMIENTO.filter((p) => procesosRealizados[p.key]);
    const procesosPendientes = CATALOGO_PROCESOS_MANTENIMIENTO.filter((p) => !procesosRealizados[p.key]);

    const maxConsumoLinea = Math.max(1, ...consumoPorLinea.map((l) => l.litros));
    const nombreMaxLargo = Math.max(8, ...consumoPorLinea.map((l) => l.nombre.length));

    const subject = `Verdtical · Informe de mantenimiento — ${fecha}`;
    const bodyLineas = [
      `Estimado/a ${cliente.nombre || "cliente"},`,
      "",
      "Le enviamos el resumen del estado de su instalación de riego:",
      "",
      `Fecha del informe: ${fecha}`,
      `Líneas totales: ${sectors.length}`,
      `Líneas regando en este momento: ${lineasActivas}`,
      `Presión de red: ${pressureBar} bar`,
      "",
      lineasBloqueadas.length
        ? `Líneas con incidencia abierta ahora mismo: ${lineasBloqueadas.map((s) => s.name).join(", ")}`
        : "Sin incidencias abiertas en este momento.",
      "",
      `Consumo de agua de ${nombreMes} (por línea):`,
      ...consumoPorLinea.map(
        (l) => `  ${l.nombre.padEnd(nombreMaxLargo)}  ${barraAscii(l.litros, maxConsumoLinea)}  ${l.litros} L`
      ),
      `  ${"".padEnd(nombreMaxLargo)}  ${"—".repeat(18)}`,
      `  ${"Total".padEnd(nombreMaxLargo)}  ${totalConsumoMes} L`,
      "",
      "Depósito de fertilizante:",
      `  Nivel actual   [${barraAscii(fertilizerLevel, 100)}] ${fertilizerLevel}%`,
      `  Consumo ${nombreMes.padEnd(9)} [${barraAscii(totalFertilizanteMes, Math.max(totalFertilizanteMes, 5000))}] ${totalFertilizanteMes} mL`,
      ultimoRelleno
        ? `  Último relleno: ${new Date(ultimoRelleno.ts).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })}`
        : "  Sin relleno registrado todavía.",
      "",
      "Procesos realizados en esta visita:",
      ...(procesosHechos.length ? procesosHechos.map((p) => `  ✓ ${p.label}`) : ["  (ninguno marcado)"]),
      procesosPendientes.length ? "Procesos NO realizados en esta visita:" : "",
      ...procesosPendientes.map((p) => `  ✗ ${p.label}`),
      "",
      notaObservacion ? "Nota de observación:" : "",
      notaObservacion ? `  ${notaObservacion}` : "",
      "",
      alarmasAbiertas.length ? "Últimas alarmas registradas:" : "",
      ...alarmasAbiertas.map((a) => {
        const t = textoAlarma(a);
        return `  · ${a.lineName || "Sistema"} — ${t.titulo} (${new Date(a.ts).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })})`;
      }),
      "",
      "Quedamos a su disposición para cualquier consulta.",
      "",
      "Un saludo,",
      "Equipo Verdtical Ecosistema",
    ].filter((l) => l !== "");
    const body = bodyLineas.join("\n");
    const destino = cliente.emailAvisos || cliente.email;
    const enlace = document.createElement("a");
    enlace.href = `mailto:${encodeURIComponent(destino)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    enlace.click();
  };

  const rellenarFertilizante = () => {
    setFertilizerLevel(100);
    setFertilizerAlert(null);
    fertilizerAlertedRef.current = { bajo: false, agotado: false };
    setAlarmHistory((prev) =>
      [
        {
          id: `alarm-${Date.now()}-fert-relleno`,
          ts: new Date().toISOString(),
          lineName: "Depósito de fertilizante",
          type: "fertilizante_rellenado",
        },
        ...prev,
      ].slice(0, MAX_ALARM_LOG)
    );
    setHistory((h) => [{ ts: new Date().toISOString(), text: "Depósito de fertilizante marcado como rellenado (100%)." }, ...h].slice(0, 20));
  };

  const rearmarLineaFault = (lineId, lineName) => {
    setSectors((prev) => prev.map((s) => (s.id === lineId ? { ...s, blockedByFault: false } : s)));
    setAlarmHistory((prev) =>
      [
        { id: `alarm-${Date.now()}`, ts: new Date().toISOString(), lineId, lineName, type: "fallo_electrico_resuelto" },
        ...prev,
      ].slice(0, MAX_ALARM_LOG)
    );
    setHistory((h) => [{ ts: new Date().toISOString(), text: `${lineName}: electroválvula rearmada tras fallo eléctrico` }, ...h].slice(0, 20));
  };

  const descartarAlertaPresion = () => {
    setPressureAlert(null);
    pressureOutTicksRef.current = 0;
  };

  const descartarAlertaMultiLinea = () => {
    setMultiLineAlert(null);
  };

  const rearmarLinea = (lineId, lineName) => {
    setSectors((prev) => prev.map((s) => (s.id === lineId ? { ...s, blockedByLeak: false } : s)));
    setLeakAlerts((prev) => prev.filter((a) => a.lineId !== lineId));
    setAlarmHistory((prev) =>
      [
        { id: `alarm-${Date.now()}`, ts: new Date().toISOString(), lineId, lineName, type: "fuga_rearmada" },
        ...prev,
      ].slice(0, MAX_ALARM_LOG)
    );
    setHistory((h) => [{ ts: new Date().toISOString(), text: `${lineName}: electroválvula rearmada manualmente` }, ...h].slice(0, 20));
  };

  const updateSector = (id, updated) => {
    setSectors((prev) => prev.map((s) => (s.id === id ? updated : s)));
  };

  const subirPlano = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Redimensionamos y comprimimos en el navegador antes de guardar,
        // para no llenar el almacenamiento con fotos a resolución completa.
        const maxAncho = 1400;
        const escala = Math.min(1, maxAncho / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * escala;
        canvas.height = img.height * escala;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setPlanoImagen(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  const colocarLineaEnPlano = (sectorId, xPct, yPct) => {
    setSectors((prev) =>
      prev.map((s) => (s.id === sectorId ? { ...s, posicionPlano: { x: xPct, y: yPct } } : s))
    );
    setLineaColocando(null);
  };

  const quitarLineaDePlano = (sectorId) => {
    setSectors((prev) => prev.map((s) => (s.id === sectorId ? { ...s, posicionPlano: null } : s)));
  };

  const [resumenProgramacionGlobal, setResumenProgramacionGlobal] = useState(null);
  const [showListadoHorarios, setShowListadoHorarios] = useState(false);
  const [temporadaListado, setTemporadaListado] = useState(() => getSeasonForDate(now));

  // Calcula la programación automática de TODAS las líneas a la vez, en una
  // sola pasada: procesa una a una (en orden), y cada línea tiene en cuenta
  // los huecos que ya han ocupado las líneas anteriores de esta misma
  // pasada, así ninguna se pisa con otra aunque estén en zonas de sol,
  // semisombra o sombra distintas.
  const calcularProgramacionAutomaticaGlobal = () => {
    const etoPorExposicion = { sol: etoSol, semisombra: etoSemisombra, sombra: etoSombra };
    const diasTodos = [...TODOS_LOS_DIAS];
    // Una lista de ocupación acumulada POR CADA ESTACIÓN por separado, ya
    // que el número de tandas (y por tanto los huecos que ocupan) puede ser
    // distinto en cada una.
    const ocupacionAcumuladaPorEstacion = {};
    ESTACIONES.forEach((est) => {
      ocupacionAcumuladaPorEstacion[est.key] = [];
    });
    let sinSuperficie = 0;
    let conflictosTotales = 0;

    const nuevosSectores = sectors.map((s) => {
      if (!s.areaM2 || s.areaM2 <= 0) {
        sinSuperficie++;
        return s;
      }
      const nominalFlowLinea = Number(s.emitters || 0) * Number(s.emitterFlow || 0);
      const etoLinea = etoPorExposicion[s.exposicion] ?? etoSol;
      const { schedules: nuevosSchedules, resumenPorEstacion } = calcularProgramacionAutomaticaTodasEstaciones({
        areaM2: s.areaM2,
        etoBase: etoLinea,
        nominalFlow: nominalFlowLinea,
        duracionSesion: s.duracionTandaAuto ?? 15,
        ocupacionPorEstacion: ocupacionAcumuladaPorEstacion,
      });

      ESTACIONES.forEach((est) => {
        conflictosTotales += resumenPorEstacion[est.key].conflictosSinResolver;
        (nuevosSchedules[est.key] || []).forEach((h) => {
          const inicio = horaAMinutos(h.time);
          ocupacionAcumuladaPorEstacion[est.key] = [
            ...ocupacionAcumuladaPorEstacion[est.key],
            { days: diasTodos, inicio, fin: inicio + Number(h.duration || 0), lineName: s.name },
          ];
        });
      });

      return { ...s, schedules: nuevosSchedules };
    });

    setSectors(nuevosSectores);
    const lineasProgramadas = sectors.length - sinSuperficie;
    setResumenProgramacionGlobal({
      lineasProgramadas,
      sinSuperficie,
      conflictosTotales,
      timestamp: new Date().toISOString(),
    });
  };

  const removeSector = (id) => {
    setSectors((prev) => prev.filter((s) => s.id !== id));
  };

  const addSector = () => {
    setSectors((prev) => {
      const numero = prev.length + 1;
      return [
        ...prev,
        {
          id: `sector-${Date.now()}`,
          name: `Línea ${numero}`,
          emitters: 20,
          emitterFlow: 50,
          mode: "horario",
          schedules: generarProgramacionEstacional([nuevoHorario()]),
          thresholds: { humidityMin: 30, humidityMax: 65, ecMin: 1.2, ecMax: 2.4, temperatureMin: 2, temperatureMax: 40, flowMinPercent: 85, flowMaxPercent: 115 },
          sensors: { humidity: 45, temperature: 21, ec: 1.8, flowMeasured: 0, litersToday: 0, lastResetDay: null },
          history: [],
          dailyConsumption: [],
          blockedByLeak: false,
          blockedByFault: false,
          minorLeakFlag: false,
          clogFlag: false,
          humidityFlag: false,
          ecFlag: false,
          temperatureFlag: false,
          manualOverride: null,
          riegoLog: [],
        },
      ];
    });
  };

  if (!sectors) {
    return (
      <div style={{ padding: "2rem", fontFamily: "var(--vc-font-body)", color: "var(--vc-text-muted)" }}>
        Cargando panel de riego…
      </div>
    );
  }

  const anyActive = mainSupply && !maestraCerrada && sectors.some((s) => isSectorActiveNow(s, now));
  const totalFlowMeasured = sectors.reduce((sum, s) => sum + Number(s.sensors?.flowMeasured || 0), 0);
  const pressureOutOfRange = pressureBar < 1.0 || pressureBar > 4.0;
  const presionEnRangoTrabajo = pressureBar >= 1.8 && pressureBar <= 3.5;
  const todayTotalLiters = Math.round(sectors.reduce((sum, s) => sum + Number(s.sensors?.litersToday || 0), 0));
  const chartConsumoDiario = [...dailyConsumption, { label: "Hoy", liters: todayTotalLiters, isToday: true }];
  const chartConsumoReciente = chartConsumoDiario.slice(-14);
  const promedioPresionHoy =
    pressureCountTodayRef.current > 0
      ? Math.round((pressureSumTodayRef.current / pressureCountTodayRef.current) * 100) / 100
      : pressureBar;
  const chartPresionDiaria = [...pressureDailyHistory, { label: "Hoy", avgPressure: promedioPresionHoy, isToday: true }];
  const chartPresionHoraria = [...pressureHourlyHistory, { label: "Ahora", pressure: pressureBar, isToday: true }];
  const chartFertilizanteDiario = [
    ...fertilizerDailyHistory,
    { label: "Hoy", consumoML: fertilizerConsumedToday, isToday: true },
  ];

  return (
    <div className="vc-root">
      <style>{`
        .vc-root {
          --vc-bg: #12201f;
          --vc-panel: #1b2b2a;
          --vc-panel-2: #223533;
          --vc-border: #33463f;
          --vc-text: #ededE6;
          --vc-text-muted: #8fa39e;
          --vc-brass: #c19a5b;
          --vc-brass-dark: #8a6f3d;
          --vc-pipe: #3a5049;
          --vc-flow: #4fb6c4;
          --vc-open: #6fcf97;
          --vc-idle: #55655f;
          --vc-amber: #e0a458;
          --vc-heat: #e08a5b;
          --vc-violet: #9b8fd1;
          --vc-red: #e0645b;
          --vc-font-display: 'Oswald', 'Arial Narrow', sans-serif;
          --vc-font-body: 'Inter', system-ui, sans-serif;
          --vc-font-mono: 'IBM Plex Mono', 'Courier New', monospace;
          background: var(--vc-bg);
          color: var(--vc-text);
          font-family: var(--vc-font-body);
          border-radius: 16px;
          padding: 1.75rem;
          width: 100%;
          box-sizing: border-box;
        }
        .vc-root * { box-sizing: border-box; }
        .vc-header {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          margin-bottom: 1.25rem;
          padding-bottom: 1.25rem;
          border-bottom: 1px solid var(--vc-border);
        }
        .vc-header-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
        }
        .vc-supply-toggle-lg {
          padding: 10px 22px;
          font-size: 13px;
          border-width: 2px;
          min-height: 56px;
          box-sizing: border-box;
        }
        .vc-top-buttons {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .vc-connection-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          background: var(--vc-panel-2);
          border: 1px solid var(--vc-open);
          color: var(--vc-open);
          border-radius: 999px;
          padding: 8px 14px;
          font-family: var(--vc-font-mono);
          font-size: 11px;
          white-space: nowrap;
          min-height: 56px;
          box-sizing: border-box;
        }
        .vc-connection-badge-off {
          border-color: var(--vc-red);
          color: var(--vc-red);
        }
        .vc-connection-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: currentColor;
          flex-shrink: 0;
        }
        .vc-title {
          font-family: var(--vc-font-display);
          font-weight: 500;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          font-size: 20px;
          margin: 0 0 4px;
        }
        .vc-co2-lineas-group {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: nowrap;
        }
        .vc-co2-toggle {
          background: #1a3324;
          border-color: #4a8f5c;
          color: #6fcf87;
          cursor: help;
          padding: 10px 12px;
          font-size: 11px;
          max-width: 160px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .vc-proyecto-btn {
          background: transparent;
          border: none;
          color: var(--vc-text-muted);
          font-size: 11px;
          font-family: var(--vc-font-mono);
          cursor: pointer;
          padding: 0;
          text-decoration: underline;
        }
        .vc-proyecto-fecha-row {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .vc-fecha-inline {
          font-size: 11px;
          color: var(--vc-text-muted);
          font-family: var(--vc-font-mono);
          white-space: nowrap;
        }
        .vc-proyecto-config {
          background: var(--vc-panel-2);
          border: 1px solid var(--vc-border);
          border-radius: 10px;
          padding: 10px 12px;
          margin-top: 10px;
        }
        .vc-proyecto-config code {
          background: var(--vc-panel);
          border-radius: 4px;
          padding: 1px 5px;
          font-family: var(--vc-font-mono);
          font-size: 10px;
        }
        .vc-plano-overlay {
          position: fixed;
          inset: 0;
          background: var(--vc-bg);
          z-index: 200;
          overflow-y: auto;
          padding: 20px;
        }
        .vc-plano-panel {
          background: var(--vc-panel);
          border: 1px solid var(--vc-border);
          border-radius: 14px;
          padding: 20px;
          max-width: 1200px;
          margin: 0 auto;
        }
        .vc-plano-cerrar-btn {
          background: var(--vc-panel-2);
          border: 1px solid var(--vc-border);
          color: var(--vc-text);
          border-radius: 999px;
          padding: 7px 14px;
          font-size: 11px;
          cursor: pointer;
        }
        .vc-plano-cerrar-btn:hover {
          border-color: var(--vc-red);
          color: var(--vc-red);
        }
        .vc-listado-resumen {
          font-size: 12px;
          color: var(--vc-text-muted);
          margin: 10px 0;
        }
        .vc-resumen-lineas-tabla {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .vc-resumen-lineas-cabecera,
        .vc-resumen-lineas-fila {
          display: grid;
          grid-template-columns: 1.3fr 1fr 1fr 1fr;
          gap: 8px;
          padding: 6px 10px;
          font-size: 12px;
        }
        .vc-resumen-lineas-cabecera {
          color: var(--vc-text-muted);
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .vc-resumen-lineas-fila {
          background: var(--vc-panel-2);
          border: 1px solid var(--vc-border);
          border-radius: 6px;
          color: var(--vc-text);
        }
        .vc-listado-tabla {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .vc-listado-fila {
          display: grid;
          grid-template-columns: 110px 1fr 60px 90px;
          align-items: center;
          gap: 8px;
          background: var(--vc-panel-2);
          border: 1px solid var(--vc-border);
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 12px;
        }
        .vc-listado-fila-conflicto {
          border-color: var(--vc-red);
          background: #3a1616;
        }
        .vc-listado-hora {
          font-family: var(--vc-font-mono);
          color: var(--vc-flow);
        }
        .vc-listado-linea {
          font-weight: 500;
        }
        .vc-listado-duracion {
          color: var(--vc-text-muted);
          font-size: 11px;
        }
        .vc-listado-dias {
          color: var(--vc-text-muted);
          font-size: 10px;
          font-family: var(--vc-font-mono);
        }
        .vc-listado-conflicto-txt {
          grid-column: 1 / -1;
          color: var(--vc-red);
          font-size: 11px;
        }
        .vc-huecos-lista {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .vc-hueco-chip {
          background: #1a3336;
          border: 1px solid var(--vc-flow);
          color: var(--vc-flow);
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 11px;
          font-family: var(--vc-font-mono);
        }
        .vc-plano-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 14px;
        }
        .vc-plano-header-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          flex-shrink: 0;
        }
        .vc-plano-imagen-wrap {
          position: relative;
          display: inline-block;
          max-width: 100%;
          border-radius: 10px;
          overflow: hidden;
          border: 1px solid var(--vc-border);
          line-height: 0;
        }
        .vc-plano-imagen {
          display: block;
          max-width: 100%;
          max-height: 72vh;
          width: auto;
          height: auto;
          background: #0a1413;
        }
        .vc-plano-marcador {
          position: absolute;
          width: 27px;
          transform: translate(-50%, -50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          cursor: default;
        }
        .vc-plano-marcador-barra {
          width: 27px;
          height: 11px;
          border-radius: 3px;
          border: 1px solid #12201f;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.15);
          overflow: hidden;
          position: relative;
        }
        .vc-plano-marcador-flujo {
          position: absolute;
          inset: 0;
          background-image: repeating-linear-gradient(
            -45deg,
            rgba(255, 255, 255, 0.4) 0,
            rgba(255, 255, 255, 0.4) 4px,
            transparent 4px,
            transparent 10px
          );
          background-size: 200% 200%;
          animation: vc-flujo-riego 0.8s linear infinite;
        }
        @keyframes vc-flujo-riego {
          from {
            background-position: 0 0;
          }
          to {
            background-position: 20px 0;
          }
        }
        .vc-plano-marcador-on {
          transform: translate(-50%, -50%) scale(1.25);
          z-index: 2;
        }
        .vc-plano-marcador-label {
          font-size: 9px;
          font-weight: 700;
          color: #12201f;
          position: relative;
          z-index: 1;
        }
        .vc-plano-marcador-humedad {
          margin-top: 3px;
          background: #ffffff;
          color: #000000;
          font-size: 11px;
          font-weight: 700;
          font-family: var(--vc-font-mono);
          padding: 1.5px 5px;
          border-radius: 999px;
          border: 1px solid var(--vc-flow);
          white-space: nowrap;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
          line-height: 1.2;
        }
        .vc-plano-lista {
          margin-top: 14px;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
          gap: 8px;
        }
        .vc-plano-lista-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: var(--vc-panel-2);
          border: 1px solid var(--vc-border);
          border-radius: 8px;
          padding: 8px 10px;
          font-size: 12px;
        }
        .vc-plano-lista-item-doble {
          flex-direction: column;
          align-items: stretch;
          gap: 6px;
        }
        .vc-plano-lista-fila {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .vc-plano-lista-fila-label {
          font-size: 10px;
          color: var(--vc-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .vc-balance-hidrico {
          margin-top: 18px;
          border-top: 1px solid var(--vc-border);
          padding-top: 16px;
        }
        .vc-balance-resultados {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 10px;
          margin-top: 10px;
        }
        .vc-balance-stat {
          background: var(--vc-panel-2);
          border: 1px solid var(--vc-border);
          border-radius: 10px;
          padding: 10px 12px;
          text-align: center;
        }
        .vc-balance-stat-co2 {
          border-color: #4a8f5c;
        }
        .vc-balance-stat-co2 .vc-balance-stat-value {
          color: #6fcf87;
        }
        .vc-balance-stat-label {
          font-size: 10px;
          color: var(--vc-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.03em;
          margin-bottom: 4px;
        }
        .vc-balance-stat-value {
          font-size: 18px;
          font-weight: 600;
          color: var(--vc-text);
        }
        .vc-llave-flujo {
          animation: vc-llave-flujo-anim 0.4s linear infinite;
        }
        @keyframes vc-llave-flujo-anim {
          from {
            stroke-dashoffset: 0;
          }
          to {
            stroke-dashoffset: -5.5;
          }
        }
        .vc-aspas-giro {
          animation: vc-aspas-giro-anim 0.6s linear infinite;
        }
        @keyframes vc-aspas-giro-anim {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        .vc-fert-baja {
          animation: vc-fert-baja-anim 1.4s linear infinite;
        }
        @keyframes vc-fert-baja-anim {
          from {
            transform: translateY(0);
          }
          to {
            transform: translateY(10px);
          }
        }
        .vc-plano-btn-sm {
          background: transparent;
          border: 1px dashed var(--vc-border);
          color: var(--vc-flow);
          border-radius: 6px;
          padding: 4px 8px;
          font-size: 10px;
          cursor: pointer;
        }
        .vc-plano-btn-sm-on {
          border-style: solid;
          border-color: var(--vc-flow);
          background: #1a3336;
        }
        .vc-plano-btn-sm-quitar {
          color: var(--vc-red);
        }
        .vc-plano-input-sm {
          background: var(--vc-panel);
          border: 1px solid var(--vc-border);
          color: var(--vc-text);
          border-radius: 6px;
          padding: 4px 6px;
          font-size: 11px;
          width: 70px;
        }
        .vc-plano-lista-fila-unidad {
          font-size: 10px;
          color: var(--vc-text-muted);
        }
        .vc-subtitle {
          font-size: 12px;
          color: var(--vc-text-muted);
          font-family: var(--vc-font-mono);
          margin: 6px 0 10px;
        }
        .vc-header-actions {
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
        }
        .vc-supply-toggle {
          background: var(--vc-panel-2);
          border: 1px solid var(--vc-border);
          color: var(--vc-text);
          border-radius: 999px;
          padding: 7px 14px;
          font-family: var(--vc-font-mono);
          font-size: 11px;
          letter-spacing: 0.02em;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 7px;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .vc-supply-toggle:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .vc-supply-toggle-on {
          border-color: var(--vc-flow);
          color: var(--vc-flow);
        }
        .vc-reset-toggle {
          color: var(--vc-text-muted);
          border-style: dashed;
        }
        .vc-supply-toggle-auto {
          border-color: var(--vc-flow);
          color: var(--vc-flow);
        }
        .vc-box-left {
          margin-right: auto;
        }
        .vc-test-box {
          border-style: dashed;
        }
        .vc-box-separador {
          width: 1px;
          height: 20px;
          background: var(--vc-border);
          margin: 0 2px;
        }
        .vc-icon-only-btn-on {
          color: var(--vc-red);
        }
        .vc-programacion-box {
          display: flex;
          align-items: center;
          gap: 4px;
          background: var(--vc-panel-2);
          border: 1px solid var(--vc-border);
          border-radius: 999px;
          padding: 6px 10px;
          min-height: 56px;
          box-sizing: border-box;
        }
        .vc-icon-only-btn {
          background: transparent;
          border: none;
          color: var(--vc-flow);
          padding: 4px 6px;
          font-size: 16px;
          cursor: pointer;
        }
        .vc-resumen-programacion-global {
          background: #1a3336;
          border: 1px solid var(--vc-flow);
          border-radius: 10px;
          padding: 8px 12px;
          margin-top: 10px;
          font-size: 12px;
          color: var(--vc-text);
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .vc-resumen-cerrar-btn {
          background: transparent;
          border: none;
          color: var(--vc-text-muted);
          cursor: pointer;
          font-size: 13px;
          margin-left: auto;
          flex-shrink: 0;
        }
        .vc-reset-toggle:hover {
          border-color: var(--vc-red);
          color: var(--vc-red);
        }
        .vc-reset-confirm {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #3a1616;
          border: 1px solid var(--vc-red);
          border-radius: 999px;
          padding: 7px 14px;
          font-size: 11px;
          color: #ffd9d5;
          white-space: nowrap;
        }
        .vc-reset-confirm-yes {
          background: var(--vc-red);
          color: #3a1616;
          border: none;
          border-radius: 999px;
          padding: 5px 10px;
          font-size: 10px;
          font-weight: 500;
          cursor: pointer;
        }
        .vc-reset-confirm-no {
          background: transparent;
          border: 1px solid var(--vc-border);
          color: var(--vc-text);
          border-radius: 999px;
          padding: 5px 10px;
          font-size: 10px;
          cursor: pointer;
        }
        .vc-maestra-banner {
          background: #3a1616;
          border: 2px solid var(--vc-red);
          border-radius: 12px;
          padding: 16px;
          margin-bottom: 1.25rem;
        }
        .vc-maestra-titulo {
          color: var(--vc-red);
          font-weight: 700;
          font-size: 15px;
          margin-bottom: 8px;
        }
        .vc-maestra-motivo {
          font-size: 13px;
          color: var(--vc-text);
          margin: 0 0 6px;
        }
        .vc-maestra-hora {
          font-size: 11px;
          color: var(--vc-text-muted);
          margin: 0 0 12px;
        }
        .vc-maestra-rearmar {
          background: var(--vc-red);
          color: #fff;
          border: none;
          border-radius: 8px;
          padding: 10px 16px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }
        .vc-maestra-confirm {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          font-size: 12px;
          color: #ffd9d5;
        }
        .vc-maestra-confirm-yes {
          background: var(--vc-red);
          color: #fff;
          border: none;
          border-radius: 8px;
          padding: 8px 14px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }
        .vc-maestra-confirm-no {
          background: transparent;
          color: #ffd9d5;
          border: 1px solid var(--vc-red);
          border-radius: 8px;
          padding: 8px 14px;
          font-size: 12px;
          cursor: pointer;
        }
        .vc-leak-stack {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 1.25rem;
        }
        .vc-leak-banner {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          background: #3a1616;
          border: 1px solid var(--vc-red);
          color: #ffd9d5;
          border-radius: 10px;
          padding: 10px 16px;
          font-size: 13px;
        }
        .vc-leak-rearm {
          background: var(--vc-red);
          color: #3a1616;
          border: none;
          border-radius: 7px;
          padding: 8px 14px;
          font-weight: 500;
          font-size: 12px;
          cursor: pointer;
          white-space: nowrap;
        }
        .vc-leak-rearm:hover {
          background: #f28c85;
        }
        .vc-blocked-banner {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #3a1616;
          border: 1px solid var(--vc-red);
          color: #ffd9d5;
          border-radius: 8px;
          padding: 6px 10px;
          font-size: 11px;
        }
        .vc-blocked-banner-fault {
          background: #2a2340;
          border-color: var(--vc-violet);
          color: #e3ddf7;
        }
        .vc-leak-banner-pressure {
          background: #3a2f16;
          border-color: var(--vc-amber);
          color: #ffe8c2;
        }
        .vc-leak-banner-multi {
          background: #2a2340;
          border-color: var(--vc-violet);
          color: #e3ddf7;
        }
        .vc-leak-rearm-sm {
          padding: 4px 10px;
          font-size: 11px;
        }
        .vc-summary-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 10px;
          margin-bottom: 1.25rem;
        }
        .vc-tecnico-cliente-stack {
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-width: 0;
        }
        .vc-summary-card {
          background: var(--vc-panel);
          border: 1px solid var(--vc-border);
          border-radius: 10px;
          padding: 10px 12px;
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .vc-summary-card-narrow {
          padding: 10px 8px;
        }
        .vc-summary-card-compact {
          padding: 6px 8px;
          gap: 5px;
        }
        .vc-summary-card-compact .vc-summary-label {
          font-size: 9px;
          margin-bottom: 1px;
        }
        .vc-summary-card-compact .vc-summary-value {
          font-size: 13px;
        }
        .vc-summary-card-mini {
          padding: 1px 5px;
          max-width: 60px;
          flex: 0 0 auto;
          align-self: start;
          height: fit-content;
        }
        .vc-summary-card-mini .vc-summary-label {
          font-size: 7px;
          margin-bottom: 0;
          line-height: 1;
        }
        .vc-summary-card-mini .vc-summary-value {
          font-size: 11px;
          line-height: 1.1;
        }
        .vc-summary-card-vertical {
          flex-direction: column;
          justify-content: center;
          gap: 4px;
          align-self: start;
        }
        .vc-summary-text-center {
          align-items: center;
          text-align: center;
        }
        .vc-summary-card-btn {
          width: 100%;
          font-family: inherit;
          cursor: pointer;
          text-align: left;
        }
        .vc-summary-card-btn:hover {
          border-color: var(--vc-border-strong, var(--vc-border));
        }
        .vc-summary-card-on {
          border-color: var(--vc-flow);
        }
        .vc-summary-text { display: flex; flex-direction: column; }
        .vc-summary-label {
          font-size: 11px;
          color: var(--vc-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 4px;
        }
        .vc-summary-value {
          font-family: var(--vc-font-mono);
          font-size: 18px;
        }
        .vc-collector-wrap {
          margin-bottom: 1.5rem;
        }
        .vc-collector-status {
          text-align: center;
          font-size: 11px;
          font-family: var(--vc-font-mono);
          color: var(--vc-text-muted);
          margin-top: -4px;
        }
        .vc-charts-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 14px;
          margin-bottom: 1.5rem;
        }
        .vc-chart-card {
          background: var(--vc-panel);
          border: 1px solid var(--vc-border);
          border-radius: 12px;
          padding: 12px 14px 4px;
        }
        .vc-chart-title {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--vc-text-muted);
          margin-bottom: 4px;
        }
        .vc-chart-current {
          font-family: var(--vc-font-mono);
          font-size: 14px;
          text-transform: none;
          letter-spacing: 0;
        }
        .vc-chart-empty {
          font-size: 12px;
          color: var(--vc-text-muted);
          padding: 40px 0;
          text-align: center;
        }
        .vc-annual-toggle {
          width: 100%;
          margin-top: 6px;
          margin-bottom: 4px;
        }
        .vc-annual-chart-wrap {
          border-top: 1px solid var(--vc-border);
          padding-top: 8px;
          margin-top: 4px;
        }
        .vc-hourly-detail {
          border-top: 1px solid var(--vc-border);
          margin-top: 10px;
          padding-top: 10px;
        }
        .vc-hourly-detail-title {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
          color: var(--vc-text-muted);
          margin-bottom: 6px;
        }
        .vc-cal-dia-cerrar-btn {
          background: transparent;
          border: none;
          color: var(--vc-text-muted);
          cursor: pointer;
          font-size: 13px;
          padding: 0 4px;
        }
        .vc-cal-dia-cerrar-btn:hover {
          color: var(--vc-red);
        }
        .vc-chart-nav {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 6px;
          flex-wrap: wrap;
        }
        .vc-chart-nav-btn {
          background: var(--vc-panel-2);
          border: 1px solid var(--vc-border);
          color: var(--vc-flow);
          border-radius: 999px;
          padding: 5px 10px;
          font-size: 10px;
          cursor: pointer;
          white-space: nowrap;
        }
        .vc-chart-nav-btn:disabled {
          color: var(--vc-text-muted);
          cursor: not-allowed;
          opacity: 0.5;
        }
        .vc-chart-nav-btn:not(:disabled):hover {
          border-color: var(--vc-flow);
        }
        .vc-chart-nav-hoy {
          color: var(--vc-brass);
        }
        .vc-chart-nav-label {
          font-size: 10px;
          font-family: var(--vc-font-mono);
          color: var(--vc-text-muted);
        }
        .vc-outage-log {
          margin-top: 10px;
          border-top: 1px solid var(--vc-border);
          padding-top: 8px;
          max-height: 200px;
          overflow-y: auto;
        }
        .vc-outage-log-title {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--vc-text-muted);
          margin-bottom: 6px;
        }
        .vc-outage-log-item {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          font-family: var(--vc-font-mono);
          color: var(--vc-red);
          background: #3a1616;
          border-radius: 6px;
          padding: 5px 8px;
          margin-bottom: 4px;
        }
        .vc-flow-alarm-item-leve {
          color: var(--vc-amber);
          background: #2a2318;
        }
        .vc-flow-alarm-item-grave {
          color: var(--vc-red);
          background: #3a1616;
        }
        .vc-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
          gap: 10px;
          align-items: start;
        }
        .vc-card {
          background: var(--vc-panel);
          border: 1px solid var(--vc-border);
          border-radius: 12px;
          padding: 12px 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          position: relative;
          z-index: 1;
        }
        .vc-card-leak {
          border: 2px solid var(--vc-red);
          background: linear-gradient(180deg, #3a1616 0%, var(--vc-panel) 90px);
        }
        .vc-card-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .vc-card-title {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
          min-width: 0;
        }
        .vc-name-input {
          background: transparent;
          border: none;
          color: var(--vc-text);
          font-family: var(--vc-font-display);
          font-size: 14px;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          width: 100%;
          padding: 2px 0;
          min-width: 0;
        }
        .vc-name-input:focus {
          outline: none;
          border-bottom: 1px solid var(--vc-brass);
        }
        .vc-icon-btn {
          background: transparent;
          border: 1px solid var(--vc-border);
          color: var(--vc-text-muted);
          width: 24px;
          height: 24px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 15px;
          line-height: 1;
          flex-shrink: 0;
        }
        .vc-icon-btn:hover {
          border-color: var(--vc-red);
          color: var(--vc-red);
        }
        .vc-confirm-delete {
          display: flex;
          flex-direction: column;
          gap: 8px;
          background: #3a1616;
          border: 1px solid var(--vc-red);
          color: #ffd9d5;
          border-radius: 8px;
          padding: 10px 12px;
          font-size: 11px;
        }
        .vc-confirm-delete-actions {
          display: flex;
          gap: 8px;
        }
        .vc-confirm-cancel {
          flex: 1;
          background: var(--vc-panel-2);
          border: 1px solid var(--vc-border);
          color: var(--vc-text);
          border-radius: 6px;
          padding: 7px 8px;
          font-size: 11px;
          cursor: pointer;
        }
        .vc-confirm-yes {
          flex: 1;
          background: var(--vc-red);
          color: #3a1616;
          border: none;
          border-radius: 6px;
          padding: 7px 8px;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
        }
        .vc-confirm-yes:hover {
          background: #f28c85;
        }
        .vc-card-body {
          display: flex;
          align-items: center;
          gap: 14px;
          background: var(--vc-panel-2);
          border-radius: 10px;
          padding: 10px 14px;
        }
        .vc-readout {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .vc-readout-label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--vc-text-muted);
        }
        .vc-readout-value {
          font-family: var(--vc-font-mono);
          font-size: 15px;
        }
        .vc-sensor-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 6px;
        }
        .vc-sensor {
          background: var(--vc-panel-2);
          border: 1px solid var(--vc-border);
          border-radius: 7px;
          padding: 6px 8px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .vc-sensor-warn {
          border-color: var(--vc-red);
        }
        .vc-sensor-clickable {
          cursor: pointer;
        }
        .vc-sensor-clickable:hover {
          border-color: var(--vc-flow);
        }
        .vc-sensor-active {
          border-color: var(--vc-flow);
          background: #1a3336;
        }
        .vc-sensor-wide {
          grid-column: 1 / -1;
          flex-direction: row;
          align-items: baseline;
          justify-content: space-between;
        }
        .vc-sensor-label {
          font-size: 10px;
          color: var(--vc-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .vc-sensor-value {
          font-family: var(--vc-font-mono);
          font-size: 14px;
        }
        .vc-sensor-unit {
          font-size: 10px;
          color: var(--vc-text-muted);
          margin-left: 2px;
        }
        .vc-mini-charts-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
        }
        .vc-combined-chart-wrap {
          background: var(--vc-panel-2);
          border: 1px solid var(--vc-border);
          border-radius: 10px;
          padding: 10px 12px;
        }
        .vc-mini-chart {
          background: var(--vc-panel-2);
          border: 1px solid var(--vc-border);
          border-radius: 8px;
          padding: 8px 8px 2px;
        }
        .vc-mini-chart-title {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--vc-text-muted);
          margin-bottom: 2px;
          font-family: var(--vc-font-mono);
        }
        .vc-day-tabs {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin-bottom: 8px;
        }
        .vc-day-tab {
          background: var(--vc-panel-2);
          border: 1px solid var(--vc-border);
          color: var(--vc-text-muted);
          border-radius: 999px;
          padding: 5px 10px;
          font-size: 10px;
          cursor: pointer;
          white-space: nowrap;
        }
        .vc-day-tab-on {
          border-color: var(--vc-flow);
          color: var(--vc-flow);
        }
        .vc-chart-empty-sm {
          padding: 20px 0;
          font-size: 11px;
        }
        .vc-alert-line {
          font-size: 11px;
          color: var(--vc-red);
        }
        .vc-alert-ok {
          color: var(--vc-open);
        }
        .vc-alert-pressure-first {
          color: var(--vc-amber);
          font-weight: 500;
        }
        .vc-alert-escorrentia {
          color: var(--vc-amber);
          font-weight: 500;
        }
        .vc-alert-deficit {
          color: var(--vc-red);
          font-weight: 500;
        }
        .vc-mode-toggle {
          display: flex;
          gap: 4px;
        }
        .vc-mode-btn {
          flex: 1;
          background: var(--vc-panel-2);
          border: 1px solid var(--vc-border);
          color: var(--vc-text-muted);
          border-radius: 7px;
          padding: 6px 4px;
          font-size: 11px;
          line-height: 1.2;
          cursor: pointer;
          font-family: var(--vc-font-body);
        }
        .vc-mode-btn-on {
          border-color: var(--vc-brass);
          color: var(--vc-text);
          background: #2a2318;
        }
        .vc-manual-block {
          display: flex;
          align-items: center;
          gap: 6px;
          background: var(--vc-panel-2);
          border: 1px solid var(--vc-border);
          border-radius: 7px;
          padding: 6px 8px;
        }
        .vc-manual-input {
          width: 48px;
          background: var(--vc-panel);
          border: 1px solid var(--vc-border);
          color: var(--vc-text);
          border-radius: 6px;
          padding: 5px 6px;
          font-size: 12px;
          font-family: var(--vc-font-mono);
        }
        .vc-manual-unit {
          font-size: 11px;
          color: var(--vc-text-muted);
        }
        .vc-manual-start {
          flex: 1;
          background: var(--vc-flow);
          color: #08282c;
          border: none;
          border-radius: 6px;
          padding: 7px 8px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
        }
        .vc-manual-start:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .vc-manual-countdown {
          flex: 1;
          font-size: 11px;
          color: var(--vc-flow);
          font-family: var(--vc-font-mono);
        }
        .vc-manual-stop {
          background: var(--vc-red);
          color: #3a1616;
          border: none;
          border-radius: 6px;
          padding: 7px 12px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
        }
        .vc-sensor-hint {
          font-size: 11px;
          color: var(--vc-violet);
          font-family: var(--vc-font-mono);
        }
        .vc-next-event {
          font-size: 12px;
          color: var(--vc-text-muted);
          font-family: var(--vc-font-mono);
        }
        .vc-exposicion-fila {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--vc-text-muted);
        }
        .vc-next-event strong {
          color: var(--vc-text);
          font-weight: 400;
        }
        .vc-event-count {
          color: var(--vc-text-muted);
        }
        .vc-link-btn {
          background: transparent;
          border: none;
          color: var(--vc-flow);
          font-size: 12px;
          cursor: pointer;
          padding: 0;
          text-align: left;
        }
        .vc-toggle-row {
          display: flex;
          gap: 8px;
        }
        .vc-toggle-btn {
          flex: 1;
          background: var(--vc-panel-2);
          border: 1px solid var(--vc-border);
          color: var(--vc-flow);
          border-radius: 8px;
          padding: 8px 10px;
          font-size: 11px;
          cursor: pointer;
          text-align: center;
        }
        .vc-toggle-btn:hover {
          border-color: var(--vc-flow);
        }
        .vc-schedule-editor {
          border-top: 1px solid var(--vc-border);
          padding-top: 10px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-height: 420px;
          overflow-y: auto;
        }
        .vc-auto-programa {
          background: var(--vc-panel-2);
          border: 1px dashed var(--vc-flow);
          border-radius: 10px;
          padding: 10px;
        }
        .vc-auto-duracion-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--vc-text);
          margin-bottom: 8px;
        }
        .vc-season-tabs {
          display: flex;
          gap: 4px;
          position: sticky;
          top: 0;
          background: var(--vc-panel);
          padding-bottom: 4px;
          z-index: 1;
        }
        .vc-season-tab {
          flex: 1;
          background: var(--vc-panel-2);
          border: 1px solid var(--vc-border);
          color: var(--vc-text-muted);
          border-radius: 7px;
          padding: 6px 4px;
          font-size: 11px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
        }
        .vc-season-tab-on {
          border-color: var(--vc-flow);
          color: var(--vc-text);
          background: #1a3336;
        }
        .vc-season-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: var(--vc-open);
          display: inline-block;
        }
        .vc-event-block {
          background: var(--vc-panel-2);
          border: 1px solid var(--vc-border);
          border-radius: 8px;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .vc-event-block-conflicto {
          border-color: var(--vc-red);
          background: #3a1616;
        }
        .vc-conflicto-hint {
          font-size: 10px;
          color: var(--vc-red);
          margin: 0;
          line-height: 1.4;
        }
        .vc-event-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .vc-event-title {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--vc-brass);
          font-family: var(--vc-font-mono);
        }
        .vc-event-remove {
          background: transparent;
          border: 1px solid var(--vc-border);
          color: var(--vc-text-muted);
          width: 20px;
          height: 20px;
          border-radius: 5px;
          cursor: pointer;
          font-size: 13px;
          line-height: 1;
        }
        .vc-event-remove:hover {
          border-color: var(--vc-red);
          color: var(--vc-red);
        }
        .vc-add-event-btn {
          background: transparent;
          border: 1px dashed var(--vc-border);
          color: var(--vc-flow);
          border-radius: 8px;
          padding: 8px;
          font-size: 12px;
          cursor: pointer;
        }
        .vc-add-event-btn:hover {
          border-color: var(--vc-flow);
        }
        .vc-add-event-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .vc-threshold-title {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--vc-text-muted);
          border-top: 1px solid var(--vc-border);
          padding-top: 10px;
        }
        .vc-day-row {
          display: flex;
          gap: 4px;
        }
        .vc-day {
          flex: 1;
          background: var(--vc-panel);
          border: 1px solid var(--vc-border);
          color: var(--vc-text-muted);
          border-radius: 6px;
          padding: 5px 0;
          font-size: 11px;
          cursor: pointer;
        }
        .vc-day-on {
          background: var(--vc-flow);
          border-color: var(--vc-flow);
          color: #08282c;
          font-weight: 500;
        }
        .vc-field-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .vc-thresholds-note {
          font-size: 10px;
          color: var(--vc-amber);
          background: #2a2318;
          border: 1px solid var(--vc-amber);
          border-radius: 6px;
          padding: 8px 10px;
          margin: 4px 0 0;
          line-height: 1.4;
        }
        .vc-field-row label {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 11px;
          color: var(--vc-text-muted);
          flex: 1;
          min-width: 90px;
        }
        .vc-field-row input,
        .vc-field-row select {
          background: var(--vc-panel);
          border: 1px solid var(--vc-border);
          color: var(--vc-text);
          border-radius: 6px;
          padding: 6px 8px;
          font-size: 12px;
          font-family: var(--vc-font-mono);
        }
        .vc-add-card {
          background: transparent;
          border: 1px dashed var(--vc-border);
          border-radius: 12px;
          color: var(--vc-text-muted);
          cursor: pointer;
          min-height: 150px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
        }
        .vc-add-card:hover {
          border-color: var(--vc-brass);
          color: var(--vc-brass);
        }
        .vc-history {
          margin-top: 1.5rem;
          border-top: 1px solid var(--vc-border);
          padding-top: 12px;
        }
        .vc-history-title {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--vc-text-muted);
          margin-bottom: 8px;
        }
        .vc-history-item {
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-size: 11px;
          font-family: var(--vc-font-mono);
          color: var(--vc-text-muted);
          padding: 5px 0;
          border-bottom: 1px solid var(--vc-panel-2);
        }
        .vc-history-item span:first-child {
          color: var(--vc-text);
        }
        .vc-history-empty {
          font-size: 12px;
          color: var(--vc-text-muted);
        }
        .vc-riego-log {
          display: flex;
          flex-direction: column;
          gap: 4px;
          max-height: 320px;
          overflow-y: auto;
        }
        .vc-riego-log-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          font-family: var(--vc-font-mono);
          color: var(--vc-text-muted);
          background: var(--vc-panel-2);
          border-radius: 6px;
          padding: 5px 8px;
        }
        .vc-riego-tag {
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          padding: 2px 6px;
          border-radius: 999px;
          flex-shrink: 0;
        }
        .vc-riego-tag-horario {
          background: #1a3336;
          color: var(--vc-flow);
        }
        .vc-riego-tag-sensor {
          background: #2a2340;
          color: var(--vc-violet);
        }
        .vc-riego-tag-manual {
          background: #2a2318;
          color: var(--vc-brass);
        }
        .vc-riego-tag-fuga {
          background: #3a1616;
          color: var(--vc-red);
        }
        .vc-riego-tag-fuga-ok {
          background: #163a1e;
          color: var(--vc-open);
        }
        .vc-history-title-sub {
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid var(--vc-panel-2);
        }
        .vc-riego-log-time {
          flex: 1;
        }
        .vc-riego-log-stats {
          color: var(--vc-text);
          white-space: nowrap;
        }
        .vc-alarm-dropdown-wrap {
          position: relative;
        }
        .vc-alarm-dropdown {
          position: absolute;
          top: calc(100% + 6px);
          right: 0;
          z-index: 20;
          width: 320px;
          max-width: 80vw;
          max-height: 320px;
          overflow-y: auto;
          background: var(--vc-panel);
          border: 1px solid var(--vc-border);
          border-radius: 10px;
          padding: 12px 14px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        }
        .vc-alarm-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 11px;
          font-family: var(--vc-font-mono);
          padding: 6px 0;
          border-bottom: 1px solid var(--vc-panel-2);
        }
        .vc-alarm-item-row {
          display: flex;
          justify-content: space-between;
          gap: 8px;
        }
        .vc-alarm-item-actions {
          display: flex;
          gap: 12px;
        }
        .vc-alarm-notify-link {
          color: var(--vc-flow);
          text-decoration: none;
          font-size: 10px;
        }
        .vc-alarm-notify-link-cliente {
          color: var(--vc-brass);
        }
        .vc-cliente-informe-btn {
          background: var(--vc-brass);
          color: #221a0c;
          border: none;
          border-radius: 8px;
          padding: 8px 10px;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          margin-top: 4px;
        }
        .vc-cliente-informe-btn:disabled {
          background: var(--vc-panel-2);
          color: var(--vc-text-muted);
          cursor: not-allowed;
        }
        .vc-cliente-copiar-btn {
          background: transparent;
          border: 1px dashed var(--vc-border);
          color: var(--vc-flow);
          border-radius: 8px;
          padding: 7px 10px;
          font-size: 10px;
          cursor: pointer;
          margin-top: 4px;
        }
        .vc-cliente-copiar-btn:hover {
          border-color: var(--vc-flow);
        }
        .vc-cliente-copiar-btn:disabled {
          color: var(--vc-text-muted);
          cursor: not-allowed;
        }
        .vc-alarm-notify-link:hover {
          text-decoration: underline;
        }
        .vc-alarm-notify-off {
          font-size: 10px;
          color: var(--vc-text-muted);
          font-style: italic;
        }
        .vc-alarm-item-detected {
          color: var(--vc-red);
        }
        .vc-alarm-item-resolved {
          color: var(--vc-open);
        }
        .vc-alarm-line-name {
          color: var(--vc-text);
        }
        .vc-leak-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .vc-leak-notify {
          color: #ffd9d5;
          text-decoration: underline;
          font-size: 12px;
          white-space: nowrap;
        }
        .vc-tecnico-form {
          display: flex;
          flex-direction: column;
          gap: 8px;
          width: 280px;
          max-height: 440px;
        }
        .vc-tecnico-hint {
          font-size: 10px;
          color: var(--vc-text-muted);
          line-height: 1.4;
          margin: 0 0 4px;
        }
        .vc-tecnico-field {
          display: flex;
          flex-direction: column;
          gap: 3px;
          font-size: 11px;
          color: var(--vc-text-muted);
        }
        .vc-tecnico-field input,
        .vc-tecnico-field textarea {
          background: var(--vc-panel-2);
          border: 1px solid var(--vc-border);
          color: var(--vc-text);
          border-radius: 6px;
          padding: 6px 8px;
          font-size: 12px;
          font-family: var(--vc-font-body);
          resize: vertical;
        }
        .vc-tecnico-alarmas-title {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--vc-text-muted);
          border-top: 1px solid var(--vc-border);
          padding-top: 8px;
          margin-top: 4px;
        }
        .vc-tecnico-checks {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .vc-tecnico-check {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          color: var(--vc-text);
          cursor: pointer;
        }
        .vc-tecnico-check input {
          accent-color: var(--vc-flow);
          width: 14px;
          height: 14px;
          flex-shrink: 0;
        }
        .vc-fertilizer-dropdown {
          width: 300px;
        }
        .vc-fertilizer-level-row {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: var(--vc-text-muted);
          border-top: 1px solid var(--vc-border);
          padding-top: 8px;
          margin-top: 8px;
          font-family: var(--vc-font-mono);
        }
        @media (max-width: 480px) {
          .vc-root { padding: 1.1rem; }
          .vc-grid { grid-template-columns: 1fr; }
          .vc-alarm-dropdown { right: auto; left: 0; width: 280px; }
          .vc-mini-charts-grid { grid-template-columns: 1fr; }
          .vc-summary-row { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>

      <div className="vc-header">
        <div className="vc-header-top">
          <div>
            <p className="vc-title">Verdtical · panel de riego</p>
            <div className="vc-proyecto-fecha-row">
              <button className="vc-proyecto-btn" onClick={() => setShowProyectoConfig((v) => !v)}>
                {proyecto.nombre ? `📍 ${proyecto.nombre}` : "⚠ proyecto sin identificar — pulsa para configurar"}
              </button>
              <span className="vc-fecha-inline">
                {now.toLocaleDateString("es-ES", { weekday: "long", day: "2-digit", month: "short" })} · {pad2(now.getHours())}:{pad2(now.getMinutes())}
              </span>
            </div>
          </div>
          <div className="vc-top-buttons">
            <div
              className={datosActivos ? "vc-connection-badge" : "vc-connection-badge vc-connection-badge-off"}
              title={datosActivos ? "Recibiendo datos con normalidad" : "Sin datos — comunicación perdida o batería del PLC agotada"}
            >
              <span className="vc-connection-dot" />
              {datosActivos ? "en línea" : "sin datos"}
            </div>
            <button
              className="vc-supply-toggle vc-supply-toggle-lg"
              onClick={() => setMainSupply((v) => !v)}
              title="Corte general de riego: apagado, no se puede activar ninguna electroválvula. Es independiente de si el panel tiene datos o no — la falta de datos no apaga el sistema. No confundir con la electroválvula maestra, en la tarjeta 'Estado red'."
            >
              <StatusDot active={mainSupply} mode="horario" />
              sistema {mainSupply ? "activado" : "apagado"}
            </button>
            {(() => {
              const consumosAyerTitulo = sectors.map((s) => consumoDeAyer(s, now));
              const hayDatosAyerTitulo = consumosAyerTitulo.some((v) => v !== null);
              const consumoAyerTotal = consumosAyerTitulo.reduce((sum, v) => sum + (v || 0), 0);
              const co2Kg = Math.round(((consumoAyerTotal * wueGramosPorLitro * 0.45 * 3.667) / 1000) * 100) / 100;
              return (
                <div className="vc-co2-lineas-group">
                  <div
                    className="vc-supply-toggle vc-supply-toggle-lg vc-co2-toggle"
                    title={
                      hayDatosAyerTitulo
                        ? "Estimación orientativa de CO₂ capturado ayer — ver detalle y ajustar en el Plano"
                        : "Todavía no hay un día completo de histórico; se mostrará una estimación real a partir de mañana — ver detalle en el Plano"
                    }
                  >
                    <span style={{ fontSize: 20 }}>🌱</span>{" "}
                    {hayDatosAyerTitulo ? `${co2Kg} kg CO₂ / día` : "0 kg CO₂ / día"}
                  </div>
                  <div className="vc-supply-toggle vc-supply-toggle-lg vc-lineas-toggle" title="Número de líneas de riego configuradas">
                    💧 {sectors.length} líneas
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
        {showProyectoConfig && (
          <div className="vc-proyecto-config">
            <p className="vc-tecnico-hint" style={{ margin: "0 0 8px" }}>
              Identifica a qué proyecto del mapa de situación pertenece esta instalación. Usa el mismo identificador (id) que
              tenga ese proyecto en <code>mapa-situacion-proyectos.html</code> — por ejemplo <code>jarcia-noblejas</code>.
            </p>
            <div className="vc-field-row">
              <label>
                Nombre del proyecto
                <input
                  type="text"
                  value={proyecto.nombre}
                  onChange={(e) => setProyecto({ ...proyecto, nombre: e.target.value })}
                  placeholder="Jarcia Noblejas"
                />
              </label>
              <label>
                Identificador (id)
                <input
                  type="text"
                  value={proyecto.id}
                  onChange={(e) => setProyecto({ ...proyecto, id: e.target.value.toLowerCase().replace(/\s+/g, "-") })}
                  placeholder="jarcia-noblejas"
                />
              </label>
            </div>
          </div>
        )}
        <div className="vc-header-actions">
          <div className="vc-programacion-box">
            <button
              className="vc-icon-only-btn"
              onClick={calcularProgramacionAutomaticaGlobal}
              title="Programar automáticamente TODAS las líneas (según superficie, exposición y evapotranspiración de cada una, sin pisarse entre sí)"
            >
              🔄
            </button>
            <button
              className="vc-icon-only-btn"
              onClick={() => {
                setTemporadaListado(getSeasonForDate(now));
                setShowListadoHorarios(true);
              }}
              title="Ver listado de horarios de todas las líneas (con las que se cruzan entre sí, huecos libres, y total de actuaciones por línea)"
            >
              📋
            </button>
          </div>
          <div className="vc-programacion-box">
            {!confirmReset ? (
              <button className="vc-icon-only-btn" onClick={() => setConfirmReset(true)} title="Reiniciar datos de ejemplo">
                🔁
              </button>
            ) : (
              <div className="vc-reset-confirm">
                <span>¿Borrar todo y volver a los datos de ejemplo?</span>
                <button className="vc-reset-confirm-yes" onClick={reiniciarPanel}>
                  sí, reiniciar
                </button>
                <button className="vc-reset-confirm-no" onClick={() => setConfirmReset(false)}>
                  cancelar
                </button>
              </div>
            )}
            <div className="vc-alarm-dropdown-wrap" ref={alarmDropdownRef}>
              <button
                className={showAlarmHistory ? "vc-icon-only-btn vc-icon-only-btn-on" : "vc-icon-only-btn"}
                onClick={() => setShowAlarmHistory((v) => !v)}
                title={`Alarmas (${alarmHistory.length})`}
              >
                🔔{alarmHistory.length > 0 ? ` ${alarmHistory.length}` : ""}
              </button>
              {showAlarmHistory && (
                <div className="vc-alarm-dropdown">
                  <div className="vc-history-title">Historial de alarmas ({alarmHistory.length})</div>
                  {alarmHistory.length === 0 ? (
                    <div className="vc-history-empty">sin alarmas registradas todavía</div>
                  ) : (
                    alarmHistory.map((a) => {
                      const esResuelta = a.type === "fuga_rearmada" || a.type === "fallo_electrico_resuelto";
                      const { titulo } = textoAlarma(a);
                      let detalle = "";
                      if (a.flowMeasured !== undefined && a.nominalFlow !== undefined) {
                        detalle = ` (${a.flowMeasured} L/h, esperado ${a.nominalFlow} L/h)`;
                      } else if (a.valor !== undefined) {
                        detalle = ` (${a.valor}, rango ${a.min}–${a.max})`;
                      } else if (a.value !== undefined) {
                        detalle = ` (${a.value} bar)`;
                      }
                      return (
                        <div className={esResuelta ? "vc-alarm-item vc-alarm-item-resolved" : "vc-alarm-item vc-alarm-item-detected"} key={a.id}>
                          <div className="vc-alarm-item-row">
                            <span>
                              {esResuelta ? "✓" : "⚠"} {titulo} ·{" "}
                              <span className="vc-alarm-line-name">{a.lineName}</span>
                              {detalle}
                            </span>
                            <span>
                              {new Date(a.ts).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <div className="vc-alarm-item-actions">
                            {debeNotificar(a, tecnico) ? (
                              <>
                                <a href={buildMailtoUrl(a, tecnico)} className="vc-alarm-notify-link">
                                  ✉ técnico
                                </a>
                                {tecnico.telefono && (
                                  <a
                                    href={buildWhatsappUrl(a, tecnico)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="vc-alarm-notify-link"
                                  >
                                    💬 técnico
                                  </a>
                                )}
                              </>
                            ) : (
                              <span className="vc-alarm-notify-off">técnico: desactivado</span>
                            )}
                            {debeNotificar(a, cliente) && cliente.email ? (
                              <>
                                <a href={buildMailtoUrl(a, cliente)} className="vc-alarm-notify-link vc-alarm-notify-link-cliente">
                                  ✉ cliente
                                </a>
                                {cliente.telefono && (
                                  <a
                                    href={buildWhatsappUrl(a, cliente)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="vc-alarm-notify-link vc-alarm-notify-link-cliente"
                                  >
                                    💬 cliente
                                  </a>
                                )}
                              </>
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
            <div className="vc-alarm-dropdown-wrap" ref={activityDropdownRef}>
              <button
                className={showActivityLog ? "vc-icon-only-btn vc-icon-only-btn-on" : "vc-icon-only-btn"}
                onClick={() => setShowActivityLog((v) => !v)}
                title={`Actividad (${history.length})`}
              >
                📝{history.length > 0 ? ` ${history.length}` : ""}
              </button>
              {showActivityLog && (
                <div className="vc-alarm-dropdown">
                  <div className="vc-history-title">Registro de actividad</div>
                  {history.length === 0 ? (
                    <div className="vc-history-empty">sin eventos registrados todavía</div>
                  ) : (
                    history.map((h, i) => (
                      <div className="vc-history-item" key={i}>
                        <span>{h.text}</span>
                        <span>
                          {new Date(h.ts).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="vc-programacion-box vc-test-box vc-box-left">
            <button
              className="vc-icon-only-btn"
              onClick={() => {
                if (maestraCerrada) return;
                const motivoTexto =
                  "🧪 PRUEBA manual — no es una avería real. El caudalímetro general marcaría agua que ninguna línea explica, indicio de rotura antes de las electroválvulas.";
                setMaestraCerrada({ motivo: motivoTexto, ts: new Date().toISOString() });
                setAlarmHistory((prev) =>
                  [
                    {
                      id: `alarm-maestra-${Date.now()}`,
                      ts: new Date().toISOString(),
                      lineId: null,
                      lineName: "Sistema general",
                      type: "rotura_antes_electrovalvulas",
                      detalle: motivoTexto,
                    },
                    ...prev,
                  ].slice(0, MAX_ALARM_LOG)
                );
              }}
              title="🧪 Probar: rotura antes de las electroválvulas (cierra la maestra)"
            >
              💧⛔
            </button>
            <button
              className="vc-icon-only-btn"
              onClick={() => {
                if (!sectors || sectors.length === 0) return;
                const linea = sectors.find((s) => !s.blockedByLeak) || sectors[0];
                if (!linea || linea.blockedByLeak) return;
                const nominalFlow = Number(linea.emitters || 0) * Number(linea.emitterFlow || 0) || 100;
                const flowMeasured = Math.round(nominalFlow * 1.6);
                setSectors((prev) => prev.map((s) => (s.id === linea.id ? { ...s, blockedByLeak: true } : s)));
                setLeakAlerts((prev) => [
                  ...prev,
                  { lineId: linea.id, lineName: linea.name, ts: new Date().toISOString(), flowMeasured, nominalFlow },
                ]);
                setAlarmHistory((prev) =>
                  [
                    {
                      id: `alarm-${Date.now()}-${linea.id}`,
                      ts: new Date().toISOString(),
                      lineId: linea.id,
                      lineName: linea.name,
                      type: "fuga_grave",
                      flowMeasured,
                      nominalFlow,
                    },
                    ...prev,
                  ].slice(0, MAX_ALARM_LOG)
                );
              }}
              title="🧪 Probar: fuga grave en una línea (aísla su electroválvula)"
            >
              💧⚠
            </button>
            <button
              className="vc-icon-only-btn"
              onClick={() => {
                setMainSupply(false);
                setAlarmHistory((prev) =>
                  [
                    { id: `alarm-plc-${Date.now()}`, ts: new Date().toISOString(), lineId: null, lineName: "Sistema general", type: "corte_corriente_plc" },
                    ...prev,
                  ].slice(0, MAX_ALARM_LOG)
                );
              }}
              title="🧪 Probar: corte de corriente en el PLC (apaga el sistema, sensores siguen)"
            >
              ⚡🔌
            </button>
            <button
              className={simulacionBateriaAgotada ? "vc-icon-only-btn vc-icon-only-btn-on" : "vc-icon-only-btn"}
              onClick={() => setSimulacionBateriaAgotada((v) => !v)}
              title={
                simulacionBateriaAgotada
                  ? "🧪 Pulsa de nuevo para simular que vuelven los datos (batería recargada)"
                  : "🧪 Probar: batería agotada — sin datos en absoluto"
              }
            >
              🔋⚠
            </button>
          </div>
        </div>
        {resumenProgramacionGlobal && (
          <div className="vc-resumen-programacion-global">
            ✅ {resumenProgramacionGlobal.lineasProgramadas} línea(s) programada(s) automáticamente, sin pisarse entre ellas.
            {resumenProgramacionGlobal.sinSuperficie > 0 &&
              ` ${resumenProgramacionGlobal.sinSuperficie} línea(s) sin superficie asignada en el Plano — se han dejado tal cual.`}
            {resumenProgramacionGlobal.conflictosTotales > 0 &&
              ` ⚠ ${resumenProgramacionGlobal.conflictosTotales} tanda(s) no encontraron hueco libre del todo — revísalas a mano.`}
            <button className="vc-resumen-cerrar-btn" onClick={() => setResumenProgramacionGlobal(null)}>
              ✕
            </button>
          </div>
        )}
      </div>

      {maestraCerrada && (
        <div className="vc-maestra-banner">
          <div className="vc-maestra-titulo">⛔ Electroválvula maestra cerrada — rotura antes de las electroválvulas</div>
          <p className="vc-maestra-motivo">{maestraCerrada.motivo}</p>
          <p className="vc-maestra-hora">Ocurrió: {new Date(maestraCerrada.ts).toLocaleString("es-ES")}</p>
          {!confirmRearmeMaestra ? (
            <button className="vc-maestra-rearmar" onClick={() => setConfirmRearmeMaestra(true)}>
              ✓ he revisado y reparado la avería — reabrir maestra
            </button>
          ) : (
            <div className="vc-maestra-confirm">
              <span>¿Confirmas que un técnico ha revisado y reparado la rotura? Se reabrirá la electroválvula maestra.</span>
              <button
                className="vc-maestra-confirm-yes"
                onClick={() => {
                  setMaestraCerrada(null);
                  setConfirmRearmeMaestra(false);
                }}
              >
                sí, reabrir
              </button>
              <button className="vc-maestra-confirm-no" onClick={() => setConfirmRearmeMaestra(false)}>
                cancelar
              </button>
            </div>
          )}
        </div>
      )}

      {anyActive && !presionEnRangoTrabajo && (
        <div className="vc-leak-stack">
          <div className="vc-leak-banner vc-leak-banner-pressure">
            <span>
              ℹ Hay líneas regando con la presión de red fuera del rango de trabajo (1,8–3,5 bar) — actual: {pressureBar} bar. Mientras
              dure, el diagnóstico de embozo/fuga por línea queda en pausa: los emisores no entregan su caudal nominal por falta o exceso
              de presión, no por avería. Comprueba primero la presión de cabezal.
            </span>
          </div>
        </div>
      )}

      {pressureAlert && (
        <div className="vc-leak-stack">
          <div className="vc-leak-banner vc-leak-banner-pressure">
            <span>
              ⚠ Presión de red sostenidamente {pressureAlert.type === "presion_baja" ? "baja" : "alta"} ({pressureAlert.value} bar
              durante ≥2 min) — no se ha aislado ninguna línea, revisar suministro/regulador.
            </span>
            <div className="vc-leak-actions">
              {tecnico.alarmas?.presion !== false && (
                <>
                  <a className="vc-leak-notify" href={buildMailtoUrl(pressureAlert, tecnico)} title="Abrir correo con el aviso ya redactado">
                    ✉ Avisar
                  </a>
                  {tecnico.telefono && (
                    <a
                      className="vc-leak-notify"
                      href={buildWhatsappUrl(pressureAlert, tecnico)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Abrir WhatsApp con el aviso ya redactado"
                    >
                      💬 WhatsApp
                    </a>
                  )}
                </>
              )}
              <button className="vc-leak-rearm" onClick={descartarAlertaPresion}>
                Descartar aviso
              </button>
            </div>
          </div>
        </div>
      )}

      {multiLineAlert && (
        <div className="vc-leak-stack">
          <div className="vc-leak-banner vc-leak-banner-multi">
            <span>
              ⚠ {multiLineAlert.cantidad} líneas con incidencias a la vez ({multiLineAlert.lineas}) — sospecha primero de una causa
              común (presión, filtro, suministro) antes de revisar cada línea por separado.
            </span>
            <div className="vc-leak-actions">
              {tecnico.alarmas?.multiples_lineas !== false && (
                <>
                  <a className="vc-leak-notify" href={buildMailtoUrl(multiLineAlert, tecnico)} title="Abrir correo con el aviso ya redactado">
                    ✉ Avisar
                  </a>
                  {tecnico.telefono && (
                    <a
                      className="vc-leak-notify"
                      href={buildWhatsappUrl(multiLineAlert, tecnico)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Abrir WhatsApp con el aviso ya redactado"
                    >
                      💬 WhatsApp
                    </a>
                  )}
                </>
              )}
              <button className="vc-leak-rearm" onClick={descartarAlertaMultiLinea}>
                Descartar aviso
              </button>
            </div>
          </div>
        </div>
      )}

      {fertilizerAlert && (
        <div className="vc-leak-stack">
          <div className={fertilizerAlert.type === "fertilizante_agotado" ? "vc-leak-banner" : "vc-leak-banner vc-leak-banner-pressure"}>
            <span>
              {fertilizerAlert.type === "fertilizante_agotado" ? "⚠" : "ℹ"} Depósito de fertilizante{" "}
              {fertilizerAlert.type === "fertilizante_agotado" ? "prácticamente agotado" : "bajo"} ({fertilizerLevel}%) — el riego sigue
              funcionando con agua, pero sin dosificación efectiva.
            </span>
            <div className="vc-leak-actions">
              {tecnico.alarmas?.fertilizante !== false && (
                <>
                  <a className="vc-leak-notify" href={buildMailtoUrl(fertilizerAlert, tecnico)} title="Abrir correo con el aviso ya redactado">
                    ✉ Avisar
                  </a>
                  {tecnico.telefono && (
                    <a
                      className="vc-leak-notify"
                      href={buildWhatsappUrl(fertilizerAlert, tecnico)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Abrir WhatsApp con el aviso ya redactado"
                    >
                      💬 WhatsApp
                    </a>
                  )}
                </>
              )}
              <button className="vc-leak-rearm" onClick={rellenarFertilizante}>
                Marcar como rellenado
              </button>
            </div>
          </div>
        </div>
      )}


      <div className="vc-summary-row">
        <div className="vc-tecnico-cliente-stack">
          <div className="vc-summary-card vc-summary-card-compact">
            <div className="vc-summary-text">
              <div className="vc-summary-label">Caudalímetro total</div>
              <div className="vc-summary-value">{totalFlowMeasured} L/h</div>
            </div>
          </div>
          <div className="vc-alarm-dropdown-wrap">
            <button
              className={showPlano ? "vc-summary-card vc-summary-card-btn vc-summary-card-on vc-summary-card-compact" : "vc-summary-card vc-summary-card-btn vc-summary-card-compact"}
              onClick={() => setShowPlano((v) => !v)}
            >
              <div className="vc-summary-text">
                <div className="vc-summary-label">🗺️ Plano</div>
                <div className="vc-summary-value">
                  {planoImagen ? `${sectors.filter((s) => s.posicionPlano).length}/${sectors.length} colocadas` : "sin subir"}
                </div>
              </div>
            </button>
          </div>
        </div>
        <div className="vc-summary-card vc-summary-card-narrow vc-summary-card-vertical">
          <PressureGauge bar={pressureBar} />
          <div className="vc-summary-text vc-summary-text-center">
            <div className="vc-summary-label">Presión red</div>
            <div className="vc-summary-value" style={{ color: pressureOutOfRange ? "var(--vc-red)" : "var(--vc-text)" }}>
              {pressureBar} bar
            </div>
          </div>
        </div>
        <div className="vc-alarm-dropdown-wrap" ref={redDropdownRef}>
          <button
            className="vc-summary-card vc-summary-card-narrow vc-summary-card-vertical vc-summary-card-btn"
            onClick={() => setShowRedHistory((v) => !v)}
            title="Electroválvula maestra: se cierra sola si hay indicio de rotura antes de las líneas. Pulsa para ver el historial."
          >
            <MiniAguaIcon active={anyActive} danger={!!maestraCerrada} />
            <div className="vc-summary-text vc-summary-text-center">
              <div className="vc-summary-label">Estado red</div>
              <div className="vc-summary-value" style={{ color: maestraCerrada ? "var(--vc-red)" : anyActive ? "var(--vc-open)" : "var(--vc-text-muted)" }}>
                {maestraCerrada ? "MAESTRA CERRADA" : anyActive ? "regando" : "en reposo"}
              </div>
            </div>
          </button>
          {showRedHistory && (
            <div className="vc-alarm-dropdown">
              <div className="vc-history-title">
                Historial de la electroválvula maestra ({alarmHistory.filter((a) => a.type === "rotura_antes_electrovalvulas").length})
              </div>
              {alarmHistory.filter((a) => a.type === "rotura_antes_electrovalvulas").length === 0 ? (
                <div className="vc-history-empty">sin incidencias registradas todavía</div>
              ) : (
                alarmHistory
                  .filter((a) => a.type === "rotura_antes_electrovalvulas")
                  .map((a) => (
                    <div className="vc-alarm-item vc-alarm-item-detected" key={a.id}>
                      <div className="vc-alarm-item-row">
                        <span>⛔ Rotura antes de las electroválvulas — {a.detalle}</span>
                        <span>
                          {new Date(a.ts).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>
                  ))
              )}
            </div>
          )}
        </div>
        <div className="vc-tecnico-cliente-stack">
        <div className="vc-alarm-dropdown-wrap" ref={tecnicoDropdownRef}>
          <button
            className={showTecnicoConfig ? "vc-summary-card vc-summary-card-btn vc-summary-card-on vc-summary-card-compact" : "vc-summary-card vc-summary-card-btn vc-summary-card-compact"}
            onClick={() => setShowTecnicoConfig((v) => !v)}
          >
            <div className="vc-summary-text">
              <div className="vc-summary-label">Técnico</div>
              <div className="vc-summary-value">{tecnico.nombre ? tecnico.nombre : "sin definir"}</div>
            </div>
          </button>
          {showTecnicoConfig && (
            <div className="vc-alarm-dropdown vc-tecnico-form">
              <div className="vc-history-title">Técnico de mantenimiento</div>
              <p className="vc-tecnico-hint">
                Estos datos se usan para preparar el correo o WhatsApp de cada alarma. El panel no envía avisos automáticamente: abre tu
                app de correo/WhatsApp con el mensaje ya redactado para que lo confirmes y envíes tú.
              </p>
              <label className="vc-tecnico-field">
                Nombre
                <input
                  type="text"
                  value={tecnico.nombre}
                  onChange={(e) => setTecnico({ ...tecnico, nombre: e.target.value })}
                  placeholder="Nombre del técnico"
                />
              </label>
              <label className="vc-tecnico-field">
                Teléfono / WhatsApp
                <input
                  type="text"
                  value={tecnico.telefono}
                  onChange={(e) => setTecnico({ ...tecnico, telefono: e.target.value })}
                  placeholder="+34 600 000 000"
                />
              </label>
              <label className="vc-tecnico-field">
                Email del técnico
                <input
                  type="email"
                  value={tecnico.email}
                  onChange={(e) => setTecnico({ ...tecnico, email: e.target.value })}
                  placeholder="tecnico@ejemplo.com"
                />
              </label>
              <label className="vc-tecnico-field">
                Email de avisos (si es distinto)
                <input
                  type="email"
                  value={tecnico.emailAvisos}
                  onChange={(e) => setTecnico({ ...tecnico, emailAvisos: e.target.value })}
                  placeholder="avisos@verdtical.com"
                />
              </label>
              <div className="vc-tecnico-alarmas-title">Alarmas que quieres que le lleguen</div>
              <div className="vc-tecnico-checks">
                {CATEGORIAS_ALARMA.map((c) => (
                  <label className="vc-tecnico-check" key={c.key}>
                    <input
                      type="checkbox"
                      checked={tecnico.alarmas?.[c.key] !== false}
                      onChange={(e) => setTecnico({ ...tecnico, alarmas: { ...tecnico.alarmas, [c.key]: e.target.checked } })}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="vc-alarm-dropdown-wrap" ref={clienteDropdownRef}>
          <button
            className={showClienteConfig ? "vc-summary-card vc-summary-card-btn vc-summary-card-on vc-summary-card-compact" : "vc-summary-card vc-summary-card-btn vc-summary-card-compact"}
            onClick={() => setShowClienteConfig((v) => !v)}
          >
            <div className="vc-summary-text">
              <div className="vc-summary-label">Cliente</div>
              <div className="vc-summary-value">{cliente.nombre ? cliente.nombre : "sin definir"}</div>
            </div>
          </button>
          {showClienteConfig && (
            <div className="vc-alarm-dropdown vc-tecnico-form">
              <div className="vc-history-title">Cliente final</div>
              <p className="vc-tecnico-hint">
                Estos datos se usan para el informe de mantenimiento y para avisar al cliente de las alarmas que marques y de su
                arreglo posterior. El panel no envía nada automáticamente: abre tu app de correo/WhatsApp con el mensaje ya redactado
                para que lo confirmes y envíes tú.
              </p>
              <label className="vc-tecnico-field">
                Nombre
                <input
                  type="text"
                  value={cliente.nombre}
                  onChange={(e) => setCliente({ ...cliente, nombre: e.target.value })}
                  placeholder="Nombre del cliente"
                />
              </label>
              <label className="vc-tecnico-field">
                Teléfono / WhatsApp
                <input
                  type="text"
                  value={cliente.telefono}
                  onChange={(e) => setCliente({ ...cliente, telefono: e.target.value })}
                  placeholder="+34 600 000 000"
                />
              </label>
              <label className="vc-tecnico-field">
                Email del cliente
                <input
                  type="email"
                  value={cliente.email}
                  onChange={(e) => setCliente({ ...cliente, email: e.target.value })}
                  placeholder="cliente@ejemplo.com"
                />
              </label>
              <label className="vc-tecnico-field">
                Email de avisos (si es distinto)
                <input
                  type="email"
                  value={cliente.emailAvisos}
                  onChange={(e) => setCliente({ ...cliente, emailAvisos: e.target.value })}
                  placeholder="avisos@cliente.com"
                />
              </label>
              <div className="vc-tecnico-alarmas-title">Alarmas que quieres que le lleguen al cliente</div>
              <div className="vc-tecnico-checks">
                {CATEGORIAS_ALARMA.map((c) => (
                  <label className="vc-tecnico-check" key={c.key}>
                    <input
                      type="checkbox"
                      checked={cliente.alarmas?.[c.key] === true}
                      onChange={(e) => setCliente({ ...cliente, alarmas: { ...cliente.alarmas, [c.key]: e.target.checked } })}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
              <div className="vc-tecnico-alarmas-title">Procesos realizados en esta visita</div>
              <div className="vc-tecnico-checks">
                {CATALOGO_PROCESOS_MANTENIMIENTO.map((p) => (
                  <label className="vc-tecnico-check" key={p.key}>
                    <input
                      type="checkbox"
                      checked={procesosRealizados[p.key] === true}
                      onChange={(e) => setProcesosRealizados({ ...procesosRealizados, [p.key]: e.target.checked })}
                    />
                    {p.label}
                  </label>
                ))}
              </div>
              <label className="vc-tecnico-field">
                Nota de observación
                <textarea
                  rows={2}
                  value={notaObservacion}
                  onChange={(e) => setNotaObservacion(e.target.value)}
                  placeholder="Comentarios, incidencias vistas in situ, recomendaciones…"
                />
              </label>
              <button className="vc-cliente-informe-btn" onClick={enviarInformeMantenimientoCliente} disabled={!cliente.email}>
                ✉ enviar informe de mantenimiento ahora
              </button>
              {!cliente.email && <p className="vc-tecnico-hint" style={{ margin: 0 }}>añade un email para poder enviarlo</p>}
              <button
                className="vc-cliente-copiar-btn"
                onClick={() => {
                  const datos = JSON.stringify({ nombre: cliente.nombre, email: cliente.email, telefono: cliente.telefono, emailAvisos: cliente.emailAvisos });
                  navigator.clipboard.writeText(datos);
                  setCopiadoCliente(true);
                  setTimeout(() => setCopiadoCliente(false), 2000);
                }}
                disabled={!cliente.nombre && !cliente.email}
              >
                {copiadoCliente ? "✓ copiado" : "📋 copiar datos de cliente (para pegar en el mapa de proyectos)"}
              </button>
            </div>
          )}
        </div>
        </div>
        <div className="vc-alarm-dropdown-wrap" ref={fertilizerDropdownRef}>
          <button
            className={
              showFertilizerHistory
                ? "vc-summary-card vc-summary-card-btn vc-summary-card-on vc-summary-card-vertical vc-summary-card-narrow"
                : "vc-summary-card vc-summary-card-btn vc-summary-card-vertical vc-summary-card-narrow"
            }
            onClick={() => setShowFertilizerHistory((v) => !v)}
          >
            <FertilizerGauge
              level={fertilizerLevel}
              consumiendo={mainSupply && !maestraCerrada && sectors.some((s) => isSectorActiveNow(s, now))}
            />
            <div className="vc-summary-text vc-summary-text-center">
              <div className="vc-summary-label">Fertilizante</div>
              <div
                className="vc-summary-value"
                style={{ color: fertilizerLevel < 5 ? "var(--vc-red)" : fertilizerLevel < 15 ? "var(--vc-amber)" : "var(--vc-text)" }}
              >
                {fertilizerLevel}%
              </div>
            </div>
          </button>
          {showFertilizerHistory && (
            <div className="vc-alarm-dropdown vc-fertilizer-dropdown">
              <div className="vc-chart-title">
                <span>Consumo de fertilizante (mL/día)</span>
                <span className="vc-chart-current" style={{ color: "var(--vc-violet)" }}>
                  {fertilizerConsumedToday} mL hoy
                </span>
              </div>
              <DailyBarChart data={chartFertilizanteDiario} color="var(--vc-violet)" unit="mL" dataKey="consumoML" height={140} />
              <div className="vc-fertilizer-level-row">
                <span>Nivel del depósito</span>
                <span
                  style={{ color: fertilizerLevel < 5 ? "var(--vc-red)" : fertilizerLevel < 15 ? "var(--vc-amber)" : "var(--vc-violet)" }}
                >
                  {fertilizerLevel}%
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="vc-collector-wrap">
        <CollectorFlow
          lines={sectors.map((s) => ({ name: s.name, active: mainSupply && !maestraCerrada && isSectorActiveNow(s, now) }))}
        />
      </div>

      <div className="vc-charts-row">
        <div className="vc-chart-card" style={{ gridColumn: showAnnualWaterHistory ? "1 / -1" : undefined }}>
          <div className="vc-chart-title">
            <span>Consumo total (L/día)</span>
            <span className="vc-chart-current" style={{ color: "var(--vc-flow)" }}>
              {todayTotalLiters} L hoy
            </span>
          </div>
          <DailyBarChart data={chartConsumoReciente} color="var(--vc-brass)" unit="L" />
          <button className="vc-toggle-btn vc-annual-toggle" onClick={() => setShowAnnualWaterHistory((v) => !v)}>
            {showAnnualWaterHistory ? "ocultar historial de 1 año" : `ver historial de 1 año (${chartConsumoDiario.length} días guardados)`}
          </button>
          {showAnnualWaterHistory && (
            <div className="vc-annual-chart-wrap">
              <DailyBarChart
                data={ventanaDatos(chartConsumoDiario, waterAnnualOffset, VENTANA_DIAS_HISTORICO)}
                color="var(--vc-brass)"
                unit="L"
                height={280}
                onBarClick={(entry) => setSelectedGlobalConsumoDay(entry.date || "hoy")}
              />
              <ChartNavBar
                offset={waterAnnualOffset}
                setOffset={setWaterAnnualOffset}
                total={chartConsumoDiario.length}
                windowSize={VENTANA_DIAS_HISTORICO}
              />
              {selectedGlobalConsumoDay && (
                <div className="vc-hourly-detail">
                  <div className="vc-hourly-detail-title">
                    <span>
                      Consumo por línea —{" "}
                      {selectedGlobalConsumoDay === "hoy"
                        ? "Hoy"
                        : chartConsumoDiario.find((d) => d.date === selectedGlobalConsumoDay)?.label || selectedGlobalConsumoDay}
                    </span>
                    <button className="vc-cal-dia-cerrar-btn" onClick={() => setSelectedGlobalConsumoDay(null)}>
                      ✕
                    </button>
                  </div>
                  <DailyBarChart
                    data={sectors.map((s) => {
                      const entrada =
                        selectedGlobalConsumoDay === "hoy"
                          ? null
                          : (s.dailyConsumption || []).find((d) => d.date === selectedGlobalConsumoDay);
                      const liters =
                        selectedGlobalConsumoDay === "hoy" ? s.sensors?.litersToday || 0 : entrada ? entrada.liters : 0;
                      return { label: s.name, liters };
                    })}
                    color="var(--vc-flow)"
                    unit="L"
                    height={180}
                  />
                </div>
              )}
            </div>
          )}
        </div>
        <div className="vc-chart-card" style={{ gridColumn: showAnnualPressureHistory ? "1 / -1" : undefined }}>
          <div className="vc-chart-title">
            <span>Presión de red</span>
            <span className="vc-chart-current" style={{ color: pressureOutOfRange ? "var(--vc-red)" : "var(--vc-amber)" }}>
              {pressureBar} bar
            </span>
          </div>
          {chartPresionHoraria.length > 1 ? (
            <TrendChart data={chartPresionHoraria} color="var(--vc-amber)" unit="bar" dataKey="pressure" />
          ) : (
            <div className="vc-chart-empty">registrando datos…</div>
          )}
          <button className="vc-toggle-btn vc-annual-toggle" onClick={() => setShowAnnualPressureHistory((v) => !v)}>
            {showAnnualPressureHistory
              ? "ocultar historial de 1 año"
              : `ver historial de 1 año (${chartPresionDiaria.length} días guardados)`}
          </button>
          {showAnnualPressureHistory && (
            <div className="vc-annual-chart-wrap">
              <TrendChart
                data={ventanaDatos(chartPresionDiaria, pressureAnnualOffset, VENTANA_DIAS_HISTORICO)}
                color="var(--vc-amber)"
                unit="bar"
                dataKey="avgPressure"
                height={280}
              />
              <ChartNavBar
                offset={pressureAnnualOffset}
                setOffset={setPressureAnnualOffset}
                total={chartPresionDiaria.length}
                windowSize={VENTANA_DIAS_HISTORICO}
              />
              <div className="vc-outage-log">
                <div className="vc-outage-log-title">
                  Horas sin presión registradas (&lt;1,0 bar) — {pressureOutageLog.length}
                </div>
                {pressureOutageLog.length === 0 ? (
                  <div className="vc-chart-empty">sin caídas de presión registradas</div>
                ) : (
                  pressureOutageLog.slice(0, 30).map((o, i) => (
                    <div className="vc-outage-log-item" key={i}>
                      <span>
                        {new Date(o.ts).toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "short" })} ·{" "}
                        {new Date(o.ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span>{o.value} bar</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {showPlano && (
        <div className="vc-plano-overlay">
          <div className="vc-plano-panel">
          <div className="vc-plano-header">
            <div>
              <div className="vc-history-title" style={{ marginBottom: 4 }}>Plano del proyecto</div>
              <p className="vc-tecnico-hint" style={{ margin: 0 }}>
                Sube el plano arquitectónico, un croquis o una foto de la instalación, y coloca cada línea sobre el punto exacto
                donde está físicamente. Se guarda junto con el resto de datos del panel.
              </p>
            </div>
            <div className="vc-plano-header-actions">
              <label className="vc-cliente-copiar-btn" style={{ cursor: "pointer" }}>
                {planoImagen ? "cambiar imagen" : "📐 subir plano o foto"}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => subirPlano(e.target.files?.[0])}
                />
              </label>
              {planoImagen && (
                <button className="vc-cliente-copiar-btn" onClick={() => setPlanoImagen(null)}>
                  quitar imagen
                </button>
              )}
              <button className="vc-plano-cerrar-btn" onClick={() => { setShowPlano(false); setLineaColocando(null); }}>
                ✕ cerrar
              </button>
            </div>
          </div>

          {!planoImagen ? (
            <div className="vc-chart-empty">Todavía no has subido ningún plano.</div>
          ) : (
            <>
              <div style={{ textAlign: "center" }}>
              <div
                className="vc-plano-imagen-wrap"
                onClick={(e) => {
                  if (!lineaColocando) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const xPct = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10;
                  const yPct = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10;
                  colocarLineaEnPlano(lineaColocando, xPct, yPct);
                }}
                style={{ cursor: lineaColocando ? "crosshair" : "default" }}
              >
                <img src={planoImagen} alt="Plano del proyecto" className="vc-plano-imagen" />
                {sectors
                  .filter((s) => s.posicionPlano)
                  .map((s) => {
                    const activa = isSectorActiveNow(s, now);
                    const conAlarma = s.blockedByLeak || s.blockedByFault || s.minorLeakFlag || s.clogFlag;
                    const color = conAlarma ? "var(--vc-red)" : activa ? "var(--vc-flow)" : "var(--vc-brass)";
                    const humedad = s.sensors?.humidity;
                    return (
                      <div
                        key={s.id}
                        className={lineaResaltada === s.id ? "vc-plano-marcador vc-plano-marcador-on" : "vc-plano-marcador"}
                        style={{ left: s.posicionPlano.x + "%", top: s.posicionPlano.y + "%" }}
                        title={s.name + " · " + (activa ? "regando" : conAlarma ? "con alarma" : "en reposo") + " · " + humedad + "% humedad"}
                        onMouseEnter={() => setLineaResaltada(s.id)}
                        onMouseLeave={() => setLineaResaltada(null)}
                      >
                        <div className="vc-plano-marcador-barra" style={{ background: color }}>
                          {activa && <span className="vc-plano-marcador-flujo" />}
                          <span className="vc-plano-marcador-label">{s.name.replace("Línea ", "L")}</span>
                        </div>
                        <span className="vc-plano-marcador-humedad">{humedad}%</span>
                      </div>
                    );
                  })}
              </div>
              </div>

              {lineaColocando && (
                <p className="vc-tecnico-hint" style={{ color: "var(--vc-flow)" }}>
                  Pulsa sobre el plano en el punto donde está {sectors.find((s) => s.id === lineaColocando)?.name}…
                </p>
              )}

              <div className="vc-plano-lista">
                {sectors.map((s) => (
                  <div key={s.id} className="vc-plano-lista-item vc-plano-lista-item-doble">
                    <span>{s.name}</span>
                    <div className="vc-plano-lista-fila">
                      <span className="vc-plano-lista-fila-label">sensor:</span>
                      {s.posicionPlano ? (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="vc-plano-btn-sm" onClick={() => setLineaColocando(s.id)}>
                            mover
                          </button>
                          <button className="vc-plano-btn-sm vc-plano-btn-sm-quitar" onClick={() => quitarLineaDePlano(s.id)}>
                            quitar
                          </button>
                        </div>
                      ) : (
                        <button
                          className={lineaColocando === s.id ? "vc-plano-btn-sm vc-plano-btn-sm-on" : "vc-plano-btn-sm"}
                          onClick={() => setLineaColocando(s.id)}
                        >
                          {lineaColocando === s.id ? "pulsa el plano…" : "colocar"}
                        </button>
                      )}
                    </div>
                    <div className="vc-plano-lista-fila">
                      <span className="vc-plano-lista-fila-label">superficie:</span>
                      <input
                        type="number"
                        step="0.1"
                        value={s.areaM2 ?? 0}
                        onChange={(e) => updateSector(s.id, { ...s, areaM2: Number(e.target.value) })}
                        className="vc-plano-input-sm"
                      />
                      <span className="vc-plano-lista-fila-unidad">m²</span>
                    </div>
                    <div className="vc-plano-lista-fila">
                      <span className="vc-plano-lista-fila-label">exposición:</span>
                      <select
                        value={s.exposicion || "sol"}
                        onChange={(e) => updateSector(s.id, { ...s, exposicion: e.target.value })}
                        className="vc-plano-input-sm"
                      >
                        <option value="sol">☀ sol</option>
                        <option value="semisombra">⛅ semisombra</option>
                        <option value="sombra">☁ sombra</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              <div className="vc-balance-hidrico">
                <div className="vc-plano-header" style={{ marginBottom: 10 }}>
                  <div>
                    <div className="vc-history-title" style={{ marginBottom: 4 }}>Balance hídrico estimado</div>
                    <p className="vc-tecnico-hint" style={{ margin: 0 }}>
                      Compara el agua que realmente se ha regado hoy con la que las plantas necesitarían solo por
                      evapotranspiración, calculada línea a línea según su superficie y su exposición real (sol,
                      semisombra o sombra) — configúralas en la lista de arriba. La diferencia es una estimación de
                      escorrentía o pérdida de agua (o de riego insuficiente, si sale negativa) — no un dato medido con
                      sensores de humedad de suelo, así que tómalo como orientativo.
                    </p>
                  </div>
                </div>
                <div className="vc-field-row">
                  <label>
                    ETo sol pleno (L/m²/día)
                    <input type="number" step="0.1" value={etoSol} onChange={(e) => setEtoSol(Number(e.target.value))} />
                  </label>
                  <label>
                    ETo semisombra (L/m²/día)
                    <input
                      type="number"
                      step="0.1"
                      value={etoSemisombra}
                      onChange={(e) => setEtoSemisombra(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    ETo sombra (L/m²/día)
                    <input type="number" step="0.1" value={etoSombra} onChange={(e) => setEtoSombra(Number(e.target.value))} />
                  </label>
                  <label>
                    Umbral de aviso por línea (%)
                    <input
                      type="number"
                      step="1"
                      value={umbralBalanceHidrico}
                      onChange={(e) => setUmbralBalanceHidrico(Number(e.target.value))}
                    />
                  </label>
                </div>
                <p className="vc-tecnico-hint">
                  Este mismo cálculo se hace también línea a línea: si una línea concreta se desvía de su necesidad teórica más de
                  este % (por exceso = posible escorrentía, o por defecto = posible riego insuficiente), aparecerá un aviso en su
                  propia tarjeta, para identificar rápido cuál está mal ajustada. Se compara siempre con el día de AYER (ya
                  completo), no con hoy — así no sale un falso aviso de déficit mientras el riego de hoy todavía está en marcha.
                </p>
                {(() => {
                  const etoPorExposicion = { sol: etoSol, semisombra: etoSemisombra, sombra: etoSombra };
                  const superficieTotal = sectors.reduce((sum, s) => sum + Number(s.areaM2 || 0), 0);
                  const consumoTeorico =
                    Math.round(
                      sectors.reduce((sum, s) => sum + Number(s.areaM2 || 0) * (etoPorExposicion[s.exposicion] ?? etoSol), 0) * 10
                    ) / 10;
                  const consumosAyer = sectors.map((s) => consumoDeAyer(s, now));
                  const hayDatosDeAyer = consumosAyer.some((v) => v !== null);
                  const consumoReal = Math.round(consumosAyer.reduce((sum, v) => sum + (v || 0), 0) * 10) / 10;
                  const diferencia = Math.round((consumoReal - consumoTeorico) * 10) / 10;
                  if (!hayDatosDeAyer) {
                    return (
                      <div className="vc-balance-resultados">
                        <div className="vc-balance-stat" style={{ gridColumn: "1 / -1" }}>
                          <div className="vc-balance-stat-label">Todavía no hay un día completo de histórico — vuelve mañana</div>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="vc-balance-resultados">
                      <div className="vc-balance-stat">
                        <div className="vc-balance-stat-label">Superficie total ({superficieTotal.toFixed(1)} m²)</div>
                        <div className="vc-balance-stat-value">{consumoTeorico} L</div>
                        <div className="vc-balance-stat-label" style={{ marginTop: 2 }}>necesidad teórica / día</div>
                      </div>
                      <div className="vc-balance-stat">
                        <div className="vc-balance-stat-label">Regado real AYER</div>
                        <div className="vc-balance-stat-value">{consumoReal} L</div>
                      </div>
                      <div className="vc-balance-stat">
                        <div className="vc-balance-stat-label">
                          {diferencia >= 0 ? "Posible escorrentía" : "Posible déficit de riego"}
                        </div>
                        <div
                          className="vc-balance-stat-value"
                          style={{ color: diferencia >= 0 ? "var(--vc-amber)" : "var(--vc-red)" }}
                        >
                          {diferencia >= 0 ? "+" : ""}
                          {diferencia} L
                        </div>
                      </div>
                      <div className="vc-balance-stat vc-balance-stat-co2">
                        <div className="vc-balance-stat-label">CO₂ estimado capturado / día</div>
                        <div className="vc-balance-stat-value">{Math.round(((consumoReal * wueGramosPorLitro * 0.45 * 3.667) / 1000) * 100) / 100} kg</div>
                      </div>
                    </div>
                  );
                })()}
                <div className="vc-field-row" style={{ marginTop: 12 }}>
                  <label>
                    Eficiencia hídrica de la vegetación — WUE (g materia seca / L agua)
                    <input
                      type="number"
                      step="0.1"
                      value={wueGramosPorLitro}
                      onChange={(e) => setWueGramosPorLitro(Number(e.target.value))}
                    />
                  </label>
                </div>
                <p className="vc-tecnico-hint">
                  ⚠ El CO₂ es una ESTIMACIÓN muy orientativa, no una medición certificable: se calcula asumiendo que el ~45% de la
                  materia seca producida es carbono, y que cada gramo de carbono equivale a 3,67 g de CO₂. La eficiencia hídrica
                  (WUE) real varía enormemente según la especie concreta de cada planta (de 1 a más de 10 g/L) — el valor de arriba
                  es un promedio genérico de vegetación ornamental, ajústalo si conoces mejor las especies de tu instalación.
                </p>
              </div>
            </>
          )}
          </div>
        </div>
      )}

      {showListadoHorarios && (
        <div className="vc-plano-overlay">
          <div className="vc-plano-panel">
            <div className="vc-plano-header">
              <div>
                <div className="vc-history-title" style={{ marginBottom: 4 }}>Listado de horarios — todas las líneas</div>
                <p className="vc-tecnico-hint" style={{ margin: 0 }}>
                  Todos los riegos programados de las {sectors.length} líneas, ordenados por hora. En rojo, los que se cruzan con
                  otra línea (mismo día, misma franja). Debajo, los huecos del día en los que ninguna línea está regando.
                </p>
              </div>
              <button className="vc-plano-cerrar-btn" onClick={() => setShowListadoHorarios(false)}>
                ✕ cerrar
              </button>
            </div>

            <div className="vc-season-tabs">
              {ESTACIONES.map((est) => (
                <button
                  key={est.key}
                  className={temporadaListado === est.key ? "vc-season-tab vc-season-tab-on" : "vc-season-tab"}
                  onClick={() => setTemporadaListado(est.key)}
                >
                  {est.label}
                </button>
              ))}
            </div>

            {(() => {
              const listado = construirListadoHorarios(sectors, temporadaListado);
              const huecos = calcularHuecosLibres(listado);
              const conflictosCount = listado.filter((ev) => ev.conflictoCon).length;

              // Resumen de actuaciones por línea: cuántas tandas, minutos y
              // litros totales riega cada una en esta estación.
              const resumenPorLinea = sectors.map((s) => {
                const eventosLinea = listado.filter((ev) => ev.lineId === s.id);
                const minutosTotales = eventosLinea.reduce((sum, ev) => sum + ev.duration, 0);
                const nominalFlowLinea = Number(s.emitters || 0) * Number(s.emitterFlow || 0);
                const litrosTotales = Math.round(((minutosTotales / 60) * nominalFlowLinea) * 10) / 10;
                return { nombre: s.name, actuaciones: eventosLinea.length, minutosTotales, litrosTotales };
              });

              return (
                <>
                  <div className="vc-history-title" style={{ margin: "0 0 8px" }}>Total de actuaciones por línea</div>
                  <div className="vc-resumen-lineas-tabla">
                    <div className="vc-resumen-lineas-cabecera">
                      <span>Línea</span>
                      <span>Actuaciones/día</span>
                      <span>Minutos/día</span>
                      <span>Litros/día</span>
                    </div>
                    {resumenPorLinea.map((r) => (
                      <div key={r.nombre} className="vc-resumen-lineas-fila">
                        <span>{r.nombre}</span>
                        <span>{r.actuaciones}</span>
                        <span>{r.minutosTotales} min</span>
                        <span>{r.litrosTotales} L</span>
                      </div>
                    ))}
                  </div>

                  <div className="vc-listado-resumen" style={{ marginTop: 16 }}>
                    {listado.length} riego(s) programado(s) en total
                    {conflictosCount > 0 ? ` · ⚠ ${conflictosCount} se cruzan con otra línea` : " · ✅ ninguno se cruza"}
                  </div>

                  {listado.length === 0 ? (
                    <div className="vc-chart-empty">Todavía no hay ningún horario programado en esta temporada.</div>
                  ) : (
                    <div className="vc-listado-tabla">
                      {listado.map((ev, idx) => (
                        <div
                          key={idx}
                          className={ev.conflictoCon ? "vc-listado-fila vc-listado-fila-conflicto" : "vc-listado-fila"}
                        >
                          <span className="vc-listado-hora">
                            {ev.time} – {formatoHora(ev.fin)}
                          </span>
                          <span className="vc-listado-linea">{ev.lineName}</span>
                          <span className="vc-listado-duracion">{ev.duration} min</span>
                          <span className="vc-listado-dias">{ev.days.join(" ")}</span>
                          {ev.conflictoCon && <span className="vc-listado-conflicto-txt">⚠ se cruza con {ev.conflictoCon}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="vc-history-title" style={{ margin: "16px 0 8px" }}>Huecos libres del día (sin ninguna línea regando)</div>
                  {huecos.length === 0 ? (
                    <div className="vc-chart-empty">No queda ningún hueco libre — el día está completo de riegos.</div>
                  ) : (
                    <div className="vc-huecos-lista">
                      {huecos.map((h, idx) => (
                        <span key={idx} className="vc-hueco-chip">
                          {formatoHora(h.inicio)} – {formatoHora(h.fin)} ({h.fin - h.inicio} min libres)
                        </span>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      <div className="vc-grid">
        {sectors.map((s) => {
          const etoLinea = { sol: etoSol, semisombra: etoSemisombra, sombra: etoSombra }[s.exposicion] ?? etoSol;
          const necesidadTeorica = Math.round(Number(s.areaM2 || 0) * etoLinea * 10) / 10;
          const consumoAyerLinea = consumoDeAyer(s, now);
          const consumoRealLinea = consumoAyerLinea ?? 0;
          const diferenciaLinea = Math.round((consumoRealLinea - necesidadTeorica) * 10) / 10;
          const diferenciaPct = necesidadTeorica > 0 ? Math.round((diferenciaLinea / necesidadTeorica) * 100) : 0;
          const balanceHidrico = {
            necesidadTeorica,
            consumoRealLinea,
            diferenciaLinea,
            diferenciaPct,
            hayDatos: consumoAyerLinea !== null,
          };
          return (
            <SectorCard
              key={s.id}
              sector={s}
              now={now}
              mainSupply={mainSupply}
              maestraCerrada={maestraCerrada}
              tecnico={tecnico}
              cliente={cliente}
              presionEnRangoTrabajo={presionEnRangoTrabajo}
              balanceHidrico={balanceHidrico}
              umbralBalanceHidrico={umbralBalanceHidrico}
              todosLosSectores={sectors}
              etoSol={etoSol}
              etoSemisombra={etoSemisombra}
              etoSombra={etoSombra}
              alarmHistory={alarmHistory}
              onUpdate={(updated) => updateSector(s.id, updated)}
              onRemove={() => removeSector(s.id)}
              onRearm={rearmarLinea}
              onRearmFault={rearmarLineaFault}
            />
          );
        })}
        <button className="vc-add-card" onClick={addSector}>
          + añadir línea
        </button>
      </div>
    </div>
  );
}
