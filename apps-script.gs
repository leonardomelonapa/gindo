/*
 * Pega esto en Extensiones → Apps Script del Sheet de destino.
 *
 * Antes de desplegar, en Configuración del proyecto → Propiedades del script,
 * crea la propiedad TOKEN con el mismo valor que pongas en Ajustes de Gindo.
 * El token no vive en este archivo a propósito: el repositorio es público.
 *
 * Desplegar como: Aplicación web · Ejecutar como yo · Acceso: cualquier usuario.
 */

const SHEET = 'Log';
const HEADERS = ['Clave', 'Fecha', 'Día', 'Semana', 'Fase', 'Ejercicio', 'Carga', 'Unidad', 'Series (reps/RIR)', 'Dolor máx'];

function doPost(e) {
  try {
    const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    const payload = JSON.parse(e.postData.contents);

    if (!token || payload.token !== token) return json({ ok: false, error: 'token inválido' });
    if (!Array.isArray(payload.rows)) return json({ ok: false, error: 'faltan filas' });

    const sheet = tab();
    const seen = keysIn(sheet);
    let added = 0, skipped = 0;

    for (const r of payload.rows) {
      if (seen[r.key]) { skipped++; continue; }
      sheet.appendRow([r.key, r.date, r.day, r.week, r.phase, r.exercise, r.load, r.unit, r.sets, r.maxPain]);
      seen[r.key] = true;
      added++;
    }
    return json({ ok: true, added: added, skipped: skipped });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function tab() {
  const doc = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = doc.getSheetByName(SHEET);
  if (!sheet) {
    sheet = doc.insertSheet(SHEET);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function keysIn(sheet) {
  const rows = sheet.getLastRow();
  const seen = {};
  if (rows < 2) return seen;
  for (const row of sheet.getRange(2, 1, rows - 1, 1).getValues()) seen[row[0]] = true;
  return seen;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
