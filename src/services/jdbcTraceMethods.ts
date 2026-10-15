/** Extrae únicamente operaciones SQL identificadas como JDBC en la traza Rho. */
export function getJdbcMethodsFromTrace(trace: unknown): string[] {
  const lines = String(trace ?? "").split(/\r?\n/);
  const hasJdbcSection = lines.some((line) => line.trim().toUpperCase() === "JDBC");
  const found = new Set<string>();
  let inJdbc = !hasJdbcSection; // compatibilidad con trazas antiguas sin encabezados

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toUpperCase() === "JDBC") {
      inJdbc = true;
      continue;
    }
    if (/^(?:CICS|JPA|MONGO CONNECTOR|API-CONNECTOR INTERNO|API-CONNECTOR EXTERNO|TITAN CLIENT|OTROS|Flujo\s+\d+|={3,}|-{3,})$/i.test(trimmed)) {
      inJdbc = false;
    }
    if (!inJdbc) continue;

    const grouped = trimmed.match(/^[│ ]*[├└]──\s*(SELECT|INSERT|UPDATE|DELETE|MERGE):\s*(\d+)\s*$/i);
    if (grouped && Number(grouped[2]) > 0) {
      found.add(grouped[1].toUpperCase());
    }

    const detail = trimmed.match(/(?:Consulta|Salto|Sin clasificar)\s*·\s*Jdbc\[\s*(SELECT|INSERT|UPDATE|DELETE|MERGE)\b/i);
    if (detail) found.add(detail[1].toUpperCase());
  }

  return Array.from(found);
}
