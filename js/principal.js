// ============================================================
// MICE L3 · búsqueda, horarios, secciones y visor 3D
// ============================================================

const VERSION = "71";
const $ = (id) => document.getElementById(id);

const estado = {
  grupos: [],
  gruposOrdenados: [],
  materias: [],
  nombresProfesores: [],
  profesores: [],
  salones: {},
  areasPorId: {},
  secciones: { grupos: [], servicios: [] },
  semestre: "",
  modo: "grupo",
  seccion: "busqueda",
  indiceResaltado: -1,
  horaElegida: null,
  diaElegido: null,
  lineaProfesor: null, // { nombre, grupo }: clases del profesor buscado marcadas en la línea del tiempo
  visor: null,
  techoVisible: true,
  separado: false,
  ventanas: null,
};

const SECCIONES = {
  busqueda: { titulo: "Buscar" },
  grupos: { titulo: "Grupos estudiantiles", filtro: "Filtrar grupos, ej. IDEA", vacio: "grupos estudiantiles" },
  servicios: { titulo: "Servicios para alumnos", filtro: "Filtrar servicios, ej. MAKER", vacio: "servicios para alumnos" },
};

const PLACEHOLDER_MODO = {
  grupo: "Número de grupo, ej. 8419",
  maestro: "Nombre del profesor, ej. GARCIA",
  materia: "Materia o clave, ej. DISEÑO LOGICO",
};

const NOMBRE_TIPO = {
  salon: "Salón de clases",
  apoyo: "Área de gestión de apoyo",
  grupo: "Grupo estudiantil",
  servicio: "Servicio para alumnos",
  restringido: "Solo personal autorizado",
  bano: "Sanitarios",
};

const NOMBRE_VISTA = {
  entrada: "Vista desde la entrada · poniente",
  n: "Vista norte",
  s: "Vista sur",
  e: "Vista este",
  o: "Vista oeste",
  ne: "Isométrica noreste",
  no: "Isométrica noroeste",
  se: "Isométrica sureste",
  so: "Isométrica suroeste",
};

// Pantalla táctil: los textos de ayuda hablan de dedos en lugar de mouse.
const TACTIL = window.matchMedia("(pointer: coarse)").matches;
const TEXTO_INICIO = `Vista desde la entrada · elige un piso o ${TACTIL ? "toca" : "haz clic en"} un salón`;
const AYUDA_MAPA = TACTIL
  ? "Un dedo para girar · dos dedos para mover y acercar"
  : "Arrastra para girar · clic derecho, botón central o Shift+arrastrar para mover · rueda para acercar";
const AYUDA_MOVER = TACTIL ? "dos dedos para mover" : "clic derecho para mover";
const AYUDA_2D = TACTIL ? "un dedo para mover · pellizca para acercar" : "arrastra para mover · rueda para acercar";
// Se muestra en todos los servicios para alumnos (también en los que se agreguen después).
const NOTA_SERVICIOS = "si se encuentra cerrado, acércate y pregunta a jefatura por apoyo.";
const SIN_BUSQUEDA ="<p class='placeholder'>Aún no hay búsqueda.</p>";

// ---------- utilidades ----------

/** Pone el cursor en un campo, salvo en pantallas táctiles (ahí abriría el teclado). */
function enfocar(campo) {
  if (!TACTIL) campo.focus();
}

function escapar(valor) {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Texto sin acentos, en mayúsculas y sin signos (para comparar). */
function plano(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Todas las palabras de la búsqueda aparecen en el texto, en cualquier orden. */
function coincidePalabras(texto, busqueda) {
  const objetivo = plano(texto);
  const palabras = plano(busqueda).split(" ").filter(Boolean);
  return palabras.length > 0 && palabras.every((p) => objetivo.includes(p));
}

/** Texto escapado con sus direcciones web y correos convertidos en enlaces (con `etiqueta`, ese texto en lugar de la dirección). */
function enlazar(texto, etiqueta) {
  return escapar(texto).replace(/https?:\/\/[^\s<]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (m) => {
    const web = m.startsWith("http");
    let visible = etiqueta ?? m;
    try {
      if (!etiqueta) visible = decodeURI(m).replaceAll("<", "&lt;"); // "sal%C3%B3n" -> "salón"
    } catch {}
    return `<a class="enlace" href="${web ? "" : "mailto:"}${m}"${web ? ' target="_blank" rel="noopener"' : ""}>${visible}${web ? " ↗" : ""}</a>`;
  });
}

/** "08419", "84-19" -> "8419". */
function limpiarGrupo(texto) {
  return String(texto ?? "").replace(/\D/g, "").replace(/^0+(?=\d{3})/, "");
}

/** Distancia de edición entre dos palabras. */
function distancia(a, b) {
  const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let previo = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, previo + (a[i - 1] === b[j - 1] ? 0 : 1));
      previo = temp;
    }
  }
  return fila[b.length];
}

/** Opciones más parecidas a la búsqueda ("¿Quisiste decir…?"). */
function masParecidos(busqueda, opciones, cuantos = 4) {
  const q = plano(busqueda).split(" ").filter(Boolean);
  if (!q.length) return [];
  return opciones
    .map((op) => {
      const palabras = plano(op).split(" ");
      const d = Math.min(...q.map((w) => Math.min(...palabras.map((p) => distancia(w, p.slice(0, w.length + 1))))));
      return { op, d };
    })
    .filter((x) => x.d <= 2)
    .sort((a, b) => a.d - b.d)
    .slice(0, cuantos)
    .map((x) => x.op);
}

/** Espera a que termine la intro animada (o 8 s como máximo, por si algo falla). */
function esperarIntro() {
  if (!document.getElementById("mice-intro")) return Promise.resolve();
  return new Promise((listo) => {
    document.addEventListener("mice-intro-end", listo, { once: true });
    setTimeout(listo, 8000);
  });
}

async function cargarJSON(ruta) {
  const respuesta = await fetch(ruta, { cache: "no-cache" });
  if (!respuesta.ok) throw new Error(`${ruta}: HTTP ${respuesta.status}`);
  return respuesta.json();
}

function nivelDeSalon(codigo) {
  const m = /^L3(\d)/.exec(codigo || "");
  return m ? Number(m[1]) : null;
}

/** "L30022" -> "L30022 · IASE" si el salón tiene un segundo nombre. */
function nombreSalon(codigo) {
  const area = estado.salones[codigo];
  if (!area) return codigo || "";
  const otro = area.alias || (area.nombre !== area.codigo ? area.nombre : null);
  return otro ? `${codigo} · ${otro}` : codigo;
}

function nombreNivel(id) {
  return ["Planta baja", "Primer piso", "Segundo piso"][id] ?? "Nivel";
}

function estadoMapa(texto) {
  $("mapaEstado").textContent = texto;
}

// ---------- horarios ----------

const DIAS = ["DOM", "LUN", "MAR", "MIE", "JUE", "VIE", "SAB"];
const DIAS_LARGO = { DOM: "Domingo", LUN: "Lunes", MAR: "Martes", MIE: "Miércoles", JUE: "Jueves", VIE: "Viernes", SAB: "Sábado" };
const INICIO_DIA = 7 * 60;
const FIN_DIA = 24 * 60;
const sesionesPorDia = new Map();

function aMinutos(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + (m || 0);
}

function rango(hora) {
  const [a, b] = String(hora || "").split("-");
  return b ? [aMinutos(a), aMinutos(b)] : null;
}

