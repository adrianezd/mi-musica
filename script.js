// Tu música en datos: estadísticas de Spotify (API con PKCE, sin servidor) y del
// historial que exportan Spotify y Apple Music (por día, mes y año).
'use strict';

var REDIRECT = location.origin + location.pathname;
var CLIENT_ID_DEFECTO = ''; // Client ID de la app de Spotify; cada usuario puede poner el suyo en Ajustes
var SCOPES = 'user-top-read user-read-recently-played playlist-read-private playlist-modify-private';
var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
var DIAS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
var RANGOS = { short_term: 'Últimas 4 semanas', medium_term: 'Últimos 6 meses', long_term: 'Último año' };

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function num(n) { return Math.round(n).toLocaleString('es-ES'); }
function horas(ms) { var m = ms / 60000; return m < 120 ? num(m) + ' min' : num(m / 60) + ' h'; }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function toast(t) { var e = $('toast'); e.textContent = t; e.classList.add('ver'); clearTimeout(toast.t); toast.t = setTimeout(function () { e.classList.remove('ver'); }, 2200); }
function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }

/* =========================================================
   SPOTIFY: inicio de sesión con PKCE y llamadas a la API
   ========================================================= */
function clientId() { return ls('mm-client-id') || CLIENT_ID_DEFECTO; }
function b64url(buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function conectar() {
  if (!clientId()) { $('ajustes').open = true; $('cid').focus(); toast('Primero pon tu Client ID de Spotify'); return; }
  var a = new Uint8Array(48); crypto.getRandomValues(a);
  var verifier = b64url(a);
  crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (h) {
    try { sessionStorage.setItem('mm-verifier', verifier); } catch (e) {}
    location.href = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
      response_type: 'code', client_id: clientId(), scope: SCOPES, redirect_uri: REDIRECT,
      code_challenge_method: 'S256', code_challenge: b64url(h)
    });
  });
}
function pedirToken(datos) {
  return fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(datos)
  }).then(function (r) { return r.json(); }).then(function (j) {
    if (!j.access_token) throw new Error(j.error_description || j.error || 'Sin token');
    var viejo = JSON.parse(ls('mm-token') || '{}');
    var t = { access: j.access_token, refresh: j.refresh_token || viejo.refresh, exp: Date.now() + (j.expires_in || 3600) * 1000 };
    ls('mm-token', JSON.stringify(t));
    return t.access;
  });
}
function canjear(code) {
  var v = ''; try { v = sessionStorage.getItem('mm-verifier') || ''; } catch (e) {}
  return pedirToken({ grant_type: 'authorization_code', code: code, redirect_uri: REDIRECT, client_id: clientId(), code_verifier: v });
}
function token(forzar) {
  var t = JSON.parse(ls('mm-token') || 'null');
  if (!t) return Promise.reject(new Error('Sin sesión'));
  if (!forzar && t.exp - 60000 > Date.now()) return Promise.resolve(t.access);
  return pedirToken({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: clientId() });
}
function api(ruta, opts, reintento) {
  opts = opts || {};
  return token(reintento === 'token').then(function (tk) {
    return fetch(/^https:/.test(ruta) ? ruta : 'https://api.spotify.com/v1' + ruta, {
      method: opts.method || 'GET',
      headers: Object.assign({ Authorization: 'Bearer ' + tk }, opts.body ? { 'Content-Type': 'application/json' } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
  }).then(function (r) {
    if (r.status === 401 && !reintento) return api(ruta, opts, 'token');
    if (r.status === 429 && reintento !== 'espera') {
      var s = +(r.headers.get('Retry-After') || 2);
      return new Promise(function (ok) { setTimeout(ok, Math.min(10, s) * 1000); }).then(function () { return api(ruta, opts, 'espera'); });
    }
    if (!r.ok) { var e = new Error('Spotify respondió ' + r.status); e.status = r.status; throw e; }
    return r.status === 204 ? null : r.json();
  });
}
function desconectar() { ls('mm-token', null); SP = null; pintarSpotify(); }

var SP = null; // datos cargados de la API
var rango = 'short_term';
function cargarSpotify() {
  $('spEstado').textContent = 'Cargando tus datos de Spotify…';
  var r = Object.keys(RANGOS);
  return Promise.all([
    api('/me'),
    Promise.all(r.map(function (k) { return api('/me/top/artists?limit=50&time_range=' + k); })),
    Promise.all(r.map(function (k) { return api('/me/top/tracks?limit=50&time_range=' + k); })),
    api('/me/player/recently-played?limit=50').catch(function () { return { items: [] }; }),
    api('/me/playlists?limit=50').catch(function () { return { items: [] }; })
  ]).then(function (x) {
    SP = { yo: x[0], artistas: {}, canciones: {}, recientes: x[3].items || [], listas: (x[4].items || []).filter(Boolean) };
    r.forEach(function (k, i) { SP.artistas[k] = x[1][i].items || []; SP.canciones[k] = x[2][i].items || []; });
    pintarSpotify();
  }).catch(function (e) {
    if (e.status === 403) $('spEstado').innerHTML = 'Spotify no deja entrar a esta cuenta. Si la app de Spotify está en modo desarrollo, añade tu correo en <b>User Management</b> del panel de desarrolladores.';
    else $('spEstado').textContent = 'No se pudo cargar: ' + e.message;
    $('spConectado').hidden = true; $('spDesconectado').hidden = false;
  });
}
function img(imgs, i) { imgs = imgs || []; var x = imgs[Math.min(i || 0, imgs.length - 1)] || imgs[0]; return x ? x.url : ''; }
function pintarSpotify() {
  var con = !!SP;
  $('spConectado').hidden = !con; $('spDesconectado').hidden = con;
  if (!con) { $('spEstado').textContent = ls('mm-token') ? '' : 'Conecta tu cuenta para ver tu top de artistas y canciones.'; return; }
  $('spEstado').textContent = '';
  $('spHola').textContent = 'Hola, ' + (SP.yo.display_name || 'oyente');
  document.querySelectorAll('[data-rango]').forEach(function (b) { b.classList.toggle('on', b.dataset.rango === rango); });
  var arts = SP.artistas[rango], cans = SP.canciones[rango];
  $('spArtistas').innerHTML = arts.slice(0, 20).map(function (a, i) {
    return '<li><span class="pos">' + (i + 1) + '</span>' + (img(a.images, 2) ? '<img src="' + img(a.images, 2) + '" alt="" loading="lazy">' : '<span class="sin-img">🎤</span>') + '<a href="' + esc(a.external_urls && a.external_urls.spotify) + '" target="_blank" rel="noopener">' + esc(a.name) + '</a></li>';
  }).join('') || '<li class="texto">Spotify aún no tiene datos de este periodo.</li>';
  $('spCanciones').innerHTML = cans.slice(0, 30).map(function (t, i) {
    return '<li><span class="pos">' + (i + 1) + '</span>' + (img(t.album && t.album.images, 2) ? '<img src="' + img(t.album.images, 2) + '" alt="" loading="lazy">' : '<span class="sin-img">🎵</span>') +
      '<span class="cl-txt"><a href="' + esc(t.external_urls && t.external_urls.spotify) + '" target="_blank" rel="noopener">' + esc(t.name) + '</a><small>' + esc((t.artists || []).map(function (a) { return a.name; }).join(', ')) + '</small></span></li>';
  }).join('') || '<li class="texto">Spotify aún no tiene datos de este periodo.</li>';
  // géneros a partir de los artistas (si Spotify los da)
  var gen = {};
  arts.forEach(function (a, i) { (a.genres || []).forEach(function (g) { gen[g] = (gen[g] || 0) + (50 - i); }); });
  var gl = Object.keys(gen).sort(function (p, q) { return gen[q] - gen[p]; }).slice(0, 10);
  $('spGenerosCaja').hidden = !gl.length;
  barras($('spGeneros'), gl.map(function (g) { return { n: g, v: gen[g] }; }), function () { return ''; });
  pintarRecientes();
  pintarSugerenciasSp();
}
function pintarRecientes() {
  var rec = SP.recientes;
  $('spRecientes').innerHTML = rec.slice(0, 15).map(function (it) {
    var d = new Date(it.played_at);
    return '<li><img src="' + img(it.track.album && it.track.album.images, 2) + '" alt="" loading="lazy"><span class="cl-txt"><b>' + esc(it.track.name) + '</b><small>' + esc((it.track.artists || []).map(function (a) { return a.name; }).join(', ')) + '</small></span><time>' + d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + '</time></li>';
  }).join('') || '<li class="texto">Sin escuchas recientes.</li>';
  // listas y álbumes desde los que más has escuchado últimamente
  var ctx = {};
  rec.forEach(function (it) { if (it.context && it.context.uri) ctx[it.context.uri] = (ctx[it.context.uri] || 0) + 1; });
  var listas = {};
  SP.listas.forEach(function (l) { listas[l.uri] = l; });
  var top = Object.keys(ctx).sort(function (p, q) { return ctx[q] - ctx[p]; }).slice(0, 8);
  $('spListasTop').innerHTML = top.map(function (u) {
    var l = listas[u], tipo = u.split(':')[1];
    var nombre = l ? l.name : tipo === 'album' ? 'Un álbum' : tipo === 'artist' ? 'Página de un artista' : tipo === 'playlist' ? 'Una lista de Spotify' : 'Otra fuente';
    return '<li>' + (l && img(l.images, 2) ? '<img src="' + img(l.images, 2) + '" alt="">' : '<span class="sin-img">' + (tipo === 'album' ? '💿' : '📃') + '</span>') + '<span class="cl-txt"><b>' + esc(nombre) + '</b><small>' + ctx[u] + ' de tus últimas ' + rec.length + ' canciones</small></span></li>';
  }).join('') || '<li class="texto">Tus últimas canciones no venían de ninguna lista.</li>';
  $('spListas').innerHTML = SP.listas.slice(0, 50).map(function (l) {
    var n = (l.tracks && l.tracks.total) != null ? l.tracks.total : (l.items && l.items.total);
    return '<li>' + (img(l.images, 2) ? '<img src="' + img(l.images, 2) + '" alt="" loading="lazy">' : '<span class="sin-img">📃</span>') + '<span class="cl-txt"><a href="' + esc(l.external_urls && l.external_urls.spotify) + '" target="_blank" rel="noopener">' + esc(l.name) + '</a><small>' + (n != null ? n + ' canciones' : '') + (l.owner && SP.yo && l.owner.id !== SP.yo.id ? ' · de ' + esc(l.owner.display_name) : '') + '</small></span></li>';
  }).join('') || '<li class="texto">No tienes listas.</li>';
  // horas a las que escuchas (de las últimas 50)
  var hh = new Array(24).fill(0);
  rec.forEach(function (it) { hh[new Date(it.played_at).getHours()]++; });
  columnas($('spHoras'), hh.map(function (v, h) { return { n: h + ' h', v: v, et: h % 6 === 0 ? h + 'h' : '' }; }), function (v) { return v + ' canciones'; });
}
function pintarSugerenciasSp() {
  var corto = {}, largo = {};
  SP.artistas.short_term.forEach(function (a) { corto[a.id] = 1; });
  SP.artistas.long_term.forEach(function (a) { largo[a.id] = 1; });
  var olvidados = SP.artistas.long_term.filter(function (a) { return !corto[a.id]; }).slice(0, 6);
  var nuevos = SP.artistas.short_term.filter(function (a) { return !largo[a.id]; }).slice(0, 6);
  var cc = {}; SP.canciones.short_term.forEach(function (t) { cc[t.id] = 1; });
  var rescatar = SP.canciones.long_term.filter(function (t) { return !cc[t.id]; }).slice(0, 8);
  var nombres = function (l) { return l.map(function (a) { return '<a href="' + esc(a.external_urls && a.external_urls.spotify) + '" target="_blank" rel="noopener">' + esc(a.name) + '</a>'; }).join(', '); };
  var h = '';
  if (olvidados.length) h += '<li><b>Vuelve a escuchar</b>: artistas de tu año que no salen en tu último mes: ' + nombres(olvidados) + '.</li>';
  if (nuevos.length) h += '<li><b>Tus nuevos descubrimientos</b>: ' + nombres(nuevos) + '. Ninguno estaba en tu top del año.</li>';
  if (rescatar.length) h += '<li><b>Canciones para rescatar</b>: ' + rescatar.map(function (t) { return '<a href="' + esc(t.external_urls && t.external_urls.spotify) + '" target="_blank" rel="noopener">' + esc(t.name) + '</a> de ' + esc(t.artists[0].name); }).join(', ') + '.</li>';
  $('spSugerencias').innerHTML = h || '<li class="texto">Escucha un poco más y aquí saldrán ideas.</li>';
}
function crearLista() {
  var cans = SP.canciones[rango];
  if (!cans.length) { toast('No hay canciones en este periodo'); return; }
  var b = $('spCrear'); b.disabled = true;
  var nombre = 'Mi top · ' + RANGOS[rango].toLowerCase() + ' · ' + new Date().toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  var cuerpo = { name: nombre, public: false, description: 'Creada con Tu música en datos' };
  api('/me/playlists', { method: 'POST', body: cuerpo })
    .catch(function () { return api('/users/' + encodeURIComponent(SP.yo.id) + '/playlists', { method: 'POST', body: cuerpo }); })
    .then(function (l) {
      var uris = { uris: cans.map(function (t) { return t.uri; }) };
      return api('/playlists/' + l.id + '/items', { method: 'POST', body: uris })
        .catch(function () { return api('/playlists/' + l.id + '/tracks', { method: 'POST', body: uris }); })
        .then(function () { toast('Lista creada en tu Spotify'); window.open(l.external_urls.spotify, '_blank'); });
    })
    .catch(function (e) { toast('No se pudo crear la lista: ' + e.message); })
    .then(function () { b.disabled = false; });
}

/* =========================================================
   HISTORIAL IMPORTADO (Spotify y Apple Music)
   Registro: { t: inicio en ms, ms: duración, tr, ar, al, p: reproducciones }
   ========================================================= */
var H = [];
function db() {
  return new Promise(function (ok, ko) {
    var r = indexedDB.open('mi-musica', 1);
    r.onupgradeneeded = function () { r.result.createObjectStore('datos'); };
    r.onsuccess = function () { ok(r.result); };
    r.onerror = function () { ko(r.error); };
  });
}
function dbLeer() { return db().then(function (d) { return new Promise(function (ok) { var q = d.transaction('datos').objectStore('datos').get('historial'); q.onsuccess = function () { ok(q.result || []); }; q.onerror = function () { ok([]); }; }); }).catch(function () { return []; }); }
function dbGuardar(v) { return db().then(function (d) { return new Promise(function (ok) { var tx = d.transaction('datos', 'readwrite'); tx.objectStore('datos').put(v, 'historial'); tx.oncomplete = ok; tx.onerror = ok; }); }).catch(function () {}); }

function csv(texto) {
  var filas = [], fila = [], campo = '', q = false;
  texto = texto.replace(/^﻿/, '');
  for (var i = 0; i < texto.length; i++) {
    var c = texto[i];
    if (q) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else q = false; }
      else campo += c;
    } else if (c === '"') q = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  var cab = filas.shift() || [];
  return filas.filter(function (f) { return f.length > 1; }).map(function (f) { var o = {}; cab.forEach(function (k, j) { o[k.trim()] = f[j]; }); return o; });
}
function col(o, nombres) { for (var i = 0; i < nombres.length; i++) if (o[nombres[i]] != null && o[nombres[i]] !== '') return o[nombres[i]]; return ''; }
function normalizar(nombre, texto) {
  var out = [];
  if (/\.json$/i.test(nombre)) {
    var arr = JSON.parse(texto);
    if (!Array.isArray(arr)) return out;
    arr.forEach(function (o) {
      if (o.ts && o.master_metadata_track_name) { // historial ampliado de Spotify
        var ms = +o.ms_played || 0, fin = Date.parse(o.ts);
        out.push({ t: fin - ms, ms: ms, tr: o.master_metadata_track_name, ar: o.master_metadata_album_artist_name || '', al: o.master_metadata_album_album_name || '', p: ms >= 30000 ? 1 : 0 });
      } else if (o.endTime && o.trackName) { // datos de la cuenta de Spotify (último año)
        var ms2 = +o.msPlayed || 0, fin2 = Date.parse(o.endTime.replace(' ', 'T') + 'Z');
        out.push({ t: fin2 - ms2, ms: ms2, tr: o.trackName, ar: o.artistName || '', al: '', p: ms2 >= 30000 ? 1 : 0 });
      }
    });
    return out;
  }
  var filas = csv(texto);
  if (!filas.length) return out;
  var f0 = filas[0];
  if ('Track Description' in f0 && 'Date Played' in f0) { // Apple Music: Play History Daily Tracks
    filas.forEach(function (o) {
      var d = o['Date Played'] || '', desc = o['Track Description'] || '', i = desc.indexOf(' - ');
      if (d.length !== 8 || !desc) return;
      var h = parseInt((o['Hours'] || '12').split(',')[0], 10) || 0;
      var ms = +o['Play Duration Milliseconds'] || 0;
      out.push({ t: new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), h).getTime(), ms: ms,
        tr: i > 0 ? desc.slice(i + 3) : desc, ar: i > 0 ? desc.slice(0, i) : '', al: '', p: +o['Play Count'] || (ms >= 30000 ? 1 : 0) });
    });
  } else if ('Song Name' in f0) { // Apple Music: Play Activity
    filas.forEach(function (o) {
      var ms = +col(o, ['Play Duration Milliseconds', 'Media Duration In Milliseconds']) || 0;
      var t = Date.parse(col(o, ['Event Start Timestamp', 'Event Timestamp', 'Event End Timestamp']));
      if (!o['Song Name'] || !t || ms <= 0) return;
      out.push({ t: t, ms: ms, tr: o['Song Name'], ar: col(o, ['Artist Name', 'Container Artist Name']), al: col(o, ['Album Name', 'Container Album Name']), p: ms >= 30000 ? 1 : 0 });
    });
  }
  return out;
}
function importar(files) {
  files = Array.prototype.slice.call(files || []);
  if (!files.length) return;
  var zips = files.filter(function (f) { return /\.zip$/i.test(f.name); });
  if (zips.length) toast('Descomprime el .zip y elige los archivos de dentro');
  Promise.all(files.filter(function (f) { return /\.(json|csv)$/i.test(f.name); }).map(function (f) {
    return f.text().then(function (t) { try { return normalizar(f.name, t); } catch (e) { return []; } });
  })).then(function (listas) {
    var nuevos = [].concat.apply([], listas).filter(function (r) { return r.t && isFinite(r.t) && r.tr; });
    if (!nuevos.length) { if (!zips.length) toast('No he encontrado escuchas en esos archivos'); return; }
    var visto = {};
    H.forEach(function (r) { visto[r.t + '|' + r.tr] = 1; });
    var n = 0;
    nuevos.forEach(function (r) { var k = r.t + '|' + r.tr; if (!visto[k]) { visto[k] = 1; H.push(r); n++; } });
    H.sort(function (a, b) { return a.t - b.t; });
    dbGuardar(H);
    toast(num(n) + ' escuchas nuevas importadas');
    prepararFiltros(); pintarHistorial();
  });
}

