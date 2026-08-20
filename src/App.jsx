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
  const numeros = [1, 2, 3, 4, 5, 6, 7, 8];
  return numeros.map((n, i) => {
    const baseHour = (i * 3) % 24;
    const litrosSemana = [18, 25, 14, 30, 22, 10, 27, 19, 23, 16, 28, 21, 12, 26].map(
      (l) => Math.round(l * (0.85 + (i % 4) * 0.1))
    );
    const semanaDemo = demoLineWeek(baseHour, litrosSemana);
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
  const color = active ? "var(--vc-open)" : mode === "apagado" ? "var(--vc-red)" : mode === "sensor" ? "var(--vc-violet)" : "var(--vc-idle)";
  return (
    <span
      style={{
        display: "inline-block",
        width: 9,
        height: 9,
        borderRadius: "50%",
        background: color,
        boxShadow: active ? `0 0 0 4px ${color}33` : "none",
        transition: "box-shadow 0.3s ease",
        flexShrink: 0,
      }}
    />
  );
}

function SensorStat({ label, value, unit, warn, wide, onClick, active }) {
  const clases = `vc-sensor${warn ? " vc-sensor-warn" : ""}${wide ? " vc-sensor-wide" : ""}${onClick ? " vc-sensor-clickable" : ""}${
    active ? " vc-sensor-active" : ""
  }`;
  return (
    <div className={clases} onClick={onClick} role={onClick ? "button" : undefined}>
      <span className="vc-sensor-label">{label}</span>
      <span className="vc-sensor-value">
        {value}
        <span className="vc-sensor-unit">{unit}</span>
      </span>
    </div>
  );
}

function HorarioRow({ evento, index, onChange, onRemove, canRemove }) {
  const toggleDay = (dayKey) => {
    const days = evento.days.includes(dayKey)
      ? evento.days.filter((d) => d !== dayKey)
      : [...evento.days, dayKey];
    onChange({ ...evento, days });
  };

  return (
    <div className="vc-event-block">
      <div className="vc-event-header">
        <span className="vc-event-title">Riego {index + 1}</span>
        {canRemove && (
          <button className="vc-event-remove" onClick={onRemove} aria-label={`Eliminar riego ${index + 1}`}>
            ×
          </button>
        )}
      </div>
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

function SectorCard({ sector, now, mainSupply, tecnico, cliente, presionEnRangoTrabajo, onUpdate, onRemove, onRearm, onRearmFault }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [showCharts, setShowCharts] = useState(false);
  const [combinedView, setCombinedView] = useState("hora");
  const [combinedAnnualOffset, setCombinedAnnualOffset] = useState(0);
  const [editingSeason, setEditingSeason] = useState(() => getSeasonForDate(now));
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
  const active = mainSupply && isSectorActiveNow(sector, now);
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
    const nuevos = [...eventos, nuevoHorario(last ? { time: last.time, days: [...last.days] } : {})];
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
      className="vc-card"
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
          <StatusDot active={active} mode={sector.mode} />
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
          label="Consumo hoy"
          value={sensors.litersToday || 0}
          unit="L"
          warn={false}
          wide
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
          <span>⚠ electroválvula aislada por fuga</span>
          <div className="vc-leak-actions">
            {tecnico.alarmas?.fugas !== false && (
              <a
                className="vc-alarm-notify-link"
                href={buildMailtoUrl(
                  { lineId: sector.id, lineName: sector.name, ts: now.toISOString(), flowMeasured: sensors.flowMeasured, nominalFlow, type: "fuga_grave" },
                  tecnico
                )}
              >
                ✉ avisar técnico
              </a>
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

      <button className="vc-link-btn" onClick={() => setEditingSchedule((v) => !v)}>
        {editingSchedule ? "ocultar horarios y umbrales" : "editar horarios y umbrales"}
      </button>

      {editingSchedule && (
        <div className="vc-schedule-editor">
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
          {eventos.map((ev, idx) => (
            <HorarioRow
              key={ev.id}
              evento={ev}
              index={idx}
              onChange={(updated) => updateEvento(idx, updated)}
              onRemove={() => removeEvento(idx)}
              canRemove={eventos.length > 1}
            />
          ))}
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

function FertilizerGauge({ level }) {
  const color = level < 5 ? "var(--vc-red)" : level < 15 ? "var(--vc-amber)" : "var(--vc-violet)";
  const alturaLlena = (level / 100) * 26;
  return (
    <svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true">
      <rect x="6" y="4" width="18" height="4" rx="1" fill="var(--vc-border)" />
      <rect x="4" y="8" width="22" height="28" rx="3" fill="none" stroke="var(--vc-border)" strokeWidth="2" />
      <rect x="6" y={34 - alturaLlena} width="18" height={alturaLlena} rx="1" fill={color} />
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

export default function VerdticalControlPanel() {
  const [sectors, setSectors] = useState(null);
  const [mainSupply, setMainSupply] = useState(true);
  const [pressureBar, setPressureBar] = useState(2.6);
  const [now, setNow] = useState(new Date());
  const [loaded, setLoaded] = useState(false);
  const [proyecto, setProyecto] = useState({ id: "", nombre: "" });
  const [showProyectoConfig, setShowProyectoConfig] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [showAlarmHistory, setShowAlarmHistory] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [showTecnicoConfig, setShowTecnicoConfig] = useState(false);
  const [showClienteConfig, setShowClienteConfig] = useState(false);
  const [copiadoCliente, setCopiadoCliente] = useState(false);
  const [showFertilizerHistory, setShowFertilizerHistory] = useState(false);
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
  const [history, setHistory] = useState([]);
  const [flowHistory, setFlowHistory] = useState([]);
  const [pressureHistory, setPressureHistory] = useState([]);
  const [dailyConsumption, setDailyConsumption] = useState([]);
  const [masterAutoShutoff, setMasterAutoShutoff] = useState(true);
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
          setMasterAutoShutoff(parsed.masterAutoShutoff !== undefined ? parsed.masterAutoShutoff : true);
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

  useEffect(() => {
    if (!showAlarmHistory && !showActivityLog && !showTecnicoConfig && !showClienteConfig && !showFertilizerHistory) return;
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
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showAlarmHistory, showActivityLog, showTecnicoConfig, showClienteConfig, showFertilizerHistory]);

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
            masterAutoShutoff,
            leakAlerts,
            alarmHistory: alarmHistory.slice(-MAX_ALARM_LOG),
            tecnico,
            cliente,
            procesosRealizados,
            notaObservacion,
            proyecto,
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
    masterAutoShutoff,
    leakAlerts,
    alarmHistory,
    tecnico,
    cliente,
    procesosRealizados,
    notaObservacion,
    proyecto,
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

      const active = mainSupply && isSectorActiveNow(sConManual, now);
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
        if (masterAutoShutoff && !blockedByLeak && esGrave) {
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

    const totalFlow = updated.reduce((sum, s) => sum + Number(s.sensors?.flowMeasured || 0), 0);
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
    setMasterAutoShutoff(true);
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

  const anyActive = mainSupply && sectors.some((s) => isSectorActiveNow(s, now));
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
            <button className="vc-proyecto-btn" onClick={() => setShowProyectoConfig((v) => !v)}>
              {proyecto.nombre ? `📍 ${proyecto.nombre}` : "⚠ proyecto sin identificar — pulsa para configurar"}
            </button>
          </div>
          <div className="vc-top-buttons">
            <div className={isOnline ? "vc-connection-badge" : "vc-connection-badge vc-connection-badge-off"} title={isOnline ? "Con conexión a internet" : "Sin conexión a internet"}>
              <span className="vc-connection-dot" />
              {isOnline ? "en línea" : "sin conexión"}
            </div>
            <button className="vc-supply-toggle vc-supply-toggle-lg" onClick={() => setMainSupply((v) => !v)}>
              <StatusDot active={mainSupply} mode="horario" />
              sistema {mainSupply ? "activado" : "apagado"}
            </button>
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
        <p className="vc-subtitle">
          {now.toLocaleDateString("es-ES", { weekday: "long", day: "2-digit", month: "short" })} · {pad2(now.getHours())}:{pad2(now.getMinutes())}
        </p>
        <div className="vc-header-actions">
          {!confirmReset ? (
            <button className="vc-supply-toggle vc-reset-toggle" onClick={() => setConfirmReset(true)}>
              reiniciar datos de ejemplo
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
          <button
            className={masterAutoShutoff ? "vc-supply-toggle vc-supply-toggle-on" : "vc-supply-toggle"}
            onClick={() => setMasterAutoShutoff((v) => !v)}
          >
            protección: {masterAutoShutoff ? "activada" : "desactivada"}
          </button>
          <div className="vc-alarm-dropdown-wrap" ref={alarmDropdownRef}>
            <button
              className={showAlarmHistory ? "vc-supply-toggle vc-supply-toggle-on" : "vc-supply-toggle"}
              onClick={() => setShowAlarmHistory((v) => !v)}
            >
              alarmas ({alarmHistory.length})
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
              className={showActivityLog ? "vc-supply-toggle vc-supply-toggle-on" : "vc-supply-toggle"}
              onClick={() => setShowActivityLog((v) => !v)}
            >
              actividad ({history.length})
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
      </div>

      {leakAlerts.length > 0 && (
        <div className="vc-leak-stack">
          {leakAlerts.map((a) => (
            <div className="vc-leak-banner" key={a.lineId}>
              <span>
                ⚠ Fuga grave detectada en <strong>{a.lineName}</strong> ({a.flowMeasured} L/h frente a {a.nominalFlow} L/h esperados) — su
                electroválvula se ha aislado automáticamente. El resto de líneas sigue regando con normalidad.
              </span>
              <div className="vc-leak-actions">
                {tecnico.alarmas?.fugas !== false && (
                  <>
                    <a
                      className="vc-leak-notify"
                      href={buildMailtoUrl({ ...a, type: "fuga_grave" }, tecnico)}
                      title="Abrir correo con el aviso ya redactado"
                    >
                      ✉ Avisar
                    </a>
                    {tecnico.telefono && (
                      <a
                        className="vc-leak-notify"
                        href={buildWhatsappUrl({ ...a, type: "fuga_grave" }, tecnico)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Abrir WhatsApp con el aviso ya redactado"
                      >
                        💬 WhatsApp
                      </a>
                    )}
                  </>
                )}
                <button className="vc-leak-rearm" onClick={() => rearmarLinea(a.lineId, a.lineName)}>
                  Rearmar {a.lineName}
                </button>
              </div>
            </div>
          ))}
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
        <div className="vc-summary-card vc-summary-card-narrow">
          <div className="vc-summary-text">
            <div className="vc-summary-label">Líneas</div>
            <div className="vc-summary-value">{sectors.length}</div>
          </div>
        </div>
        <div className="vc-summary-card">
          <div className="vc-summary-text">
            <div className="vc-summary-label">Caudalímetro total</div>
            <div className="vc-summary-value">{totalFlowMeasured} L/h</div>
          </div>
        </div>
        <div className="vc-summary-card">
          <PressureGauge bar={pressureBar} />
          <div className="vc-summary-text">
            <div className="vc-summary-label">Presión red</div>
            <div className="vc-summary-value" style={{ color: pressureOutOfRange ? "var(--vc-red)" : "var(--vc-text)" }}>
              {pressureBar} bar
            </div>
          </div>
        </div>
        <div className="vc-summary-card vc-summary-card-narrow">
          <div className="vc-summary-text">
            <div className="vc-summary-label">Estado red</div>
            <div className="vc-summary-value" style={{ color: anyActive ? "var(--vc-open)" : "var(--vc-text-muted)" }}>
              {anyActive ? "regando" : "en reposo"}
            </div>
          </div>
        </div>
        <div className="vc-alarm-dropdown-wrap" ref={tecnicoDropdownRef}>
          <button
            className={showTecnicoConfig ? "vc-summary-card vc-summary-card-btn vc-summary-card-on" : "vc-summary-card vc-summary-card-btn"}
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
            className={showClienteConfig ? "vc-summary-card vc-summary-card-btn vc-summary-card-on" : "vc-summary-card vc-summary-card-btn"}
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
        <div className="vc-alarm-dropdown-wrap" ref={fertilizerDropdownRef}>
          <button
            className={showFertilizerHistory ? "vc-summary-card vc-summary-card-btn vc-summary-card-on" : "vc-summary-card vc-summary-card-btn"}
            onClick={() => setShowFertilizerHistory((v) => !v)}
          >
            <FertilizerGauge level={fertilizerLevel} />
            <div className="vc-summary-text">
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
          lines={sectors.map((s) => ({ name: s.name, active: mainSupply && isSectorActiveNow(s, now) }))}
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

      <div className="vc-grid">
        {sectors.map((s) => (
          <SectorCard
            key={s.id}
            sector={s}
            now={now}
            mainSupply={mainSupply}
            tecnico={tecnico}
            cliente={cliente}
            presionEnRangoTrabajo={presionEnRangoTrabajo}
            onUpdate={(updated) => updateSector(s.id, updated)}
            onRemove={() => removeSector(s.id)}
            onRearm={rearmarLinea}
            onRearmFault={rearmarLineaFault}
          />
        ))}
        <button className="vc-add-card" onClick={addSector}>
          + añadir línea
        </button>
      </div>
    </div>
  );
}