function formatoHora(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function horarioTexto(grupo) {
  return (grupo.sesiones || []).map((s) => `${s.dia} ${s.hora}`).join(" · ");
}

/** Sesiones de un día [{grupo, inicio, fin}], calculadas una sola vez por día. */
function sesionesDelDia(dia) {
  if (!sesionesPorDia.has(dia)) {
    const salida = [];
    for (const g of estado.grupos) {
      for (const s of g.sesiones || []) {
        const r = s.dia === dia ? rango(s.hora) : null;
        if (r) salida.push({ grupo: g, inicio: r[0], fin: r[1] });
      }
    }
    salida.sort((a, b) => a.inicio - b.inicio || a.grupo.salon.localeCompare(b.grupo.salon));
    sesionesPorDia.set(dia, salida);
  }
  return sesionesPorDia.get(dia);
}

function enCursoA(sesiones, minutos) {
  return sesiones.filter((s) => s.inicio <= minutos && minutos < s.fin);
}

function ahora() {
  const d = new Date();
  return { dia: DIAS[d.getDay()], minutos: d.getHours() * 60 + d.getMinutes() };
}

/** Hora consultada: la elegida en la línea del tiempo o la actual. */
function minutosConsulta() {
  return estado.horaElegida ?? ahora().minutos;
}

/** Día consultado: el elegido en el botón de día o el de hoy. */
function diaConsulta() {
  return estado.diaElegido ?? ahora().dia;
}

// ---------- arranque ----------

document.addEventListener("DOMContentLoaded", iniciar);

async function iniciar() {
  conectarInterfaz();

  // Durante la intro se descarga y lee el modelo y se carga Three.js; el modelo 3D se arma
  // cuando termina, porque armarlo antes traba la animación.
  const preparar3D = Promise.allSettled([
    cargarJSON("data/edificio.json"),
    cargarJSON("data/fachada.json"),
    import(`./escena3d.js?v=${VERSION}`),
  ]);
  const [horarios, profesores, secciones] = await Promise.allSettled([
    cargarJSON("data/horarios.json"),
    cargarJSON("data/profesores.json"),
    cargarJSON("data/secciones.json"),
  ]);

  if (horarios.status === "rejected") {
    mostrarErrorCarga(horarios.reason);
    return;
  }

  estado.grupos = horarios.value.grupos || [];
  estado.semestre = horarios.value.meta?.semestre || "";
  estado.gruposOrdenados = [...estado.grupos].sort((a, b) => Number(a.grupo) - Number(b.grupo));
  const ordenar = (lista) => [...new Set(lista.filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  estado.materias = ordenar(estado.grupos.map((g) => g.materia));
  estado.nombresProfesores = ordenar(estado.grupos.map((g) => g.profesor));
  if (profesores.status === "fulfilled") estado.profesores = profesores.value.profesores || [];
  if (secciones.status === "fulfilled") {
    estado.secciones = { grupos: secciones.value.grupos || [], servicios: secciones.value.servicios || [] };
  }

  iniciarLineaTiempo();

  await esperarIntro();
  const [modelo, fachada, modulo3D] = await preparar3D;
  if (modelo.status === "fulfilled") {
    const areas = modelo.value.areas || [];
    estado.areasPorId = Object.fromEntries(areas.map((a) => [a.id, a]));
    estado.salones = Object.fromEntries(areas.filter((a) => a.codigo).map((a) => [a.codigo, a]));
    if (modulo3D.status === "fulfilled") {
      await iniciarVisor(modulo3D.value.VisorEdificio, modelo.value, fachada.status === "fulfilled" ? fachada.value : null);
    } else {
      avisoVisor("No se pudo cargar el visor 3D. Revisa tu conexión (Three.js se carga desde internet).");
    }
  } else {
    avisoVisor("Modelo 3D no disponible. Genera data/edificio.json con scripts/generar_modelo.py.");
  }

  aplicarParametrosDeEnlace();
}

function conectarInterfaz() {
  const input = $("searchInput");

  document.querySelectorAll(".modoBtn").forEach((btn) => btn.addEventListener("click", () => cambiarModo(btn.dataset.modo)));
  $("searchBtn").addEventListener("click", buscar);
  input.addEventListener("input", alEscribir);
  input.addEventListener("focus", alEscribir);
  input.addEventListener("click", alEscribir);
  input.addEventListener("keydown", alPresionarTecla);

  $("autocompletado").addEventListener("click", (e) => {
    const opcion = e.target.closest(".opcionAuto");
    if (opcion) elegirOpcion(opcion.dataset.valor);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".input-wrap")) ocultarAutocompletado();
    if (!e.target.closest(".lt-hora-wrap")) ocultarOpcionesHora();
  });

  $("result").addEventListener("click", (e) => {
    const sugerencia = e.target.closest("[data-sugerencia]");
    const grupo = e.target.closest("[data-grupo]");
    if (sugerencia) {
      cambiarModo(sugerencia.dataset.sugerencia);
      elegirOpcion(sugerencia.dataset.valor);
    } else if (grupo) {
      cambiarModo("grupo");
      elegirOpcion(grupo.dataset.grupo);
    }
  });

  $("ahoraBtn").addEventListener("click", mostrarClasesDeLaLinea);
  conectarLineaTiempo();

  document.querySelectorAll(".seccionBtn").forEach((btn) => btn.addEventListener("click", () => cambiarSeccion(btn.dataset.seccion)));
  $("filtroSeccion").addEventListener("input", renderListaSeccion);
  $("listaSeccion").addEventListener("click", (e) => {
    const tarjeta = e.target.closest("[data-area]");
    if (tarjeta) mostrarDetalleSeccion(tarjeta.dataset.area);
  });
  $("limpiarBtn").addEventListener("click", limpiarBusqueda);
  $("atrasBtn").addEventListener("click", volverALista);

  // Guía de uso y Compartir (ventanas con Esc para cerrar; también se cierran al tocar fuera de ellas).
  for (const id of ["guia", "compartir"]) {
    const ventana = $(id);
    $(`${id}Btn`).addEventListener("click", () => ventana.showModal());
    $(`${id}Cerrar`).addEventListener("click", () => ventana.close());
    ventana.addEventListener("click", (e) => {
      if (e.target === ventana) ventana.close();
    });
  }

  // El enlace sale de la dirección actual: si la página cambia de cuenta, se actualiza solo.
  const enlace = $("compartirEnlace");
  const aviso = $("compartirAviso");
  enlace.value = location.origin + location.pathname;
  $("compartirBtn").addEventListener("click", () => (aviso.textContent = ""));
  $("copiarEnlaceBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(enlace.value);
      aviso.textContent = "Enlace copiado";
    } catch {
      enlace.select(); // navegadores sin permiso de portapapeles (p. ej. dentro de otras apps)
      aviso.textContent = document.execCommand("copy") ? "Enlace copiado" : "Copia el enlace seleccionado";
    }
  });
  document.addEventListener("click", (e) => {
    const boton = e.target.closest(".compartir-ficha");
    if (boton) compartirFicha(boton);
  });
  $("copiarQrBtn").addEventListener("click", async () => {
    try {
      const imagen = fetch($("compartirQr").src).then((r) => r.blob());
      await navigator.clipboard.write([new ClipboardItem({ "image/png": imagen })]); // Safari pide la promesa, no el resultado
      aviso.textContent = "Código QR copiado";
    } catch {
      aviso.textContent = "Mantén presionada la imagen para copiarla";
    }
  });

  document.querySelectorAll(".nivelBtn[data-nivel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!estado.visor) return;
      const nivel = btn.dataset.nivel;
      if (nivel === "todos") {
        estado.visor.verEdificio(true, true); // conserva los salones resaltados
        marcarNivelActivo("todos");
        marcarVistaActiva("entrada");
        estadoMapa(TEXTO_INICIO);
      } else {
        estado.visor.enfocarNivel(nivel, true, true);
        marcarNivelActivo(nivel);
        marcarVistaActiva(null);
        estadoMapa(textoNivel(Number(nivel)));
      }
    });
  });

  $("plano2dBtn").addEventListener("click", () => {
    if (!estado.visor) return;
    estado.visor.set2D(!estado.visor.modo2D);
    estado.separado = estado.visor.separado;
    actualizarBotonesVisor();
    marcarNivelActivo(String(estado.visor.nivelActivo));
    marcarVistaActiva(null);
    estadoMapa(textoNivel(Number(estado.visor.nivelActivo)));
  });

  $("separarBtn").addEventListener("click", () => {
    if (!estado.visor) return;
    estado.visor.set2D(false);
    estado.separado = !estado.separado;
    estado.visor.separar(estado.separado);
    actualizarBotonesVisor();
  });

  $("ventanasBtn").addEventListener("click", () => {
    if (!estado.visor || estado.ventanas === null) return;
    estado.ventanas = !estado.ventanas;
    estado.visor.setVentanas(estado.ventanas);
    actualizarBotonesVisor();
  });

  $("techoBtn").addEventListener("click", () => {
    if (!estado.visor) return;
    estado.techoVisible = !estado.techoVisible;
    estado.visor.setTecho(estado.techoVisible);
    actualizarBotonesVisor();
  });

  document.querySelectorAll(".vistaBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!estado.visor) return;
      estado.visor.vista(btn.dataset.vista, true);
      marcarVistaActiva(btn.dataset.vista);
      marcarNivelActivo("todos");
      estadoMapa(`${NOMBRE_VISTA[btn.dataset.vista] || "Vista del edificio"} · ${AYUDA_MOVER}`);
      abrirVistas(false);
    });
  });

  $("vistasBtn").addEventListener("click", () => abrirVistas(!$("vistas").classList.contains("abiertas")));
  iniciarBotonMapa();
}