/* ---------- análisis del historial ---------- */
function prepararFiltros() {
  var anos = {};
  H.forEach(function (r) { anos[new Date(r.t).getFullYear()] = 1; });
  var a = $('fAno'), prev = a.value;
  a.innerHTML = '<option value="">Todo</option>' + Object.keys(anos).sort().reverse().map(function (y) { return '<option>' + y + '</option>'; }).join('');
  if (prev && anos[prev]) a.value = prev; else if (Object.keys(anos).length) a.value = Object.keys(anos).sort().pop();
}
function filtrados() {
  var y = $('fAno').value, m = $('fMes').value;
  return H.filter(function (r) {
    if (!y) return true;
    var d = new Date(r.t);
    return d.getFullYear() === +y && (m === '' || d.getMonth() === +m);
  });
}
function agrupar(lista, clave) {
  var g = {};
  lista.forEach(function (r) {
    var k = clave(r); if (!k) return;
    var x = g[k] || (g[k] = { n: k, ms: 0, p: 0, ar: r.ar });
    x.ms += r.ms; x.p += r.p;
  });
  return Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return b.ms - a.ms; });
}
function pintarHistorial() {
  var hay = H.length > 0;
  $('hVacio').hidden = hay; $('hDatos').hidden = !hay;
  $('fMes').disabled = !$('fAno').value;
  if (!hay) return;
  var y = $('fAno').value, m = $('fMes').value;
  var L = filtrados();
  var total = L.reduce(function (s, r) { return s + r.ms; }, 0);
  var cans = agrupar(L, function (r) { return r.tr + ' · ' + r.ar; });
  var arts = agrupar(L, function (r) { return r.ar; });
  var albs = agrupar(L, function (r) { return r.al ? r.al + ' · ' + r.ar : ''; });
  $('hMin').textContent = num(total / 60000);
  $('hRep').textContent = num(L.reduce(function (s, r) { return s + r.p; }, 0));
  $('hCan').textContent = num(cans.length);
  $('hArt').textContent = num(arts.length);
  var desde = H[0] ? new Date(H[0].t) : null, hasta = H.length ? new Date(H[H.length - 1].t) : null;
  $('hRango').textContent = desde ? 'Tu historial va del ' + desde.toLocaleDateString('es-ES') + ' al ' + hasta.toLocaleDateString('es-ES') + ' · ' + num(H.length) + ' escuchas' : '';

  // minutos en el tiempo: por mes (todo o un año) o por día (un mes)
  var serie = [], titulo;
  if (y && m !== '') {
    var nd = new Date(+y, +m + 1, 0).getDate(), pd = new Array(nd).fill(0);
    L.forEach(function (r) { pd[new Date(r.t).getDate() - 1] += r.ms; });
    serie = pd.map(function (v, i) { return { n: (i + 1) + ' de ' + MESES[+m], v: v / 60000, et: (i === 0 || (i + 1) % 5 === 0) ? String(i + 1) : '' }; });
    titulo = 'Minutos cada día de ' + MESES[+m];
  } else if (y) {
    var pm = new Array(12).fill(0);
    L.forEach(function (r) { pm[new Date(r.t).getMonth()] += r.ms; });
    serie = pm.map(function (v, i) { return { n: MESES[i] + ' ' + y, v: v / 60000, et: MESES[i].slice(0, 3) }; });
    titulo = 'Minutos cada mes de ' + y;
  } else {
    var g = {};
    L.forEach(function (r) { var d = new Date(r.t), k = d.getFullYear() + '-' + pad(d.getMonth() + 1); g[k] = (g[k] || 0) + r.ms; });
    var ks = Object.keys(g).sort();
    if (ks.length) {
      var a0 = +ks[0].slice(0, 4), m0 = +ks[0].slice(5) - 1, a1 = +ks[ks.length - 1].slice(0, 4), m1 = +ks[ks.length - 1].slice(5) - 1;
      for (var i0 = a0 * 12 + m0; i0 <= a1 * 12 + m1; i0++) {
        var aa = Math.floor(i0 / 12), mm = i0 % 12, k = aa + '-' + pad(mm + 1);
        serie.push({ n: MESES[mm] + ' ' + aa, v: (g[k] || 0) / 60000, et: mm === 0 ? String(aa) : '' });
      }
    }
    titulo = 'Minutos cada mes';
  }
  $('hTitulo').textContent = titulo;
  columnas($('hGrafico'), serie, function (v) { return num(v) + ' min'; });

  // mapa de calor día de la semana × hora
  var mapa = []; for (var i = 0; i < 7; i++) mapa.push(new Array(24).fill(0));
  L.forEach(function (r) { var d = new Date(r.t); mapa[(d.getDay() + 6) % 7][d.getHours()] += r.ms; });
  var mx = Math.max.apply(null, mapa.map(function (f) { return Math.max.apply(null, f); })) || 1;
  $('hMapa').innerHTML = '<div class="mc-fila mc-cab"><span></span>' + Array.from({ length: 24 }, function (_, h) { return '<i>' + (h % 3 === 0 ? h : '') + '</i>'; }).join('') + '</div>' +
    mapa.map(function (f, di) {
      return '<div class="mc-fila"><span>' + DIAS[di] + '</span>' + f.map(function (v, h) {
        return '<i class="mc" style="--a:' + (v / mx).toFixed(3) + '" title="' + DIAS[di] + ' a las ' + h + ' h: ' + num(v / 60000) + ' min"></i>';
      }).join('') + '</div>';
    }).join('');
  var pico = { v: -1 };
  mapa.forEach(function (f, di) { f.forEach(function (v, h) { if (v > pico.v) pico = { v: v, d: di, h: h }; }); });
  $('hPico').textContent = pico.v > 0 ? 'Donde más escuchas: los ' + ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'][pico.d] + ' de ' + pico.h + ' a ' + (pico.h + 1) + ' h.' : '';

  var fmt = function (x) { return horas(x.ms) + ' · ' + num(x.p) + ' rep.'; };
  barras($('hTopArt'), arts.slice(0, 15).map(function (x) { return { n: x.n, v: x.ms, x: x }; }), function (d) { return fmt(d.x); });
  barras($('hTopCan'), cans.slice(0, 15).map(function (x) { return { n: x.n.split(' · ')[0], sub: x.ar, v: x.ms, x: x }; }), function (d) { return fmt(d.x); });
  $('hAlbCaja').hidden = !albs.length;
  barras($('hTopAlb'), albs.slice(0, 10).map(function (x) { return { n: x.n.split(' · ')[0], sub: x.ar, v: x.ms, x: x }; }), function (d) { return fmt(d.x); });

  // lo más escuchado cada mes
  var porMes = {};
  L.forEach(function (r) { var d = new Date(r.t), k = d.getFullYear() + '-' + pad(d.getMonth() + 1); (porMes[k] || (porMes[k] = [])).push(r); });
  var meses = Object.keys(porMes).sort().reverse().slice(0, 24);
  $('hMeses').innerHTML = meses.map(function (k) {
    var lm = porMes[k], a = agrupar(lm, function (r) { return r.ar; })[0], c = agrupar(lm, function (r) { return r.tr + ' · ' + r.ar; })[0];
    return '<tr><td>' + MESES[+k.slice(5) - 1] + ' ' + k.slice(0, 4) + '</td><td class="n">' + num(lm.reduce(function (s, r) { return s + r.ms; }, 0) / 60000) + '</td><td>' + esc(a ? a.n : '') + '</td><td>' + esc(c ? c.n.split(' · ')[0] : '') + '</td></tr>';
  }).join('');

  // día récord
  var porDia = agrupar(L, function (r) { var d = new Date(r.t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); });
  if (porDia[0]) {
    var dr = porDia[0].n, p = dr.split('-');
    var cdr = agrupar(L.filter(function (r) { var d = new Date(r.t); return d.getFullYear() === +p[0] && d.getMonth() === +p[1] - 1 && d.getDate() === +p[2]; }), function (r) { return r.tr + ' · ' + r.ar; })[0];
    $('hRecord').textContent = new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ': ' + horas(porDia[0].ms) + (cdr ? '. La que más sonó: ' + cdr.n.replace(' · ', ' de ') + '.' : '');
  }
  pintarSugerenciasH();
}
// sugerencias con todo el historial, no solo el periodo elegido
function pintarSugerenciasH() {
  if (!H.length) return;
  var fin = H[H.length - 1].t, DIA = 86400000;
  var ult = {}, pri = {}, cnt = {}, arUlt = {}, arCnt = {}, arPri = {};
  H.forEach(function (r) {
    var k = r.tr + ' · ' + r.ar;
    cnt[k] = (cnt[k] || 0) + r.p; ult[k] = r.t; if (!pri[k]) pri[k] = r.t;
    if (r.ar) { arCnt[r.ar] = (arCnt[r.ar] || 0) + r.p; arUlt[r.ar] = r.t; if (!arPri[r.ar]) arPri[r.ar] = r.t; }
  });
  var olvidadas = Object.keys(cnt).filter(function (k) { return fin - ult[k] > 120 * DIA; }).sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, 8);
  var artOlv = Object.keys(arCnt).filter(function (a) { return fin - arUlt[a] > 180 * DIA; }).sort(function (a, b) { return arCnt[b] - arCnt[a]; }).slice(0, 6);
  var nuevos = Object.keys(arCnt).filter(function (a) { return fin - arPri[a] < 60 * DIA; }).sort(function (a, b) { return arCnt[b] - arCnt[a]; }).slice(0, 6);
  var h = '';
  if (olvidadas.length) h += '<li><b>Canciones que tenías olvidadas</b>: ' + olvidadas.map(function (k) { return esc(k.replace(' · ', ' de ')) + ' (' + cnt[k] + ' veces)'; }).join(', ') + '.</li>';
  if (artOlv.length) h += '<li><b>Artistas a los que volver</b>: ' + artOlv.map(esc).join(', ') + '. Hace más de seis meses que no los escuchas.</li>';
  if (nuevos.length) h += '<li><b>Tus descubrimientos de los últimos dos meses</b>: ' + nuevos.map(esc).join(', ') + '.</li>';
  $('hSugerencias').innerHTML = h || '<li class="texto">Con más historial saldrán ideas aquí.</li>';
}

