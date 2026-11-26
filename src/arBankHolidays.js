// Argentine bank non-working days for 2026 and 2027 (D-12). Only used by the
// FCE transfer window of Ley 27.440 art. 18; ordinary invoices ignore it.
// Source [S]: api.argentinadatos.com/v1/feriados/{year} (read 2026-11-26), which
// mirrors argentina.gob.ar/jefatura/feriados-nacionales-{year}, plus the bank
// employees' day (6/11). 2027 has no decree yet for moved holidays or tourist
// bridges: review against the official calendar and get user approval before
// any real FCE operation.
export const AR_BANK_HOLIDAYS = new Set([
  // 2026
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-03-23', '2026-03-24',
  '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-25', '2026-06-15',
  '2026-06-20', '2026-07-09', '2026-07-10', '2026-08-17', '2026-10-12',
  '2026-11-06', '2026-11-09', '2026-11-23', '2026-12-07', '2026-12-08',
  '2026-12-25',
  // 2027
  '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-24', '2027-03-25',
  '2027-03-26', '2027-04-02', '2027-05-01', '2027-05-25', '2027-06-17',
  '2027-06-20', '2027-07-09', '2027-08-17', '2027-10-12', '2027-11-20',
  '2027-12-08', '2027-12-25',
]);