/** Celular: la rosa de vistas se abre con el botón "Vistas". */
function abrirVistas(abrir) {
  $("vistas").classList.toggle("abiertas", abrir);
  $("vistasBtn").classList.toggle("activo", abrir);
  $("vistasBtn").setAttribute("aria-expanded", String(abrir));
}

/** Celular: botón flotante que lleva al mapa o, si ya se ve el mapa, de regreso a la búsqueda. */
function iniciarBotonMapa() {
  const boton = $("irMapaBtn");
  const angosta = window.matchMedia("(max-width: 980px)");
  let enMapa = false;
  new IntersectionObserver(([e]) => {
    enMapa = e.intersectionRatio > 0.35;
    boton.textContent = enMapa ? "Búsqueda ↑" : "Ver mapa ↓";
  }, { threshold: [0, 0.35, 1] }).observe(document.querySelector(".panel-mapa"));
  const actualizar = () => (boton.hidden = !angosta.matches);
  angosta.addEventListener("change", actualizar);
  actualizar();
  boton.addEventListener("click", () =>
    document.querySelector(enMapa ? ".columna-busqueda" : ".instructivo").scrollIntoView({ behavior: "smooth", block: "start" })
  );
}

function textoNivel(nivel) {
  return estado.visor?.modo2D
    ? `Plano 2D · ${nombreNivel(nivel)} · ${AYUDA_2D}`
    : `${nombreNivel(nivel)} · ${TACTIL ? "toca" : "haz clic en"} un salón`;
}

// ---------- enlaces directos (?grupo=, ?maestro=, ?materia=, ?salon=, ?grupoest=, ?servicio=, ?ahora, ?nivel=, ?vista=, ?guia) ----------

function aplicarParametrosDeEnlace() {
  const p = new URLSearchParams(window.location.search);
  for (const modo of ["grupo", "maestro", "materia"]) {
    if (p.get(modo)) {
      cambiarModo(modo);
      $("searchInput").value = p.get(modo);
      buscar();
      return;
    }
  }
  // Enlaces de "Compartir “…”": un salón o área del mapa, un grupo estudiantil o un servicio.
  const area = estado.salones[p.get("salon")] || estado.areasPorId[p.get("salon")];
  if (area && estado.visor) {
    estado.visor.enfocarSalon(area.id);
    mostrarArea(area);
    return;
  }
  for (const [parametro, seccion] of [["grupoest", "grupos"], ["servicio", "servicios"]]) {
    const valor = plano(p.get(parametro));
    const item = valor && estado.secciones[seccion].find((x) => plano(x.nombre) === valor || plano(x.area) === valor);
    if (item) {
      cambiarSeccion(seccion);
      mostrarDetalleSeccion(item.area);
      return;
    }
  }
  if (p.has("guia")) $("guia").showModal();
  if (p.has("ahora")) {
    clasesAhora();
    return;
  }
  if (!estado.visor) return;
  const nivel = p.get("nivel");
  if (nivel && nivel !== "todos") {
    estado.visor.enfocarNivel(nivel);
    marcarNivelActivo(nivel);
    estadoMapa(textoNivel(Number(nivel)));
  } else if (p.get("vista")) {
    estado.visor.vista(p.get("vista"));
    marcarVistaActiva(p.get("vista"));
  }
}

// ---------- modos de búsqueda ----------

function cambiarModo(modo) {
  estado.modo = modo;
  document.querySelectorAll(".modoBtn").forEach((btn) => {
    const activo = btn.dataset.modo === modo;
    btn.classList.toggle("activo", activo);
    btn.setAttribute("aria-selected", String(activo));
  });
  const input = $("searchInput");
  input.value = "";
  input.placeholder = PLACEHOLDER_MODO[modo];
  ocultarAutocompletado();
  $("result").innerHTML = SIN_BUSQUEDA;
  enfocar(input);
}

// ---------- autocompletado ----------

function alEscribir() {
  const texto = $("searchInput").value;
  estado.indiceResaltado = -1;
  if (estado.modo === "grupo") mostrarGrupos(texto);
  else if (estado.modo === "materia") mostrarMaterias(texto);
  else mostrarProfesores(texto);
}

function mostrarProfesores(texto) {
  const lista = plano(texto)
    ? estado.nombresProfesores.filter((n) => coincidePalabras(n, texto))
    : estado.nombresProfesores;
  mostrarAutocompletado(lista.map((n) => ({ valor: n, texto: n })));
}

/** Materias que coinciden por nombre o por clave. */
function filtrarMaterias(texto) {
  const q = plano(texto);
  if (!q) return estado.materias;
  const porClave = new Set(estado.grupos.filter((g) => g.clave === q).map((g) => g.materia));
  return estado.materias.filter((m) => porClave.has(m) || coincidePalabras(m, texto));
}

function mostrarMaterias(texto) {
  mostrarAutocompletado(filtrarMaterias(texto).map((m) => ({ valor: m, texto: m })));
}

function mostrarGrupos(texto) {
  const digitos = limpiarGrupo(texto);
  const grupos = estado.gruposOrdenados
    .filter((g, i, lista) => (!digitos || g.grupo.startsWith(digitos)) && g.grupo !== lista[i - 1]?.grupo)
    .map((g) => ({ valor: g.grupo, texto: g.grupo, detalle: `${g.materia} · ${nombreSalon(g.salon)}` }));
  mostrarAutocompletado(grupos, true);
}

function mostrarAutocompletado(items, deGrupos = false) {
  const lista = $("autocompletado");
  if (!items.length) {
    ocultarAutocompletado();
    return;
  }
  const fragmento = document.createDocumentFragment();
  for (const item of items) {
    const opcion = document.createElement("div");
    opcion.className = "opcionAuto";
    opcion.setAttribute("role", "option");
    opcion.dataset.valor = item.valor;
    opcion.textContent = item.texto;
    if (item.detalle) opcion.title = item.detalle;
    fragmento.appendChild(opcion);
  }
  lista.replaceChildren(fragmento);
  lista.classList.toggle("grupos", deGrupos);
  lista.classList.add("visible");
}

function ocultarAutocompletado() {
  const lista = $("autocompletado");
  lista.classList.remove("visible", "grupos");
  lista.replaceChildren();
}

function elegirOpcion(valor) {
  $("searchInput").value = valor;
  ocultarAutocompletado();
  buscar();
}

function alPresionarTecla(e) {
  const opciones = $("autocompletado").querySelectorAll(".opcionAuto");
  if (e.key === "Escape") {
    ocultarAutocompletado();
    $("searchInput").blur();
    return;
  }
  if (opciones.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    const paso = e.key === "ArrowDown" ? 1 : -1;
    estado.indiceResaltado = Math.min(Math.max(estado.indiceResaltado + paso, 0), opciones.length - 1);
    opciones.forEach((o, i) => o.classList.toggle("resaltada", i === estado.indiceResaltado));
    opciones[estado.indiceResaltado].scrollIntoView({ block: "nearest" });
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    const opcion = opciones[estado.indiceResaltado];
    if (opcion) elegirOpcion(opcion.dataset.valor);
    else {
      ocultarAutocompletado();
      buscar();
    }
  }
}

// ---------- búsqueda ----------

function buscar(conservarLinea = false) {
  if (!estado.grupos.length) return;
  if (!conservarLinea) marcarProfesorEnLinea(null);
  if (TACTIL) $("searchInput").blur(); // cierra el teclado del celular
  if (estado.modo === "grupo") buscarPorGrupo();
  else if (estado.modo === "materia") buscarPorMateria();
  else buscarPorMaestro();
}

/** Botones "¿Quisiste decir…?". */
function sugerencias(modo, opciones) {
  if (!opciones.length) return "";
  const botones = opciones
    .map((op) => `<button type="button" class="sugerencia" data-sugerencia="${escapar(modo)}" data-valor="${escapar(op)}">${escapar(op)}</button>`)
    .join("");
  return `<p class="sugerencia-titulo">¿Quisiste decir…?</p><div class="sugerencia-lista">${botones}</div>`;
}