/* ---------- gráficos sencillos (una sola serie, un solo color) ---------- */
function barras(el, datos, etiqueta) {
  var max = Math.max.apply(null, datos.map(function (d) { return d.v; }).concat([1]));
  el.innerHTML = datos.map(function (d, i) {
    return '<li><span class="pos">' + (i + 1) + '</span><div class="b-txt"><div class="b-cab"><b>' + esc(d.n) + '</b>' + (d.sub ? '<small>' + esc(d.sub) + '</small>' : '') + '<span>' + etiqueta(d) + '</span></div>' +
      '<div class="barrita"><div style="width:' + (d.v / max * 100) + '%;background:var(--accent)"></div></div></div></li>';
  }).join('');
}
function columnas(el, datos, etiqueta) {
  var max = Math.max.apply(null, datos.map(function (d) { return d.v; }).concat([1]));
  el.innerHTML = datos.map(function (d) {
    return '<div class="g-col" title="' + esc(d.n) + ': ' + etiqueta(d.v) + '"><div class="g-barra" style="height:' + (d.v / max * 100) + '%"></div><span class="g-et">' + esc(d.et || '') + '</span></div>';
  }).join('');
}

/* =========================================================
   ARRANQUE
   ========================================================= */
$('cid').value = clientId();
$('redirect').textContent = REDIRECT;
$('cidGuardar').onclick = function () { ls('mm-client-id', $('cid').value.trim() || null); toast('Guardado'); };
$('spConectar').onclick = conectar;
$('spSalir').onclick = desconectar;
$('spCrear').onclick = crearLista;
document.querySelectorAll('[data-rango]').forEach(function (b) { b.onclick = function () { rango = b.dataset.rango; pintarSpotify(); }; });
$('archivos').onchange = function () { importar(this.files); this.value = ''; };
$('fAno').onchange = function () { $('fMes').value = ''; pintarHistorial(); };
$('fMes').onchange = pintarHistorial;
$('hBorrar').onclick = function () { if (confirm('¿Borrar el historial importado de este navegador?')) { H = []; dbGuardar(H); pintarHistorial(); } };
['dragover', 'drop'].forEach(function (ev) {
  $('soltar').addEventListener(ev, function (e) { e.preventDefault(); if (ev === 'drop') importar(e.dataTransfer.files); });
});

var qs = new URLSearchParams(location.search);
if (qs.get('code')) {
  history.replaceState(null, '', REDIRECT);
  canjear(qs.get('code')).then(cargarSpotify).catch(function (e) { $('spEstado').textContent = 'No se pudo conectar: ' + e.message; });
} else if (qs.get('error')) {
  history.replaceState(null, '', REDIRECT);
  $('spEstado').textContent = 'Has cancelado la conexión con Spotify.';
} else if (ls('mm-token')) {
  cargarSpotify();
} else pintarSpotify();
dbLeer().then(function (h) { H = h; prepararFiltros(); pintarHistorial(); });