function sinResultados(mensaje, htmlSugerencias = "") {
  $("result").innerHTML = `<p class='placeholder'>${mensaje}</p>${htmlSugerencias}`;
  if (estado.visor) {
    estado.visor.limpiarResaltado();
    estadoMapa(AYUDA_MAPA);
  }
}

function buscarPorGrupo() {
  const texto = limpiarGrupo($("searchInput").value);
  if (!texto) {
    $("result").innerHTML = "<p class='placeholder'>Escribe un número de grupo.</p>";
    return;
  }
  const grupos = estado.gruposOrdenados.filter((g) => g.grupo === texto);
  const grupo = grupos[0];
  if (!grupo) {
    let parecidos = estado.gruposOrdenados.filter((g) => g.grupo.startsWith(texto));
    if (!parecidos.length) {
      parecidos = [...estado.gruposOrdenados].sort(
        (a, b) => Math.abs(a.grupo - texto) - Math.abs(b.grupo - texto)
      );
    }
    sinResultados(`No se encontró el grupo ${escapar(texto)}.`, sugerencias("grupo", parecidos.slice(0, 6).map((g) => g.grupo)));
    return;
  }
  $("searchInput").value = grupo.grupo;
  if (grupos.length > 1) {
    // El mismo número de grupo con varias materias o salones en el PDF: se muestran todas.
    $("result").innerHTML = `
      <p>El grupo <strong>${escapar(grupo.grupo)}</strong> tiene <strong>${grupos.length}</strong> clases.</p>
      <div class="clase-lista">${grupos.map((g) => tarjetaClase(g)).join("")}</div>
      ${botonCompartir(`Grupo ${grupo.grupo}`, { grupo: grupo.grupo })}`;
    ubicarSalones(grupos.map((g) => g.salon), `Grupo ${grupo.grupo}`);
    return;
  }
  renderizarGrupo(grupo);
  ubicarSalon(grupo.salon);
}

function buscarPorMateria() {
  const texto = $("searchInput").value;
  if (!plano(texto)) {
    mostrarMaterias("");
    $("result").innerHTML = "<p class='placeholder'>Elige una materia de la lista.</p>";
    return;
  }
  const exacta = estado.materias.find((m) => plano(m) === plano(texto));
  const candidatas = exacta ? [exacta] : filtrarMaterias(texto);
  if (candidatas.length !== 1) {
    sinResultados(
      candidatas.length
        ? `Hay ${candidatas.length} materias que coinciden con “${escapar(texto)}”.`
        : `No se encontró la materia “${escapar(texto)}”.`,
      sugerencias("materia", (candidatas.length ? candidatas : masParecidos(texto, estado.materias, 5)).slice(0, 8))
    );
    return;
  }

  const materia = candidatas[0];
  $("searchInput").value = materia;
  const grupos = estado.gruposOrdenados.filter((g) => g.materia === materia);
  const porProfesor = new Map();
  for (const g of grupos) {
    if (!porProfesor.has(g.profesor)) porProfesor.set(g.profesor, []);
    porProfesor.get(g.profesor).push(g);
  }
  const salones = [...new Set(grupos.map((g) => g.salon))].sort();
  const bloques = [...porProfesor.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "es"))
    .map(([profesor, lista]) => `
      <section class="materia-profesor">
        <h3>${escapar(profesor)} <span>${lista.length} grupo${lista.length === 1 ? "" : "s"}</span></h3>
        <div class="clase-lista">${lista.map((g) => tarjetaClase(g)).join("")}</div>
      </section>`)
    .join("");

  $("result").innerHTML = `
    <div class="ficha-grupo"><span class="ficha-materia ficha-materia-grande">${escapar(materia)}</span></div>
    <p><strong>${grupos.length}</strong> grupo(s) · <strong>${porProfesor.size}</strong> profesor(es) · clave ${escapar(grupos[0]?.clave || "—")}</p>
    <p class="salones-chips">${salones.map((s) => `<span class="clase-salon">${escapar(nombreSalon(s))}</span>`).join(" ")}</p>
    ${bloques}`;

  ubicarSalones(salones, `${materia} · ${salones.length} salón(es)`);
}

function buscarPorMaestro() {
  const texto = $("searchInput").value;
  if (!plano(texto)) {
    $("result").innerHTML = "<p class='placeholder'>Escribe o elige un nombre de profesor.</p>";
    return;
  }
  const clases = estado.gruposOrdenados.filter((g) => coincidePalabras(g.profesor, texto));
  if (!clases.length) {
    sinResultados(
      `No se encontraron clases para “${escapar(texto)}”.`,
      sugerencias("maestro", masParecidos(texto, estado.nombresProfesores, 5))
    );
    return;
  }
  const nombres = [...new Set(clases.map((c) => c.profesor))];
  const correo = nombres.length === 1 ? correoProfesor(nombres[0]) : "";
  $("result").innerHTML = `
    <p><strong>${clases.length}</strong> clase(s) encontrada(s) para “${escapar(texto)}”.</p>
    ${correo ? `<p class="correo-linea">Correo: ${correo}</p>` : ""}
    <div class="clase-lista">${clases.map((c) => tarjetaClase(c)).join("")}</div>`;

  if (nombres.length === 1) {
    marcarProfesorEnLinea(nombres[0]);
    const salones = [...new Set(clases.map((c) => c.salon))];
    ubicarSalones(salones, `${nombres[0]} · ${salones.length} salón(es)`);
  }
}

/** Tarjeta de una clase. */
function tarjetaClase(clase, extra = "", etiqueta = nombreSalon(clase.salon), meta = `${clase.profesor} · ${horarioTexto(clase) || "Horario pendiente"}`) {
  return `
    <article class="clase-card">
      <div class="clase-head">
        <button type="button" class="clase-grupo" data-grupo="${escapar(clase.grupo)}">${escapar(clase.grupo)}</button>
        <span class="clase-salon">${escapar(etiqueta)}</span>
      </div>
      <p class="clase-materia">${escapar(clase.materia)}</p>
      <p class="clase-meta">${escapar(meta)}${extra}</p>
    </article>`;
}

/** "Hoy", "En curso" o "Terminó" para una sesión de hoy. */
function estadoSesion(s) {
  const { dia, minutos } = ahora();
  const r = rango(s.hora);
  if (s.dia !== dia || !r) return "";
  if (minutos < r[0]) return `<span class="estado-sesion prox">Hoy</span>`;
  if (minutos < r[1]) return `<span class="estado-sesion curso">En curso</span>`;
  return `<span class="estado-sesion fin">Terminó</span>`;
}

function renderizarGrupo(grupo) {
  const sesiones = (grupo.sesiones || [])
    .map((s) => `<li>${escapar(DIAS_LARGO[s.dia] || s.dia)} · ${escapar(s.hora)} ${estadoSesion(s)}</li>`)
    .join("");
  const aviso = estado.salones[grupo.salon]
    ? ""
    : `<p class="aviso">Este salón no aparece en el modelo 3D. Revisa que exista
       un sólido con su nombre en el DXF y vuelve a ejecutar generar_modelo.py.</p>`;
  $("result").innerHTML = `
    <div class="ficha-grupo">
      <span class="grupo-codigo">${escapar(grupo.grupo)}</span>
      <span class="ficha-materia">${escapar(grupo.materia)}</span>
    </div>
    <dl class="ficha-grid">
      <dt>Clave</dt><dd>${escapar(grupo.clave)}</dd>
      <dt>Profesor</dt><dd>${escapar(grupo.profesor)}${correoProfesor(grupo.profesor) ? `<br>${correoProfesor(grupo.profesor)}` : ""}</dd>
      <dt>Salón</dt><dd>${escapar(nombreSalon(grupo.salon))}</dd>
      <dt>Tipo</dt><dd>${escapar(grupo.tipo || "—")}${grupo.cupo ? ` · Cupo ${escapar(grupo.cupo)}` : ""}</dd>
    </dl>
    <ul class="sesion-lista">${sesiones || "<li>Horario pendiente</li>"}</ul>
    ${aviso}
    ${botonCompartir(`Grupo ${grupo.grupo}`, { grupo: grupo.grupo })}`;
}

// ---------- secciones: Grupos Estudiantiles / Servicios para Alumnos ----------

/** Cambia de pestaña; con `conservarMapa`, Búsqueda no regresa el mapa a la vista inicial. */
function cambiarSeccion(seccion, conservarMapa = false) {
  estado.seccion = seccion;
  document.querySelectorAll(".seccionBtn").forEach((btn) => {
    const activo = btn.dataset.seccion === seccion;
    btn.classList.toggle("activo", activo);
    btn.setAttribute("aria-selected", String(activo));
  });
  $("tituloBusqueda").textContent = SECCIONES[seccion].titulo;
  $("seccionBusqueda").hidden = seccion !== "busqueda";
  $("seccionLista").hidden = seccion === "busqueda";
  ocultarAutocompletado();
  $("leyendaAreas").hidden = false;

  if (seccion === "busqueda") {
    $("atrasBtn").hidden = true; // "Atrás" es de la ficha de un grupo o servicio
    if (!conservarMapa) limpiarMapa();
    return;
  }
  $("filtroSeccion").value = "";
  $("filtroSeccion").placeholder = SECCIONES[seccion].filtro;
  volverALista();
}

/** Lista de grupos o servicios (sin ficha abierta) con todos sus lugares resaltados en el mapa. */
function volverALista() {
  verFicha(false);
  renderListaSeccion();
  const seccion = estado.seccion;
  const ids = estado.secciones[seccion].flatMap(areasDe).filter((id) => estado.areasPorId[id]);
  if (ids.length) ubicarSalones(ids, `${SECCIONES[seccion].titulo} · ${ids.length} lugar(es)`);
}

/** Con una ficha abierta se oculta la lista y aparece "Atrás". */
function verFicha(abierta) {
  $("detalleSeccion").hidden = !abierta;
  $("listaSeccion").hidden = abierta;
  $("filtroSeccion").hidden = abierta;
  $("atrasBtn").hidden = !abierta;
  $("leyendaAreas").hidden = false;
}

/** Áreas del mapa de un grupo o servicio: la lista "areas" o, si no la tiene, su "area". */
function areasDe(item) {
  return item.areas?.length ? item.areas : [item.area];
}

function datosLugar(item) {
  const area = estado.areasPorId[item.area];
  return {
    area,
    piso: area ? area.ubicacion || nombreNivel(area.nivel) : "Ubicación pendiente",
    salon: area?.codigo ? `Salón ${area.codigo}` : "",
  };
}

function renderListaSeccion() {
  const seccion = estado.seccion;
  if (seccion === "busqueda") return;
  const todos = estado.secciones[seccion];
  const filtro = $("filtroSeccion").value;
  const items = plano(filtro)
    ? todos.filter((item) => coincidePalabras(`${item.nombre} ${item.significado || ""} ${item.actividades || ""} ${item.area} ${item.descripcion || ""}`, filtro))
    : todos;

  if (!todos.length) {
    $("listaSeccion").innerHTML = `<p class="placeholder">Aún no hay ${SECCIONES[seccion].vacio} registrados.</p>`;
  } else if (!items.length) {
    $("listaSeccion").innerHTML = `<p class="placeholder">Nada coincide con “${escapar(filtro)}”.</p>`;
  } else {
    $("listaSeccion").innerHTML = items
      .map((item) => {
        const { salon } = datosLugar(item);
        return `
          <button type="button" class="clase-card seccion-card" data-area="${escapar(item.area)}">
            <span class="clase-head">
              <span class="seccion-nombre">${escapar(tituloSeccion(item))}</span>
              ${salon ? `<span class="clase-salon">${escapar(salon)}</span>` : ""}
            </span>
            <span class="clase-meta">${escapar(item.actividades || item.descripcion || "Información pendiente")}</span>
          </button>`;
      })
      .join("");
  }
}

// shortcut: dos o más personas se reconocen por la coma, la "y" o la "e" entre sus nombres; si un apellido llega a llevar "y", guardar los responsables en una lista.
const VARIOS = /,| [ye] /;

/** Actividades, descripción (o leyenda para unirse), enlace a su página, responsable, contacto y horario de un grupo o servicio (los vacíos no se muestran). */
function fichaSeccion(item, esGrupo) {
  const campos = [
    [!esGrupo ? "Responsable" : VARIOS.test(item.responsable) ? "Docentes responsables" : "Docente responsable", item.responsable],
    ["Contacto", item.contacto],
    ["Horario", item.horario],
  ].filter(([, valor]) => valor);
  return `
    ${item.actividades ? `<p>${escapar(item.actividades)}</p>` : ""}
    ${item.descripcion ? `<p>${enlazar(item.descripcion)}</p>` : item.web ? "" : `<p class="placeholder">Información pendiente: se agregará próximamente.</p>`}
    ${item.web ? `<p>${enlazar(item.web, "Abrir página web")}</p>` : ""}
    ${campos.length ? `<dl class="ficha-grid">${campos.map(([k, v]) => `<dt>${k}</dt><dd>${enlazar(v)}</dd>`).join("")}</dl>` : ""}
    ${esGrupo ? "" : `<p class="nota-servicio">Nota: ${NOTA_SERVICIOS}</p>`}`;
}

/** "IASE - Investigación Aplicada de Sistemas Eléctricos" (solo el nombre si no tiene siglas). */
function tituloSeccion(item) {
  return item.significado ? `${item.nombre} - ${item.significado}` : item.nombre;
}

/** Grupo o servicio que ocupa un área del mapa: [sección, datos] o undefined. */
function seccionDeArea(id) {
  for (const seccion of ["grupos", "servicios"]) {
    const item = estado.secciones[seccion].find((x) => areasDe(x).includes(id));
    if (item) return [seccion, item];
  }
}

// ---------- compartir lo que se está viendo ----------

/** Opción "Compartir “…”" al final de una ficha: enlace que abre la página en ese grupo, salón o servicio. */
function botonCompartir(nombre, parametros) {
  const enlace = `${location.origin}${location.pathname}?${new URLSearchParams(parametros)}`;
  return `<button type="button" class="compartir-ficha" data-enlace="${escapar(enlace)}" data-nombre="${escapar(nombre)}">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="5" cy="12" r="3"/><circle cx="18" cy="5" r="3"/><circle cx="18" cy="19" r="3"/><path d="M5 12l13-7M5 12l13 7"/></svg>
      Compartir “${escapar(nombre)}”
    </button>
    <span class="compartir-ficha-aviso" role="status"></span>`;
}

async function compartirFicha(boton) {
  const { enlace, nombre } = boton.dataset;
  const aviso = boton.nextElementSibling;
  // En el celular se abre el menú de compartir del teléfono (WhatsApp, correo…); en computadora se copia el enlace.
  if (TACTIL && navigator.share) {
    try {
      await navigator.share({ title: `MICE L3 · ${nombre}`, url: enlace });
      return;
    } catch (e) {
      if (e.name === "AbortError") return; // la persona cerró el menú
    }
  }
  try {
    await navigator.clipboard.writeText(enlace);
    aviso.textContent = "Enlace copiado";
  } catch {
    // Navegadores sin permiso de portapapeles: se copia desde un campo temporal.
    const campo = Object.assign(document.createElement("textarea"), { value: enlace });
    document.body.appendChild(campo);
    campo.select();
    aviso.textContent = document.execCommand("copy") ? "Enlace copiado" : enlace;
    campo.remove();
  }
}

function mostrarDetalleSeccion(id) {
  const item = estado.secciones[estado.seccion].find((x) => areasDe(x).includes(id));
  if (!item) return;
  const { area, piso, salon } = datosLugar(item);
  verFicha(true);
  $("detalleSeccion").innerHTML = `
    <div class="ficha-grupo"><span class="ficha-materia ficha-materia-grande">${escapar(tituloSeccion(item))}</span></div>
    ${salon ? `<p>${escapar(salon)}</p>` : ""}
    ${fichaSeccion(item, estado.seccion === "grupos")}
    ${botonCompartir(item.nombre, { [estado.seccion === "grupos" ? "grupoest" : "servicio"]: item.nombre })}`;
  // En pantallas bajas la leyenda de colores se oculta para que la ficha quepa sin barra de desplazamiento.
  const panel = document.querySelector(".panel-busqueda");
  $("leyendaAreas").hidden = panel.scrollHeight > panel.clientHeight;
  document.querySelectorAll(".seccion-card").forEach((c) => c.classList.toggle("activa", c.dataset.area === item.area));
  const varias = areasDe(item).filter((a) => estado.areasPorId[a]);
  if (varias.length > 1 && estado.visor) {
    // Servicio en varios pisos (Kit LEM): se iluminan todas sus áreas.
    ubicarSalones(varias, `${item.nombre} · ${varias.length} lugares`);
  } else if (area && estado.visor) {
    estado.visor.enfocarSalon(area.id);
    marcarNivelActivo(String(area.nivel));
    marcarVistaActiva(null);
    estadoMapa(`${item.nombre} · ${piso}`);
  }
}

/** Mapa a la vista inicial, sin resaltados ni pisos separados. */
function limpiarMapa() {
  if (!estado.visor) return;
  if (estado.separado) {
    estado.separado = false;
    estado.visor.separar(false);
  }
  estado.visor.verEdificio();
  actualizarBotonesVisor();
  marcarNivelActivo("todos");
  marcarVistaActiva("entrada");
  estadoMapa(TEXTO_INICIO);
}

function limpiarBusqueda() {
  if (estado.seccion !== "busqueda") {
    $("filtroSeccion").value = "";
    verFicha(false);
    renderListaSeccion();
    limpiarMapa();
    enfocar($("filtroSeccion"));
    return;
  }
  $("searchInput").value = "";
  ocultarAutocompletado();
  $("result").innerHTML = SIN_BUSQUEDA;
  marcarProfesorEnLinea(null);
  limpiarMapa();
  if (window.location.search) history.replaceState(null, "", window.location.pathname);
  enfocar($("searchInput"));
}

// ---------- clases a una hora ----------

function clasesAhora() {
  if (!estado.grupos.length) return;
  marcarProfesorEnLinea(null);
  ocultarAutocompletado();
  const dia = diaConsulta();
  const minutos = minutosConsulta();
  const elegida = estado.horaElegida !== null;
  const hoy = sesionesDelDia(dia);
  const enCurso = enCursoA(hoy, minutos);
  const siguienteInicio = hoy.find((s) => s.inicio > minutos)?.inicio;
  const siguientes = siguienteInicio === undefined ? [] : hoy.filter((s) => s.inicio === siguienteInicio);
  const aEsaHora = elegida ? "a esa hora" : "en curso";

  const tarjetas = (lista, conFin) =>
    lista
      .map((s) => tarjetaClase(s.grupo, ` · <strong>${conFin ? `termina ${formatoHora(s.fin)}` : `empieza ${formatoHora(s.inicio)}`}</strong>`))
      .join("");

  let html = `<div class="ficha-grupo"><span class="ficha-materia ficha-materia-grande">${
    elegida ? `Clases a las ${formatoHora(minutos)}` : "Clases en este momento"
  }</span></div>
    <p>${escapar(DIAS_LARGO[dia])} · ${formatoHora(minutos)}${textoElegido()}</p>`;
  if (!hoy.length) {
    html += `<p class="placeholder">${estado.diaElegido ? "Ese día" : "Hoy"} no hay clases registradas en el L3.</p>`;
  } else if (enCurso.length) {
    html += `<p><strong>${enCurso.length}</strong> clase(s) ${aEsaHora}.</p><div class="clase-lista">${tarjetas(enCurso, true)}</div>`;
  } else {
    html += `<p class="placeholder">No hay clases ${elegida ? "a esa hora" : "en este momento"}.</p>`;
  }
  if (siguientes.length) {
    html += `<p class="sugerencia-titulo">Siguientes, a las ${formatoHora(siguienteInicio)}</p>
      <div class="clase-lista">${tarjetas(siguientes, false)}</div>`;
  }
  $("result").innerHTML = html;

  const resaltar = (enCurso.length ? enCurso : siguientes).map((s) => s.grupo.salon);
  if (resaltar.length) {
    ubicarSalones(
      resaltar,
      enCurso.length
        ? `${enCurso.length} clase(s) ${elegida ? `a las ${formatoHora(minutos)}` : "en curso"}`
        : `Siguientes clases · ${formatoHora(siguienteInicio)}`
    );
  } else {
    estado.visor?.limpiarResaltado();
  }
}

// ---------- línea del tiempo (encabezado) ----------

function posicionEnLinea(minutos) {
  return Math.min(Math.max((minutos - INICIO_DIA) / (FIN_DIA - INICIO_DIA), 0), 1) * 100;
}

function iniciarLineaTiempo() {
  const pista = $("ltPista");
  const fragmento = document.createDocumentFragment();

  // Marcas de hora (número cada 2 h).
  for (let h = 7; h <= 24; h++) {
    const marca = document.createElement("span");
    const mayor = (h - 7) % 2 === 0;
    marca.className = mayor ? "lt-tick lt-tick-mayor" : "lt-tick";
    marca.style.left = `${posicionEnLinea(h * 60)}%`;
    if (mayor || h === 24) marca.dataset.hora = String(h);
    fragmento.appendChild(marca);
  }

  pista.appendChild(fragmento);

  // La lista va de lunes a viernes; en fin de semana se agrega hoy para que el cuadro no quede vacío.
  const hoy = ahora().dia;
  if (hoy === "SAB" || hoy === "DOM") $("ltDia").add(new Option(DIAS_LARGO[hoy], hoy));

  dibujarBarras();
  actualizarLineaTiempo();
  setInterval(actualizarLineaTiempo, 30000);
}

/** Barras de cuántas clases hay cada media hora en el día consultado. */
function dibujarBarras() {
  const pista = $("ltPista");
  pista.querySelectorAll(".lt-barra").forEach((barra) => barra.remove());
  const hoy = sesionesDelDia(diaConsulta());
  const conteo = [];
  for (let t = INICIO_DIA; t < FIN_DIA; t += 30) conteo.push(enCursoA(hoy, t + 15).length);
  const maximo = Math.max(1, ...conteo);
  conteo.forEach((n, i) => {
    if (!n) return;
    const inicio = INICIO_DIA + i * 30;
    const barra = document.createElement("span");
    barra.className = "lt-barra";
    barra.style.left = `${posicionEnLinea(inicio)}%`;
    barra.style.width = `${posicionEnLinea(inicio + 30) - posicionEnLinea(inicio)}%`;
    barra.style.height = `${20 + 80 * (n / maximo)}%`;
    barra.title = `${formatoHora(inicio)} · ${n} clase(s)`;
    pista.appendChild(barra);
  });
  dibujarClasesProfesor();
}

// ---------- clases del profesor en la línea del tiempo ----------

/** Sesiones del profesor marcado en el día consultado. */
function sesionesProfesor(dia = diaConsulta()) {
  const nombre = estado.lineaProfesor?.nombre;
  return nombre ? sesionesDelDia(dia).filter((s) => s.grupo.profesor === nombre) : [];
}

/**
 * Marca (o quita, con null) las clases de un profesor en la línea del tiempo.
 * Si el día consultado no tiene clases suyas, pasa al siguiente día en que da clase.
 */
function marcarProfesorEnLinea(nombre) {
  if (!nombre) {
    if (!estado.lineaProfesor) return;
    estado.lineaProfesor = null;
  } else {
    estado.lineaProfesor = { nombre, grupo: null };
    const dias = new Set(DIAS.filter((d) => sesionesProfesor(d).length));
    const hoy = DIAS.indexOf(ahora().dia);
    if (dias.size && !dias.has(diaConsulta())) {
      const dia = [1, 2, 3, 4, 5, 6].map((k) => DIAS[(hoy + k) % 7]).find((d) => dias.has(d));
      estado.diaElegido = dia;
      $("ltResetBtn").hidden = false;
    }
  }
  dibujarBarras();
  actualizarLineaTiempo();
}

function dibujarClasesProfesor() {
  const pista = $("ltPista");
  pista.querySelectorAll(".lt-prof").forEach((b) => b.remove());
  const sesiones = sesionesProfesor();
  pista.classList.toggle("con-profesor", Boolean(estado.lineaProfesor));
  for (const s of sesiones) {
    const g = s.grupo;
    const izq = posicionEnLinea(s.inicio);
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = `lt-prof${g.grupo === estado.lineaProfesor.grupo ? " activa" : ""}`;
    boton.dataset.grupo = g.grupo;
    boton.title = ""; // sin el aviso de la pista: la etiqueta propia ya lo explica
    boton.style.left = `${izq}%`;
    boton.style.width = `${posicionEnLinea(s.fin) - izq}%`;
    const horas = `${formatoHora(s.inicio)}–${formatoHora(s.fin)}`;
    boton.setAttribute("aria-label", `Grupo ${g.grupo}, ${g.materia}, ${horas}, salón ${g.salon}`);
    const etiqueta = document.createElement("span");
    // En las orillas la etiqueta se alinea hacia adentro para no salirse de la pantalla.
    etiqueta.className = `lt-etiqueta${izq < 15 ? " izq" : izq > 80 ? " der" : ""}`;
    etiqueta.innerHTML = `<b>Grupo ${escapar(g.grupo)}</b> · ${horas}<br>${escapar(nombreSalon(g.salon))}`;
    boton.appendChild(etiqueta);
    pista.appendChild(boton);
  }
}

/** Elige el grupo de una clase marcada: muestra su ficha y su salón, y conserva las demás clases del profesor. */
function elegirGrupoDeLinea(grupo) {
  if (estado.seccion !== "busqueda") cambiarSeccion("busqueda", true);
  estado.lineaProfesor.grupo = grupo;
  cambiarModo("grupo");
  $("searchInput").value = grupo;
  buscar(true);
  dibujarClasesProfesor();
}

function conectarClasesProfesor() {
  const pista = $("ltPista");
  let tipo = "mouse";
  const cerrarEtiquetas = () => pista.querySelectorAll(".lt-prof.mostrar").forEach((b) => b.classList.remove("mostrar"));
  pista.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".lt-prof")) return;
    tipo = e.pointerType;
    e.stopPropagation(); // tocar una clase no mueve el marcador de la hora
  }, true);
  pista.addEventListener("click", (e) => {
    const boton = e.target.closest(".lt-prof");
    if (!boton) return;
    // Con el dedo no hay "pasar encima": el primer toque muestra la etiqueta y el segundo elige el grupo.
    if (tipo === "touch" && !boton.classList.contains("mostrar")) {
      cerrarEtiquetas();
      boton.classList.add("mostrar");
      return;
    }
    elegirGrupoDeLinea(boton.dataset.grupo);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".lt-prof")) cerrarEtiquetas();
  });
}

function textoElegido() {
  if (estado.diaElegido) return " (elegidos)";
  return estado.horaElegida !== null ? " (hora elegida)" : "";
}

function actualizarLineaTiempo() {
  const dia = diaConsulta();
  const { minutos: actual } = ahora();
  const otroDia = estado.diaElegido !== null;
  const elegida = estado.horaElegida !== null;
  const minutos = elegida ? estado.horaElegida : actual;
  const dentro = minutos >= INICIO_DIA && minutos <= FIN_DIA;
  $("ltMarca").style.left = `${posicionEnLinea(minutos)}%`;
  $("ltMarca").classList.toggle("fuera", !dentro);
  $("ltPasado").style.width = otroDia ? "0" : `${posicionEnLinea(actual)}%`;
  $("ltAhora").style.left = `${posicionEnLinea(actual)}%`;
  $("ltAhora").hidden = !elegida || otroDia;
  $("ltHora").textContent = `${DIAS_LARGO[dia]} · ${formatoHora(minutos)}${textoElegido()}`;
  $("ltDia").value = dia;
  $("ltHoraInput").placeholder = formatoHora(actual);
  const n = enCursoA(sesionesDelDia(dia), minutos).length;
  $("ltEstado").textContent = dentro ? `${n} clase(s) ${elegida ? "a esa hora" : "en curso"}` : "Fuera del horario del L3";
  if (estado.lineaProfesor) {
    const p = sesionesProfesor(dia).length;
    $("ltEstado").textContent = p ? `${p} clase(s) del profesor este día` : "El profesor no da clase este día";
  }
}

function elegirHora(minutos, mostrar = false) {
  estado.horaElegida = Math.min(Math.max(Math.round(minutos / 5) * 5, INICIO_DIA), FIN_DIA - 5);
  $("ltHoraInput").value = formatoHora(estado.horaElegida);
  $("ahoraBtn").textContent = "Clases a esa hora";
  $("ltResetBtn").hidden = false;
  actualizarLineaTiempo();
  if (mostrar) mostrarClasesDeLaLinea();
}

/** Cambia el día consultado y conserva la hora que se está viendo. */
function elegirDia(dia) {
  estado.diaElegido = dia === ahora().dia ? null : dia;
  if (estado.lineaProfesor) {
    $("ltResetBtn").hidden = estado.diaElegido === null && estado.horaElegida === null;
    dibujarBarras();
    actualizarLineaTiempo();
    return;
  }
  dibujarBarras();
  elegirHora(minutosConsulta(), true);
}

function volverAhora(mostrar = false) {
  estado.horaElegida = null;
  estado.diaElegido = null;
  dibujarBarras();
  $("ltHoraInput").value = "";
  $("ahoraBtn").textContent = "Clases en este momento";
  $("ltResetBtn").hidden = true;
  actualizarLineaTiempo();
  if (mostrar) mostrarClasesDeLaLinea();
}

function mostrarClasesDeLaLinea() {
  if (estado.seccion !== "busqueda") cambiarSeccion("busqueda");
  clasesAhora();
}

/** Lista con las horas en que empiezan clases el día consultado (o en la semana, si ese día no hay). */
function mostrarOpcionesHora() {
  const { minutos } = ahora();
  const dia = diaConsulta();
  let sesiones = sesionesDelDia(dia);
  let nota = estado.diaElegido ? `Horarios del ${DIAS_LARGO[dia].toLowerCase()}` : "Horarios de hoy";
  if (!sesiones.length) {
    sesiones = ["LUN", "MAR", "MIE", "JUE", "VIE", "SAB"].flatMap(sesionesDelDia);
    nota = `${estado.diaElegido ? "Ese día" : "Hoy"} no hay clases · horarios de la semana`;
  }
  const conteo = new Map();
  for (const s of sesiones) conteo.set(s.inicio, (conteo.get(s.inicio) || 0) + 1);
  const opciones = [...conteo.keys()]
    .sort((a, b) => a - b)
    .map((m) => {
      const n = conteo.get(m);
      const clases = `lt-opcion${m === estado.horaElegida ? " activa" : ""}${!estado.diaElegido && m < minutos ? " pasada" : ""}`;
      return `<button type="button" class="${clases}" data-minutos="${m}">
        <span>${formatoHora(m)}</span><span class="lt-opcion-n">${n} clase${n === 1 ? "" : "s"}</span>
      </button>`;
    })
    .join("");
  $("ltOpciones").innerHTML = `
    <p class="lt-opciones-titulo">${nota}</p>
    <button type="button" class="lt-opcion lt-opcion-ahora" data-minutos="ahora">Ahora · ${formatoHora(minutos)}</button>
    ${opciones}`;
  $("ltOpciones").hidden = false;
}

function ocultarOpcionesHora() {
  $("ltOpciones").hidden = true;
}

function conectarLineaTiempo() {
  const pista = $("ltPista");
  const minutosEn = (e) => {
    const r = pista.getBoundingClientRect();
    return INICIO_DIA + Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * (FIN_DIA - INICIO_DIA);
  };

  // Arrastrar el marcador o hacer clic en la línea.
  let arrastrando = false;
  pista.addEventListener("pointerdown", (e) => {
    arrastrando = true;
    pista.classList.add("arrastrando");
    pista.setPointerCapture(e.pointerId);
    elegirHora(minutosEn(e));
  });
  pista.addEventListener("pointermove", (e) => {
    if (arrastrando) elegirHora(minutosEn(e));
  });
  const soltar = () => {
    if (!arrastrando) return;
    arrastrando = false;
    pista.classList.remove("arrastrando");
    mostrarClasesDeLaLinea();
  };
  pista.addEventListener("pointerup", soltar);
  pista.addEventListener("pointercancel", soltar);

  // Cuadro de hora: se escribe HH:MM / HHMM o se elige de la lista.
  const cuadro = $("ltHoraInput");
  const aplicarCuadro = () => {
    const valor = cuadro.value.trim();
    if (!valor) {
      if (estado.horaElegida !== null) volverAhora(true);
      return;
    }
    const m = /^(\d{1,2})(?::?(\d{2}))?$/.exec(valor);
    if (!m || Number(m[1]) > 23 || Number(m[2] || 0) > 59) {
      cuadro.classList.add("error");
      return;
    }
    cuadro.classList.remove("error");
    ocultarOpcionesHora();
    elegirHora(Number(m[1]) * 60 + Number(m[2] || 0), true);
  };
  cuadro.addEventListener("focus", mostrarOpcionesHora);
  cuadro.addEventListener("click", mostrarOpcionesHora);
  cuadro.addEventListener("input", () => cuadro.classList.remove("error"));
  cuadro.addEventListener("change", aplicarCuadro);
  cuadro.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      aplicarCuadro();
      cuadro.blur();
    } else if (e.key === "Escape") {
      ocultarOpcionesHora();
      cuadro.blur();
    }
  });
  $("ltOpciones").addEventListener("click", (e) => {
    const opcion = e.target.closest("[data-minutos]");
    if (!opcion) return;
    ocultarOpcionesHora();
    if (opcion.dataset.minutos === "ahora") volverAhora(true);
    else elegirHora(Number(opcion.dataset.minutos), true);
  });
  $("ltFlecha").addEventListener("click", () => ($("ltOpciones").hidden ? mostrarOpcionesHora() : ocultarOpcionesHora()));
  $("ltDia").addEventListener("change", (e) => elegirDia(e.target.value));
  $("ltResetBtn").addEventListener("click", () => volverAhora(true));
  conectarClasesProfesor();
}

// ---------- correo del profesor ----------

/** Enlace al correo del profesor (si lo tiene registrado); vacío si no. */
function correoProfesor(nombre) {
  const correo = estado.profesores.find((p) => p.nombre === nombre)?.correo;
  if (!correo) return "";
  const [usuario, dominio] = escapar(correo).split("@");
  // Corte de línea permitido solo después de la @.
  return `<a class="correo-profesor" href="mailto:${escapar(correo)}">${usuario}@<wbr>${dominio || ""}</a>`;
}

// ---------- visor 3D ----------

async function iniciarVisor(VisorEdificio, modelo, fachada) {
  // El visor se arma por partes (sin trabar la intro); los botones lo usan solo cuando ya está listo.
  const visor = new VisorEdificio($("visor3d"));
  visor.alSeleccionar = mostrarArea;
  visor.alCambiar2D = actualizarBotonesVisor;
  await visor.cargar(modelo, fachada);
  estado.visor = visor;
  if (fachada) estado.ventanas = true;
  else $("ventanasBtn").hidden = true;
  if (new URLSearchParams(window.location.search).has("depurar")) window.miceVisor = estado.visor;

  $("visorEstado")?.remove();
  actualizarBotonesVisor();
  marcarNivelActivo("todos");
  marcarVistaActiva("entrada");
  estadoMapa(TEXTO_INICIO);
}

function ubicarSalon(codigo) {
  if (!estado.visor || !codigo) return;
  const nivel = nivelDeSalon(codigo) ?? estado.areasPorId[codigo]?.nivel ?? null;
  if (estado.visor.enfocarSalon(codigo)) {
    marcarNivelActivo(String(nivel));
    marcarVistaActiva(null);
    estadoMapa(`Salón ${codigo} · ${nombreNivel(nivel)}`);
  } else if (nivel !== null) {
    estado.visor.enfocarNivel(nivel);
    marcarNivelActivo(String(nivel));
    estadoMapa(`Salón ${codigo} no está en el modelo · ${nombreNivel(nivel)}`);
  } else {
    estado.visor.verEdificio();
    marcarNivelActivo("todos");
  }
}

/** Ilumina varios salones (códigos L30010 o ids de área como "Grupo IDEA"). */
function ubicarSalones(codigos, mensaje) {
  if (!estado.visor) return;
  const areaDe = (c) => estado.salones[c] || estado.areasPorId[c];
  const unicos = [...new Set(codigos)].filter(areaDe);
  if (unicos.length <= 1) {
    if (unicos.length) ubicarSalon(unicos[0]);
    return;
  }
  estado.visor.enfocarSalones(unicos);
  estado.separado = estado.visor.separado;
  actualizarBotonesVisor();
  const niveles = [...new Set(unicos.map((c) => areaDe(c).nivel))];
  marcarNivelActivo(niveles.length === 1 ? String(niveles[0]) : "todos");
  marcarVistaActiva(null);
  estadoMapa(niveles.length === 1
    ? `${mensaje} · ${nombreNivel(niveles[0])}`
    : `${mensaje} · ${niveles.length} pisos (pisos separados)`);
}

function marcarNivelActivo(nivel) {
  document.querySelectorAll(".nivelBtn[data-nivel]").forEach((btn) => btn.classList.toggle("activo", btn.dataset.nivel === String(nivel)));
}

function marcarVistaActiva(vista) {
  document.querySelectorAll(".vistaBtn").forEach((btn) => btn.classList.toggle("activo", btn.dataset.vista === String(vista)));
}

function actualizarBotonesVisor() {
  const alternar = (id, activo, texto) => {
    const btn = $(id);
    btn.textContent = texto;
    btn.classList.toggle("activo", activo);
  };
  const modo2D = Boolean(estado.visor?.modo2D);
  alternar("plano2dBtn", modo2D, modo2D ? "Vista 3D" : "Plano 2D");
  alternar("techoBtn", estado.techoVisible, estado.techoVisible ? "Techo: sí" : "Techo: no");
  alternar("separarBtn", estado.separado, estado.separado ? "Juntar pisos" : "Separar pisos");
  if (estado.ventanas !== null) alternar("ventanasBtn", estado.ventanas, estado.ventanas ? "Ventanas: sí" : "Ventanas: no");
}

/** Ficha del área al hacer clic en el modelo 3D. */
function mostrarArea(area) {
  // Desde Grupos o Servicios: si el área es de esa pestaña se abre su ficha ahí; si no (un baño,
  // un salón), se pasa a Búsqueda para que su ficha se vea.
  const [seccion, item] = seccionDeArea(area.id) || [];
  if (estado.seccion !== "busqueda") {
    if (seccion === estado.seccion) {
      mostrarDetalleSeccion(area.id);
      return;
    }
    cambiarSeccion("busqueda", true);
  }
  marcarNivelActivo(String(area.nivel));
  marcarVistaActiva(null);
  estadoMapa(area.tipo === "bano"
    ? `${area.nombre} · descanso de la escalera`
    : `${area.codigo || estado.areasPorId[area.id]?.etiqueta || area.nombre} · ${nombreNivel(area.nivel)}`);

  const titulo = [area.codigo, area.nombre !== area.codigo ? area.nombre : null, area.alias].filter(Boolean).join(" · ");
  const subtitulo = NOMBRE_TIPO[area.tipo] || "";
  const grupos = area.codigo ? estado.gruposOrdenados.filter((g) => g.salon === area.codigo) : [];
  const lista = grupos.map((g) => tarjetaClase(g, "", horarioTexto(g) || "Horario pendiente", g.profesor)).join("");

  let cuerpo = "";
  if (area.tipo !== "bano") {
    cuerpo = grupos.length
      ? `<p><strong>${grupos.length}</strong> grupo(s) en este salón${estado.semestre ? ` (semestre ${escapar(estado.semestre)})` : ""}.</p>
         <div class="clase-lista">${lista}</div>`
      : `<p class="placeholder">No hay grupos registrados en esta área.</p>`;
  }
  $("result").innerHTML = `
    <div class="ficha-grupo">
      <span class="grupo-codigo">${escapar(titulo)}</span>
      <span class="ficha-materia">${escapar(subtitulo)}</span>
    </div>
    ${(area.descripcion || "").split("\n").filter(Boolean).map((linea) => `<p>${escapar(linea)}</p>`).join("")}
    ${item ? `<p><strong>${escapar(tituloSeccion(item))}</strong></p>${fichaSeccion(item, seccion === "grupos")}` : ""}
    ${cuerpo}
    ${botonCompartir(titulo, { salon: area.codigo || area.id })}`;
}

// ---------- errores ----------

function avisoVisor(texto) {
  const aviso = $("visorEstado");
  if (!aviso) return;
  aviso.textContent = texto;
  aviso.classList.add("error");
}

function mostrarErrorCarga(error) {
  console.error(error);
  $("result").innerHTML = `
    <p class="aviso">
      No se pudieron cargar los datos (${escapar(error?.message)}).
      Abre el proyecto con un servidor local, por ejemplo
      <code>python -m http.server 8000</code>, y visita <code>http://localhost:8000</code>.
    </p>`;
  avisoVisor("Modelo 3D no disponible.");
}
